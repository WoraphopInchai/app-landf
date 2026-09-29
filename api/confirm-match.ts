import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ApiHttpError, handleRequest, ok, readJson } from "./_lib/http.js";
import { authUid, db } from "./_lib/firebase.js";
import type { AiMatchRecord } from "./_lib/ai.js";

interface ConfirmData {
  myPostId?: string;
  otherPostId?: string;
  action?: "confirm" | "reject";
}

export default handleRequest(async (req: VercelRequest, res: VercelResponse) => {
  const uid = await authUid(req);
  const data = (await readJson(req)) as ConfirmData;

  const { myPostId, otherPostId, action } = data;
  if (!myPostId || !otherPostId || (action !== "confirm" && action !== "reject")) {
    throw new ApiHttpError(400, "ข้อมูลไม่ครบถ้วน");
  }
  if (myPostId === otherPostId) {
    throw new ApiHttpError(400, "คู่แมทต้องเป็นคนละโพสต์");
  }

  // กันกดรัวเพื่อกินโควตา writes ของ Firestore แผนฟรี (1 ครั้ง = 2 writes + 1)
  const limiterRef = db().doc(`meta/confirmMatch/users/${uid}`);
  const limiterSnap = await limiterRef.get();
  const lastStamp = Number(
    (limiterSnap.data() as { lastStampAtMs?: number } | undefined)?.lastStampAtMs || 0
  );
  if (Date.now() - lastStamp < 5_000) {
    throw new ApiHttpError(429, "กดถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
  }

  const now = new Date().toISOString();
  const stamp =
    action === "confirm"
      ? { confirmed: true, confirmedBy: uid, confirmedAt: now, rejected: false }
      : { rejected: true, rejectedBy: uid, rejectedAt: now, confirmed: false };

  const myRef = db().doc(`posts/${myPostId}`);
  const otherRef = db().doc(`posts/${otherPostId}`);

  try {
    await db().runTransaction(async (tx) => {
      const mySnap = await tx.get(myRef);
      if (!mySnap.exists) throw new ApiHttpError(404, "ไม่พบโพสต์ของคุณ");
      const my = mySnap.data() as {
        userId?: string;
        matches?: AiMatchRecord[];
        nearMatches?: AiMatchRecord[];
      };
      if (String(my.userId || "") !== uid) {
        throw new ApiHttpError(403, "คุณไม่ใช่เจ้าของโพสต์นี้");
      }

      const hasEntry = [...(my.matches || []), ...(my.nearMatches || [])].some(
        (m) => m.matchedPostId === otherPostId
      );
      if (!hasEntry) {
        throw new ApiHttpError(404, "ไม่พบคู่แมทนี้ในโพสต์ของคุณ");
      }

      const otherSnap = await tx.get(otherRef);
      if (!otherSnap.exists) throw new ApiHttpError(404, "ไม่พบโพสต์อีกฝ่าย");
      const other = otherSnap.data() as { matches?: AiMatchRecord[]; nearMatches?: AiMatchRecord[] };

      // อีกฝั่งปฏิเสธคู่นี้ไปแล้ว = ปฏิเสธคู่นั้นถาวร ไม่ให้มายืนยันแทน/กู้คืน
      if (action === "confirm") {
        const otherRejected = [...(other.matches || []), ...(other.nearMatches || [])].some(
          (m) => m.matchedPostId === myPostId && m.rejected
        );
        if (otherRejected) {
          throw new ApiHttpError(409, "อีกฝั่งได้ทำเครื่องหมายว่าไม่ใช่คู่ของกันแล้ว");
        }
      }

      const stampArr = (arr?: AiMatchRecord[]): AiMatchRecord[] =>
        (arr || []).map((m) =>
          m.matchedPostId === otherPostId ? { ...m, ...stamp } : m
        );
      const stampOtherArr = (arr?: AiMatchRecord[]): AiMatchRecord[] =>
        (arr || []).map((m) =>
          m.matchedPostId === myPostId ? { ...m, ...stamp } : m
        );

      tx.update(myRef, {
        matches: stampArr(my.matches),
        nearMatches: stampArr(my.nearMatches),
        [`aiJudgedAt.${otherPostId}`]: now,
      });
      tx.update(otherRef, {
        matches: stampOtherArr(other.matches),
        nearMatches: stampOtherArr(other.nearMatches),
        [`aiJudgedAt.${myPostId}`]: now,
      });
    });
    await limiterRef.set({ lastStampAtMs: Date.now() });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    console.error("[api] confirmAiPair error:", err);
    throw new ApiHttpError(500, "เกิดข้อผิดพลาดในการยืนยันคู่แมท");
  }

  return ok(res, { ok: true as const, action, at: now });
});