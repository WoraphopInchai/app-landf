// =========================================================
// AI Matching core (ฝั่ง Vercel Serverless) — โมเดลเดียวกับ client lib เดิม
// แต่ปรับเป็น budget/โควตาที่เป็นจริง: คีย์ฟรี Gemini = ~20 ครั้ง/วัน
// => ค่า default ทั้งหมดตั้งแบบประหยัด (conserve)
// =========================================================
import { GoogleGenAI } from "@google/genai";
import type { Firestore, QueryDocumentSnapshot, DocumentData } from "firebase-admin/firestore";

export const GEMINI_MODEL = "gemini-3.6-flash";
export const MATCH_MIN_SCORE = 60;
export const NEAR_MATCH_MIN_SCORE = 45;
export const NEAR_MATCH_MAX_SCORE = MATCH_MIN_SCORE - 1;
// โพสต์ที่มีแมท (ไม่โดน reject) แต้ม >= ค่านี้ = ล็อก ไม่ rescan ซ้ำ
export const LOCK_MATCH_SCORE = 75;
// กันสั่นตอนโพสต์เพิ่งถูกสร้าง
export const SCAN_GRACE_MS = 40_000;
// rescan โพสต์เดิมได้ใหม่ (ถ้ายังไม่มีแมทคุณภาพ)
export const POST_REFRESH_MS = 10 * 60 * 1000;
// คู่ที่เพิ่งถูก judge (ทั้ง 2 ฝั่ง) จะไม่เทียบซ้ำภายในกรอบนี้ (ประหยัดโควตา)
export const PAIR_REFRESH_MS = 24 * 60 * 60 * 1000;

// --- budget (free Gemini ~20 ครั้ง/วัน) ---
export const POSTS_PER_RECONCILE = 8;
export const DAILY_GEMINI_CAP = 20;
export const USER_EXTRACT_CAP_PER_DAY = 5;

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

export interface AiMatchResult {
  aiData: Record<string, unknown>;
  matches: AiMatchRecord[];
  nearMatches: AiMatchRecord[];
  usedCalls: number;
  budgetHit: boolean;
}

const STOPWORDS = [
  "ที่", "ของ", "ใน", "บน", "มี", "เป็น", "กับ", "และ", "หรือ", "ไม่",
  "อยู่", "หา", "ฉัน", "ผม", "the", "a", "an", "to", "and", "or", "for",
];

// ---------- ตัวช่วย parse/ข้อความ ----------
export const parseAiJson = (text?: string): Record<string, unknown> | null => {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const describePost = (p: Record<string, unknown>): string => {
  const extras: string[] = [];
  const cat = String(p.category || "").trim();
  const building = String(p.building || "").trim();
  const locationName = String(p.locationName || "").trim();
  const depositLocation = String(p.depositLocation || "").trim();
  const faculty = String(p.faculty || "").trim();
  const date = String(p.date || "").trim();
  const title = String(p.title || "");
  const desc = String(p.desc || "");
  if (cat) extras.push(`หมวดหมู่: ${cat}`);
  if (building) extras.push(`อาคาร/พื้นที่: ${building}`);
  if (locationName) extras.push(`สถานที่: ${locationName}`);
  if (depositLocation) extras.push(`จุดรับฝาก: ${depositLocation}`);
  if (faculty) extras.push(`คณะ: ${faculty}`);
  if (date) extras.push(`วันที่: ${date}`);
  return `"${title} ${desc}"${extras.length ? " " + extras.join(", ") : ""}`.trim();
};

// ---------- ตัวช่วยความใกล้ในเครื่อง (ไม่เสียโควตา) ----------
const charBigrams = (text: string): Set<string> => {
  const clean = text.toLowerCase().replace(/[^a-z0-9ก-๙]/g, "");
  const grams = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2));
  return grams;
};

const charOverlapScore = (a: string, b: string): number => {
  const ga = charBigrams(a);
  const gb = charBigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let common = 0;
  for (const g of ga) if (gb.has(g)) common++;
  return (2 * common) / (ga.size + gb.size);
};

