import { auth } from "../firebase";

// ประเภทข้อมูลแมท AI (server เขียนให้ client อ่าน)
export interface AiMatchRecord {
  matchedPostId: string;
  matchedTitle: string;
  similarityScore: number;
  reason?: string;
  confirmed?: boolean;
  confirmedBy?: string;
  confirmedAt?: string;
  rejected?: boolean;
  rejectedBy?: string;
  rejectedAt?: string;
}

// ---------- เกณฑ์คะแนน (ต้องตรงกับ api/_lib/ai.ts) ----------
export const MATCH_MIN_SCORE = 60;
export const NEAR_MATCH_MIN_SCORE = 45;
export const NEAR_MATCH_MAX_SCORE = MATCH_MIN_SCORE - 1;

// base URL ของ Vercel backend (ตั้งได้ผ่าน env: VITE_API_BASE_URL)
// ว่าง = เรียก relative /api/... กับโฮสต์เดียวกับ frontend
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";

async function getToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("กรุณาเข้าสู่ระบบก่อน");
  return user.getIdToken();
}

async function post<TReq, TRes>(
  path: string,
  body: TReq
): Promise<TRes> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[aiMatch] fetch ${path} failed:`, err);
    throw new Error("ไม่สามารถติดต่อเซิร์ฟเวอร์ได้ (network error)", { cause: err });
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ใช้ message เริ่มต้น
    }
    throw new Error(message);
  }
  return (await res.json()) as TRes;
}

// เจ้าของโพสต์กด "ใช่ของฉัน / ไม่ใช่ของฉัน" กับคู่แมท
export async function confirmAiPair(
  myPostId: string,
  otherPostId: string,
  action: "confirm" | "reject"
): Promise<{ ok: boolean }> {
  return post<
    { myPostId: string; otherPostId: string; action: "confirm" | "reject" },
    { ok: boolean }
  >("/api/confirm-match", { myPostId, otherPostId, action });
}

// ปุ่ม "รีเฟรชคู่แนะนำ" — ให้ server สแกนโพสต์ทั้งหมดของผู้ใช้ (กฎฟรี จำกัด 1 ครั้ง/นาที)
export async function runForceRescan(): Promise<{
  postsDone: number;
  totalMatches: number;
}> {
  return post<Record<string, never>, { postsDone: number; totalMatches: number }>(
    "/api/force-rescan",
    {}
  );
}