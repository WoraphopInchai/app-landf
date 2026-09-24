import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import {
  runAiMatchServer,
  needsScanServer,
  POSTS_PER_RECONCILE,
  type AiMatchRecord,
} from "./ai";

admin.initializeApp();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

const db = admin.firestore();
const nowIso = () => new Date().toISOString();

// ================================================
// 1) แมททันทีเมื่อโพสต์ถูกสร้าง
//    - lost (active) / found (pending) -> สแกนคู่แมท
// ================================================
export const matchLostAndFound = onDocumentCreated(
  { document: "posts/{postId}", secrets: [geminiApiKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const itemType = String(data.itemType || data.type || "");
    const status = String(data.status || "");
    const isLostActive = itemType === "lost" && status === "active";
    const isFoundPending = itemType === "found" && status === "pending";
    if (!isLostActive && !isFoundPending) return;

    console.log(`[AI] onCreate match for ${event.params.postId}`);
    try {
      await runAiMatchServer({ db, postId: event.params.postId, extractOwnerUid: String(data.userId || "") });
      console.log(`[AI] onCreate done: ${event.params.postId}`);
    } catch (error) {
      console.error(`[AI] onCreate error ${event.params.postId}:`, error);
    }
  }
);

// ================================================
// 2) แมทใหม่เมื่อโพสต์ถูกแก้ (อนุมัติของพบ -> active, หรือแก้เนื้อหา)
//    กัน loop: ข้ามถ้าเปลี่ยนแค่ field แมท/aiCheckedAt
// ================================================
export const reMatchOnPostUpdated = onDocumentUpdated(
  { document: "posts/{postId}", secrets: [geminiApiKey] },
  async (event) => {
    const before = event.data?.before.data() || {};
    const after = event.data?.after.data();
    if (!after) return;

    const trackedFields = [
      "title",
      "desc",
      "category",
      "itemType",
      "locationName",
      "building",
      "depositLocation",
      "faculty",
    ];
    const contentChanged = trackedFields.some(
      (f) => String(before[f] || "") !== String(after[f] || "")
    );
    const activated =
      String(before.status || "") !== String(after.status || "") &&
      after.status === "active";
    if (!contentChanged && !activated) return;

    console.log(`[AI] onUpdate trigger: ${event.params.postId}`);
    try {
      await runAiMatchServer({ db, postId: event.params.postId, extractOwnerUid: String(after.userId || "") });
      console.log(`[AI] onUpdate done: ${event.params.postId}`);
    } catch (error) {
      console.error(`[AI] onUpdate error ${event.params.postId}:`, error);
    }
  }
);

// ================================================
// 3) ปุ่ม "รีเฟรชคู่แนะนำ" — สแกนโพสต์ของตัวเอง (ผ่าน server กันคีย์รั่ว)
//    จำกัด 1 ครั้ง/นาที/คน เท่านั้น (กฎแมทฟรี ใช้ได้เต็มที่แม้โควตา Gemini จะหมด)
// ================================================
export const forceRescan = onCall(
  { secrets: [geminiApiKey], maxInstances: 10 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");

    const limiterRef = db.doc(`meta/forceScan/${uid}`);
    const limiterSnap = await limiterRef.get();
    const lastRun = Number((limiterSnap.data() as { lastRunAtMs?: number } | undefined)?.lastRunAtMs || 0);
    const now = Date.now();
    if (now - lastRun < 60_000) {
      throw new HttpsError("resource-exhausted", "กรุณารอ 1 นาทีก่อนกดอีกครั้ง");
    }

    const snap = await db.collection("posts").where("userId", "==", uid).limit(50).get();
    const targets = snap.docs.filter((d) => {
      const s = String(d.data().status || "active");
      const it = String(d.data().itemType || d.data().type || "");
      return s === "active" || (s === "pending" && it === "found");
    });

    let postsDone = 0;
    let totalMatches = 0;
    for (const d of targets) {
      const r = await runAiMatchServer({ db, postId: d.id, extractOwnerUid: uid });
      postsDone++;
      totalMatches += r.matches.length;
    }

    await limiterRef.set({ lastRunAtMs: now });
    return { postsDone, totalMatches };
  }
);

// ================================================
// 4) ยืนยัน/ปฏิเสธคู่แมท (ใช่ของฉัน / ไม่ใช่ของฉัน) — เขียน flag ลงทั้ง 2 ฝั่ง
//    เพื่อให้ "แมทจริง" หมายถึงคนยืนยันแล้วเท่านั้น (กันแมทปลอม)
// ================================================
export const confirmAiMatch = onCall(
  { secrets: [geminiApiKey], maxInstances: 20 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");

    const { myPostId, otherPostId, action } = (request.data || {}) as {
      myPostId?: string;
      otherPostId?: string;
      action?: "confirm" | "reject";
    };
    if (!myPostId || !otherPostId || (action !== "confirm" && action !== "reject")) {
      throw new HttpsError("invalid-argument", "ข้อมูลไม่ครบถ้วน");
    }

    const now = nowIso();
    const stamp = action === "confirm"
      ? { confirmed: true, confirmedBy: uid, confirmedAt: now, rejected: false }
      : { rejected: true, rejectedBy: uid, rejectedAt: now, confirmed: false };

    const myRef = db.doc(`posts/${myPostId}`);
    const otherRef = db.doc(`posts/${otherPostId}`);

    try {
      await db.runTransaction(async (tx) => {
        const mySnap = await tx.get(myRef);
        if (!mySnap.exists) throw new HttpsError("not-found", "ไม่พบโพสต์ของคุณ");
        const my = mySnap.data() as { userId?: string; matches?: AiMatchRecord[]; nearMatches?: AiMatchRecord[] };
        if (String(my.userId || "") !== uid) {
          throw new HttpsError("permission-denied", "คุณไม่ใช่เจ้าของโพสต์นี้");
        }

        const hasEntry = [...(my.matches || []), ...(my.nearMatches || [])].some(
          (m) => m.matchedPostId === otherPostId
        );
        if (!hasEntry) {
          throw new HttpsError("not-found", "ไม่พบคู่แมทนี้ในโพสต์ของคุณ");
        }

        const otherSnap = await tx.get(otherRef);
        if (!otherSnap.exists) throw new HttpsError("not-found", "ไม่พบโพสต์อีกฝ่าย");
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
      if (err instanceof HttpsError) throw err;
      console.error("[AI] confirmAiMatch error:", err);
      throw new HttpsError("internal", "เกิดข้อผิดพลาดในการยืนยันคู่แมท");
    }

    console.log(`[AI] ${action} pair: ${myPostId} <-> ${otherPostId} by ${uid}`);
    return { ok: true, action, at: now };
  }
);

// ================================================
// 5) Reconcile — ประเมินคู่ที่ยังไม่มีแมทคุณภาพเป็นระยะ (ทุก 12 นาที)
//    กฎแมทฟรี => ครอบคลุมทุกคู่ทั้งวัน (Gemini ใช้เฉพาะ extract โพสต์ที่ยังไม่มี aiData)
//    (ยังทำ backfill โพสต์เก่าที่สร้างก่อน deploy function ด้วย)
// ================================================
export const reconcileMatches = onSchedule(
  { schedule: "every 12 minutes", timeZone: "Asia/Bangkok", secrets: [geminiApiKey] },
  async () => {
    // status in [active, pending] (ไม่ต้อง composite index) แล้วกรองเอง
    const snap = await db.collection("posts").where("status", "in", ["active", "pending"]).limit(500).get();
    const candidates = snap.docs
      .filter((d) => {
        const p = d.data();
        const s = String(p.status || "active");
        const it = String(p.itemType || p.type || "");
        if (s !== "active" && !(s === "pending" && it === "found")) return false;
        return needsScanServer(p);
      })
      .sort((a, b) => (Number(a.data().createdAt?.toMillis?.() || 0)) - (Number(b.data().createdAt?.toMillis?.() || 0)));

    let postsDone = 0;
    let totalMatches = 0;

    for (const d of candidates.slice(0, POSTS_PER_RECONCILE)) {
      try {
        const r = await runAiMatchServer({
          db,
          postId: d.id,
          extractOwnerUid: String(d.data().userId || ""),
        });
        postsDone++;
        totalMatches += r.matches.length;
      } catch (err) {
        console.error(`[Reconcile] error ${d.id}:`, err);
      }
    }

    console.log(`[Reconcile] posts=${postsDone} matches=${totalMatches}`);
  }
);

// ================================================
// ปิดคำขอรับของที่หมดอายุ (24 ชม. หรือตามวันนัดรับ)
// รันทุก 10 นาที แล้วปล่อยโพสต์กลับเป็น active เมื่อไม่มีคำขอค้างเหลือ
// ================================================
export const expireStaleClaims = onSchedule(
  { schedule: "every 10 minutes", timeZone: "Asia/Bangkok" },
  async () => {
    const now = nowIso();

    // ดึงคำขอสถานะ pending ทั้งหมด แล้วกรองเอาที่หมดอายุในโค้ด
    // (เลี่ยง composite index ที่ต้องสร้างเองบน Firestore)
    const claimSnap = await db
      .collection("claims")
      .where("status", "==", "pending")
      .get();

    const batch = db.batch();
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
        db.collection("notifications")
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

      // ปล่อยโพสต์กลับเป็น active ถ้าไม่มีคำขอที่ยังไม่หมดอายุเหลืออยู่
      for (const postId of affectedPostIds) {
        const remaining = await db
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
          const postRef = db.collection("posts").doc(postId);
          const postSnap = await postRef.get();
          if (postSnap.exists && postSnap.data()?.status === "in_progress") {
            await postRef.update({ status: "active" });
          }
        }
      }
    }

    console.log(`[Claim Expiry] Expired ${expiredCount} claim(s)`);
  }
);