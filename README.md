# my-bot-line

LINE Bot ตอบลูกค้าด้วย Gemini 3.5 Flash อิงคำตอบจาก FAQ ใน Google Sheet

## Stack
- Next.js 14 (App Router) + TypeScript, deploy บน Vercel
- Webhook: `POST /api/line-webhook`
- `@line/bot-sdk` รับ event + ส่ง reply
- `@google/genai` → โมเดล `gemini-3.5-flash` (`thinkingLevel: "minimal"`)
- FAQ ดึงจาก Google Sheet (public CSV) cache 60 วินาที

## โครงไฟล์
```
app/
  layout.tsx
  page.tsx
  api/line-webhook/route.ts   ← verify signature → handle events → reply
lib/
  sheet.ts                    ← ดึง CSV + cache 60s
  gemini.ts                   ← ประกอบ prompt + เรียก gemini-3.5-flash
vercel.json                   ← framework: nextjs
```

## Env vars (ตั้งทั้งใน `.env.local` และใน Vercel → Project Settings → Environment Variables)
| ชื่อ | ที่มา |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console → Messaging API |
| `LINE_CHANNEL_SECRET` | LINE Developers Console → Basic settings |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `SHEET_CSV_URL` | Google Sheet → File → Share → Publish to web → CSV |

## Google Sheet schema
แถวแรกเป็น header: `question,answer` (เพิ่ม `keywords` ได้ ไม่บังคับ)

## Dev
```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # ตรวจ build ก่อน deploy
```

## Deploy & ตั้งค่า webhook
1. ตั้ง env 4 ตัวใน Vercel → Settings → Environment Variables
2. `git push` → Vercel auto-deploy จนขึ้น "Ready"
3. LINE Developers Console → Messaging API → Webhook URL:
   `https://<your-domain>/api/line-webhook` แล้วกด **Verify** (ต้องได้ Success)
4. เปิด **Use webhook = ON** และปิด **Auto-reply messages** ใน LINE Official Account Manager
5. ทดสอบ: ทักหาบอท → ดู Vercel Runtime Logs ว่ามี log `finishReason / thoughtsTokenCount / candidatesTokenCount`
