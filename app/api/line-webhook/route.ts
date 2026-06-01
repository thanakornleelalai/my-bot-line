// LINE webhook endpoint
//  - verify signature (HMAC-SHA256 ของ raw body ด้วย LINE_CHANNEL_SECRET)
//  - parse events → เลือกเฉพาะ message ที่เป็น text
//  - ดึง FAQ (cache 60s) → ถาม Gemini → reply
//  - ลงเอยที่ 200 เสมอ (กัน LINE retry รัว ๆ) ยกเว้น signature ไม่ผ่าน → 401

import type { NextRequest } from "next/server";
import { validateSignature, messagingApi, type WebhookEvent } from "@line/bot-sdk";
import { getFaq } from "@/lib/sheet";
import { DEFAULT_REPLY } from "@/lib/gemini";
import { askAssistant } from "@/lib/assistant";

// SDK ของ LINE ต้องรันบน Node ไม่ใช่ Edge
export const runtime = "nodejs";

// เผื่อเวลา: assistant อาจเรียกปฏิทินหลายรอบ (function calling) ตั้ง maxDuration กว้างขึ้น
export const maxDuration = 30;

let lineClient: messagingApi.MessagingApiClient | null = null;

function getLineClient(): messagingApi.MessagingApiClient {
  if (!lineClient) {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
    lineClient = new messagingApi.MessagingApiClient({ channelAccessToken });
  }
  return lineClient;
}

export async function POST(req: NextRequest): Promise<Response> {
  // 1) อ่าน raw body (จำเป็นต่อการ verify signature)
  const body = await req.text();
  const signature = req.headers.get("x-line-signature");

  // 2) verify signature — ไม่ผ่าน → 401 ทันที ไม่แตะ AI/Sheet
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    console.error("[webhook] LINE_CHANNEL_SECRET is not set");
    return new Response("Server misconfigured", { status: 500 });
  }
  if (!signature || !validateSignature(body, channelSecret, signature)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 3) parse events
  let events: WebhookEvent[] = [];
  try {
    events = (JSON.parse(body).events ?? []) as WebhookEvent[];
  } catch (err) {
    console.error("[webhook] failed to parse body:", err);
    return new Response("OK", { status: 200 });
  }

  // ทำงานให้เสร็จ "ก่อน" คืน 200 (บน Vercel serverless งานหลังคืน response อาจถูกตัด)
  await Promise.all(events.map(handleEvent));

  return new Response("OK", { status: 200 });
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  try {
    // 4) เลือกเฉพาะ message ที่เป็น text — อย่างอื่นข้าม
    if (event.type !== "message" || event.message.type !== "text") return;

    const userMessage = event.message.text;

    // 5) ดึง FAQ → ถาม assistant (FAQ + ปฏิทิน) — ลงเอยที่ DEFAULT_REPLY เสมอถ้าพัง
    let reply = DEFAULT_REPLY;
    try {
      const faqCsv = await getFaq();
      reply = await askAssistant(faqCsv, userMessage);
    } catch (err) {
      console.error("[webhook] assistant error:", err);
      reply = DEFAULT_REPLY;
    }

    // 6) reply กลับ
    await getLineClient().replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: reply }],
    });
  } catch (err) {
    // 7) reply ไม่สำเร็จ / replyToken หมดอายุ → log แล้วปล่อยให้คืน 200 อยู่ดี
    console.error("[webhook] handleEvent error:", err);
  }
}
