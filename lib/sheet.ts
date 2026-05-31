// ดึง FAQ จาก Google Sheet (public CSV) แล้ว cache ในหน่วยความจำ 60 วินาที
//
// หมายเหตุ: บน Vercel แต่ละ serverless instance มีหน่วยความจำของตัวเอง + มี cold start
// cache จึงอาจไม่ติดข้ามทุก request แต่ก็ยังช่วยลดการยิง Sheet ตอน instance อุ่นอยู่

const CACHE_TTL_MS = 60_000;

type SheetCache = {
  data: string;
  fetchedAt: number;
};

// module-level cache (อยู่ได้ตราบที่ instance ยังอุ่น)
let cache: SheetCache | null = null;

/**
 * คืน CSV ของ FAQ ทั้งก้อนเป็น string
 * - ถ้า cache ยังไม่หมดอายุ (< 60s) → คืน cache
 * - ถ้าดึงใหม่ไม่ได้แต่มี cache เก่า → ใช้ cache เก่าต่อ (stale-while-error)
 * - ถ้าดึงไม่ได้และไม่มี cache เลย → throw ให้ผู้เรียกจัดการ (ตอบ default reply)
 */
export async function getFaq(): Promise<string> {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    if (cache) {
      console.error("[sheet] SHEET_CSV_URL not set, using stale cache");
      return cache.data;
    }
    throw new Error("SHEET_CSV_URL is not set");
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Sheet fetch failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.text();
    cache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    if (cache) {
      console.error("[sheet] fetch failed, falling back to stale cache:", err);
      return cache.data;
    }
    console.error("[sheet] fetch failed and no cache available:", err);
    throw err;
  }
}
