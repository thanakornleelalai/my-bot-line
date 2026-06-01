// SETUP (ใช้ครั้งเดียว): เริ่ม OAuth consent flow เพื่อขอ refresh token ของเจ้าของปฏิทิน
//
// วิธีใช้: เปิด https://<domain>/api/google/auth ในเบราว์เซอร์ (ล็อกอิน Google ของเจ้าของร้าน)
// → Google จะ redirect กลับมาที่ /api/google/callback พร้อม refresh token
//
// แนะนำให้ลบ 2 route นี้ (โฟลเดอร์ app/api/google) ทิ้งหลังได้ refresh token แล้ว

import type { NextRequest } from "next/server";
import { getOAuthClient, CALENDAR_SCOPES } from "@/lib/google-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/google/callback`;

  try {
    const oauth = getOAuthClient(redirectUri);
    const url = oauth.generateAuthUrl({
      access_type: "offline", // จำเป็นเพื่อให้ได้ refresh token
      prompt: "consent", // บังคับให้ออก refresh token ใหม่ทุกครั้ง
      scope: CALENDAR_SCOPES,
    });
    return Response.redirect(url, 302);
  } catch (err) {
    return new Response("OAuth not configured: " + String((err as Error).message), {
      status: 500,
    });
  }
}
