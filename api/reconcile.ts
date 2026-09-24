import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "firebase-admin";
import { handleRequest, ok, sendJson } from "./_lib/http.js";
import { authUid, db } from "./_lib/firebase.js";
import { runAiMatchServer, needsScanServer, POSTS_PER_RECONCILE } from "./_lib/ai.js";

function cronAuthorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization || "";
  return header === `Bearer ${secret}`;
}

// ผู้ใช้เปิดแอปแล้วเรียกกวาดเองได้ (โดยกว่าไม่ถี่เกิน 60 วินาที กันโควตา Gemini เหลือเกิน)
const SWEEP_COOLDOWN_MS = 60_000;

async function acquireUserCooldown(): Promise<boolean> {
  const ref = db().collection("meta").doc("reconcileCooldown");
  let allowed = false;
  await db().runTransaction(async (tx) => {
    const now = Date.now();
    const snap = await tx.get(ref);
    const last = snap.data()?.lastRunAt as
      | admin.firestore.Timestamp
      | string
      | undefined;
    let lastMs = 0;
    if (last) lastMs = typeof last === "string" ? Date.parse(last) : last.toMillis();
    if (Number.isFinite(lastMs) && now - lastMs < SWEEP_COOLDOWN_MS) return;
    allowed = true;
    tx.set(ref, { lastRunAt: admin.firestore.Timestamp.now() }, { merge: true });
  });
  return allowed;
}

async function runMatchSweep(): Promise<{ postsDone: number; totalMatches: number }> {
  const snap = await db()
    .collection("posts")
    .where("status", "in", ["active", "pending"])
    .limit(500)
    .get();

  const candidates = snap.docs
    .filter((d) => {
      const p = d.data();
      const s = String(p.status || "active");
      const it = String(p.itemType || p.type || "");
      if (s !== "active" && !(s === "pending" && it === "found")) return false;
      return needsScanServer(p);
    })
    .sort(
      (a, b) =>
        Number(a.data().createdAt?.toMillis?.() || 0) -
        Number(b.data().createdAt?.toMillis?.() || 0)
    );

  let postsDone = 0;
  let totalMatches = 0;
  for (const d of candidates.slice(0, POSTS_PER_RECONCILE)) {
    try {
      const r = await runAiMatchServer({
        db: db(),
        postId: d.id,
        extractOwnerUid: String(d.data().userId || ""),
      });
      postsDone++;
      totalMatches += r.matches.length;
    } catch (err) {
      console.error(`[Reconcile] error ${d.id}:`, err);
    }
  }
  return { postsDone, totalMatches };
}

async function expireStaleClaims(): Promise<number> {
  const now = new Date().toISOString();
  const claimSnap = await db()
    .collection("claims")
    .where("status", "==", "pending")
    .get();

  const batch = db().batch();
  const affectedPostIds = new Set<string>();
  let expiredCount = 0;

  claimSnap.docs.forEach((snap) => {
    const data = snap.data();
    const expiresAt = data.expiresAt as string | undefined;
    if (!expiresAt || expiresAt > now) return;

    const postId = data.postId as string | undefined;
    if (postId) affectedPostIds.add(postId);

    batch.update(snap.ref, {
      status: "expired",
      reviewedAt: now,
      expiredAt: now,
      rejectReason: "คำขอรับของหมดอายุ (ไม่มารับของตามกำหนด)",
    });

    if (data.claimantId) {
      db()
        .collection("notifications")
        .add({
          type: "claim_result",
          recipientUid: data.claimantId,
          status: "expired",
          claimId: snap.id,
          postId,
          postTitle: data.postTitle || "",
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => {});
    }

    expiredCount++;
  });

  if (expiredCount > 0) {
    await batch.commit();
    for (const postId of affectedPostIds) {
      const remaining = await db()
        .collection("claims")
        .where("postId", "==", postId)
        .where("status", "==", "pending")
        .limit(1)
        .get();

      const stillPending = remaining.docs.some((d) => {
        const exp = d.data().expiresAt as string | undefined;
        return exp && exp > now;
      });

      if (!stillPending) {
        const postRef = db().collection("posts").doc(postId);
        const postSnap = await postRef.get();
        if (postSnap.exists && postSnap.data()?.status === "in_progress") {
          await postRef.update({ status: "active" });
        }
      }
    }
  }
  return expiredCount;
}

export default handleRequest(async (req: VercelRequest, res: VercelResponse) => {
  const isCron = cronAuthorized(req);

  if (!isCron) {
    const userAuthorized = await authUid(req)
      .then(() => true)
      .catch(() => false);
    if (!userAuthorized) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    const allowed = await acquireUserCooldown();
    if (!allowed) {
      return sendJson(res, 429, {
        error: "กวาดคู่แนะนำเพิ่งถูกเรียกเมื่อไม่นานมานี้ ให้ลองใหม่อีกครั้งสักครู่",
      });
    }
  }

  const [sweep, expiredClaims] = await Promise.all([
    runMatchSweep(),
    expireStaleClaims(),
  ]);

  console.log(
    `[Reconcile] posts=${sweep.postsDone} matches=${sweep.totalMatches} expiredClaims=${expiredClaims}`
  );
  return ok(res, {
    ok: true,
    postsDone: sweep.postsDone,
    totalMatches: sweep.totalMatches,
    expiredClaims,
  });
});