// ประกอบ prompt + เรียก Gemini Flash ตอบคำถามลูกค้าโดยอิง FAQ เท่านั้น
//
// หมายเหตุ (พิสูจน์ด้วยการยิง API จริงผ่าน @google/genai):
//  - ใช้ gemini-2.5-flash (บรีฟเดิมระบุ gemini-3.5-flash แต่โมเดลนั้นไม่มีจริง → 404)
//  - ไม่ใส่ temperature / top_p / top_k (ปล่อย default)
//  - ปิด thinking ด้วย thinkingBudget: 0 เพื่อให้ตอบเร็วเหมาะงาน FAQ สั้น ๆ
//    (บรีฟเดิมใช้ thinkingLevel: "minimal" แต่นั่นเป็นพารามิเตอร์ของ Gemini 3.x
//     ซึ่ง 2.5 ไม่รองรับ → 400 "thinking_level is not supported by this model")
//    ตั้ง maxOutputTokens: 1024 เหลือเฟือ และทันลิมิต 10 วิของ LINE

import { GoogleGenAI } from "@google/genai";

export const DEFAULT_REPLY = "เราไม่รู้เหมือนกันจ้าคุณพี่";

const MODEL = "gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 8_000; // กันชน 10 วิของ LINE

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// โครง prompt ตาม Google official — เอา FAQ ไว้ก่อน, คำถามลูกค้าไว้ท้ายสุด
function buildPrompt(faqCsv: string, userMessage: string): string {
  return `<role>
คุณคือผู้ช่วยที่เป็นกันเองของบริการรับช่วยงาน เปรียบเหมือนเพื่อนที่มาช่วยงานให้คุณพี่
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น
- ห้ามแต่งหรือเดา ราคา เวลา ที่ตั้ง เงื่อนไข หรือรายละเอียดใด ๆ ที่ไม่มีใน <faq>
- ถ้าไม่มีข้อมูลใน <faq> ที่ตรงกับคำถาม ให้ตอบด้วยข้อความนี้เป๊ะ ๆ ห้ามดัดแปลง:
  ${DEFAULT_REPLY}
- โทน: เป็นกันเอง อบอุ่น เหมือนเพื่อนช่วยงาน
- แทนตัวเองว่า "เรา" และเรียกลูกค้าว่า "คุณพี่"
- ใช้ emoji ได้ไม่เกิน 1 ตัวต่อข้อความ (ไม่ใช้เลยก็ได้)
- ความยาว 1–3 ประโยค
</constraints>

<output_format>
ตอบเป็นภาษาไทย ไม่ใช้ markdown ไม่ใช้หัวข้อ ไม่ใช้ bullet
</output_format>

<faq>
${faqCsv}
</faq>

<question>
${userMessage}
</question>`;
}

/**
 * เรียก Gemini ตอบคำถามลูกค้า
 * - คืนข้อความคำตอบ หรือ DEFAULT_REPLY ถ้า MAX_TOKENS / ตอบว่าง / timeout / error
 */
export async function askGemini(faqCsv: string, userMessage: string): Promise<string> {
  try {
    const ai = getClient();

    const request = ai.models.generateContent({
      model: MODEL,
      contents: buildPrompt(faqCsv, userMessage),
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // thinkingBudget: 0 = ปิด thinking (เร็วสุด เหมาะงาน FAQ สั้น ๆ)
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // timeout ~8 วิ กันชน 10 วิของ LINE
    const res = await Promise.race([
      request,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini timeout")), TIMEOUT_MS)
      ),
    ]);

    const candidate = res.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const usage = res.usageMetadata;

    // log ตามบรีฟ: finishReason + thoughtsTokenCount + candidatesTokenCount ทุก request
    console.log(
      "[gemini]",
      JSON.stringify({
        finishReason,
        thoughtsTokenCount: usage?.thoughtsTokenCount,
        candidatesTokenCount: usage?.candidatesTokenCount,
      })
    );

    if (finishReason === "MAX_TOKENS") {
      // กันส่งครึ่งประโยค
      return DEFAULT_REPLY;
    }

    const text = (res.text ?? "").trim();
    if (!text) return DEFAULT_REPLY;

    return text;
  } catch (err) {
    console.error("[gemini] error:", err);
    return DEFAULT_REPLY;
  }
}
