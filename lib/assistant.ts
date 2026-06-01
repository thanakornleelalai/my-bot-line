// ผู้ช่วยหลัก: รวม FAQ + Google Calendar เข้าด้วยกันผ่าน Gemini function calling
//
// flow: ผู้ใช้พิมพ์มา → Gemini ตัดสินใจเองว่าจะตอบ FAQ หรือเรียกฟังก์ชันปฏิทิน
//   (เช็กว่าง/จอง/ดูคิว/ยกเลิก/เลื่อน) → ทำงานจริงกับปฏิทิน → สรุปกลับเป็นภาษาไทย

import { GoogleGenAI, Type } from "@google/genai";
import type { FunctionDeclaration } from "@google/genai";
import { DEFAULT_REPLY } from "./gemini";
import {
  checkAvailability,
  bookAppointment,
  listUpcoming,
  cancelAppointment,
  rescheduleAppointment,
} from "./calendar";

const MODEL = "gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 6; // กัน loop ไม่รู้จบ
const TIMEZONE = process.env.TIMEZONE || "Asia/Bangkok";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// ===== นิยามฟังก์ชันที่ Gemini เรียกได้ =====
const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "check_availability",
    description: "เช็กว่าช่วงเวลาที่ระบุว่างไหม (มีนัดชนหรือเปล่า) ใช้ก่อนยืนยันการจอง",
    parameters: {
      type: Type.OBJECT,
      properties: {
        startISO: { type: Type.STRING, description: "เวลาเริ่ม RFC3339 เช่น 2026-06-02T14:00:00+07:00" },
        endISO: { type: Type.STRING, description: "เวลาสิ้นสุด RFC3339" },
      },
      required: ["startISO", "endISO"],
    },
  },
  {
    name: "book_appointment",
    description: "จองคิว/สร้างนัดหมายใหม่ลงปฏิทิน ควรเช็ก check_availability ก่อนถ้าไม่แน่ใจ",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "ชื่อ/หัวข้อนัด เช่น 'นัดลูกค้า คุณเอ - ตัดผม'" },
        startISO: { type: Type.STRING, description: "เวลาเริ่ม RFC3339" },
        endISO: { type: Type.STRING, description: "เวลาสิ้นสุด RFC3339" },
        description: { type: Type.STRING, description: "รายละเอียดเพิ่มเติม (ไม่บังคับ)" },
      },
      required: ["title", "startISO", "endISO"],
    },
  },
  {
    name: "list_upcoming",
    description: "ดูคิว/นัดหมายที่กำลังจะถึง คืน eventId มาด้วย (ใช้ก่อนยกเลิก/เลื่อนเพื่อหา eventId)",
    parameters: {
      type: Type.OBJECT,
      properties: {
        maxResults: { type: Type.NUMBER, description: "จำนวนสูงสุดที่จะดึง (ดีฟอลต์ 10)" },
      },
    },
  },
  {
    name: "cancel_appointment",
    description: "ยกเลิกนัด ต้องมี eventId (เรียก list_upcoming หา eventId ก่อน)",
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING, description: "id ของ event ที่ได้จาก list_upcoming" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "reschedule_appointment",
    description: "เลื่อนนัดไปเวลาใหม่ ต้องมี eventId (เรียก list_upcoming หา eventId ก่อน)",
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING, description: "id ของ event ที่ได้จาก list_upcoming" },
        newStartISO: { type: Type.STRING, description: "เวลาเริ่มใหม่ RFC3339" },
        newEndISO: { type: Type.STRING, description: "เวลาสิ้นสุดใหม่ RFC3339" },
      },
      required: ["eventId", "newStartISO", "newEndISO"],
    },
  },
];

// ===== ตัวกระจายงาน: ชื่อฟังก์ชัน → ฟังก์ชันจริงใน calendar.ts =====
async function dispatch(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "check_availability":
      return checkAvailability(args as { startISO: string; endISO: string });
    case "book_appointment":
      return bookAppointment(args as { title: string; startISO: string; endISO: string; description?: string });
    case "list_upcoming":
      return listUpcoming(args as { maxResults?: number });
    case "cancel_appointment":
      return cancelAppointment(args as { eventId: string });
    case "reschedule_appointment":
      return rescheduleAppointment(args as { eventId: string; newStartISO: string; newEndISO: string });
    default:
      return { error: `unknown function: ${name}` };
  }
}

