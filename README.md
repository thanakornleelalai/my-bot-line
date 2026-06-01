# my-bot-line

LINE Bot ตอบลูกค้าด้วย Gemini (gemini-2.5-flash) อิงคำตอบจาก FAQ ใน Google Sheet
และจัดการนัดหมายใน Google Calendar (เช็กว่าง / จอง / ดูคิว / ยกเลิก / เลื่อน) ผ่าน function calling

## Stack
- Next.js 14 (App Router) + TypeScript, deploy บน Vercel
- Webhook: `POST /api/line-webhook`
- `@line/bot-sdk` รับ event + ส่ง reply
- `@google/genai` → โมเดล `gemini-2.5-flash` (`thinkingBudget: 0`) + function calling
- `googleapis` → Google Calendar v3 (OAuth refresh token)
- FAQ ดึงจาก Google Sheet (public CSV) cache 60 วินาที

## โครงไฟล์
```
app/
  api/line-webhook/route.ts     ← verify signature → handle events → reply
  api/google/auth/route.ts      ← SETUP: เริ่ม OAuth consent (ใช้ครั้งเดียว)
  api/google/callback/route.ts  ← SETUP: รับ refresh token (ใช้ครั้งเดียว)
lib/
  sheet.ts                      ← ดึง CSV + cache 60s
  gemini.ts                     ← prompt + DEFAULT_REPLY (FAQ ล้วน)
  assistant.ts                  ← orchestrator: FAQ + ปฏิทิน ผ่าน function calling
  calendar.ts                   ← เช็กว่าง/จอง/ดูคิว/ยกเลิก/เลื่อน
  google-auth.ts                ← OAuth2 client + calendar client
vercel.json                     ← framework: nextjs
```

## Env vars (ตั้งทั้งใน `.env.local` และใน Vercel → Settings → Environment Variables)
| ชื่อ | ที่มา |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console → Messaging API |
| `LINE_CHANNEL_SECRET` | LINE Developers Console → Basic settings |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `SHEET_CSV_URL` | Google Sheet → File → Share → Publish to web → CSV |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → Credentials → OAuth Client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | เหมือนข้างบน |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | ได้จากขั้นตอน OAuth setup ด้านล่าง |
| `GOOGLE_CALENDAR_ID` | `primary` หรือ id ปฏิทินเฉพาะ |
| `TIMEZONE` | `Asia/Bangkok` |

## Google Sheet schema
แถวแรกเป็น header: `question,answer` (เพิ่ม `keywords` ได้ ไม่บังคับ)

## ตั้งค่า Google Calendar (OAuth) — ทำครั้งเดียว
1. **Google Cloud Console** → สร้าง/เลือกโปรเจกต์ → เปิดใช้ **Google Calendar API**
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://<your-domain>/api/google/callback`
   - ถ้า consent screen ยัง "Testing" ให้เพิ่มอีเมลเจ้าของเป็น **Test user**
3. เอา Client ID / Secret ใส่ env `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` ใน Vercel แล้ว deploy
4. เปิด `https://<your-domain>/api/google/auth` ในเบราว์เซอร์ → ล็อกอิน Google **ของเจ้าของปฏิทิน** → กดอนุญาต
5. หน้า callback จะโชว์ **refresh token** → ก๊อปไปใส่ env `GOOGLE_OAUTH_REFRESH_TOKEN` ใน Vercel → deploy ใหม่
6. **ลบโฟลเดอร์ `app/api/google`** แล้ว deploy อีกครั้ง เพื่อปิดช่อง setup (ความปลอดภัย)

## Dev
```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # ตรวจ build ก่อน deploy
```

## Deploy & ตั้งค่า webhook
1. ตั้ง env ทั้งหมดใน Vercel → Settings → Environment Variables
2. `git push` → Vercel auto-deploy จนขึ้น "Ready"
3. LINE Developers Console → Messaging API → Webhook URL:
   `https://<your-domain>/api/line-webhook` แล้วกด **Verify**
4. เปิด **Use webhook = ON** และปิด **Auto-reply messages** ใน LINE Official Account Manager
5. ทดสอบ: ทักหาบอท → ดู Vercel Runtime Logs (log `[assistant]` มี toolRounds / finishReason)

## ตัวอย่างที่บอททำได้
- "วันศุกร์บ่าย 2 ว่างไหม" → เช็กปฏิทิน
- "จองคิวตัดผมพรุ่งนี้ 10 โมง ชื่อคุณเอ" → สร้าง event
- "มีคิวอะไรบ้างสัปดาห์นี้" → ลิสต์นัด
- "ยกเลิกนัดวันศุกร์" / "เลื่อนนัดพรุ่งนี้เป็นบ่าย 3" → แก้/ลบ event
