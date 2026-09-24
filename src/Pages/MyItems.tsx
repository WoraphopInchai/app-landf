import { useState, useEffect, useMemo } from "react";
import {
  Briefcase,
  MapPin,
  Clock,
  LogOut,
  User,
  Mail,
  Package,
  UserCircle,
  Sparkles,
  ExternalLink,
  ClipboardCheck,
  CheckCircle2,
} from "lucide-react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { AppUser, PostItem, FirestoreTimeLike } from "../types";
import { confirmAiPair, runForceRescan } from "../lib/aiMatch";
import ToastContainer from "../components/Toast";
import { showToast } from "../lib/toast";

interface MyItemsProps {
  user: AppUser;
  onLogout: () => void;
  onSelectItem: (item: PostItem) => void;
  onOpenProfile: () => void;
}

interface PostDoc extends PostItem {
  id: string;
  createdAt?: FirestoreTimeLike;
}

// คำขอรับของที่ผู้ใช้ยื่นไป (ใช้หาว่าเราไปขอดรับของโพสต์ไหน + สถานะคำขอ)
interface ClaimDoc {
  id: string;
  postId?: string;
  postTitle?: string;
  postImageUrl?: string;
  itemType?: string;
  status?: string;
  note?: string;
  rejectReason?: string;
  createdAt?: FirestoreTimeLike;
  reviewedAt?: FirestoreTimeLike;
  expiresAt?: string;
}

const resolveTime = (t?: FirestoreTimeLike): number => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t !== "object") return new Date(t).getTime();
  if (typeof t.toDate === "function") return t.toDate().getTime();
  return 0;
};

