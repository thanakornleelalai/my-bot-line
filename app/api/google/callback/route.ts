// SETUP (ใช้ครั้งเดียว): รับ code จาก Google → แลกเป็น refresh token → แสดงให้ก๊อปไปใส่ env
//
// หลังได้ refresh token: เอาไปใส่ GOOGLE_OAUTH_REFRESH_TOKEN ใน Vercel
// แล้วแนะนำให้ลบโฟลเดอร์ app/api/google ทิ้ง (ไม่ให้ใครเรียก flow นี้ได้อีก)

import type { NextRequest } from "next/server";
import { getOAuthClient } from "@/lib/google-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) return new Response("OAuth error: " + error, { status: 400 });
  if (!code) return new Response("Missing ?code", { status: 400 });

  const redirectUri = `${url.origin}/api/google/callback`;

  try {
    const oauth = getOAuthClient(redirectUri);
    const { tokens } = await oauth.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return new Response(
        "ไม่ได้ refresh token (อาจเคย authorize ไปแล้ว) — ลองเพิกถอนสิทธิ์ที่ https://myaccount.google.com/permissions แล้วทำใหม่",
        { status: 400 }
      );
    }

    // แสดงเป็น text ธรรมดา (หน้านี้ควรถูกลบหลังใช้)
    const html = `<!doctype html><meta charset="utf-8"><title>Refresh Token</title>
<body style="font-family:system-ui;padding:24px;max-width:720px;margin:auto">
<h2>✅ ได้ refresh token แล้ว</h2>
<p>ก๊อปค่าด้านล่างไปใส่ใน Vercel → Settings → Environment Variables ชื่อ <code>GOOGLE_OAUTH_REFRESH_TOKEN</code></p>
<textarea style="width:100%;height:90px;font-size:14px" readonly>${refreshToken}</textarea>
<p style="color:#c00"><b>สำคัญ:</b> หลังใส่ค่าแล้ว ให้ลบโฟลเดอร์ <code>app/api/google</code> แล้ว deploy ใหม่ เพื่อปิดช่องนี้</p>
</body>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    return new Response("แลก token ไม่สำเร็จ: " + String((err as Error).message), { status: 500 });
  }
}
