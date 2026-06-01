// การทำงานกับ Google Calendar: เช็กว่าง / จอง / ดูคิว / ยกเลิก / เลื่อนนัด
//
// ทุกฟังก์ชันคืนค่าเป็น object ที่ JSON ได้ เพื่อส่งกลับให้ Gemini (function calling)
// เวลา (datetime) ใช้รูปแบบ RFC3339 พร้อม offset เช่น 2026-06-02T14:00:00+07:00

import { getCalendarClient } from "./google-auth";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const TIMEZONE = process.env.TIMEZONE || "Asia/Bangkok";

// เช็กว่าช่วงเวลาที่ระบุว่างไหม (มี event ชนหรือเปล่า)
export async function checkAvailability(args: {
  startISO: string;
  endISO: string;
}): Promise<unknown> {
  const calendar = getCalendarClient();
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: args.startISO,
      timeMax: args.endISO,
      timeZone: TIMEZONE,
      items: [{ id: CALENDAR_ID }],
    },
  });
  const busy = res.data.calendars?.[CALENDAR_ID]?.busy ?? [];
  return { free: busy.length === 0, busy };
}

// จองคิว/สร้างนัดหมาย
export async function bookAppointment(args: {
  title: string;
  startISO: string;
  endISO: string;
  description?: string;
}): Promise<unknown> {
  const calendar = getCalendarClient();
  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: args.title,
      description: args.description,
      start: { dateTime: args.startISO, timeZone: TIMEZONE },
      end: { dateTime: args.endISO, timeZone: TIMEZONE },
    },
  });
  return {
    id: res.data.id,
    summary: res.data.summary,
    start: res.data.start?.dateTime,
    end: res.data.end?.dateTime,
    htmlLink: res.data.htmlLink,
  };
}

// ดูคิว/นัดหมายที่กำลังจะถึง
export async function listUpcoming(args: { maxResults?: number }): Promise<unknown> {
  const calendar = getCalendarClient();
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: new Date().toISOString(),
    maxResults: args.maxResults ?? 10,
    singleEvents: true,
    orderBy: "startTime",
  });
  const events = (res.data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
  }));
  return { events };
}

// ยกเลิกนัด (ต้องมี eventId — ปกติให้เรียก listUpcoming หา eventId ก่อน)
export async function cancelAppointment(args: { eventId: string }): Promise<unknown> {
  const calendar = getCalendarClient();
  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: args.eventId });
  return { success: true, eventId: args.eventId };
}

// เลื่อนนัด (ต้องมี eventId + เวลาใหม่)
export async function rescheduleAppointment(args: {
  eventId: string;
  newStartISO: string;
  newEndISO: string;
}): Promise<unknown> {
  const calendar = getCalendarClient();
  const res = await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: args.eventId,
    requestBody: {
      start: { dateTime: args.newStartISO, timeZone: TIMEZONE },
      end: { dateTime: args.newEndISO, timeZone: TIMEZONE },
    },
  });
  return {
    id: res.data.id,
    summary: res.data.summary,
    start: res.data.start?.dateTime,
    end: res.data.end?.dateTime,
  };
}