function buildSystemInstruction(faqCsv: string): string {
  // เวลาปัจจุบันตาม timezone ร้าน เพื่อให้ AI ตีความ "พรุ่งนี้/บ่าย 2" ได้ถูก
  const now = new Date().toLocaleString("sv-SE", { timeZone: TIMEZONE });
  return `<role>
คุณคือผู้ช่วยที่เป็นกันเองของบริการรับช่วยงาน เปรียบเหมือนเพื่อนที่มาช่วยงานให้คุณพี่
คุณช่วยได้ทั้ง ตอบคำถามจาก FAQ และ จัดการนัดหมายในปฏิทิน (เช็กว่าง/จอง/ดูคิว/ยกเลิก/เลื่อน)
</role>

<context>
- เวลาปัจจุบัน (โซน ${TIMEZONE}) คือ: ${now}
- เมื่อผู้ใช้พูดเวลาแบบกำกวม (พรุ่งนี้, บ่าย 2, สัปดาห์หน้า) ให้คำนวณเป็น RFC3339 พร้อม offset +07:00 เอง
- ถ้าผู้ใช้ไม่ได้บอกระยะเวลานัด ให้ตั้งเริ่มต้นเป็น 1 ชั่วโมง
</context>

<constraints>
- เรื่อง "คำถามทั่วไป" (ราคา เวลาเปิด เงื่อนไข ฯลฯ): ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามแต่งหรือเดา
  ถ้าไม่มีข้อมูลใน <faq> ที่ตรงกับคำถาม ให้ตอบเป๊ะ ๆ ว่า: ${DEFAULT_REPLY}
- เรื่อง "นัดหมาย" (เช็กว่าง/จอง/ดูคิว/ยกเลิก/เลื่อน): **ต้องเรียกใช้ฟังก์ชันปฏิทินที่ให้มาจริง ๆ ทันที**
  ⚠️ ห้ามตอบว่า "เดี๋ยวเช็กให้" "ขอดูให้ก่อน" "กำลังจองให้" โดยที่ยังไม่ได้เรียกฟังก์ชัน — ให้ "เรียกฟังก์ชันเลย" แล้วค่อยตอบจากผลจริง
  ⚠️ ห้ามเดาเองว่าว่าง/ไม่ว่าง/จองสำเร็จ ถ้ายังไม่ได้เรียกฟังก์ชัน
- ถ้าลูกค้าสั่งจองและให้ข้อมูลครบ (วัน เวลา ชื่อ) ให้เรียก book_appointment จองเลย ไม่ต้องถามยืนยันซ้ำ
  ถ้าข้อมูลไม่ครบจริง ๆ (ไม่รู้วันหรือเวลา) ค่อยถามเฉพาะส่วนที่ขาด
- ถ้าลูกค้าถามว่ามีคิว/นัดอะไรบ้าง ให้เรียก list_upcoming เลย แล้วสรุปจากผลจริง
- ก่อนยกเลิกหรือเลื่อนนัด ให้เรียก list_upcoming เพื่อหา eventId ที่ถูกต้องก่อนเสมอ
- หลังทำรายการปฏิทินสำเร็จ ให้ยืนยันสั้น ๆ ว่าทำอะไรไปแล้ว (วัน-เวลาที่อ่านง่าย)
- โทน: เป็นกันเอง อบอุ่น แทนตัวเองว่า "เรา" เรียกลูกค้าว่า "คุณพี่"
- ใช้ emoji ได้ไม่เกิน 1 ตัวต่อข้อความ
- ความยาวกระชับ ไม่ใช้ markdown ไม่ใช้ bullet ตอบเป็นภาษาไทย
</constraints>

<faq>
${faqCsv}
</faq>`;
}

/**
 * ถาม assistant (FAQ + ปฏิทิน)
 * - คืนข้อความตอบ หรือ DEFAULT_REPLY ถ้าตอบว่าง/พัง
 */
export async function askAssistant(faqCsv: string, userMessage: string): Promise<string> {
  const ai = getClient();

  const chat = ai.chats.create({
    model: MODEL,
    config: {
      systemInstruction: buildSystemInstruction(faqCsv),
      tools: [{ functionDeclarations }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  let resp = await chat.sendMessage({ message: userMessage });

  let round = 0;
  while (resp.functionCalls && resp.functionCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
    round++;

    const responseParts = [];
    for (const fc of resp.functionCalls) {
      let result: unknown;
      try {
        result = await dispatch(fc.name ?? "", (fc.args ?? {}) as Record<string, unknown>);
      } catch (err) {
        console.error(`[assistant] tool ${fc.name} error:`, err);
        result = { error: String((err as Error).message) };
      }
      responseParts.push({
        functionResponse: {
          name: fc.name ?? "",
          response: (result ?? {}) as Record<string, unknown>,
        },
      });
    }

    resp = await chat.sendMessage({ message: responseParts });
  }

  // log ไว้ดูพฤติกรรม (จำนวนรอบ tool + finishReason)
  console.log(
    "[assistant]",
    JSON.stringify({
      toolRounds: round,
      finishReason: resp.candidates?.[0]?.finishReason,
      candidatesTokenCount: resp.usageMetadata?.candidatesTokenCount,
    })
  );

  const text = (resp.text ?? "").trim();
  return text || DEFAULT_REPLY;
}
