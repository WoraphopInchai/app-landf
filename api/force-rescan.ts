import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ApiHttpError, handleRequest, ok } from "./_lib/http.js";
import { authUid, db } from "./_lib/firebase.js";
import { runAiMatchServer } from "./_lib/ai.js";

export default handleRequest(async (req: VercelRequest, res: VercelResponse) => {
  const uid = await authUid(req);

  const limiterRef = db().doc(`meta/forceScan/users/${uid}`);
  const limiterSnap = await limiterRef.get();
  const lastRun = Number(
    (limiterSnap.data() as { lastRunAtMs?: number } | undefined)?.lastRunAtMs || 0
  );
  const now = Date.now();
  if (now - lastRun < 60_000) {
    throw new ApiHttpError(429, "กรุณารอ 1 นาทีก่อนกดอีกครั้ง");
  }

  const snap = await db().collection("posts").where("userId", "==", uid).limit(50).get();
  const targets = snap.docs.filter((d) => {
    const s = String(d.data().status || "active");
    const it = String(d.data().itemType || d.data().type || "");
    return s === "active" || (s === "pending" && it === "found");
  });

  let postsDone = 0;
  let totalMatches = 0;
  for (const d of targets) {
    const r = await runAiMatchServer({ db: db(), postId: d.id, extractOwnerUid: uid });
    postsDone++;
    totalMatches += r.matches.length;
  }

  await limiterRef.set({ lastRunAtMs: now });
  return ok(res, { postsDone, totalMatches });
});