const describeText = (p: Record<string, unknown>): string =>
  `${String(p.title || "")} ${String(p.desc || "")} ${String(p.category || "")} ${String(p.locationName || "")} ${String(p.building || "")} ${String(p.depositLocation || "")} ${String(p.faculty || "")}`;

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.includes(t));

const isCategoryConflict = (a: string | undefined, b: string | undefined): boolean => {
  const ca = (a || "").trim();
  const cb = (b || "").trim();
  if (!ca || !cb) return false;
  if (ca === cb) return false;
  if (ca === "อื่นๆ" || cb === "อื่นๆ") return false;
  return true;
};

interface EvidenceResult {
  meaningful: string[];
  charScore: number;
  hasEvidence: boolean;
}

const buildSameTypeEvidence = (
  currentSearchSet: Set<string>,
  currentTitle: string,
  currentDesc: string,
  targetPost: Record<string, unknown>
): EvidenceResult => {
  const targetAi = (targetPost.aiData as { keywords?: unknown } | null | undefined);
  const targetWords = Array.isArray(targetAi?.keywords)
    ? (targetAi.keywords as unknown[]).map(String)
    : [];
  const targetText =
    `${String(targetPost.title || "")} ${String(targetPost.desc || "")} ${String(targetPost.category || "")} ${targetWords.join(" ")}`.toLowerCase();

  const overlap = Array.from(currentSearchSet).filter((t) =>
    targetText.includes(t)
  );
  const meaningful = overlap.filter((t) => !STOPWORDS.includes(t));

  const descOnly = (o: Record<string, unknown>): string =>
    `${String(o.title || "")} ${String(o.desc || "")}`.toLowerCase();
  const charScore = charOverlapScore(
    descOnly({ title: currentTitle, desc: currentDesc }),
    descOnly(targetPost)
  );

  const hasEvidence =
    meaningful.length >= 2 ||
    (meaningful.length >= 1 && charScore >= 0.35) ||
    charScore >= 0.5;
  return { meaningful, charScore, hasEvidence };
};

const normalize = (s: string): string => s.trim().toLowerCase();

const equalStr = (a: unknown, b: unknown): boolean =>
  Boolean(a && b) && normalize(String(a)) === normalize(String(b));

const reasonFor = (
  ev: EvidenceResult,
  boosts: string[],
  keywords: string[]
): string => {
  const parts: string[] = [];
  if (boosts.length) parts.push(...boosts.slice(0, 3));
  if (keywords.length) parts.push(`ตรงคำสำคัญ: ${keywords.slice(0, 3).join(", ")}`);
  if (ev.meaningful.length) parts.push(`คำค้นใกล้: ${ev.meaningful.slice(0, 3).join(", ")}`);
  if (parts.length === 0) return "ข้อความ/คำหลักใกล้เคียงกัน (ยังไม่ยืนยัน)";
  return `${parts.join(" · ")} (เจ้าของยืนยัน = แมทจริง)`;
};

interface RuleScoreResult {
  score: number;
  reason: string;
  ev: EvidenceResult;
  clearConflict: boolean;
}

