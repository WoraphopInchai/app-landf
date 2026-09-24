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
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    console.error("[api] confirmAiPair error:", err);
    throw new ApiHttpError(500, "เกิดข้อผิดพลาดในการยืนยันคู่แมท");
  }

  return ok(res, { ok: true as const, action, at: now });
});