export default function MyItems({
  user,
  onLogout,
  onSelectItem,
  onOpenProfile,
}: MyItemsProps) {
  // =========================
  // Filter State
  // =========================
  const [filterType, setFilterType] = useState<"mine" | "claims" | "ai">("mine");

  // =========================
  // ดึงข้อมูลโพสต์ของ user ที่ล็อกอินจาก Firebase Firestore (Realtime)
  // =========================
  const [items, setItems] = useState<PostDoc[]>([]);
  const [loading, setLoading] = useState(() => !auth.currentUser?.uid);

  // =========================
  // โพสต์คนอื่นที่ AI จับคู่ตรงกับโพสต์ของเรา
  // =========================
  interface ExternalMatch {
    post: PostDoc;
    matchedMyPostId: string;
    matchedMyPostTitle: string;
    score: number;
    reason?: string;
    confirmed?: boolean;
    rejected?: boolean;
  }
  const [externalMatches, setExternalMatches] = useState<ExternalMatch[]>([]);
  // ระดับ "ใกล้เคียง" (45-59) — ยังไม่ยืนยัน แสดงแยกโซน
  const [externalNearMatches, setExternalNearMatches] = useState<ExternalMatch[]>([]);

  // คำขอรับของที่เรายื่นไป + โพสต์ที่เราขอดรับ (เพื่อติดตามสถานะใน "รายการของฉัน")
  const [myClaims, setMyClaims] = useState<ClaimDoc[]>([]);
  const [claimedPosts, setClaimedPosts] = useState<PostDoc[]>([]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const q = query(collection(db, "posts"), where("userId", "==", uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const posts = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as PostDoc[];

        // เรียงจากใหม่ไปเก่า (หลีกเลี่ยง composite index ที่ต้องสร้างเพิ่ม)
        posts.sort((a, b) => {
          const ra = resolveTime(a.createdAt);
          const rb = resolveTime(b.createdAt);
          return rb - ra;
        });

        setItems(posts);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching my items:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // =========================
  // ดึงคำขอรับของที่เรายื่นไว้ (Realtime) เพื่อแสดงโพสต์ที่เราขอดรับของ
  // =========================
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const q = query(collection(db, "claims"), where("claimantId", "==", uid));

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setMyClaims(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ClaimDoc)
        );
      },
      (error) => console.error("Error fetching my claims:", error)
    );

    return () => unsubscribe();
  }, []);

  // =========================
  // ดึงข้อมูลโพสต์แต่ละโพสต์ที่เราไปขอดรับของ (ตามคำขอที่ยื่นไว้)
  // =========================
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    const postIds = Array.from(
      new Set(myClaims.map((c) => c.postId).filter((id): id is string => !!id))
    );
    if (!uid || postIds.length === 0) return;

    const unsubscribeFns = postIds.map((postId) =>
      onSnapshot(
        doc(db, "posts", postId),
        (snap) => {
          setClaimedPosts((prev) => {
            const next = new Map(prev.map((p) => [p.id, p]));
            if (snap.exists()) {
              const data = snap.data();
              // ข้ามโพสต์ของตัวเอง (ของตัวเองแสดงจากรายการหลักอยู่แล้ว)
              if (data.userId !== uid) {
                next.set(snap.id, { id: snap.id, ...data } as PostDoc);
              } else {
                next.delete(snap.id);
              }
            } else {
              next.delete(snap.id);
            }
            return Array.from(next.values());
          });
        },
        (error) => console.error("Error fetching claimed post:", error)
      )
    );

    return () => unsubscribeFns.forEach((u) => u());
  }, [myClaims]);

  // =========================
  // ดึงโพสต์คนอื่นที่ AI ตรงกับโพสต์ของเรา (Realtime)
  // =========================
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || items.length === 0) return;

    const myPostIds = new Set(items.map((it) => it.id));

    // ดึงโพสต์ทั้งหมดที่ไม่ใช่ของเรา (ที่ status active)
    const q = query(
      collection(db, "posts"),
      where("status", "==", "active"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const results: ExternalMatch[] = [];
        const nearResults: ExternalMatch[] = [];

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          // ข้ามโพสต์ของตัวเอง
          if (data.userId === uid) continue;

          const matches = data.matches || [];
          for (const m of matches) {
            if (m.similarityScore < 60) continue;
            if (m.rejected) continue;
            if (myPostIds.has(m.matchedPostId)) {
              // โพสต์คนอื่นนี้ match กับโพสต์ของเรา
              const myPost = items.find((it) => it.id === m.matchedPostId);
              results.push({
                post: {
                  id: docSnap.id,
                  ...data,
                } as PostDoc,
                matchedMyPostId: m.matchedPostId,
                matchedMyPostTitle: myPost?.title || m.matchedTitle || "โพสต์ของคุณ",
                score: m.similarityScore,
                reason: m.reason,
                confirmed: !!m.confirmed,
              });
            }
          }

          // ระดับ "ใกล้เคียง" (45-59)
          const near = data.nearMatches || [];
          for (const m of near) {
            if (m.similarityScore < 45 || m.similarityScore > 59) continue;
            if (m.rejected) continue;
            if (myPostIds.has(m.matchedPostId)) {
              const myPost = items.find((it) => it.id === m.matchedPostId);
              nearResults.push({
                post: {
                  id: docSnap.id,
                  ...data,
                } as PostDoc,
                matchedMyPostId: m.matchedPostId,
                matchedMyPostTitle: myPost?.title || m.matchedTitle || "โพสต์ของคุณ",
                score: m.similarityScore,
                reason: m.reason,
                confirmed: !!m.confirmed,
              });
            }
          }
        }

        // เรียงตาม score สูง→ต่ำ
        results.sort((a, b) => b.score - a.score);
        nearResults.sort((a, b) => b.score - a.score);
        setExternalMatches(results);
        setExternalNearMatches(nearResults);
      },
      (error) => {
        console.error("Error fetching external AI matches:", error);
      }
    );

    return () => unsubscribe();
  }, [items]);

  // =========================
  // AI Match Rescan ถูกย้ายไปฝั่ง Cloud Function แล้ว (server สแกน/เก็บโควตา)
  // =========================
  const [refreshing, setRefreshing] = useState(false);
  const [scanDone, setScanDone] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);

  const forceRefreshAi = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      showToast("ไม่ได้ล็อกอิน", "error");
      return;
    }
    if (refreshing) return;
    setRefreshing(true);
    const candidates = items.filter(
      (it) => {
        if (!it.id || it.userId !== uid) return false;
        const status = it.status || "active";
        const isActive = status === "active";
        const isPendingFound =
          status === "pending" && it.itemType === "found";
        return isActive || isPendingFound;
      }
    );
    setScanTotal(candidates.length);
    setScanDone(0);
    try {
      const { postsDone, totalMatches } = await runForceRescan();
      setScanDone(postsDone);
      if (candidates.length === 0 && totalMatches === 0) {
        showToast(
          "ไม่มีโพสต์ของตัวเองให้สแกน — ลองล็อกอินบัญชีที่มีโพสต์",
          "info"
        );
      } else if (totalMatches > 0) {
        showToast(
          `สแกนเสร็จ: ${postsDone} โพสต์ · พบคู่แนะนำ ${totalMatches} คู่`,
          "success"
        );
      } else {
        showToast(`สแกนเสร็จ: ${postsDone} โพสต์ · ยังไม่พบคู่ใหม่`, "info");
      }
    } catch (err) {
      console.error("Force refresh AI error:", err);
      const msg =
        err instanceof Error && err.message
          ? err.message.slice(0, 140)
          : "เกิดข้อผิดพลาด";
      showToast(`รีเฟรช AI Match ไม่สำเร็จ: ${msg}`, "error");
    } finally {
      setRefreshing(false);
    }
  };

  // แยก "แมทจริง" (ยืนยันแล้ว) ออกจาก "คู่ที่ AI แนะนำ"
  const externalConfirmedMatches = externalMatches.filter((em) => em.confirmed);
  const externalSuggestedMatches = externalMatches.filter((em) => !em.confirmed);

  // เสนอคู่โดย AI -> รอการยืนยันจากเจ้าของ (ใช่ของฉัน / ไม่ใช่ของฉัน)
  const [busyConfirmKey, setBusyConfirmKey] = useState<string | null>(null);
  const handleConfirmDecision = async (
    myPostId: string,
    otherPostId: string,
    action: "confirm" | "reject"
  ) => {
    const key = `${myPostId}|${otherPostId}`;
    if (busyConfirmKey) return;
    setBusyConfirmKey(key);
    try {
      await confirmAiPair(myPostId, otherPostId, action);
      showToast(
        action === "confirm"
          ? "ยืนยันสำเร็จ — คู่นี้ถือเป็นแมทจริงแล้ว"
          : "บันทึกแล้ว — ระบบจะไม่แนะนำคู่นี้ซ้ำ",
        action === "confirm" ? "success" : "info"
      );
    } catch (err) {
      console.error("confirmAiPair error:", err);
      const msg =
        err instanceof Error && err.message ? err.message.slice(0, 140) : "";
      showToast(`ยืนยันไม่สำเร็จ: ${msg}`, "error");
    } finally {
      setBusyConfirmKey(null);
    }
  };

  const formatDate = (timestamp?: FirestoreTimeLike) => {
    if (!timestamp) return "เมื่อสักครู่";
    const time = resolveTime(timestamp);
    if (!time) return "เมื่อสักครู่";
    const date = new Date(time);
    if (isNaN(date.getTime())) return "เมื่อสักครู่";
    return (
      new Intl.DateTimeFormat("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      }).format(date) + " น."
    );
  };

  const getStatusInfo = (item: PostDoc) => {
    if (item.status === "resolved")
      return { label: "พบเจ้าของแล้ว", color: "#34d399", bg: "#0f2a1f", border: "#1f4a35" };
    if (item.status === "under_investigation")
      return { label: "อยู่ระหว่างตรวจสอบ", color: "#f87171", bg: "#2a1418", border: "#4a1f28" };
    if (item.status === "in_progress")
      return { label: "กำลังดำเนินการ", color: "#60a5fa", bg: "#172036", border: "#1e3a5f" };
    if (item.status === "pending")
      return { label: "รออนุมัติ", color: "#fbbf24", bg: "#2a1a10", border: "#4a3418" };
    if (item.status === "rejected")
      return { label: "ถูกปฏิเสธ", color: "#f87171", bg: "#2a1418", border: "#4a1f28" };
    if (item.itemType === "found")
      return { label: "ของพบ", color: "#34d399", bg: "#0f2a1f", border: "#1f4a35" };
    return { label: "ของหาย", color: "#fb923c", bg: "#2a1a10", border: "#4a3418" };
  };

  // สถานะคำขอรับของของเรา (ตามสถานะล่าสุดของ claim ที่ยื่นไป)
  const getClaimStatus = (claim: ClaimDoc) => {
    if (claim.status === "approved")
      return { label: "คำขออนุมัติแล้ว", color: "#34d399", bg: "#0f2a1f", border: "#1f4a35" };
    if (claim.status === "rejected")
      return { label: "คำขอถูกปฏิเสธ", color: "#f87171", bg: "#2a1418", border: "#4a1f28" };
    if (claim.status === "expired")
      return { label: "คำขอหมดอายุแล้ว", color: "#fbbf24", bg: "#2a1a10", border: "#4a3418" };
    if (claim.status === "post_deleted")
      return { label: "โพสต์ถูกลบ", color: "#9ca3af", bg: "#1c1a24", border: "#3a3350" };
    return { label: "กำลังดำเนินการ", color: "#60a5fa", bg: "#172036", border: "#1e3a5f" };
  };

  // สถานะคำขอล่าสุดของแต่ละโพสต์ที่เราไปขอดรับของ
  const claimByPostId = useMemo(() => {
    const m: Record<string, ClaimDoc> = {};
    for (const c of myClaims) {
      if (!c.postId) continue;
      const existing = m[c.postId];
      if (!existing || resolveTime(c.createdAt) > resolveTime(existing.createdAt)) {
        m[c.postId] = c;
      }
    }
    return m;
  }, [myClaims]);

  // คำขอรับของที่เราส่งให้ admin ยังอยู่ในขั้น "กำลังดำเนินการ" (pending)
  // พอ admin อนุมัติหรือปฏิเสธ — คำขอนั้นจะหายไปจากรายการนี้
  const claimRows = useMemo(() => {
    const postById = new Map(claimedPosts.map((p) => [p.id, p]));
    return myClaims
      .map((claim) => ({
        claim,
        post: claim.postId ? postById.get(claim.postId) : undefined,
      }))
      .filter(({ claim }) => !claim.status || claim.status === "pending")
      .sort(
        (a, b) => resolveTime(b.claim.createdAt) - resolveTime(a.claim.createdAt)
      );
  }, [myClaims, claimedPosts]);

  // =========================
  // Filter Logic
  // =========================
  const gridItems = items;

  const gridEmpty =
    filterType === "claims"
      ? {
          title: "ยังไม่มีคำขอที่กำลังดำเนินการ",
          note:
            "เมื่อคุณขอดรับของจากประกาศของผู้อื่น คำขอที่กำลังดำเนินการจะแสดงที่นี่\nและจะหายไปเมื่อ admin อนุมัติหรือปฏิเสธแล้ว",
        }
      : {
          title: "ยังไม่มีโพสต์ของคุณ",
          note: "ไปประกาศของหาย / ของที่พบได้ที่ปุ่ม \"แจ้งของ\"",
        };

  const renderEmptyBox = (title: string, note: string) => (
    <div
      style={{
        textAlign: "center",
        padding: "50px 20px",
        color: "var(--fg-muted)",
        fontSize: "14px",
        backgroundColor: "var(--bg-card)",
        borderRadius: "16px",
        border: "1px dashed var(--border-strong)",
        marginTop: "8px",
      }}
    >
      <Package
        size={36}
        color="var(--border-strong)"
        style={{ marginBottom: "8px" }}
      />
      <div>{title}</div>
      <div
        style={{
          marginTop: "8px",
          fontSize: "12px",
          color: "var(--fg-faint)",
          lineHeight: 1.5,
        }}
      >
        {note}
      </div>
    </div>
  );

  return (
    <div
      className="laf-page-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        backgroundColor: "var(--bg)",
        paddingBottom: "32px",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes itemIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } .my-grid { display: grid; grid-template-columns: 1fr; gap: 14px; } @media (min-width: 720px) { .my-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (min-width: 1024px) { .my-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } } .my-tabs { display: flex; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; } .my-tabs::-webkit-scrollbar { display: none; } .my-tab { flex: 1 0 auto; }`}</style>
      {/* =========================
          Profile Header Card
      ========================= */}
      <div
        className="laf-page-header"
        style={{
          padding: "20px 16px",
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.4)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "var(--fg)",
              fontSize: "20px",
              fontWeight: 800,
              letterSpacing: "-0.025em",
            }}
          >
            รายการของฉัน
          </h2>

          {/* User Circle Button */}
          <button
            onClick={onOpenProfile}
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              border: "1px solid var(--border-strong)",
              background: "var(--bg-card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
            }}
          >
            <UserCircle size={24} color="var(--fg-strong)" />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            backgroundColor: "var(--bg-card)",
            padding: "12px",
            borderRadius: "16px",
            border: "1px solid var(--border)",
          }}
        >
          {/* Avatar / Profile Icon */}
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              border: "2px solid var(--border-strong)",
            }}
          >
            <User size={22} color="var(--accent-fg)" />
          </div>

          {/* User Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: "15px",
                color: "var(--fg)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {user?.displayName || "ไม่ระบุชื่อ"}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "12px",
                color: "var(--fg-muted)",
                marginTop: "2px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <Mail size={12} style={{ flexShrink: 0 }} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {user?.email || "ไม่ระบุอีเมล"}
              </span>
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={onLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "8px 12px",
              border: "1px solid #4a1f28",
              borderRadius: "10px",
              backgroundColor: "#2a1418",
              color: "#f87171",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              flexShrink: 0,
              transition: "background-color 0.2s",
            }}
          >
            <LogOut size={14} />
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* =========================
          Filter Tabs (Modern Pill Style)
      ========================= */}
      <div
        className="my-tabs"
        style={{
          display: "flex",
          gap: "6px",
          margin: "16px auto 12px",
          maxWidth: 640,
          backgroundColor: "var(--bg-subtle)",
          padding: "4px",
          borderRadius: "14px",
          border: "1px solid var(--border)",
        }}
      >
        {(
          [
            { key: "mine", label: "โพสต์ของฉัน" },
            { key: "claims", label: "คำขอของฉัน" },
            { key: "ai", label: "AI Match" },
          ] as const
        ).map((tab) => {
          const isActive = filterType === tab.key;
          const isAiTab = tab.key === "ai";
          const count =
            tab.key === "mine"
              ? items.length
              : tab.key === "claims"
                ? claimRows.length
                : externalMatches.length;
          return (
            <button
              key={tab.key}
              className="my-tab"
              onClick={() => setFilterType(tab.key)}
              style={{
                padding: "8px 6px",
                border: "none",
                borderRadius: "10px",
                background: isActive
                  ? isAiTab
                    ? "linear-gradient(135deg,#7c5cfc,#4f3bd6)"
                    : "#7c5cfc"
                  : "transparent",
                color: isActive ? "var(--accent-fg)" : "var(--fg-muted)",
                fontSize: isAiTab ? "11px" : "12px",
                fontWeight: isActive ? 700 : 600,
                cursor: "pointer",
                boxShadow: isActive ? "0 2px 10px rgba(124,92,252,0.35)" : "none",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "3px",
                whiteSpace: "nowrap",
              }}
            >
              {isAiTab && <Sparkles size={12} color={isActive ? "var(--fg)" : "var(--fg-accent)"} />}
              {tab.label}
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  color: isActive ? "rgba(255,255,255,0.85)" : "var(--fg-faint)",
                  backgroundColor: isActive ? "rgba(255,255,255,0.16)" : "var(--bg-hover)",
                  padding: "1px 6px",
                  borderRadius: "999px",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ปุ่มรีเฟรช AI Match แบบแมนนวล */}
      {!loading && items.length > 0 && (
        <div style={{ padding: "0 16px", marginBottom: "10px" }}>
          <button
            type="button"
            onClick={forceRefreshAi}
            disabled={refreshing}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              maxWidth: 640,
              margin: "0 auto",
              padding: "9px",
              borderRadius: "12px",
              border: "1px dashed #4a3fae",
              background: "rgba(124,92,252,0.08)",
              color: "var(--fg-accent)",
              fontSize: "12px",
              fontWeight: 700,
              cursor: refreshing ? "not-allowed" : "pointer",
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            <Sparkles size={14} />
            {refreshing
              ? `กำลังรีเฟรช ${scanDone}/${scanTotal}...`
              : "รีเฟรช AI Match"}
          </button>
          <div
            style={{
              textAlign: "center",
              maxWidth: 640,
              margin: "0 auto",
              marginTop: 6,
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--fg-muted)",
            }}
          >
            คู่แนะนำแมตชิงโดยกฎฟรีจากฝั่งเซิร์ฟเวอร์ (ข้อมูล AI สกัดครั้งเดียวต่อโพสต์ ประหยัดโควตา)
          </div>
        </div>
      )}

      {/* =========================
          Items List
      ========================= */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px" }}>
        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: "50px 20px",
              color: "var(--fg-muted)",
              fontSize: "14px",
            }}
          >
            กำลังโหลดรายการของฉัน...
          </div>
        ) : filterType === "ai" ? (
          // ========== โหมด AI Match: แสดงโพสต์คนอื่นที่ตรงกับของเรา ==========
          externalMatches.length === 0 && externalNearMatches.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "50px 20px",
                color: "var(--fg-muted)",
                fontSize: "14px",
                backgroundColor: "var(--bg-card)",
                borderRadius: "16px",
                border: "1px dashed var(--border-strong)",
                marginTop: "8px",
              }}
            >
              <Sparkles
                size={36}
                color="var(--border-strong)"
                style={{ marginBottom: "8px" }}
              />
              <div>ยังไม่มีโพสต์คนอื่นที่ AI จับคู่ตรงกับโพสต์ของคุณ</div>
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "12px",
                  color: "var(--fg-faint)",
                  lineHeight: 1.5,
                }}
              >
                เมื่อมีคนโพสต์ของหาย/ของพบที่ตรงกับของคุณ
                <br />
                ระบบจะแสดงรายการที่นี่โดยอัตโนมัติ
              </div>
            </div>
          ) : (
            <>
              {externalMatches.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {externalConfirmedMatches.length > 0 ? (
                    <>
                      <CheckCircle2 size={13} color="#34d399" />
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "#34d399" }}>
                        แมทจริง · ยืนยันแล้ว ({externalConfirmedMatches.length})
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} color="#fbbf24" />
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "#fbbf24" }}>
                        คู่ที่ AI แนะนำ — รอยืนยัน ({externalSuggestedMatches.length})
                      </span>
                    </>
                  )}
                </div>
                {(externalConfirmedMatches.length > 0 && externalSuggestedMatches.length > 0) && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--fg-faint)" }}>
                    <span style={{ color: "#34d399" }}>{externalConfirmedMatches.length} แมทจริง</span>
                    {" · "}
                    <span style={{ color: "#fbbf24" }}>{externalSuggestedMatches.length} คู่ที่แนะนำ</span>
                    {" — คู่ที่ยืนยันแล้วเท่านั้นถือเป็นแมทจริง"}
                  </div>
                )}
              </div>
              )}
              {externalConfirmedMatches.length > 0 && (
              <div className="my-grid">
              {externalConfirmedMatches.map((em, index) => {
                const post = em.post;
                const info = getStatusInfo(post);
                const location =
                  post.building || post.locationName || "ไม่ระบุสถานที่";
                const isHigh = em.score >= 80;

                return (
                  <div
                    key={`${post.id}-${em.matchedMyPostId}`}
                    className="vc-card vc-card-hover"
                    onClick={() => onSelectItem({ ...post, currentUser: user })}
                    style={{
                      overflow: "hidden",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      background: "var(--bg-card)",
                      borderColor: "rgba(52,211,153,0.45)",
                      boxShadow: "0 4px 20px rgba(52,211,153,0.18)",
                      animation: `itemIn 0.3s ease ${(index % 12) * 35}ms both`,
                    }}
                  >
                    {post.imageUrl && (
                      <div style={{ position: "relative", width: "100%" }}>
                        <img
                          src={post.imageUrl}
                          alt={post.title || "สิ่งของ"}
                          style={{
                            width: "100%",
                            height: 150,
                            objectFit: "cover",
                            display: "block",
                            backgroundColor: "var(--bg-subtle)",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            top: 10,
                            left: 10,
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              background: info.bg,
                              color: info.color,
                              border: `1px solid ${info.border}`,
                              padding: "3px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 800,
                              boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                              backdropFilter: "blur(6px)",
                            }}
                          >
                            {info.label}
                          </span>
                          {/* % Badge */}
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              background: isHigh
                                ? "rgba(52,211,153,0.2)"
                                : "rgba(251,191,36,0.2)",
                              backdropFilter: "blur(6px)",
                              color: isHigh ? "#34d399" : "#fbbf24",
                              border: isHigh
                                ? "1px solid rgba(52,211,153,0.5)"
                                : "1px solid rgba(251,191,36,0.5)",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 800,
                            }}
                          >
                            <Sparkles size={10} />
                            แมทจริง {em.score}%
                          </span>
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        padding: "14px 16px 16px",
                        display: "flex",
                        flexDirection: "column",
                        flex: 1,
                        gap: 8,
                      }}
                    >
                      {!post.imageUrl && (
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              background: info.bg,
                              color: info.color,
                              border: `1px solid ${info.border}`,
                              padding: "3px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            {info.label}
                          </span>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              background: isHigh
                                ? "rgba(52,211,153,0.2)"
                                : "rgba(251,191,36,0.2)",
                              color: isHigh ? "#34d399" : "#fbbf24",
                              border: isHigh
                                ? "1px solid rgba(52,211,153,0.5)"
                                : "1px solid rgba(251,191,36,0.5)",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 800,
                            }}
                          >
                            <Sparkles size={10} />
                            แมทจริง {em.score}%
                          </span>
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: 14.5,
                          fontWeight: 700,
                          color: "var(--fg)",
                          lineHeight: 1.35,
                          letterSpacing: "-0.01em",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {post.title}
                      </div>

                      {/* ตรงกับโพสต์ไหนของเรา */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 10px",
                          borderRadius: 8,
                          background: "rgba(124,92,252,0.08)",
                          border: "1px solid rgba(124,92,252,0.2)",
                          fontSize: 11.5,
                          color: "var(--fg-accent)",
                          fontWeight: 600,
                        }}
                      >
                        <ExternalLink size={12} style={{ flexShrink: 0 }} />
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          ตรงกับ: {em.matchedMyPostTitle}
                        </span>
                      </div>

                      {post.desc && (
                        <div
                          style={{
                            fontSize: 12.5,
                            color: "var(--fg-muted)",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            lineHeight: 1.55,
                          }}
                        >
                          {post.desc}
                        </div>
                      )}

                      {/* Meta */}
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          columnGap: 12,
                          rowGap: 6,
                          fontSize: 12,
                          color: "var(--fg-muted)",
                          marginTop: "auto",
                          paddingTop: 4,
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--fg-accent)",
                          }}
                        >
                          {post.category ||
                            (post.itemType === "lost" ? "ของหาย" : "ของที่พบ")}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            minWidth: 0,
                          }}
                        >
                          <MapPin size={13} color="var(--fg-faint)" />
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 150,
                            }}
                          >
                            {location}
                          </span>
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Clock size={13} color="var(--fg-faint)" />
                          {formatDate(post.createdAt)}
                        </span>
                      </div>

                      {/* Footer: ผู้แจ้ง + เหตุผล AI */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderTop: "1px solid var(--border)",
                          paddingTop: 10,
                          marginTop: 4,
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: "var(--fg-muted)",
                            minWidth: 0,
                          }}
                        >
                          <UserCircle
                            size={13}
                            color="var(--fg-faint)"
                            style={{ flexShrink: 0 }}
                          />
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 120,
                            }}
                          >
                            {post.reporterName}
                          </span>
                        </span>
                        {em.reason && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--fg-faint)",
                              maxWidth: 140,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              textAlign: "right",
                            }}
                            title={em.reason}
                          >
                            {em.reason}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
              )}

              {externalSuggestedMatches.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "6px 0 10px",
                }}
              >
                <Sparkles size={14} color="#fbbf24" />
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--fg)" }}>
                  คู่ที่ AI แนะนำ — รอยืนยัน
                  <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>
                    {" "}· {externalSuggestedMatches.length} รายการ
                  </span>
                </div>
              </div>
              )}
              {externalSuggestedMatches.length > 0 && (
              <div className="my-grid">
              {externalSuggestedMatches.map((em, index) => {
                const post = em.post;
                const info = getStatusInfo(post);
                const location =
                  post.building || post.locationName || "ไม่ระบุสถานที่";
                const isHigh = em.score >= 80;
                const busy = busyConfirmKey === `${em.matchedMyPostId}|${post.id}`;

                return (
                  <div
                    key={`${post.id}-${em.matchedMyPostId}`}
                    className="vc-card vc-card-hover"
                    onClick={() => onSelectItem({ ...post, currentUser: user })}
                    style={{
                      overflow: "hidden",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      background: "var(--bg-card)",
                      borderColor: isHigh
                        ? "rgba(251,191,36,0.4)"
                        : "var(--border)",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                      animation: `itemIn 0.3s ease ${(index % 12) * 35}ms both`,
                    }}
                  >
                    {post.imageUrl && (
                      <div style={{ position: "relative", width: "100%" }}>
                        <img
                          src={post.imageUrl}
                          alt={post.title || "สิ่งของ"}
                          style={{
                            width: "100%",
                            height: 150,
                            objectFit: "cover",
                            display: "block",
                            backgroundColor: "var(--bg-subtle)",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            top: 10,
                            left: 10,
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              background: info.bg,
                              color: info.color,
                              border: `1px solid ${info.border}`,
                              padding: "3px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 800,
                              boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                              backdropFilter: "blur(6px)",
                            }}
                          >
                            {info.label}
                          </span>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              background: "rgba(251,191,36,0.2)",
                              backdropFilter: "blur(6px)",
                              color: "#fbbf24",
                              border: "1px solid rgba(251,191,36,0.5)",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 800,
                            }}
                          >
                            <Sparkles size={10} />
                            แนะนำ {em.score}%
                          </span>
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        padding: "14px 16px 16px",
                        display: "flex",
                        flexDirection: "column",
                        flex: 1,
                        gap: 8,
                      }}
                    >
                      {!post.imageUrl && (
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              background: info.bg,
                              color: info.color,
                              border: `1px solid ${info.border}`,
                              padding: "3px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            {info.label}
                          </span>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              background: "rgba(251,191,36,0.2)",
                              color: "#fbbf24",
                              border: "1px solid rgba(251,191,36,0.5)",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 800,
                            }}
                          >
                            <Sparkles size={10} />
                            แนะนำ {em.score}%
                          </span>
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: 14.5,
                          fontWeight: 700,
                          color: "var(--fg)",
                          lineHeight: 1.35,
                          letterSpacing: "-0.01em",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {post.title}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 10px",
                          borderRadius: 8,
                          background: "rgba(124,92,252,0.08)",
                          border: "1px solid rgba(124,92,252,0.2)",
                          fontSize: 11.5,
                          color: "var(--fg-accent)",
                          fontWeight: 600,
                        }}
                      >
                        <ExternalLink size={12} style={{ flexShrink: 0 }} />
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          ตรงกับ: {em.matchedMyPostTitle}
                        </span>
                      </div>

                      {post.desc && (
                        <div
                          style={{
                            fontSize: 12.5,
                            color: "var(--fg-muted)",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            lineHeight: 1.55,
                          }}
                        >
                          {post.desc}
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          columnGap: 12,
                          rowGap: 6,
                          fontSize: 12,
                          color: "var(--fg-muted)",
                          marginTop: "auto",
                          paddingTop: 4,
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--fg-accent)",
                          }}
                        >
                          {post.category ||
                            (post.itemType === "lost" ? "ของหาย" : "ของที่พบ")}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            minWidth: 0,
                          }}
                        >
                          <MapPin size={13} color="var(--fg-faint)" />
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 150,
                            }}
                          >
                            {location}
                          </span>
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Clock size={13} color="var(--fg-faint)" />
                          {formatDate(post.createdAt)}
                        </span>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          borderTop: "1px solid var(--border)",
                          paddingTop: 10,
                          marginTop: 4,
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: "var(--fg-muted)",
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <UserCircle
                            size={13}
                            color="var(--fg-faint)"
                            style={{ flexShrink: 0 }}
                          />
                          <span
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 120,
                            }}
                          >
                            {post.reporterName}
                          </span>
                        </span>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfirmDecision(
                                em.matchedMyPostId,
                                post.id,
                                "confirm"
                              );
                            }}
                            style={{
                              height: 26,
                              padding: "0 10px",
                              borderRadius: 7,
                              border: "1px solid rgba(52,211,153,0.5)",
                              background: "rgba(52,211,153,0.14)",
                              color: "#34d399",
                              fontSize: 10.5,
                              fontWeight: 800,
                              cursor: busy ? "wait" : "pointer",
                            }}
                          >
                            ใช่ของฉัน
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfirmDecision(
                                em.matchedMyPostId,
                                post.id,
                                "reject"
                              );
                            }}
                            style={{
                              height: 26,
                              padding: "0 10px",
                              borderRadius: 7,
                              border: "1px solid rgba(244,63,94,0.5)",
                              background: "rgba(244,63,94,0.10)",
                              color: "#f87171",
                              fontSize: 10.5,
                              fontWeight: 800,
                              cursor: busy ? "wait" : "pointer",
                            }}
                          >
                            ไม่ใช่ของฉัน
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
              )}

              {externalNearMatches.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    margin: "18px 0 10px",
                  }}
                >
                  <Sparkles size={14} color="#fbbf24" />
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--fg)" }}>
                    AI ใกล้เคียง — ยังไม่ยืนยัน
                    <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>
                      {" "}· {externalNearMatches.length} รายการ
                    </span>
                  </div>
                </div>
              )}
              {externalNearMatches.length > 0 && (
                <div className="my-grid">
                  {externalNearMatches.map((em, index) => {
                    const post = em.post;
                    const info = getStatusInfo(post);
                    const location =
                      post.building || post.locationName || "ไม่ระบุสถานที่";

                    return (
                      <div
                        key={`${post.id}-${em.matchedMyPostId}`}
                        className="vc-card vc-card-hover"
                        onClick={() => onSelectItem({ ...post, currentUser: user })}
                        style={{
                          overflow: "hidden",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          background: "var(--bg-card)",
                          borderColor: em.confirmed
                            ? "rgba(52,211,153,0.45)"
                            : "rgba(251,191,36,0.35)",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                          opacity: 0.88,
                          animation: `itemIn 0.3s ease ${(index % 12) * 35}ms both`,
                        }}
                      >
                        {post.imageUrl && (
                          <div style={{ position: "relative", width: "100%" }}>
                            <img
                              src={post.imageUrl}
                              alt={post.title || "สิ่งของ"}
                              style={{
                                width: "100%",
                                height: 150,
                                objectFit: "cover",
                                display: "block",
                                backgroundColor: "var(--bg-subtle)",
                              }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                top: 10,
                                left: 10,
                                display: "flex",
                                gap: 6,
                                alignItems: "center",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  background: info.bg,
                                  color: info.color,
                                  border: `1px solid ${info.border}`,
                                  padding: "3px 10px",
                                  borderRadius: 999,
                                  fontSize: 11,
                                  fontWeight: 800,
                                  boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                                  backdropFilter: "blur(6px)",
                                }}
                              >
                                {info.label}
                              </span>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  background: "rgba(251,191,36,0.2)",
                                  backdropFilter: "blur(6px)",
                                  color: "#fbbf24",
                                  border: "1px solid rgba(251,191,36,0.5)",
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 800,
                                }}
                              >
                                <Sparkles size={10} />
                                ใกล้เคียง {em.score}%
                              </span>
                            </div>
                          </div>
                        )}

                        <div
                          style={{
                            padding: "14px 16px 16px",
                            display: "flex",
                            flexDirection: "column",
                            flex: 1,
                            gap: 8,
                          }}
                        >
                          {!post.imageUrl && (
                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  background: info.bg,
                                  color: info.color,
                                  border: `1px solid ${info.border}`,
                                  padding: "3px 10px",
                                  borderRadius: 999,
                                  fontSize: 11,
                                  fontWeight: 800,
                                }}
                              >
                                {info.label}
                              </span>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  background: "rgba(251,191,36,0.2)",
                                  color: "#fbbf24",
                                  border: "1px solid rgba(251,191,36,0.5)",
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 800,
                                }}
                              >
                                <Sparkles size={10} />
                                ใกล้เคียง {em.score}%
                              </span>
                            </div>
                          )}

                          <div
                            style={{
                              fontSize: 14.5,
                              fontWeight: 700,
                              color: "var(--fg)",
                              lineHeight: 1.35,
                              letterSpacing: "-0.01em",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {post.title}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: "#fbbf24",
                            }}
                          >
                            ตรงกับโพสต์ของคุณ: {em.matchedMyPostTitle}
                          </div>

                          {em.reason && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--fg-faint)",
                                lineHeight: 1.5,
                              }}
                            >
                              AI: {em.reason}
                            </div>
                          )}

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              borderTop: "1px solid var(--border)",
                              paddingTop: 10,
                              marginTop: "auto",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                background: info.bg,
                                color: info.color,
                                border: `1px solid ${info.border}`,
                                padding: "3px 10px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 800,
                              }}
                            >
                              {post.category ||
                                (post.itemType === "lost" ? "ของหาย" : "ของที่พบ")}
                            </span>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                minWidth: 0,
                              }}
                            >
                              <MapPin size={13} color="var(--fg-faint)" />
                              <span
                                style={{
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  maxWidth: 150,
                                }}
                              >
                                {location}
                              </span>
                            </span>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Clock size={13} color="var(--fg-faint)" />
                              {formatDate(post.createdAt)}
                            </span>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              borderTop: "1px solid var(--border)",
                              paddingTop: 10,
                              marginTop: 4,
                            }}
                          >
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11,
                                color: "var(--fg-muted)",
                                minWidth: 0,
                              }}
                            >
                              <UserCircle
                                size={13}
                                color="var(--fg-faint)"
                                style={{ flexShrink: 0 }}
                              />
                              <span
                                style={{
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  maxWidth: 120,
                                }}
                              >
                                {post.reporterName}
                              </span>
                            </span>
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                flexShrink: 0,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 800,
                                  letterSpacing: "0.4px",
                                  color: em.confirmed ? "#34d399" : "#fbbf24",
                                  background: em.confirmed
                                    ? "rgba(52,211,153,0.14)"
                                    : "rgba(251,191,36,0.12)",
                                  border: "1px solid",
                                  borderColor: em.confirmed
                                    ? "rgba(52,211,153,0.40)"
                                    : "rgba(251,191,36,0.35)",
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {em.confirmed
                                  ? "ยืนยันแล้ว"
                                  : "ใกล้เคียง · ยังไม่ยืนยัน"}
                              </span>
                              {!em.confirmed && (
                                <span style={{ display: "flex", gap: 4 }}>
                                  <button
                                    type="button"
                                    disabled={
                                      busyConfirmKey ===
                                      `${em.matchedMyPostId}|${post.id}`
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleConfirmDecision(
                                        em.matchedMyPostId,
                                        post.id,
                                        "confirm"
                                      );
                                    }}
                                    style={{
                                      height: 22,
                                      padding: "0 8px",
                                      borderRadius: 6,
                                      border: "1px solid rgba(52,211,153,0.5)",
                                      background: "rgba(52,211,153,0.14)",
                                      color: "#34d399",
                                      fontSize: 10,
                                      fontWeight: 800,
                                      cursor: "pointer",
                                    }}
                                  >
                                    ใช่ของฉัน
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      busyConfirmKey ===
                                      `${em.matchedMyPostId}|${post.id}`
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleConfirmDecision(
                                        em.matchedMyPostId,
                                        post.id,
                                        "reject"
                                      );
                                    }}
                                    style={{
                                      height: 22,
                                      padding: "0 8px",
                                      borderRadius: 6,
                                      border: "1px solid rgba(244,63,94,0.5)",
                                      background: "rgba(244,63,94,0.10)",
                                      color: "#f87171",
                                      fontSize: 10,
                                      fontWeight: 800,
                                      cursor: "pointer",
                                    }}
                                  >
                                    ไม่ใช่ของฉัน
                                  </button>
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )
        ) : filterType === "claims" ? (
          claimRows.length === 0 ? (
            renderEmptyBox(gridEmpty.title, gridEmpty.note)
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                marginTop: "8px",
              }}
            >
              {claimRows.map(({ claim, post }, index) => {
                const info = getClaimStatus(claim);
                const title = claim.postTitle || post?.title || "ไม่ทราบชื่อโพสต์";
                const imageUrl = claim.postImageUrl || post?.imageUrl || null;
                const typeLabel =
                  claim.itemType === "lost" ? "ของหาย" : "ของที่พบ";
                const canOpen = !!post;
                return (
                  <div
                    key={claim.id}
                    onClick={
                      canOpen
                        ? () => onSelectItem({ ...post, currentUser: user })
                        : undefined
                    }
                    style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "flex-start",
                      padding: "12px 14px",
                      backgroundColor: "var(--bg-card)",
                      border: `1px solid ${info.border}`,
                      borderRadius: "14px",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                      cursor: canOpen ? "pointer" : "default",
                      opacity: post ? 1 : 0.7,
                      animation: `itemIn 0.3s ease ${(index % 12) * 30}ms both`,
                    }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt=""
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          objectFit: "cover",
                          flexShrink: 0,
                          border: "1px solid var(--border)",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: info.bg,
                          border: "1px solid var(--border)",
                        }}
                      >
                        <Package size={20} color={info.color} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--fg)",
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {title}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                          marginTop: 5,
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            background: info.bg,
                            color: info.color,
                            border: `1px solid ${info.border}`,
                            padding: "2px 9px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          {info.label}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--fg-muted)",
                            fontWeight: 600,
                          }}
                        >
                          {typeLabel}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          color: "var(--fg-faint)",
                          marginTop: 5,
                        }}
                      >
                        <Clock size={11} />
                        ส่งคำขอเมื่อ {formatDate(claim.createdAt)}
                      </div>
                      {claim.note && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--fg-muted)",
                            marginTop: 5,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            lineHeight: 1.5,
                          }}
                        >
                          {claim.note}
                        </div>
                      )}
                    </div>
                    {canOpen && (
                      <ExternalLink
                        size={15}
                        color="var(--fg-faint)"
                        style={{ flexShrink: 0, marginTop: 2 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : gridItems.length === 0 ? (
          renderEmptyBox(gridEmpty.title, gridEmpty.note)
        ) : (
          <div className="my-grid">
            {gridItems.map((item, index) => {
              const myClaim = claimByPostId[item.id];
              const info = myClaim ? getClaimStatus(myClaim) : getStatusInfo(item);
              const location =
                item.building || item.locationName || "ไม่ระบุสถานที่";
              const matchCount = item.matches ? item.matches.length : 0;

              const statusChip = (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    background: info.bg,
                    color: info.color,
                    border: `1px solid ${info.border}`,
                    padding: "3px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 800,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  {info.label}
                </span>
              );

              const matchChip = matchCount > 0 ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    background: "rgba(11,10,16,0.72)",
                    backdropFilter: "blur(6px)",
                    color: "#c4b5fd",
                    border: "1px solid #4a3fae",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  <Sparkles size={10} />
                  มีคู่แมทช์
                </span>
              ) : null;

              return (
                <div
                  key={item.id}
                  className="vc-card vc-card-hover"
                  onClick={() => onSelectItem({ ...item, currentUser: user })}
                  style={{
                    overflow: "hidden",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    background: "var(--bg-card)",
                    borderColor: "var(--border)",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                    animation: `itemIn 0.3s ease ${(index % 12) * 35}ms both`,
                  }}
                >
                  {item.imageUrl && (
                    <div style={{ position: "relative", width: "100%" }}>
                      <img
                        src={item.imageUrl}
                        alt={item.title || "สิ่งของ"}
                        style={{
                          width: "100%",
                          height: 150,
                          objectFit: "cover",
                          display: "block",
                          backgroundColor: "var(--bg-subtle)",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        {statusChip}
                        {matchChip}
                      </div>
                    </div>
                  )}

                  <div
                    style={{
                      padding: "14px 16px 16px",
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                      gap: 8,
                    }}
                  >
                    {!item.imageUrl && (
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        {statusChip}
                        {matchChip}
                      </div>
                    )}

                    {item.status === "pending" && !myClaim && (
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: "#fbbf24", lineHeight: 1.4,
                        background: "#2a1a10", border: "1px solid #4a3418",
                        padding: "6px 10px", borderRadius: 8,
                      }}>
                        นำของไปฝากที่จุดรับ ({item.depositLocation || item.locationName || "จุดที่แจ้งไว้"}) เพื่อให้แอดมินตรวจรับของ แล้วโพสต์จะถูกอนุมัติ
                      </div>
                    )}
                    {item.status === "rejected" && !myClaim && (
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: "#f87171", lineHeight: 1.4,
                        background: "#2a1418", border: "1px solid #4a1f28",
                        padding: "6px 10px", borderRadius: 8,
                      }}>
                        คำขอโพสต์ถูกปฏิเสธ — ตรวจสอบจุดฝากของกับแอดมิน แล้วลบโพสต์นี้เพื่อส่งใหม่
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: 14.5,
                        fontWeight: 700,
                        color: "var(--fg)",
                        lineHeight: 1.35,
                        letterSpacing: "-0.01em",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {item.title}
                    </div>

                    {item.desc && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--fg-muted)",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          lineHeight: 1.55,
                        }}
                      >
                        {item.desc}
                      </div>
                    )}

                    {/* Meta: หมวดหมู่ + สถานที่ + วันที่ */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        columnGap: 12,
                        rowGap: 6,
                        fontSize: 12,
                        color: "var(--fg-muted)",
                        marginTop: "auto",
                        paddingTop: 4,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: "var(--bg-hover)",
                          border: "1px solid var(--border)",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--fg-accent)",
                        }}
                      >
                        {item.category ||
                          (item.itemType === "lost" ? "ของหาย" : "ของที่พบ")}
                      </span>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          minWidth: 0,
                        }}
                      >
                        <MapPin size={13} color="var(--fg-faint)" />
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 150,
                          }}
                        >
                          {location}
                        </span>
                      </span>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Clock size={13} color="var(--fg-faint)" />
                        {formatDate(item.createdAt)}
                      </span>
                    </div>

                    {/* Footer: รหัสสินค้า + สถานะ */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderTop: "1px solid var(--border)",
                        paddingTop: 10,
                        marginTop: 4,
                      }}
                    >
<span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: "var(--fg-muted)",
                            minWidth: 0,
                          }}
                        >
                          {myClaim ? (
                            <>
                              <ClipboardCheck
                                size={13}
                                color="#fbbf24"
                                style={{ flexShrink: 0 }}
                              />
                              <span
                                style={{
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  maxWidth: 120,
                                  fontWeight: 700,
                                  color: "var(--fg-accent)",
                                }}
                              >
                                ขอดรับของแล้ว
                              </span>
                            </>
                          ) : (
                            <>
                              <Briefcase
                                size={13}
                                color="var(--fg-faint)"
                                style={{ flexShrink: 0 }}
                              />
                              <span
                                style={{
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  maxWidth: 120,
                                }}
                              >
                                {`LF-${item.id.slice(0, 8).toUpperCase()}`}
                              </span>
                            </>
                          )}
                        </span>

                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: info.color,
                          flexShrink: 0,
                        }}
                      >
                        {info.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ToastContainer />
    </div>
  );
}