const ruleScore = (
  post: Record<string, unknown>,
  target: Record<string, unknown>,
  myAi: Record<string, unknown>
): RuleScoreResult => {
  const searchSet = new Set<string>([
    ...tokenize(`${String(post.title || "")} ${String(post.desc || "")}`),
    ...(Array.isArray(myAi.keywords)
      ? (myAi.keywords as unknown[])
          .map(String)
          .filter((k) => k.trim().length >= 2 && !STOPWORDS.includes(k.trim()))
          .map((k) => k.trim().toLowerCase())
      : []),
  ]);

  const ev = buildSameTypeEvidence(
    searchSet,
    String(post.title || ""),
    String(post.desc || ""),
    target
  );
  const clearConflict = isCategoryConflict(
    String(post.category || ""),
    String(target.category || "")
  );

  const boosts: string[] = [];
  const kwHits: string[] = [];
  let score = Math.round(charOverlapScore(describeText(post), describeText(target)) * 100);

  if (equalStr(post.category, target.category)) {
    score += 12;
    boosts.push("หมวดตรงกัน");
  }

  const tAi = (target.aiData as Record<string, unknown>) || {};
  const tKw = Array.isArray(tAi.keywords) ? (tAi.keywords as unknown[]).map(String) : [];
  for (const k of searchSet) {
    if (tKw.some((w) => normalize(w).includes(k))) {
      score += 5;
      kwHits.push(k);
      break;
    }
  }

  if (
    String(myAi.color || "").length > 0 &&
    String(tAi.color || "").length > 0 &&
    normalize(String(myAi.color)) === normalize(String(tAi.color))
  ) {
    score += 6;
    boosts.push("สีตรงกัน");
  }

  if (
    equalStr(post.locationName, target.locationName) ||
    equalStr(post.depositLocation, target.depositLocation) ||
    equalStr(post.building, target.building)
  ) {
    score += 6;
    boosts.push("สถานที่ตรงกัน");
  }

  if (equalStr(post.date, target.date)) {
    score += 5;
    boosts.push("วันที่ตรงกัน");
  }

  if (clearConflict && !ev.hasEvidence) score -= 35;

  score = Math.max(0, Math.min(99, score));

  const reason = reasonFor(ev, boosts, kwHits);
  return { score, reason, ev, clearConflict };
};

const resolveMs = (t: unknown): number => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t === "string") return new Date(t).getTime();
  if (typeof t === "number") return t;
  if (typeof t === "object" && (t as { toDate?: () => Date }).toDate) {
    try {
      return (t as { toDate: () => Date }).toDate().getTime();
    } catch {
      return 0;
    }
  }
  return 0;
};

// ---------- Budget รายวัน 2 ชั้น ----------
const BUDGET_DOC = "meta/geminiBudget";
const USER_BUDGET_BASE = "meta/geminiUsage/users";

export const todayKey = (): string => new Date().toISOString().slice(0, 10);

export async function readGeminiBudget(
  db: Firestore,
  uid?: string
): Promise<{ day: string; used: number; userUsed: number }> {
  let used = 0;
  let userUsed = 0;
  try {
    const snap = await db.doc(BUDGET_DOC).get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (d.day === todayKey()) used = Number(d.used || 0);
    }
  } catch {
    // ignore
  }
  if (uid) {
    try {
      const usnap = await db.doc(`${USER_BUDGET_BASE}/${uid}`).get();
      if (usnap.exists) {
        const d = usnap.data() || {};
        if (d.day === todayKey()) userUsed = Number(d.used || 0);
      }
    } catch {
      // ignore
    }
  }
  return { day: todayKey(), used, userUsed };
}

export async function recordGeminiCall(
  db: Firestore,
  used: number,
  uid?: string
): Promise<void> {
  try {
    await db.doc(BUDGET_DOC).set({ day: todayKey(), used });
  } catch {
    // ignore
  }
  if (uid) {
    try {
      const usnap = await db.doc(`${USER_BUDGET_BASE}/${uid}`).get();
      const prev = usnap.exists && usnap.data()?.day === todayKey() ? Number(usnap.data()?.used || 0) : 0;
      await db.doc(`${USER_BUDGET_BASE}/${uid}`).set({ day: todayKey(), used: prev + 1 });
    } catch {
      // ignore
    }
  }
}

