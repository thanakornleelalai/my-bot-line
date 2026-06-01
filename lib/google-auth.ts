// สร้าง OAuth2 client ของ Google จาก env แล้วคืน Calendar client ที่ auth แล้ว
//
// แนวทาง: เจ้าของร้าน authorize ครั้งเดียว → ได้ refresh token → เก็บเป็น env
// จากนั้นบอทใช้ refresh token แลก access token เองอัตโนมัติ ไม่ต้อง login ซ้ำ

import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";

// scope แบบอ่าน/เขียนปฏิทินเต็มรูปแบบ (จอง/แก้/ลบได้)
export const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"];

/**
 * OAuth2 client เปล่า ๆ (ใช้ทั้งตอนทำ consent flow และตอนใช้งานจริง)
 * redirectUri จำเป็นเฉพาะตอนทำ consent flow
 */
export function getOAuthClient(redirectUri?: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET is not set");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Calendar client ที่พร้อมใช้งาน (ใช้ refresh token จาก env)
 */
export function getCalendarClient(): calendar_v3.Calendar {
  const oauth = getOAuthClient();
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("GOOGLE_OAUTH_REFRESH_TOKEN is not set (ยังไม่ได้ทำ authorize ครั้งแรก)");
  }
  oauth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth: oauth });
}