// ---------- ตัวแมทหลัก (server) ----------
export async function runAiMatchServer(args: {
  db: Firestore;
  postId: string;
  extractOwnerUid?: string;
}): Promise<AiMatchResult> {
  const { db, postId, extractOwnerUid } = args;
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

  const emptyResult = (): AiMatchResult => ({
    aiData: {},
    matches: [],
    nearMatches: [],
    usedCalls: 0,
    budgetHit: false,
  });

  const postSnap = await db.doc(`posts/${postId}`).get();
  if (!postSnap.exists) return emptyResult();
  const post = postSnap.data() || {};
  const itemType = String(post.itemType || post.type || "lost");
  const currentUserId = String(post.userId || "");

  let storedAiData = (post.aiData as Record<string, unknown>) || {};
  if (!storedAiData || typeof storedAiData !== "object") storedAiData = {};

  let usedCalls = 0;
  let budgetHit = false;
  const budget = await readGeminiBudget(db, extractOwnerUid);
  let callsLeft = Math.max(0, DAILY_GEMINI_CAP - budget.used);

  const consumeGemini = async (): Promise<boolean> => {
    if (callsLeft <= 0 || !ai) return false;
    const before = await readGeminiBudget(db, extractOwnerUid);
    if (before.day === todayKey() && before.used >= DAILY_GEMINI_CAP) {
      budgetHit = true;
      return false;
    }
    if (
      extractOwnerUid &&
      before.day === todayKey() &&
      before.userUsed >= USER_EXTRACT_CAP_PER_DAY
    ) {
      budgetHit = true;
      return false;
    }
    return true;
  };

  const charged = async (): Promise<void> => {
    usedCalls++;
    callsLeft--;
    const b = await readGeminiBudget(db, extractOwnerUid);
    await recordGeminiCall(db, b.used + 1, extractOwnerUid);
  };

  const targetType = itemType === "lost" ? "found" : "lost";
  const promptText = (p: Record<string, unknown>): string =>
    describePost(p).slice(0, 4000);

  if (Object.keys(storedAiData).length === 0 && ai && (await consumeGemini())) {
    try {
      const extractResponse = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `วิเคราะห์โพสต์นี้แล้วตอบเป็น JSON เท่านั้น:\n{\n  "category": "หมวดหมู่สิ่งของ",\n  "color": "สี",\n  "location": "สถานที่ที่ระบุ",\n  "keywords": ["คำสำคัญ1", "คำสำคัญ2"]\n}\nข้อความ: ${promptText(post)}`,
        config: { responseMimeType: "application/json" },
      });
      await charged();
      const parsed = parseAiJson(extractResponse.text) || {};
      if (Object.keys(parsed).length > 0) storedAiData = parsed;
    } catch (err) {
      console.error("[AI] extract error:", err);
    }
  }

  const fetchOpposite = async (): Promise<
    Array<QueryDocumentSnapshot<DocumentData>>
  > => {
    try {
      const snap = await db
        .collection("posts")
        .where("itemType", "==", targetType)
        .where("status", "==", "active")
        .limit(300)
        .get();
      return snap.docs;
    } catch (indexErr) {
      console.warn("[AI] compound query failed, fallback single-field:", indexErr);
      try {
        const snap = await db.collection("posts").where("status", "==", "active").limit(500).get();
        return snap.docs.filter((d) => (d.data().itemType || "") === targetType);
      } catch (singleErr) {
        console.error("[AI] opposing query failed:", singleErr);
        return [];
      }
    }
  };

  let oppositeDocs = await fetchOpposite();
  oppositeDocs = oppositeDocs.filter(
    (d) => d.id !== postId && String(d.data().userId || "") !== currentUserId
  );

  const currentSearchSet = new Set<string>([
    ...tokenize(`${String(post.title || "")} ${String(post.desc || "")}`),
    ...(Array.isArray(storedAiData.keywords)
      ? (storedAiData.keywords as unknown[])
          .map(String)
          .filter((k) => k.trim().length >= 2 && !STOPWORDS.includes(k.trim()))
          .map((k) => k.trim().toLowerCase())
      : []),
  ]);

  const existingMatches = (post.matches as AiMatchRecord[]) || [];
  const existingNear = (post.nearMatches as AiMatchRecord[]) || [];
  const judgedAt = ((post.aiJudgedAt as Record<string, string>) || {});
  const rejectedPairs = new Set<string>();
  for (const m of [...existingMatches, ...existingNear]) {
    if (m.rejected) rejectedPairs.add(m.matchedPostId);
  }
  const settledPairs = new Set<string>();
  for (const m of existingMatches) {
    if (m.similarityScore >= MATCH_MIN_SCORE && !m.rejected) settledPairs.add(m.matchedPostId);
  }
  for (const m of existingMatches) {
    if (m.confirmed) settledPairs.add(m.matchedPostId);
  }

  const ranked = oppositeDocs
    .map((docSnap) => {
      const t = docSnap.data() as Record<string, unknown>;
      let score = charOverlapScore(
        describeText(post),
        describeText(t)
      );
      if (String(post.category || "") !== "" && post.category === t.category) score += 0.35;
      const tKw = Array.isArray(
        (t.aiData as { keywords?: unknown } | null | undefined)?.keywords
      )
        ? ((t.aiData as { keywords: unknown[] }).keywords as unknown[]).map(String)
        : [];
      for (const k of currentSearchSet) {
        if (tKw.some((w) => w.toLowerCase().includes(k))) {
          score += 0.25;
          break;
        }
      }
      return { docSnap, target: t, score };
    })
    .sort((a, b) => b.score - a.score);

  const matches: AiMatchRecord[] = [];
  const nearMatches: AiMatchRecord[] = [];
  const validMatchIds = new Set<string>();
  const validNearIds = new Set<string>();
  const toMirror: Array<{ docId: string; data: Record<string, unknown> }> = [];

  const softBlockedIds = new Set<string>();
  for (const r of ranked) {
    if (!isCategoryConflict(String(post.category || ""), String(r.target.category || ""))) continue;
    const ev = buildSameTypeEvidence(
      currentSearchSet,
      String(post.title || ""),
      String(post.desc || ""),
      r.target
    );
    if (!ev.hasEvidence) softBlockedIds.add(r.docSnap.id);
  }

  const aiDocs = ranked;

  const upsertMirror = (
    oppData: Record<string, unknown>,
    field: "matches" | "nearMatches",
    entry: AiMatchRecord
  ): Record<string, unknown> => {
    const arr = ((oppData[field] as AiMatchRecord[]) || []).filter(
      (x) => x.matchedPostId !== postId
    );
    arr.push(entry);
    return { [field]: arr.sort((a, b) => b.similarityScore - a.similarityScore) };
  };

  for (const r of aiDocs) {
    const docSnap = r.docSnap;
    const t = r.target;

    if (settledPairs.has(docSnap.id)) continue;
    if (rejectedPairs.has(docSnap.id)) continue;
    const judgedThisPair = judgedAt[docSnap.id] || (t.aiJudgedAt as Record<string, string>)?.[postId];
    if (judgedThisPair && Date.now() - resolveMs(judgedThisPair) < PAIR_REFRESH_MS) continue;

    if (softBlockedIds.has(docSnap.id)) continue;

    const rs = ruleScore(post, t, storedAiData);
    const score = rs.score;
    const reason = rs.reason;

    const nowPair = Date.now();
    judgedAt[docSnap.id] = new Date(nowPair).toISOString();

    const gatePassed = score >= MATCH_MIN_SCORE && rs.ev.hasEvidence;

    if (gatePassed) {
      const entry: AiMatchRecord = {
        matchedPostId: docSnap.id,
        matchedTitle: String(t.title || ""),
        similarityScore: score,
        reason,
      };
      matches.push(entry);
      validMatchIds.add(docSnap.id);
      const mirror = {
        matchedPostId: postId,
        matchedTitle: String(post.title || ""),
        similarityScore: score,
        reason,
      };
      const oppData = { ...t };
      const updated = upsertMirror(oppData, "matches", mirror);
      toMirror.push({
        docId: docSnap.id,
        data: { ...updated, aiJudgedAt: { ...((t.aiJudgedAt as Record<string, string>) || {}), [postId]: new Date(nowPair).toISOString() } },
      });
    } else if (score >= NEAR_MATCH_MIN_SCORE) {
      const nearEntry: AiMatchRecord = {
        matchedPostId: docSnap.id,
        matchedTitle: String(t.title || ""),
        similarityScore: score,
        reason,
      };
      nearMatches.push(nearEntry);
      validNearIds.add(docSnap.id);
      const nearMirror = {
        matchedPostId: postId,
        matchedTitle: String(post.title || ""),
        similarityScore: score,
        reason,
      };
      const oppData = { ...t };
      const updated = upsertMirror(oppData, "nearMatches", nearMirror);
      toMirror.push({
        docId: docSnap.id,
        data: { ...updated, aiJudgedAt: { ...((t.aiJudgedAt as Record<string, string>) || {}), [postId]: new Date(nowPair).toISOString() } },
      });
    } else {
      toMirror.push({
        docId: docSnap.id,
        data: { aiJudgedAt: { ...((t.aiJudgedAt as Record<string, string>) || {}), [postId]: new Date(nowPair).toISOString() } },
      });
    }
  }

  matches.sort((a, b) => b.similarityScore - a.similarityScore);
  nearMatches.sort((a, b) => b.similarityScore - a.similarityScore);

  const interesting = !["under_investigation", "resolved", "suspended"].includes(String(post.status || ""));

  const oldAll = [...existingMatches, ...existingNear];
  const newValid = new Set([...validMatchIds, ...validNearIds]);
  const cleanupRefs: Array<{ docId: string; field: "matches" | "nearMatches" }> = [];
  for (const old of oldAll) {
    if (newValid.has(old.matchedPostId)) continue;
    cleanupRefs.push({ docId: old.matchedPostId, field: "matches" });
    cleanupRefs.push({ docId: old.matchedPostId, field: "nearMatches" });
  }
  const cleanupSeen = new Set<string>();
  for (const c of cleanupRefs) {
    const key = `${c.docId}:${c.field}`;
    if (cleanupSeen.has(key)) continue;
    cleanupSeen.add(key);
    try {
      const oppRef = db.doc(`posts/${c.docId}`);
      const oppSnap = await oppRef.get();
      if (!oppSnap.exists) continue;
      const opp = oppSnap.data() || {};
      const arr = (opp[c.field] as AiMatchRecord[]) || [];
      const filtered = arr.filter((x) => x.matchedPostId !== postId);
      if (filtered.length !== arr.length) {
        await oppRef.update({ [c.field]: filtered });
      }
    } catch (err) {
      console.error("[AI] mirror cleanup error:", err);
    }
  }

  for (const m of toMirror) {
    try {
      await db.doc(`posts/${m.docId}`).update(m.data);
    } catch (err) {
      console.error("[AI] mirror update error:", err);
    }
  }

  const judgedEntries = Object.entries(judgedAt);
  if (judgedEntries.length > 300) {
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (const [k, v] of judgedEntries) {
      if (resolveMs(v) < cutoff) delete judgedAt[k];
    }
  }

  const payload: Record<string, unknown> = {
    aiData: storedAiData,
    matches,
    nearMatches,
    aiJudgedAt: judgedAt,
  };
  if (interesting) payload.aiCheckedAt = new Date().toISOString();

  try {
    await db.doc(`posts/${postId}`).update(payload);
  } catch (err) {
    console.error("[AI] self update error:", err);
  }

  return { aiData: storedAiData, matches, nearMatches, usedCalls, budgetHit };
}

// ---------- เช็คว่าโพสต์ถึงเวลา rescan หรือยัง ----------
export function needsScanServer(post: Record<string, unknown>, now = Date.now()): boolean {
  const status = String(post.status || "active");
  const isActive = status === "active";
  const isPendingFound =
    status === "pending" && (String(post.itemType || "") === "found" || String(post.type || "") === "found");
  if (!isActive && !isPendingFound) return false;

  const matches = (post.matches as AiMatchRecord[]) || [];
  if (matches.some((m) => m.confirmed)) return false;
  if (matches.some((m) => m.similarityScore >= LOCK_MATCH_SCORE && !m.rejected)) return false;

  if (typeof post.createdAt !== "undefined") {
    const created = resolveMs(post.createdAt);
    if (created && now - created < SCAN_GRACE_MS) return false;
  }
  const checked = resolveMs(post.aiCheckedAt);
  if (checked && now - checked < POST_REFRESH_MS) return false;
  return true;
}