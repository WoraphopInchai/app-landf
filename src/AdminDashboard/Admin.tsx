import { useState, useEffect } from "react";
import {
  BarChart3,
  FileText,
  Users,
  ClipboardCheck,
  TrendingUp,
  PackageCheck,
  Search,
  Eye,
  Trash2,
  Ban,
  CheckCircle2,
  XCircle,
  X,
  Clock,
  MapPin,
  User,
  RefreshCw,
  History,
  AlertTriangle,
  LogOut,
  Loader2,
  Activity,
  UserX,
  ShieldCheck,
  ShieldAlert,
  GraduationCap,
  IdCard,
  Mail,
  Sun,
  Moon,
  Flag,
  Send,
  Reply,
  PackageSearch,
  Plus,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
  limit,
  where,
  getDocs,
  getDoc,
  writeBatch,
  addDoc,
  setDoc,
  serverTimestamp,
  deleteField,
  runTransaction,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import type { AppUser, PostItem, FirestoreTimeLike } from "../types";
import { DEFAULT_RETURN_POINTS } from "../lib/returnPoints";
import { useTheme } from "../theme";
import { showToast } from "../lib/toast";
import ConfirmModal from "../components/ConfirmModal";

type AdminTab = "overview" | "found" | "claims" | "history" | "posts" | "reports" | "users" | "manage-admins";
export type { AdminTab };

interface AdminProps {
  currentUser?: AppUser;
  onLogout: () => void;
  initialTab?: AdminTab;
  // ระดับสิทธิ์: super_admin = หัวหน้าแอดมิน, admin = เจ้าหน้าที่ประจำจุด
  adminRole?: "super_admin" | "admin" | null;
  // ชื่อจุดคืนของเจ้าหน้าที่ประจำจุด (เฉพาะ admin) — ใช้กรองงานที่จุดตัวเอง
  adminPoint?: string | null;
}

interface AdminUser {
  id: string;
  name?: string;
  email?: string;
  banned?: boolean;
  role?: string;
  bannedAt?: string;
  phoneNumber?: string;
  phone?: string;
  createdAt?: string;
}

interface AdminClaim {
  id: string;
  postId?: string;
  itemId?: string;
  postTitle?: string;
  postImageUrl?: string;
  itemType?: string;
  depositLocation?: string;
  claimantId?: string;
  claimantName?: string;
  claimType?: string;
  studentId?: string;
  phone?: string;
  email?: string;
  contact?: string;
  note?: string;
  evidenceUrl?: string;
  status?: string;
  createdAt?: FirestoreTimeLike;
  reviewedAt?: string;
  reviewedByUid?: string;
  expiresAt?: string;
  pickupDate?: string;
  rejectReason?: string;
}

interface AdminReport {
  id: string;
  type?: string;
  postId?: string;
  postTitle?: string;
  postType?: string;
  reporterId?: string;
  reporterName?: string;
  userId?: string;
  category?: string;
  detail?: string;
  contact?: string;
  status?: string;
  createdAt?: FirestoreTimeLike;
}

const resolveTime = (t?: FirestoreTimeLike): number => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t !== "object") return new Date(t).getTime();
  if (typeof t.toDate === "function") return t.toDate().getTime();
  return 0;
};

const formatDateShort = (d?: FirestoreTimeLike): string => {
  const t = resolveTime(d);
  if (!t) return "";
  const date = new Date(t);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
};

const formatTime = (ts?: FirestoreTimeLike): string => {
  const t = resolveTime(ts);
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const formatClockTime = (ts?: FirestoreTimeLike): string => {
  const t = resolveTime(ts);
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
};

const getStatusBadge = (c: AdminClaim) => {
  if (c.status === "approved") return { label: "ส่งมอบแล้ว", bg: "#0f2a1f", color: "#34d399" };
  if (c.status === "rejected") return { label: "ถูกปฏิเสธ", bg: "#2a1418", color: "#f87171" };
  if (c.status === "expired") return { label: "หมดอายุแล้ว", bg: "#1c1a24", color: "var(--fg-secondary)" };
  if (c.status === "post_deleted") return { label: "โพสต์ถูกลบ", bg: "#1c1a24", color: "var(--fg-faint)" };
  return { label: "รอตรวจสอบ", bg: "#2a1a10", color: "#fbbf24" };
};

// ปิดคำขอรับของ pending ทั้งหมดของโพสต์ที่ถูกลบ + แจ้งเตือนผู้ขอดแต่ละราย
const closeClaimsForDeletedPost = async (postId: string, postTitle?: string) => {
  try {
    const snap = await getDocs(
      query(
        collection(db, "claims"),
        where("postId", "==", postId),
        where("status", "==", "pending")
      )
    );
    if (snap.empty) return;
    const nowIso = new Date().toISOString();
    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      const data = d.data();
      batch.update(d.ref, {
        status: "post_deleted",
        reviewedAt: nowIso,
        rejectReason: "โพสต์ถูกลบ คำขอรับของจึงถูกยกเลิก",
      });
      if (data.claimantId) {
        addDoc(collection(db, "notifications"), {
          type: "claim_result",
          recipientUid: data.claimantId,
          status: "post_deleted",
          claimId: d.id,
          postId,
          postTitle: postTitle || data.postTitle || "",
          read: false,
          createdAt: serverTimestamp(),
        }).catch(() => {});
      }
    });
    await batch.commit();
  } catch (e) {
    console.error("Error closing claims for deleted post:", e);
  }
};

// ปิดรายงาน open ที่อ้างถึงโพสต์ที่ถูกลบ
const closeReportsForDeletedPost = async (postId: string) => {
  try {
    const snap = await getDocs(
      query(
        collection(db, "reports"),
        where("postId", "==", postId),
        where("status", "==", "open")
      )
    );
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.update(d.ref, { status: "post_deleted" }));
    await batch.commit();
  } catch (e) {
    console.error("Error closing reports for deleted post:", e);
  }
};

// แจ้งเตือนเจ้าของโพสต์เมื่อ admin ลบ/ระงับ/อายัดโพสต์ของเขา
const notifyPostOwner = async (opts: {
  userId?: string;
  uid?: string;
  postId: string;
  postTitle?: string;
  type: "post_deleted" | "post_suspended" | "post_hold";
  status?: string;
}) => {
  const ownerUid = opts.userId || opts.uid || "";
  if (!ownerUid) return;
  try {
    await addDoc(collection(db, "notifications"), {
      type: opts.type,
      recipientUid: ownerUid,
      postId: opts.postId,
      postTitle: opts.postTitle || "",
      status:
        opts.status ||
        (opts.type === "post_deleted"
          ? "deleted"
          : opts.type === "post_suspended"
          ? "suspended"
          : "held"),
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Error notifying post owner:", e);
  }
};

// จำแนกชนิดของรายงาน (ใช้ทั้งหน้า UI และ action)
const getReportKind = (
  r: AdminReport
): "post_report" | "claim_dispute" | "support_message" => {
  if (r.type === "claim_dispute") return "claim_dispute";
  if (r.type === "support_message" || r.type === "post_report") return r.type;
  if (r.postId) return "post_report";
  return "support_message";
};

const REPORT_KIND_META: Record<
  "post_report" | "claim_dispute" | "support_message",
  { label: string; color: string; bg: string }
> = {
  post_report: { label: "รายงานโพสต์", color: "#fb923c", bg: "#2a1a10" },
  claim_dispute: { label: "แจ้งสวมสิทธิ์", color: "#f87171", bg: "#2a1418" },
  support_message: { label: "ติดต่อแอดมิน", color: "#a78bfa", bg: "#1c1626" },
};

// แจ้งผลการจัดการกลับผู้รายงาน
const notifyReportResult = async (report: AdminReport, status: string) => {
  const reporterId = report.reporterId || report.userId || "";
  if (!reporterId) return;
  try {
    await addDoc(collection(db, "notifications"), {
      type: "report_result",
      recipientUid: reporterId,
      reportId: report.id,
      postId: report.postId || "",
      postTitle: report.postTitle || "",
      status,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Error notifying report result:", e);
  }
};

// แบนผู้ใช้ฉบับสมบูรณ์: แบน user + ระงับโพสต์ทั้งหมด + ปิดรายงาน open + ถอดสิทธิ์ admin
const banUserAccount = async (userId: string) => {
  if (!userId) return;
  // อ่านอีเมลและ role เดิมก่อนแบน (ใช้ถอดสิทธิ์ admin หรือหัวหน้าหากโดนแบน)
  let email = "";
  let wasAdmin = false;
  try {
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const d = snap.data();
      email = (d.email || "").toLowerCase();
      const wasBanningSuper = isHeadAdminEmail(email);
      wasAdmin = d.role === "admin" || d.role === "super_admin" || !!d.role || wasBanningSuper;
    }
  } catch (e) {
    console.warn("Cannot read user doc before ban:", e);
  }
  await updateDoc(doc(db, "users", userId), {
    banned: true,
    bannedAt: new Date().toISOString(),
  });
  // ถ้าเป็นเจ้าหน้าที่/หัวหน้า → ถอดสิทธิ์ adminAccounts + reset role (แบน = ถอดสิทธิ์จริง)
  if ((wasAdmin || email) && email) {
    const accRef = doc(db, "adminAccounts", email);
    const accSnap = await getDoc(accRef).catch(() => null);
    if (accSnap?.exists()) {
      await deleteDoc(accRef).catch(() => {});
      addDoc(collection(db, "notifications"), {
        type: "admin_revoked",
        recipientUid: userId,
        pointName: accSnap.data()?.pointName || "",
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
    await updateDoc(doc(db, "users", userId), { role: "user" }).catch(() => {});
  }
  const postSnap = await getDocs(
    query(
      collection(db, "posts"),
      where("userId", "==", userId),
      where("status", "in", ["active", "in_progress", "under_investigation"])
    )
  );
  if (!postSnap.empty) {
    const batch = writeBatch(db);
    postSnap.docs.forEach((d) =>
      batch.update(d.ref, {
        status: "suspended",
        suspendedAt: new Date().toISOString(),
      })
    );
    await batch.commit();
  }
  const reportSnap = await getDocs(
    query(
      collection(db, "reports"),
      where("reporterId", "==", userId),
      where("status", "==", "open")
    )
  );
  if (!reportSnap.empty) {
    const batch = writeBatch(db);
    reportSnap.docs.forEach((d) => batch.update(d.ref, { status: "reporter_banned" }));
    await batch.commit();
  }
};

// Lazy cleanup: ปิดคำขอ pending ที่เกินกำหนด (expiresAt) + ปล่อยโพสต์กลับ active
// (เทียบเท่า expireStaleClaims ใน functions ที่ยัง deploy ไม่ได้ — เรียกจาก Admin ระดับบน เพื่อให้ทำงาน
//  แม้แอดมินยังไม่เปิด tab "คำขอรับของ" แล้ว post จะได้ไม่ค้าง in_progress ซ้ำซาก)
async function expireStaleClaims(adminPoint?: string | null, isStaff?: boolean) {
  const nowMs = Date.now();
  // เจ้าหน้าที่ประจำจุด: query ต้องกรอง depositLocation ให้ตรงกับ rules (rules are not filters)
  const q = isStaff && adminPoint
    ? query(
        collection(db, "claims"),
        where("depositLocation", "==", adminPoint),
        where("status", "==", "pending"),
        limit(200)
      )
    : query(collection(db, "claims"), where("status", "==", "pending"), limit(200));
  const snap = await getDocs(q);
  const expired = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as AdminClaim)
    .filter((c) => !!c.expiresAt && resolveTime(c.expiresAt) <= nowMs);
  if (!expired.length) return;

  const batch = writeBatch(db);
  const affectedPostIds = new Set<string>();
  expired.forEach((c) => {
    const iso = new Date(nowMs).toISOString();
    batch.update(doc(db, "claims", c.id), {
      status: "expired",
      reviewedAt: iso,
      expiredAt: iso,
      rejectReason: "คำขอรับของหมดอายุ (ไม่มารับของตามกำหนด)",
    });
    if (c.postId) affectedPostIds.add(c.postId);
    if (c.claimantId) {
      addDoc(collection(db, "notifications"), {
        type: "claim_result",
        recipientUid: c.claimantId,
        status: "expired",
        claimId: c.id,
        postId: c.postId || "",
        postTitle: c.postTitle || "",
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  });
  await batch.commit();

  // ปล่อยโพสต์กลับ active ถ้าไม่มีคำขอที่ยังไม่หมดอายุเหลืออยู่ + เคลียร์ reservation เดิม (กัน post ค้าง in_progress)
  for (const postId of affectedPostIds) {
    const remaining = await getDocs(
      isStaff && adminPoint
        ? query(
            collection(db, "claims"),
            where("postId", "==", postId),
            where("status", "==", "pending"),
            where("depositLocation", "==", adminPoint),
            limit(1)
          )
        : query(
            collection(db, "claims"),
            where("postId", "==", postId),
            where("status", "==", "pending"),
            limit(1)
          )
    );
    const stillPending = remaining.docs.some((d) => {
      const exp = (d.data() as { expiresAt?: string }).expiresAt;
      return exp && resolveTime(exp) > nowMs;
    });
    if (stillPending) continue;
    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (postSnap.exists() && postSnap.data()?.status === "in_progress") {
      await updateDoc(postRef, {
        status: "active",
        reservationClaimId: deleteField(),
        inProgressAt: deleteField(),
      }).catch(() => {});
    }
  }
}

export default function Admin({ currentUser, onLogout, initialTab, adminRole, adminPoint }: AdminProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab || "overview");
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  const isSuper = adminRole === "super_admin";
  const isStaff = adminRole === "admin";

  // จำนวนคำขอรับของที่ค้างอยู่ (badge บนแท็บ "คำขอรับของ" + หน้าแรก)
  const [pendingClaimsCount, setPendingClaimsCount] = useState(0);
  useEffect(() => {
    if (isStaff && !adminPoint) return;
    const q = isStaff && adminPoint
      ? query(
          collection(db, "claims"),
          where("depositLocation", "==", adminPoint),
          where("status", "==", "pending")
        )
      : query(collection(db, "claims"), where("status", "==", "pending"));
    const unsub = onSnapshot(
      q,
      (snap) => setPendingClaimsCount(snap.size),
      (error) => {
        console.error("Error fetching pending claims count:", error);
        setPendingClaimsCount(0);
      }
    );
    return () => unsub();
  }, [isStaff, adminPoint]);

  // จำนวนรายงานที่ยังค้าง (badge บนแท็บ "รายงาน" + หน้าแรก) — เฉพาะหัวหน้าแอดมิน
  const [openReportsCount, setOpenReportsCount] = useState(0);
  useEffect(() => {
    if (!isSuper) return;
    const q = query(collection(db, "reports"), where("status", "==", "open"));
    const unsub = onSnapshot(
      q,
      (snap) => setOpenReportsCount(snap.size),
      (error) => {
        console.error("Error fetching open reports count:", error);
        setOpenReportsCount(0);
      }
    );
    return () => unsub();
  }, [isSuper]);

  useEffect(() => {
    // เจ้าหน้าที่ยังไม่ได้รับมอบจุดคืน: ห้าม query โพสต์ทั้งระบบ (rules จะบล็อกเพราะต้องกรองจุด)
    if (isStaff && !adminPoint) return;
    // เจ้าหน้าที่ประจำจุด: อ่านเฉพาะโพสต์ที่จุดตัวเอง (rules require depositLocation filter)
    const q = adminPoint && isStaff
      ? query(collection(db, "posts"), where("depositLocation", "==", adminPoint), orderBy("createdAt", "desc"))
      : query(collection(db, "posts"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PostItem));
      setLoading(false);
      setDataError(null);
    }, (error) => {
      console.error("Error fetching admin posts:", error);
      setLoading(false);
      setDataError("อ่านข้อมูลโพสต์ไม่สำเร็จ กรุณารีเฟรชหรือลองใหม่ในอีกสักครู่");
    });
    return () => unsub();
  }, [adminPoint, isStaff]);

  useEffect(() => {
    // เจ้าหน้าที่ประจำจุดไม่ต้องเห็นข้อมูลผู้ใช้ทุกคน (rules จำกัด user read เฉพาะ head/ตัวเอง)
    if (!isSuper) return;
    const q = query(collection(db, "users"), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminUser));
    }, (error) => console.error("Error fetching admin users:", error));
    return () => unsub();
  }, [isSuper]);

  // ปลดล็อกโพสต์ที่ค้าง in_progress จากคำขอที่หมดอายุแล้ว — รันทันทีที่แอดมินเข้าแผง
  useEffect(() => {
    expireStaleClaims(adminPoint, isStaff).catch((e) =>
      console.error("Claim expiry cleanup error:", e)
    );
  }, [adminPoint, isStaff, activeTab]);

  const allTabs: { id: AdminTab; label: string; icon: LucideIcon; color: string }[] = [
    { id: "overview", label: "ภาพรวม", icon: BarChart3, color: "var(--fg-accent)" },
    { id: "found", label: "รับโพสต์ของพบ", icon: PackageSearch, color: "#fbbf24" },
    { id: "claims", label: "คำขอรับของ", icon: ClipboardCheck, color: "#fbbf24" },
    { id: "history", label: "ประวัติ", icon: History, color: "#a78bfa" },
  ];
  // เจ้าหน้าที่ประจำจุด: จัดการโพสต์เฉพาะจุดของตัวเอง
  if (isStaff) {
    allTabs.push({ id: "posts", label: "จัดการโพสต์", icon: FileText, color: "#60a5fa" });
  }
  // เฉพาะหัวหน้าแอดมิน: จัดการโพสต์/รายงาน/ผู้ใช้/เจ้าหน้าที่-จุดคืน
  if (isSuper) {
    allTabs.push(
      { id: "posts", label: "จัดการโพสต์", icon: FileText, color: "#60a5fa" },
      { id: "reports", label: "รายงาน", icon: Flag, color: "#f87171" },
      { id: "users", label: "จัดการผู้ใช้", icon: Users, color: "#34d399" },
      { id: "manage-admins", label: "จัดการแอดมิน", icon: ShieldCheck, color: "#7c5cfc" }
    );
  }

  const pendingFoundCount = posts.filter(
    (p) =>
      p.itemType === "found" &&
      p.status === "pending" &&
      (!isStaff || p.depositLocation === adminPoint)
  ).length;

  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      backgroundColor: "var(--bg)", fontFamily: "'Inter', sans-serif",
    }}>
      {/* Top Header */}
      <div style={{
        background: "color-mix(in srgb, var(--bg) 78%, transparent)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        padding: "10px 20px", display: "flex", alignItems: "center", gap: "12px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        height: 60,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
            background: "linear-gradient(135deg, #7c5cfc 0%, #4f3bd6 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 14px rgba(124, 92, 252, 0.5)",
          }}>
            <GraduationCap size={18} color="var(--accent-fg)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--fg)", lineHeight: 1.2, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              UP Lost &amp; Found
            </div>
            <div style={{ fontSize: "10.5px", color: "var(--fg-accent)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "1px" }}>
              Admin Panel
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* ชื่อจุดคืนของเจ้าหน้าที่ประจำจุด — เห็นทุกแท็บ กันเข้าใจผิดว่าอยู่จุดไหน */}
        {isStaff && adminPoint && (
          <div
            title={`จุดที่คุณได้รับมอบหมาย: ${adminPoint}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              height: "36px",
              padding: "0 12px",
              borderRadius: "10px",
              flexShrink: 0,
              border: "1px solid #1e3a5f",
              background: "#12233a",
              color: "#7cc4ff",
            }}
          >
            <MapPin size={15} />
            <span style={{ fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
              จุดคืน: {adminPoint}
            </span>
          </div>
        )}

        {/* Theme toggle */}
        <button onClick={toggleTheme} title={theme === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"} style={{
          width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
          border: "1px solid var(--border)", background: "var(--bg-card)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          color: "var(--fg-secondary)",
          transition: "border-color 0.13s ease",
        }}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Logout */}
        <button onClick={onLogout} title="ออกจากระบบ" style={{
          display: "flex", alignItems: "center", gap: "7px",
          height: "36px", padding: "0 14px", borderRadius: "10px", flexShrink: 0,
          border: "1px solid #4a1f28", background: "#2a1418",
          color: "#f87171", fontSize: "12.5px", fontWeight: 700, cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          transition: "all 0.15s ease",
        }}>
          <LogOut size={15} />
          ออกจากระบบ
        </button>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: "flex", gap: "6px", padding: "12px 16px 8px",
        backgroundColor: "var(--bg)", borderBottom: "1px solid var(--border)",
        overflowX: "auto", flexShrink: 0,
      }}>
        {allTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              flex: "0 0 auto", padding: "8px 14px", borderRadius: "10px",
              border: isActive ? "none" : "1px solid var(--border)",
              backgroundColor: isActive ? "#7c5cfc" : "var(--bg-card)",
              color: isActive ? "var(--fg)" : "var(--fg-muted)",
              fontSize: "12px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px",
              boxShadow: isActive ? "0 4px 14px rgba(124,92,252,0.35)" : "none",
              transition: "all 0.15s ease", whiteSpace: "nowrap",
            }}>
              <Icon size={15} />
              {tab.label}
              {tab.id === "found" && pendingFoundCount > 0 && (
                <span style={{
                  minWidth: "16px", height: "16px", padding: "0 4px", borderRadius: "999px",
                  backgroundColor: "#fbbf24", color: "#1a1208", fontSize: "10px", fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  {pendingFoundCount > 99 ? "99+" : pendingFoundCount}
                </span>
              )}
              {tab.id === "claims" && pendingClaimsCount > 0 && (
                <span style={{
                  minWidth: "16px", height: "16px", padding: "0 4px", borderRadius: "999px",
                  backgroundColor: "#60a5fa", color: "#0b1526", fontSize: "10px", fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  {pendingClaimsCount > 99 ? "99+" : pendingClaimsCount}
                </span>
              )}
              {tab.id === "reports" && openReportsCount > 0 && (
                <span style={{
                  minWidth: "16px", height: "16px", padding: "0 4px", borderRadius: "999px",
                  backgroundColor: "#f87171", color: "#241012", fontSize: "10px", fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  {openReportsCount > 99 ? "99+" : openReportsCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {isStaff && !adminPoint ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)" }}>
            <MapPin size={32} color="#7cc4ff" style={{ marginBottom: "12px" }} />
            <div style={{ fontSize: "13px", fontWeight: 600 }}>
              ยังไม่ได้รับมอบหมายจุดคืน กรุณาติดต่อหัวหน้าแอดมิน
            </div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)" }}>
            <Loader2 size={32} color="#7c5cfc" style={{ marginBottom: "12px", animation: "spin 1s linear infinite" }} />
            <div style={{ fontSize: "13px", fontWeight: 600 }}>กำลังโหลดข้อมูล...</div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : dataError ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)" }}>
            <AlertTriangle size={32} color="#f87171" style={{ marginBottom: "12px" }} />
            <div style={{ fontSize: "13px", fontWeight: 600 }}>{dataError}</div>
          </div>
        ) : (
          <>
            {activeTab === "overview" && (
              <AdminOverview
                posts={posts}
                users={users}
                isSuper={isSuper}
                adminPoint={isStaff ? adminPoint : null}
                pendingClaims={pendingClaimsCount}
                openReports={openReportsCount}
                onSwitchTab={setActiveTab}
              />
            )}
            {activeTab === "found" && (
              <AdminFoundApprovals
                posts={posts}
                adminPoint={isStaff ? adminPoint : null}
              />
            )}
            {activeTab === "claims" && (
              <AdminClaims
                adminUid={currentUser?.uid || ""}
                adminPoint={isStaff ? adminPoint : null}
                isStaff={isStaff}
              />
            )}
            {activeTab === "history" && (
              <AdminHistory
                isStaff={isStaff}
                adminPoint={isStaff ? adminPoint : null}
              />
            )}
            {activeTab === "posts" && <AdminPosts posts={posts} />}
            {isSuper && activeTab === "reports" && <AdminReports />}
            {isSuper && activeTab === "users" && <AdminUsers users={users} />}
            {isSuper && activeTab === "manage-admins" && <AdminManageAdmins isSuper={isSuper} />}
            {isStaff && (activeTab === "reports" || activeTab === "users" || activeTab === "manage-admins") && (
              <AdminOverview
                posts={posts}
                users={users}
                isSuper={isSuper}
                adminPoint={isStaff ? adminPoint : null}
                pendingClaims={pendingClaimsCount}
                openReports={openReportsCount}
                onSwitchTab={setActiveTab}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================
   SECTION 1: OVERVIEW / ANALYTICS
   ================================================ */
function AdminOverview({
  posts,
  users,
  isSuper,
  adminPoint,
  pendingClaims = 0,
  openReports = 0,
  onSwitchTab,
}: {
  posts: PostItem[];
  users: AdminUser[];
  isSuper: boolean;
  adminPoint?: string | null;
  pendingClaims?: number;
  openReports?: number;
  onSwitchTab?: (tab: AdminTab) => void;
}) {
  // เจ้าหน้าที่ประจำจุด: ดูเฉพาะรายการที่จุดของตัวเอง
  const scopedPosts = adminPoint ? posts.filter((p) => p.depositLocation === adminPoint) : posts;
  const totalPosts = scopedPosts.length;
  const lostPosts = scopedPosts.filter((p) => p.itemType === "lost").length;
  const foundPosts = scopedPosts.filter((p) => p.itemType === "found").length;
  const resolvedPosts = scopedPosts.filter((p) => p.status === "resolved").length;
  const inProgressPosts = scopedPosts.filter((p) => p.status === "in_progress").length;
  const pendingFoundPosts = scopedPosts.filter(
    (p) => p.itemType === "found" && p.status === "pending"
  ).length;
  const unresolvedPosts = scopedPosts.filter((p) => p.status !== "resolved" && p.status !== "rejected");

  // ของที่ยังค้างเกิน 7 วัน — ใช้เร่งติดตามผู้แจ้ง
  const agingDays = 7;
  const [nowMs] = useState(() => Date.now());
  const agedPosts = unresolvedPosts
    .map((p) => {
      const createdMs = resolveTime(p.createdAt);
      const days = createdMs ? Math.max(0, Math.floor((nowMs - createdMs) / 86400000)) : 0;
      return { post: p, days };
    })
    .filter((x) => x.days >= agingDays)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);

  // การ์ดงานกดลิงก์แท็บได้เฉพาะเมื่อมี onSwitchTab
  const clickableHint = onSwitchTab !== undefined;
  const totalUsers = isSuper ? users.length : 0;
  const bannedUsers = isSuper ? users.filter((u) => u.banned).length : 0;

  const stats = [
    { label: "ของค้าง", value: unresolvedPosts.length, icon: Clock, color: "#fb923c", bg: "#2a1a10" },
    { label: "กำลังดำเนินการ", value: inProgressPosts, icon: Activity, color: "#60a5fa", bg: "#172036" },
    { label: "ของหาย", value: lostPosts, icon: AlertTriangle, color: "#fb923c", bg: "#2a1a10" },
    { label: "พบของ", value: foundPosts, icon: PackageCheck, color: "#34d399", bg: "#0f2a1f" },
    { label: "คืนสำเร็จ", value: resolvedPosts, icon: CheckCircle2, color: "#34d399", bg: "#0f2a1f" },
  ];
  if (isSuper) {
    stats.push(
      { label: "โพสต์ทั้งหมด", value: totalPosts, icon: FileText, color: "var(--fg-accent)", bg: "var(--bg-hover)" },
      { label: "รายงานค้าง", value: openReports, icon: Flag, color: "#f87171", bg: "#2a1418" },
      { label: "ผู้ใช้งานทั้งหมด", value: totalUsers, icon: Users, color: "#60a5fa", bg: "#172036" },
      { label: "ผู้ใช้ที่ถูกแบน", value: bannedUsers, icon: UserX, color: "#f87171", bg: "#2a1418" }
    );
  }

  const successRate = totalPosts > 0 ? Math.round((resolvedPosts / totalPosts) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Success Rate Banner */}
      <div style={{
        background: "linear-gradient(135deg, #7c5cfc 0%, #4f3bd6 100%)",
        borderRadius: "14px", padding: "20px", color: "var(--accent-fg)",
        boxShadow: "0 8px 28px rgba(124,92,252,0.4)",
      }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.8)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "8px" }}>
          อัตราการคืนสำเร็จ
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span style={{ fontSize: "42px", fontWeight: 800, lineHeight: 1 }}>{successRate}%</span>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>({resolvedPosts} จาก {totalPosts} รายการ)</span>
        </div>
        <div style={{
          marginTop: "12px", height: "6px", borderRadius: "3px",
          backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: `${successRate}%`, borderRadius: "3px",
            background: "rgba(255,255,255,0.85)",
          }} />
        </div>
      </div>

      {/* งานรอลงมือ — กดการ์ดเพื่อไปจัดการงานนั้น */}
      <div style={{
        backgroundColor: "var(--bg-card)", borderRadius: "16px", padding: "16px",
        border: "1px solid var(--border)",
      }}>
        <div style={{
          fontSize: "14px", fontWeight: 800, color: "var(--fg)", marginBottom: "12px",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <ClipboardCheck size={16} color="var(--fg-accent)" /> งานรอลงมือ
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
          {[
            { label: "โพสต์ของพบรออนุมัติ", value: pendingFoundPosts, icon: PackageSearch, color: "#fbbf24", bg: "#2a1a10", tab: "found" as AdminTab },
            { label: "คำขอเคลมรออนุมัติ", value: pendingClaims, icon: ClipboardCheck, color: "#60a5fa", bg: "#172036", tab: "claims" as AdminTab },
          ].map((c) => {
            const Icon = c.icon;
            const clickable = clickableHint;
            return (
              <button
                key={c.tab}
                onClick={() => onSwitchTab?.(c.tab)}
                disabled={!clickable}
                style={{
                  padding: "14px 12px", borderRadius: "12px",
                  border: "1px solid var(--border)", background: "var(--bg-subtle)",
                  cursor: clickable ? "pointer" : "default",
                  textAlign: "left", display: "flex", flexDirection: "column", gap: "8px",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                  <div style={{
                    width: "30px", height: "30px", borderRadius: "9px",
                    backgroundColor: c.bg, border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon size={15} color={c.color} />
                  </div>
                  {clickable && <ChevronRight size={16} color="var(--fg-faint)" />}
                </div>
                <span style={{ fontSize: "10.5px", color: "var(--fg-muted)", fontWeight: 600, lineHeight: 1.35 }}>
                  {c.label}
                </span>
                <div style={{ fontSize: "24px", fontWeight: 800, color: c.color, lineHeight: 1 }}>
                  {c.value}
                </div>
              </button>
            );
          })}
        </div>
        {clickableHint && (
          <div style={{ fontSize: "10.5px", color: "var(--fg-faint)", marginTop: "10px" }}>
            กดการ์ดเพื่อตรงไปจัดการงานนั้นยังแท็บที่เกี่ยวข้อง
          </div>
        )}
      </div>

      {/* สถานะรายการ */}
      <div style={{
        fontSize: "14px", fontWeight: 800, color: "var(--fg)",
        display: "flex", alignItems: "center", gap: "8px",
      }}>
        <BarChart3 size={16} color="var(--fg-accent)" /> สถานะรายการ
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} style={{
              backgroundColor: "var(--bg-card)", borderRadius: "14px", padding: "14px",
              border: "1px solid var(--border)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                <div style={{
                  width: "32px", height: "32px", borderRadius: "9px",
                  backgroundColor: s.bg, display: "flex", alignItems: "center", justifyContent: "center",
                  border: "1px solid var(--border)",
                }}>
                  <Icon size={16} color={s.color} />
                </div>
                <span style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, lineHeight: 1.3 }}>
                  {s.label}
                </span>
              </div>
              <div style={{ fontSize: "26px", fontWeight: 800, color: "var(--fg)", lineHeight: 1 }}>
                {s.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* ของค้างนาน ควรเร่งติดตาม */}
      <div style={{
        backgroundColor: "var(--bg-card)", borderRadius: "16px", padding: "16px",
        border: "1px solid var(--border)",
      }}>
        <div style={{
          fontSize: "14px", fontWeight: 800, color: "var(--fg)", marginBottom: "12px",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <Clock size={16} color="#fbbf24" /> ของค้างเกิน {agingDays} วัน
        </div>
        {agedPosts.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--fg-faint)", padding: "8px 0" }}>
            ไม่มีรายการค้างนาน ติดตามทันทุกกรณี
          </div>
        ) : (
          agedPosts.map(({ post, days }) => (
            <div
              key={post.id}
              onClick={() => onSwitchTab?.("history")}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 0", borderBottom: "1px solid var(--border)",
                cursor: clickableHint ? "pointer" : "default",
              }}
            >
              <div style={{
                width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                backgroundColor: post.itemType === "lost" ? "#fb923c" : "#34d399",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {post.title}
                </div>
                <div style={{ fontSize: "10px", color: "var(--fg-faint)" }}>
                  {post.reporterName || "ไม่ระบุ"} · {formatDateShort(post.createdAt)}
                </div>
              </div>
              <span style={{
                fontSize: "10px", fontWeight: 800, padding: "3px 8px", borderRadius: "6px",
                backgroundColor: "#2a1a10", color: "#fb923c",
                border: "1px solid #4a3418", whiteSpace: "nowrap",
              }}>
                {days} วัน
              </span>
            </div>
          ))
        )}
      </div>

      {/* Recent Posts */}
      <div style={{
        backgroundColor: "var(--bg-card)", borderRadius: "16px", padding: "16px",
        border: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--fg)", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <TrendingUp size={16} color="var(--fg-accent)" /> โพสต์ล่าสุด
        </div>
        {scopedPosts.filter((p) => p.status !== "rejected").slice(0, 5).map((post) => (
          <div key={post.id} style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: "10px 0", borderBottom: "1px solid var(--border)",
          }}>
            <div style={{
              width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
              backgroundColor: post.status === "resolved" ? "#34d399"
                : post.status === "under_investigation" ? "#f87171"
                : post.status === "in_progress" ? "#60a5fa"
                : post.itemType === "lost" ? "#fb923c" : "#34d399",
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {post.title}
              </div>
              <div style={{ fontSize: "10px", color: "var(--fg-faint)" }}>
                {post.reporterName || "ไม่ระบุ"} · {post.status || "active"}
              </div>
            </div>
            <span style={{
              fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
              backgroundColor: post.itemType === "lost" ? "#2a1a10" : "#0f2a1f",
              color: post.itemType === "lost" ? "#fb923c" : "#34d399",
              border: "1px solid var(--border)",
            }}>
              {post.itemType === "lost" ? "หาย" : "พบ"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================
   SECTION 1.5: FOUND POST APPROVALS (รับโพสต์ของพบ)
   คนพบส่งคำขอโพสต์ (status pending) แอดมินตรวจรับของที่จุดรับแล้วจึงอนุมัติ/ปฏิเสธ
   ================================================ */
function AdminFoundApprovals({
  posts,
  adminPoint,
}: {
  posts: PostItem[];
  adminPoint?: string | null;
}) {
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  const pending = posts.filter(
    (p) =>
      p.itemType === "found" &&
      p.status === "pending" &&
      (!adminPoint || p.depositLocation === adminPoint)
  );

  const notifyFinder = async (post: PostItem, type: "found_approved" | "found_rejected") => {
    if (!post.userId) return;
    try {
      await addDoc(collection(db, "notifications"), {
        type,
        recipientUid: post.userId,
        postId: post.id,
        postTitle: post.title,
        itemType: post.itemType,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error notifying finder:", e);
    }
  };

  const handleApprove = (post: PostItem) => {
    setConfirmDialog({
      title: "ยืนยันรับของแล้ว อนุมัติโพสต์",
      message: `ยืนยันว่าตรวจรับของ "${post.title}" ที่จุดรับแล้ว? โพสต์จะถูกเผยแพร่สู่หน้าสาธารณะ และผู้พบจะได้รับแจ้งเตือน`,
      confirmText: "อนุมัติโพสต์",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "posts", post.id ?? ""), {
            status: "active",
            approvedAt: serverTimestamp(),
          });
          await notifyFinder(post, "found_approved");
          showToast("อนุมัติโพสต์ของพบแล้ว", "success");
        } catch (e) {
          console.error(e);
          showToast("อนุมัติไม่สำเร็จ กรุณาลองใหม่", "error");
        }
      },
    });
  };

  const handleReject = (post: PostItem) => {
    setConfirmDialog({
      title: "ยืนยันปฏิเสธคำขอโพสต์",
      message: `ยืนยันปฏิเสธโพสต์ "${post.title}"? ผู้พบจะได้รับแจ้งเตือน และโพสต์จะไม่ถูกเผยแพร่ต่อสาธารณะ`,
      confirmText: "ปฏิเสธโพสต์",
      variant: "danger",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "posts", post.id ?? ""), {
            status: "rejected",
            rejectedAt: serverTimestamp(),
          });
          await notifyFinder(post, "found_rejected");
          showToast("ปฏิเสธโพสต์แล้ว", "success");
        } catch (e) {
          console.error(e);
          showToast("ปฏิเสธไม่สำเร็จ กรุณาลองใหม่", "error");
        }
      },
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 12px", backgroundColor: "#2a1a10", border: "1px solid #4a3418",
        borderRadius: "10px", fontSize: "12px", color: "#fbbf24",
      }}>
        <PackageSearch size={14} />
        มีคำขอโพสต์ของพบรอตรวจรับ <strong>{pending.length}</strong> รายการ · รับของจริงที่จุดรับแล้วจึงกด "อนุมัติโพสต์"
      </div>

      {pending.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--fg-muted)", fontSize: "13px" }}>
          <PackageSearch size={32} color="var(--border-strong)" style={{ marginBottom: "8px" }} />
          <div>ไม่มีคำขอโพสต์ของพบที่รออนุมัติ</div>
          <div style={{ fontSize: "11px", marginTop: "4px", color: "var(--fg-faint)" }}>
            {adminPoint
              ? `เมื่อผู้ใช้แจ้งของที่พบที่จุด "${adminPoint}" โพสต์จะรอการตรวจรับของคุณที่นี่`
              : "เมื่อผู้ใช้แจ้งของที่พบ โพสต์จะรอการตรวจรับของคุณที่นี่"}
          </div>
        </div>
      ) : (
        pending.map((post) => (
          <div key={post.id} style={{
            backgroundColor: "var(--bg-card)", borderRadius: "14px", padding: "14px",
            border: "1px solid #4a3418", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}>
            <div style={{ display: "flex", gap: "12px" }}>
              {post.imageUrl ? (
                <img src={post.imageUrl} alt="" style={{
                  width: "64px", height: "64px", borderRadius: "10px",
                  objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)",
                }} />
              ) : (
                <div style={{
                  width: "64px", height: "64px", borderRadius: "10px", flexShrink: 0,
                  backgroundColor: "#2a1a10", color: "#fbbf24",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <PackageSearch size={24} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13.5px", fontWeight: 800, color: "var(--fg)" }}>
                  {post.title}
                </div>
                <div style={{ fontSize: "11px", color: "var(--fg-muted)", marginTop: 2 }}>
                  ผู้พบ: {post.reporterName || "ไม่ระบุ"} · {formatDateShort(post.createdAt) || "-"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--fg-secondary)", marginTop: 2 }}>
                  จุดฝากของ: {post.depositLocation || post.locationName || "ไม่ระบุ"}
                </div>
                {post.desc && (
                  <div style={{
                    fontSize: "11px", color: "var(--fg-muted)", marginTop: 4, lineHeight: 1.4,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                  }}>
                    {post.desc}
                  </div>
                )}
                <div style={{ fontSize: "10px", color: "var(--fg-faint)", marginTop: 4 }}>ID: {post.id}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              <button onClick={() => handleApprove(post)} style={{
                flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #1f4a35",
                backgroundColor: "#0f2a1f", color: "#34d399", fontSize: "12px", fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
              }}>
                <CheckCircle2 size={14} /> ตรวจรับแล้ว อนุมัติโพสต์
              </button>
              <button onClick={() => handleReject(post)} style={{
                flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #4a1f28",
                backgroundColor: "#2a1418", color: "#f87171", fontSize: "12px", fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
              }}>
                <XCircle size={14} /> ปฏิเสธ
              </button>
            </div>
          </div>
      )))} 

      {confirmDialog && (
        <ConfirmModal
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

/* ================================================
   SECTION 2: CLAIM REQUESTS VERIFICATION
   ================================================ */
function AdminClaims({
  adminUid,
  adminPoint,
  isStaff,
}: {
  adminUid?: string;
  adminPoint?: string | null;
  isStaff?: boolean;
}) {
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selectedClaim, setSelectedClaim] = useState<AdminClaim | null>(null);
  const [claimPost, setClaimPost] = useState<PostItem | null>(null);
  const [claimPostZoom, setClaimPostZoom] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  // เมื่อแอดมินเข้าดูหน้า "คำขอรับของ" ให้ mark การแจ้งเตือนที่เกี่ยวข้องเป็น "อ่านแล้ว"
  useEffect(() => {
    // เจ้าหน้าที่ยังไม่มีจุด: อย่า query notifications (rules ต้อง pointName → จะโดนปัด)
    if (isStaff && !adminPoint) return;
    let cancelled = false;
    (async () => {
      try {
        const base = [
          where("recipientRole", "==", "admin"),
          ...(isStaff && adminPoint ? [where("pointName", "==", adminPoint)] : []),
        ];
        const snap = await getDocs(query(collection(db, "notifications"), ...base, limit(100)));
        if (cancelled) return;
        const unread = snap.docs.filter((d) => {
          const data = d.data();
          return data.type === "claim" && data.read !== true;
        });
        if (!unread.length) return;
        const batch = writeBatch(db);
        unread.forEach((d) => batch.update(d.ref, { read: true }));
        await batch.commit();
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStaff, adminPoint]);

  useEffect(() => {
    // เจ้าหน้าที่ยังไม่มีจุด: ห้าม query ทั้งหมด (rules บังคับกรองจุด → deny เงียบ)
    if (isStaff && !adminPoint) return;
    const q = adminPoint && isStaff
      ? query(collection(db, "claims"), where("depositLocation", "==", adminPoint), orderBy("createdAt", "desc"))
      : query(collection(db, "claims"), orderBy("createdAt", "desc"));
    const un = onSnapshot(
      q,
      (snap) => {
        setClaims(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminClaim));
      },
      (error) => console.error("Error fetching claims:", error)
    );
    return () => un();
  }, [adminPoint, isStaff]);

  // หมายเหตุ: การจัดการคำขอหมดอายุใช้กลไกเดียวคือ expireStaleClaims (AdminPanel root effect)
  // ที่ re-run เมื่อเปลี่ยน tab/จุด — ไม่ทำซ้ำที่นี่ (เดิมมี 2 กลไก เสี่ยงแจ้งเตือน/เขียนซ้ำ)

  const filtered = claims.filter((c) => {
    const q = searchText.toLowerCase();
    const inScope = !isStaff || c.depositLocation === adminPoint;
    return (
      inScope &&
      c.status === "pending" &&
      (!q ||
        c.postTitle?.toLowerCase().includes(q) ||
        c.claimantName?.toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q))
    );
  });

  // เรียง: คำขอที่รอตรวจสอบมาก่อน (คนกดก่อนขึ้นบนสุด) ตามด้วยสถานะอื่นเรียงล่าสุดก่อน
  const sortedFiltered = [...filtered].sort((a, b) => {
    const aPending = a.status === "pending";
    const bPending = b.status === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;
    const at = resolveTime(a.createdAt);
    const bt = resolveTime(b.createdAt);
    return aPending ? at - bt : bt - at;
  });

  const notifyClaimant = async (claim: AdminClaim, status: "approved" | "rejected") => {
    if (!claim.claimantId) return;
    try {
      await addDoc(collection(db, "notifications"), {
        type: "claim_result",
        recipientUid: claim.claimantId,
        status,
        claimId: claim.id,
        postId: claim.postId,
        postTitle: claim.postTitle,
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error notifying claimant:", e);
    }
  };

  const openClaimPost = async (claim: AdminClaim) => {
    if (!claim.postId) {
      showToast("ไม่พบโพสต์ที่เกี่ยวข้องกับคำขอนี้", "info");
      return;
    }
    try {
      const snap = await getDoc(doc(db, "posts", claim.postId));
      if (snap.exists()) {
        setClaimPost({ id: snap.id, ...snap.data() } as PostItem);
      } else {
        setClaimPost(null);
        setClaimPostZoom(null);
        showToast("ไม่พบโพสต์นี้ (อาจถูกลบไปแล้ว)", "error");
      }
    } catch (e) {
      console.error("Error fetching claim post:", e);
      showToast("ไม่สามารถดึงข้อมูลโพสต์ได้", "error");
    }
  };

  const handleApprove = (claim: AdminClaim) => {
    if (processingId) return;
    setConfirmDialog({
      title: "ยืนยันการส่งมอบของ",
      message: `ยืนยันว่าคืนของ "${claim.postTitle}" ให้ "${claim.claimantName}" แล้วใช่ไหม? สถานะโพสต์จะเปลี่ยนเป็น 'คืนแล้ว' และปิดคำขอรับของรายอื่นในคิวอัตโนมัติ`,
      confirmText: "ยืนยันส่งมอบ",
      variant: "primary",
      onConfirm: async () => {
        setProcessingId(claim.id);
        try {
          const nowIso = new Date().toISOString();
          // ใช้ transaction + precondition กัน "ส่งของชิ้นเดียวให้ 2 คน" (สองแท็บ/สองเจ้าหน้าที่กดพร้อมกัน)
          // อนุมัติได้เฉพาะคำขอที่กำลังจองโพสต์นี้อยู่จริง (reservationClaimId ตรงกับคำขอนี้) — กันอนุมัติคำขอซ้ำซ้อน
          const postId = claim.postId;
          if (postId) {
            await runTransaction(db, async (tx) => {
              const postRef = doc(db, "posts", postId);
              const postSnap = await tx.get(postRef);
              if (!postSnap.exists()) {
                throw new Error("post_not_found");
              }
              const postData = postSnap.data() as PostItem;
              if (postData.status === "resolved") {
                throw new Error("already_resolved");
              }
              if (
                postData.reservationClaimId &&
                postData.reservationClaimId !== claim.id
              ) {
                throw new Error("wrong_reservation_claim");
              }
              await tx.update(postRef, {
                status: "resolved",
                resolvedAt: nowIso,
              });
              await tx.update(doc(db, "claims", claim.id), {
                status: "approved",
                reviewedAt: nowIso,
                reviewedByUid: adminUid || "",
              });
            });
          } else {
            await updateDoc(doc(db, "claims", claim.id), {
              status: "approved",
              reviewedAt: nowIso,
              reviewedByUid: adminUid || "",
            });
          }
          if (claim.postId) {
            try {
              const others = await getDocs(
                isStaff && adminPoint
                  ? query(
                      collection(db, "claims"),
                      where("postId", "==", postId),
                      where("status", "==", "pending"),
                      where("depositLocation", "==", adminPoint)
                    )
                  : query(
                      collection(db, "claims"),
                      where("postId", "==", postId),
                      where("status", "==", "pending")
                    )
              );
              const batch = writeBatch(db);
              const othersList = others.docs.filter((d) => d.id !== claim.id);
              othersList.forEach((d) =>
                batch.update(d.ref, {
                  status: "rejected",
                  reviewedAt: nowIso,
                  reviewedByUid: adminUid || "",
                  rejectReason: "ของถูกส่งมอบให้เจ้าของแล้ว",
                })
              );
              await batch.commit();
              // แจ้งเตือนผู้ขอรายอื่นที่ถูกปิดคำขอ
              othersList.forEach((d) => {
                const data = d.data();
                if (data.claimantId) {
                  addDoc(collection(db, "notifications"), {
                    type: "claim_result",
                    recipientUid: data.claimantId,
                    status: "rejected",
                    claimId: d.id,
                    postId: postId,
                    postTitle: claim.postTitle || "",
                    read: false,
                    createdAt: serverTimestamp(),
                  }).catch(() => {});
                }
              });
            } catch (e) {
              console.error("Error closing other claims:", e);
            }
          }
          await notifyClaimant(claim, "approved");
          setConfirmDialog(null);
          setSelectedClaim(null);
          setClaimPost(null);
          setClaimPostZoom(null);
        } catch (e) {
          console.error(e);
          const msg = (e as { message?: string })?.message || "";
          if (msg === "already_resolved") {
            showToast("โพสต์นี้ถูกส่งมอบ (resolved) ไปแล้วในแท็บอื่น", "error");
          } else if (msg === "wrong_reservation_claim") {
            showToast("คำขอนี้ไม่ใช่ผู้ที่จองโพสต์ไว้อยู่จริง ตรวจสอบคำขออีกครั้ง", "error");
          } else {
            showToast("เกิดข้อผิดพลาดในการยืนยัน", "error");
          }
        } finally {
          setProcessingId(null);
        }
      },
    });
  };

  const handleReject = (claim: AdminClaim) => {
    if (processingId) return;
    setConfirmDialog({
      title: "ยืนยันปฏิเสธคำขอ?",
      message: `ปฏิเสธคำขอรับของ "${claim.postTitle}" ของ "${claim.claimantName}"? ถ้าไม่มีคำขออื่นอีก โพสต์จะถูกปล่อยให้คนอื่นขอดรับได้`,
      confirmText: "ปฏิเสธ",
      onConfirm: async () => {
        setProcessingId(claim.id);
        try {
          const nowIso = new Date().toISOString();
          await updateDoc(doc(db, "claims", claim.id), {
            status: "rejected",
            reviewedAt: nowIso,
            reviewedByUid: adminUid || "",
          });
          const rejPostId = claim.postId;
          if (rejPostId) {
            try {
              const others = await getDocs(
                isStaff && adminPoint
                  ? query(
                      collection(db, "claims"),
                      where("postId", "==", rejPostId),
                      where("status", "==", "pending"),
                      where("depositLocation", "==", adminPoint)
                    )
                  : query(
                      collection(db, "claims"),
                      where("postId", "==", rejPostId),
                      where("status", "==", "pending")
                    )
              );
              // เคลียร์ reservation ทุกครั้งที่ปฏิเสธ (กันโพสต์ติดอยู่กับ claim ที่ reject แล้ว)
              const postRef = doc(db, "posts", rejPostId);
              const postSnap = await getDoc(postRef);
              const postData = postSnap.data();
              if (
                postData &&
                postData.status !== "resolved" &&
                postData.status !== "suspended" &&
                postData.status !== "under_investigation"
              ) {
                const patch: { [k: string]: unknown } = {
                  reservationClaimId: deleteField(),
                  inProgressAt: deleteField(),
                };
                if (others.empty) {
                  patch.status = "active";
                }
                await updateDoc(postRef, patch).catch(() => {});
              }
            } catch (e) {
              console.error("Error releasing post:", e);
            }
          }
          await notifyClaimant(claim, "rejected");
          setConfirmDialog(null);
          setSelectedClaim(null);
          setClaimPost(null);
          setClaimPostZoom(null);
        } catch (e) {
          console.error(e);
          showToast("เกิดข้อผิดพลาดในการปฏิเสธ", "error");
        } finally {
          setProcessingId(null);
        }
      },
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Search */}
      <div style={{ display: "flex", alignItems: "center", backgroundColor: "var(--bg-card)", borderRadius: "12px", padding: "10px 14px", gap: "8px", border: "1px solid var(--border)" }}>
        <Search size={16} color="var(--fg-accent)" />
        <input
          type="text"
          placeholder="ค้นหาคำขอรับของ..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ flex: 1, border: "none", outline: "none", fontSize: "13px", color: "var(--fg-strong)", background: "transparent" }}
        />
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: "8px", padding: "12px", backgroundColor: "#2a1a10", border: "1px solid #4a3418", borderRadius: "12px" }}>
        <ClipboardCheck size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: "1px" }} />
        <div style={{ fontSize: "12px", color: "#fcd34d", lineHeight: 1.5 }}>
          กำลังรออนุมัติ <strong>{filtered.length}</strong> รายการ
        </div>
      </div>

      {/* Claims List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--fg-muted)", fontSize: "13px" }}>
          <ClipboardCheck size={32} color="var(--border-strong)" style={{ marginBottom: "8px" }} />
          <div>ไม่มีคำขอที่รออนุมัติในขณะนี้</div>
        </div>
      ) : (
        sortedFiltered.map((claim) => {
          const badge = getStatusBadge(claim);
          const isProcessing = processingId === claim.id;
          return (
            <div key={claim.id} style={{
              backgroundColor: "var(--bg-card)", borderRadius: "14px", overflow: "hidden",
              border: claim.status === "pending" ? "1.5px solid #4a3418" : "1px solid var(--border)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}>
              {/* Claim Header */}
              <div style={{ padding: "14px 16px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
                {claim.postImageUrl ? (
                  <img src={claim.postImageUrl} alt="" style={{
                    width: "56px", height: "56px", borderRadius: "10px", objectFit: "cover", flexShrink: 0,
                    border: "1px solid var(--border)",
                  }} />
                ) : (
                  <div style={{
                    width: "56px", height: "56px", borderRadius: "10px", flexShrink: 0,
                    backgroundColor: "var(--bg-hover)", display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1px solid var(--border)",
                  }}>
                    <PackageCheck size={22} color="var(--fg-accent)" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>
                    {claim.postTitle}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                    <span style={{
                      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                      backgroundColor: badge.bg, color: badge.color,
                    }}>
                      {badge.label}
                    </span>
                    <span style={{
                      fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "6px",
                      backgroundColor: "var(--bg-hover)", color: "var(--fg-secondary)", border: "1px solid var(--border)",
                    }}>
                      {claim.itemType === "lost" ? "ของหาย" : "พบของ"}
                    </span>
                    <span style={{
                      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                      backgroundColor: claim.claimType === "student" ? "#172036" : "#2a1a10",
                      color: claim.claimType === "student" ? "#60a5fa" : "#fbbf24",
                      border: `1px solid ${claim.claimType === "student" ? "#2a3a5c" : "#4a3418"}`,
                    }}>
                      {claim.claimType === "student" ? "นิสิต" : "บุคคลทั่วไป"}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--fg-secondary)", lineHeight: 1.5 }}>
                    ผู้ขอ: <strong>{claim.claimantName}</strong> · {formatTime(claim.createdAt)}
                  </div>
                  {claim.status === "pending" && claim.expiresAt && (
                    <div style={{ fontSize: "11px", color: claim.pickupDate ? "#fcd34d" : "#60a5fa", marginTop: "2px" }}>
                      {claim.pickupDate
                        ? <>นัดรับ: {formatTime(claim.expiresAt)}</>
                        : <>หมดอายุใน: {formatTime(claim.expiresAt)}</>}
                    </div>
                  )}
                  {claim.studentId && (
                    <div style={{ fontSize: "11px", color: "var(--fg-secondary)", marginTop: "2px" }}>
                      รหัสนิสิต: <strong style={{ color: "#60a5fa" }}>{claim.studentId}</strong>
                    </div>
                  )}
                  {((claim.phone || claim.contact) && (claim.phone || claim.contact) !== "ไม่ระบุช่องทางติดต่อ") && (
                    <div style={{ fontSize: "11px", color: "#60a5fa", marginTop: "2px" }}>
                      โทร: {claim.phone || claim.contact}
                    </div>
                  )}
                  {claim.email && (
                    <div style={{ fontSize: "11px", color: "var(--fg-secondary)", marginTop: "2px" }}>
                      อีเมล: {claim.email}
                    </div>
                  )}
                </div>
              </div>

              {/* Note */}
              {claim.note && (
                <div style={{
                  margin: "0 16px", padding: "10px 12px", backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border)", borderRadius: "10px", marginBottom: "12px",
                }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "3px" }}>
                    รายละเอียดจากผู้ขอ
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--fg-muted)", lineHeight: 1.5 }}>
                    {claim.note}
                  </div>
                </div>
              )}

              {/* Evidence Image */}
              {claim.evidenceUrl && (
                <div style={{ margin: "0 16px 12px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "5px" }}>
                    รูปหลักฐานจากผู้ขอ
                  </div>
                  <img
                    src={claim.evidenceUrl}
                    alt="หลักฐาน"
                    style={{
                      width: "100%", maxHeight: "220px", objectFit: "cover",
                      borderRadius: "10px", border: "1px solid var(--border)", cursor: "pointer",
                    }}
                    onClick={() => setSelectedClaim(claim)}
                  />
                </div>
              )}

              {/* Actions */}
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px" }}>
                <button onClick={() => setSelectedClaim(claim)} style={{
                  flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-card)", color: "var(--fg-strong)", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                }}>
                  <Eye size={14} /> ตรวจสอบ
                </button>
                {claim.status === "pending" && (
                  <>
                    <button onClick={() => handleApprove(claim)} disabled={isProcessing} style={{
                      flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid #1f4a35",
                      backgroundColor: "#0f2a1f", color: "#34d399", fontSize: "12px", fontWeight: 700,
                      cursor: isProcessing ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                    }}>
                      <CheckCircle2 size={14} /> ยืนยันส่งมอบ
                    </button>
                    <button onClick={() => handleReject(claim)} disabled={isProcessing} style={{
                      flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid #4a1f28",
                      backgroundColor: "#2a1418", color: "#f87171", fontSize: "12px", fontWeight: 700,
                      cursor: isProcessing ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                    }}>
                      <XCircle size={14} /> ปฏิเสธ
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Claim Detail Modal */}
      {selectedClaim && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "420px", maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--fg)", margin: 0 }}>
                ตรวจสอบคำขอรับของ
              </h3>
              <button onClick={() => { setSelectedClaim(null); setClaimPost(null); setClaimPostZoom(null); }} style={{
                background: "var(--bg-hover)", border: "none", borderRadius: "50%", width: "30px", height: "30px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-secondary)",
              }}>
                <X size={16} />
              </button>
            </div>

            {selectedClaim.evidenceUrl && (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--fg-accent)", marginBottom: "6px" }}>
                  รูปหลักฐานจากผู้ขอ
                </div>
                <a href={selectedClaim.evidenceUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                  <img src={selectedClaim.evidenceUrl} alt="หลักฐาน" style={{
                    width: "100%", maxHeight: "260px", objectFit: "cover",
                    borderRadius: "12px", border: "1px solid var(--border)",
                  }} />
                </a>
              </div>
            )}

            {selectedClaim.postImageUrl && (
              <img src={selectedClaim.postImageUrl} alt="" style={{
                width: "100%", height: "180px", objectFit: "cover", borderRadius: "12px", marginBottom: "14px",
                border: "1px solid var(--border)",
              }} />
            )}

            <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--fg)", marginBottom: "12px" }}>
              {selectedClaim.postTitle}
            </div>

            <button
              onClick={() => openClaimPost(selectedClaim)}
              disabled={!!processingId}
              style={{
                width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #3a2a5a",
                backgroundColor: "var(--bg-hover)", color: "var(--fg-accent)", fontSize: "12px", fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                marginBottom: "12px",
              }}
            >
              <Eye size={14} /> ดูรายละเอียดโพสต์
            </button>

            {[
              { icon: User, label: "ผู้ขอรับของ", value: selectedClaim.claimantName || "-", color: "#60a5fa", bg: "#172036" },
              { icon: GraduationCap, label: "ประเภทผู้ขอ", value: selectedClaim.claimType === "student" ? "นิสิต" : "บุคคลทั่วไป", color: selectedClaim.claimType === "student" ? "#60a5fa" : "#fbbf24", bg: selectedClaim.claimType === "student" ? "#172036" : "#2a1a10" },
              { icon: Clock, label: "ส่งคำขอเมื่อ", value: formatTime(selectedClaim.createdAt) || "-", color: "#fbbf24", bg: "#2a1a10" },
              { icon: MapPin, label: "สถานะ", value: getStatusBadge(selectedClaim).label, color: "#34d399", bg: "#0f2a1f" },
            ].map((row, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "10px", backgroundColor: row.bg,
                marginBottom: "8px",
              }}>
                <row.icon size={16} color={row.color} />
                <div>
                  <div style={{ fontSize: "10px", color: "var(--fg-muted)", fontWeight: 600 }}>{row.label}</div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)" }}>{row.value}</div>
                </div>
              </div>
            ))}

            {selectedClaim.studentId && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "10px", backgroundColor: "#172036", marginBottom: "8px",
              }}>
                <IdCard size={16} color="#60a5fa" />
                <div>
                  <div style={{ fontSize: "10px", color: "var(--fg-muted)", fontWeight: 600 }}>รหัสนิสิต</div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)" }}>{selectedClaim.studentId}</div>
                </div>
              </div>
            )}

            {((selectedClaim.phone || selectedClaim.contact) && (selectedClaim.phone || selectedClaim.contact) !== "ไม่ระบุช่องทางติดต่อ") && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "10px", backgroundColor: "var(--bg-hover)", marginBottom: "8px",
              }}>
                <ShieldCheck size={16} color="var(--fg-accent)" />
                <div>
                  <div style={{ fontSize: "10px", color: "var(--fg-muted)", fontWeight: 600 }}>เบอร์โทร</div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)" }}>{selectedClaim.phone || selectedClaim.contact}</div>
                </div>
              </div>
            )}

            {selectedClaim.email && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "10px", backgroundColor: "var(--bg-hover)", marginBottom: "8px",
              }}>
                <Mail size={16} color="var(--fg-accent)" />
                <div>
                  <div style={{ fontSize: "10px", color: "var(--fg-muted)", fontWeight: 600 }}>อีเมล</div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)" }}>{selectedClaim.email}</div>
                </div>
              </div>
            )}

            {selectedClaim.note && (
              <div style={{
                padding: "12px", backgroundColor: "var(--bg-subtle)", borderRadius: "10px",
                fontSize: "12px", color: "var(--fg-secondary)", lineHeight: 1.6, marginBottom: "12px",
                border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--fg-accent)", marginBottom: "4px" }}>
                  รายละเอียดจากผู้ขอ
                </div>
                {selectedClaim.note}
              </div>
            )}

            {selectedClaim.status === "pending" && (
              <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                <button onClick={() => handleApprove(selectedClaim)} disabled={processingId === selectedClaim.id} style={{
                  flex: 1, padding: "12px", borderRadius: "12px", border: "none",
                  backgroundColor: "#10b981", color: "var(--accent-fg)", fontSize: "13px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}>
                  <CheckCircle2 size={16} /> อนุมัติคำขอ
                </button>
                <button onClick={() => handleReject(selectedClaim)} disabled={processingId === selectedClaim.id} style={{
                  flex: 1, padding: "12px", borderRadius: "12px", border: "none",
                  backgroundColor: "#dc2626", color: "var(--fg)", fontSize: "13px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}>
                  <XCircle size={16} /> ปฏิเสธ
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Post Detail Modal (ที่เปิดจากคำขอรับของ) */}
      {claimPost && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 101, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "420px", maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--fg)", margin: 0 }}>รายละเอียดโพสต์</h3>
              <button onClick={() => { setClaimPost(null); setClaimPostZoom(null); }} style={{
                background: "var(--bg-hover)", border: "none", borderRadius: "50%", width: "30px", height: "30px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-secondary)",
              }}>
                <X size={16} />
              </button>
            </div>

            {claimPost.imageUrl && (
              <img
                src={claimPost.imageUrl}
                alt=""
                onClick={() => setClaimPostZoom(claimPost.imageUrl ?? null)}
                style={{
                  width: "100%", height: "180px", objectFit: "cover", borderRadius: "12px", marginBottom: "14px",
                  border: "1px solid var(--border)", cursor: "pointer",
                }}
              />
            )}

            <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--fg)", marginBottom: "4px" }}>
              {claimPost.title}
            </div>
            <div style={{
              fontSize: "10px", color: "var(--fg-faint)", marginBottom: "12px",
              fontFamily: "'SF Mono', monospace",
            }}>
              ID: {claimPost.id}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", margin: "0 2px 6px" }}>
              <FileText size={13} color="var(--fg-accent)" />
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-strong)" }}>รายละเอียด</span>
            </div>
            {claimPost.desc && (
              <div style={{
                padding: "12px", backgroundColor: "var(--bg-subtle)", borderRadius: "10px",
                fontSize: "12px", color: "var(--fg-secondary)", lineHeight: 1.6, marginBottom: "12px",
                border: "1px solid var(--border)",
              }}>
                {claimPost.desc}
              </div>
            )}

            {[
              { icon: MapPin, label: "สถานที่", value: claimPost.locationName || "-" },
              { icon: User, label: "ผู้แจ้ง", value: claimPost.reporterName || "-" },
              { icon: Clock, label: "วันที่", value: formatDateShort(claimPost.date) || "-" },
              { icon: Clock, label: "เวลาโพสต์", value: formatClockTime(claimPost.createdAt) || "-" },
              { icon: MapPin, label: "สถานะ", value: (claimPost.status || "-") },
            ].map((r, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 0", borderBottom: "1px solid var(--border)",
              }}>
                <r.icon size={14} color="var(--fg-faint)" />
                <span style={{ fontSize: "11px", color: "var(--fg-faint)", width: "60px" }}>{r.label}</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-strong)" }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox: ดูรูปโพสต์ใหญ่ */}
      {claimPostZoom && (
        <div
          onClick={() => setClaimPostZoom(null)}
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.85)",
            backdropFilter: "blur(6px)",
            zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center",
            padding: "20px", cursor: "pointer",
          }}
        >
          <img
            src={claimPostZoom}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%", maxHeight: "88vh", borderRadius: "16px",
              boxShadow: "0 25px 60px rgba(0,0,0,0.7)", border: "1px solid var(--border)",
              objectFit: "contain",
            }}
          />
        </div>
      )}

{confirmDialog && (
        <ConfirmModal
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          busy={!!processingId}
          onConfirm={() => {
            confirmDialog.onConfirm();
          }}
          onCancel={() => {
            if (processingId) return;
            setConfirmDialog(null);
          }}
        />
      )}
    </div>
  );
}

function AdminHistory({
  isStaff,
  adminPoint,
}: {
  isStaff?: boolean;
  adminPoint?: string | null;
}) {
  const [history, setHistory] = useState<AdminClaim[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<AdminClaim | null>(null);

  useEffect(() => {
    // เจ้าหน้าที่ยังไม่มีจุด: ห้าม query ทั้งหมด (rules บังคับกรองจุด → deny เงียบ)
    if (isStaff && !adminPoint) return;
    const q = isStaff && adminPoint
      ? query(collection(db, "claims"), where("depositLocation", "==", adminPoint), orderBy("createdAt", "desc"))
      : query(collection(db, "claims"), orderBy("createdAt", "desc"));
    const un = onSnapshot(
      q,
      (snap) => {
        setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminClaim));
      },
      (error) => console.error("Error fetching claim history:", error)
    );
    return () => un();
  }, [isStaff, adminPoint]);

  const filtered = history.filter((c) => {
    if (c.status === "pending") return false;
    // เจ้าหน้าที่เห็นประวัติเฉพาะรายการที่เกี่ยวข้องกับจุดของตัวเอง
    if (isStaff && (!adminPoint || c.depositLocation !== adminPoint)) return false;
    const q = searchText.toLowerCase();
    return (
      !q ||
      c.postTitle?.toLowerCase().includes(q) ||
      c.claimantName?.toLowerCase().includes(q) ||
      (c.contact || "").toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Search */}
      <div style={{ display: "flex", alignItems: "center", backgroundColor: "var(--bg-card)", borderRadius: "12px", padding: "10px 14px", gap: "8px", border: "1px solid var(--border)" }}>
        <Search size={16} color="var(--fg-accent)" />
        <input
          type="text"
          placeholder="ค้นหาประวัติตามชื่อโพสต์ / ผู้ขอ..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ flex: 1, border: "none", outline: "none", fontSize: "13px", color: "var(--fg-strong)", background: "transparent" }}
        />
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: "8px", padding: "12px", backgroundColor: "#1c1a24", border: "1px solid #3a3350", borderRadius: "12px" }}>
        <History size={16} color="#a78bfa" style={{ flexShrink: 0, marginTop: "1px" }} />
        <div style={{ fontSize: "12px", color: "#c4b5fd", lineHeight: 1.5 }}>
          ประวัติรายการที่จบแล้วทั้งหมด <strong>{filtered.length}</strong> รายการ
        </div>
      </div>

      {/* History List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--fg-muted)", fontSize: "13px" }}>
          <History size={32} color="var(--border-strong)" style={{ marginBottom: "8px" }} />
          <div>ยังไม่มีประวัติ</div>
        </div>
      ) : (
        filtered.map((claim) => {
          const badge = getStatusBadge(claim);
          const closedAt = resolveTime(claim.reviewedAt);
          return (
            <div key={claim.id} style={{
              backgroundColor: "var(--bg-card)", borderRadius: "14px", overflow: "hidden",
              border: "1px solid var(--border)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}>
              <div style={{ padding: "14px 16px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
                {claim.postImageUrl ? (
                  <img src={claim.postImageUrl} alt="" style={{
                    width: "56px", height: "56px", borderRadius: "10px", objectFit: "cover", flexShrink: 0,
                    border: "1px solid var(--border)",
                  }} />
                ) : (
                  <div style={{
                    width: "56px", height: "56px", borderRadius: "10px", flexShrink: 0,
                    backgroundColor: "var(--bg-hover)", display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1px solid var(--border)",
                  }}>
                    <PackageCheck size={22} color="var(--fg-accent)" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>
                    {claim.postTitle}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px", backgroundColor: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                    <span style={{
                      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                      backgroundColor: claim.claimType === "student" ? "#172036" : "#2a1a10",
                      color: claim.claimType === "student" ? "#60a5fa" : "#fbbf24",
                      border: `1px solid ${claim.claimType === "student" ? "#2a3a5c" : "#4a3418"}`,
                    }}>
                      {claim.claimType === "student" ? "นิสิต" : "บุคคลทั่วไป"}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--fg-secondary)", lineHeight: 1.6 }}>
                    ผู้ขอ: <strong>{claim.claimantName}</strong>{" "}
                    {claim.studentId && <>(รหัส <strong style={{ color: "#60a5fa" }}>{claim.studentId}</strong>)</>}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--fg-secondary)", lineHeight: 1.6 }}>
                    ยื่นเมื่อ: {formatTime(claim.createdAt)} · จบเมื่อ: {closedAt ? formatTime(claim.reviewedAt) : "-"}
                  </div>
                  {(claim.phone || claim.contact) && (claim.phone || claim.contact) !== "ไม่ระบุช่องทางติดต่อ" && (
                    <div style={{ fontSize: "11px", color: "#60a5fa", marginTop: "2px" }}>
                      โทร: {claim.phone || claim.contact}
                    </div>
                  )}
                  {claim.status === "rejected" && claim.rejectReason && (
                    <div style={{ fontSize: "11px", color: "var(--fg-muted)", marginTop: "2px", lineHeight: 1.5 }}>
                      เหตุผล: {claim.rejectReason}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px" }}>
                <button onClick={() => setSelected(claim)} style={{
                  flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-card)", color: "var(--fg-strong)", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                }}>
                  <Eye size={14} /> ดูรายละเอียด
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* Detail Modal (อ่านอย่างเดียว) */}
      {selected && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "420px", maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--fg)", margin: 0 }}>
                รายละเอียดประวัติ
              </h3>
              <button onClick={() => setSelected(null)} style={{
                background: "var(--bg-hover)", border: "none", borderRadius: "50%", width: "30px", height: "30px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-secondary)",
              }}>
                <X size={16} />
              </button>
            </div>

            {selected.postImageUrl && (
              <img src={selected.postImageUrl} alt="" style={{
                width: "100%", height: "180px", objectFit: "cover", borderRadius: "12px", marginBottom: "14px",
                border: "1px solid var(--border)",
              }} />
            )}

            <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--fg)", marginBottom: "12px" }}>
              {selected.postTitle}
            </div>

            {[
              { icon: User, label: "ผู้ขอรับของ", value: selected.claimantName || "-", color: "#60a5fa", bg: "#172036" },
              { icon: GraduationCap, label: "ประเภทผู้ขอ", value: selected.claimType === "student" ? "นิสิต" : "บุคคลทั่วไป", color: selected.claimType === "student" ? "#60a5fa" : "#fbbf24", bg: selected.claimType === "student" ? "#172036" : "#2a1a10" },
              { icon: Clock, label: "ยื่นคำขอเมื่อ", value: formatTime(selected.createdAt) || "-", color: "#fbbf24", bg: "#2a1a10" },
              { icon: CheckCircle2, label: "สถานะ", value: getStatusBadge(selected).label, color: "#34d399", bg: "#0f2a1f" },
              { icon: Clock, label: "จบ (ส่งมอบ/ปิด) เมื่อ", value: resolveTime(selected.reviewedAt) ? formatTime(selected.reviewedAt) : "-", color: "#a78bfa", bg: "#1c1a24" },
            ].map((row, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "10px", backgroundColor: row.bg,
                marginBottom: "8px",
              }}>
                <row.icon size={16} color={row.color} />
                <div>
                  <div style={{ fontSize: "10px", color: "var(--fg-muted)", fontWeight: 600 }}>{row.label}</div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)" }}>{row.value}</div>
                </div>
              </div>
            ))}

            {selected.studentId && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "10px", backgroundColor: "#172036", marginBottom: "8px",
              }}>
                <IdCard size={16} color="#60a5fa" />
                <div>
                  <div style={{ fontSize: "10px", color: "var(--fg-muted)", fontWeight: 600 }}>รหัสนิสิต</div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)" }}>{selected.studentId}</div>
                </div>
              </div>
            )}

            {((selected.phone || selected.contact) && (selected.phone || selected.contact) !== "ไม่ระบุช่องทางติดต่อ") && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "10px", backgroundColor: "var(--bg-hover)", marginBottom: "8px",
              }}>
                <ShieldCheck size={16} color="var(--fg-accent)" />
                <div>
                  <div style={{ fontSize: "10px", color: "var(--fg-muted)", fontWeight: 600 }}>เบอร์โทร</div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-strong)" }}>{selected.phone || selected.contact}</div>
                </div>
              </div>
            )}

            {selected.status === "rejected" && selected.rejectReason && (
              <div style={{
                padding: "12px", backgroundColor: "#2a1418", borderRadius: "10px",
                fontSize: "12px", color: "#fca5a5", lineHeight: 1.6, marginBottom: "12px",
                border: "1px solid #4a1f28",
              }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#f87171", marginBottom: "4px" }}>
                  เหตุผลการปิดคำขอ
                </div>
                {selected.rejectReason}
              </div>
            )}

            <button onClick={() => setSelected(null)} style={{
              width: "100%", padding: "11px", borderRadius: "10px",
              border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
              color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 700, cursor: "pointer",
            }}>
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================
   SECTION 3: MANAGE POSTS
   ================================================ */
function AdminPosts({ posts }: { posts: PostItem[] }) {
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState<"all" | "lost" | "found" | "resolved">("all");
  const [filterBuilding, setFilterBuilding] = useState("all");
  const [selectedPost, setSelectedPost] = useState<PostItem | null>(null);
  const [postDetailZoom, setPostDetailZoom] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  const uniqueBuildings = Array.from(new Set(
    posts.map((p) => p.locationName || p.building).filter(Boolean)
  )).sort();

  const visiblePosts = posts.filter((p) => p.status !== "rejected");
  const filtered = visiblePosts.filter((p) => {
    const q = searchText.toLowerCase();
    const matchType = filterType === "all"
      || (filterType === "resolved" && p.status === "resolved")
      || (filterType === "lost" && p.itemType === "lost" && p.status !== "resolved")
      || (filterType === "found" && p.itemType === "found" && p.status !== "resolved");
    const matchSearch = !q || p.title?.toLowerCase().includes(q) || p.reporterName?.toLowerCase().includes(q);
    const postLocation = (p.locationName || p.building || "").toLowerCase();
    const matchBuilding = filterBuilding === "all" || postLocation === filterBuilding.toLowerCase();
    return matchType && matchSearch && matchBuilding;
  });

  const handleDelete = (post: PostItem) => {
    setConfirmDialog({
      title: "ยืนยันลบโพสต์",
      message: `ยืนยันลบโพสต์ "${post.title}"? การกระทำนี้ไม่สามารถย้อนกลับได้`,
      confirmText: "ลบโพสต์",
      onConfirm: async () => {
        setDeletingId(post.id ?? "");
        try {
          const postId = post.id ?? "";
          await deleteDoc(doc(db, "posts", postId));
          if (postId) {
            await closeClaimsForDeletedPost(postId, post.title);
            await closeReportsForDeletedPost(postId);
          }
          await notifyPostOwner({
            userId: post.userId,
            uid: post.uid,
            postId,
            postTitle: post.title,
            type: "post_deleted",
          });
          setSelectedPost(null); setPostDetailZoom(null);
        } catch (e) {
          console.error(e);
          showToast("เกิดข้อผิดพลาด", "error");
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const handleSuspend = (post: PostItem) => {
    setConfirmDialog({
      title: "ยืนยันระงับโพสต์",
      message: `ระงับโพสต์ "${post.title}"?`,
      confirmText: "ระงับโพสต์",
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, "posts", post.id ?? ""), { status: "suspended", suspendedAt: new Date().toISOString() });
          await notifyPostOwner({
            userId: post.userId,
            uid: post.uid,
            postId: post.id ?? "",
            postTitle: post.title,
            type: "post_suspended",
          });
          setSelectedPost(null); setPostDetailZoom(null);
        } catch (e) {
          console.error(e);
        }
      },
    });
  };

  const handleRestore = async (post: PostItem) => {
    try {
      await updateDoc(doc(db, "posts", post.id ?? ""), { status: "active" });
      setSelectedPost(null); setPostDetailZoom(null);
    } catch (e) {
      console.error(e);
    }
  };

  // ปลดอายัด (under_investigation → active)
  const handleUnhold = async (post: PostItem) => {
    try {
      await updateDoc(doc(db, "posts", post.id ?? ""), { status: "active" });
      await notifyPostOwner({
        userId: post.userId,
        uid: post.uid,
        postId: post.id ?? "",
        postTitle: post.title,
        type: "post_hold",
        status: "released",
      });
      setSelectedPost(null); setPostDetailZoom(null);
    } catch (e) {
      console.error(e);
    }
  };

  const statusLabel = (p: PostItem) => {
    if (p.status === "rejected") return { text: "ถูกปฏิเสธ", bg: "#2a1418", color: "#f87171" };
    if (p.status === "pending") return { text: "รอตรวจสอบ", bg: "#2a1a10", color: "#fbbf24" };
    if (p.status === "suspended") return { text: "ระงับ", bg: "#2a1418", color: "#f87171" };
    if (p.status === "resolved") return { text: "คืนแล้ว", bg: "#0f2a1f", color: "#34d399" };
    if (p.status === "under_investigation") return { text: "อายัด", bg: "#2a1418", color: "#f87171" };
    if (p.status === "in_progress") return { text: "ดำเนินการ", bg: "#172036", color: "#60a5fa" };
    return { text: "ใช้งาน", bg: "#0f2a1f", color: "#34d399" };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Search + Filter */}
      <div style={{
        display: "flex", alignItems: "center", backgroundColor: "var(--bg-card)",
        borderRadius: "12px", padding: "10px 14px", gap: "8px", border: "1px solid var(--border)",
      }}>
        <Search size={16} color="var(--fg-accent)" />
        <input
          type="text" placeholder="ค้นหาชื่อโพสต์หรือผู้แจ้ง..."
          value={searchText} onChange={(e) => setSearchText(e.target.value)}
          style={{ flex: 1, border: "none", outline: "none", fontSize: "13px", color: "var(--fg-strong)", background: "transparent" }}
        />
      </div>

      <div style={{ display: "flex", gap: "6px" }}>
        {(["all", "lost", "found", "resolved"] as const).map((t) => {
          const labels: Record<string, string> = { all: "ทั้งหมด", lost: "ของหาย", found: "พบของ", resolved: "คืนแล้ว" };
          return (
            <button key={t} onClick={() => setFilterType(t)} style={{
              flex: 1, padding: "7px 0", borderRadius: "10px",
              backgroundColor: filterType === t ? "#7c5cfc" : "var(--bg-card)",
              color: filterType === t ? "var(--fg)" : "var(--fg-secondary)",
              fontSize: "11px", fontWeight: 700, cursor: "pointer",
              border: filterType === t ? "none" : "1px solid var(--border)",
              boxShadow: filterType === t ? "0 2px 10px rgba(124,92,252,0.35)" : "none",
            }}>
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Building Filter */}
      <div style={{
        display: "flex", alignItems: "center", backgroundColor: "var(--bg-card)",
        borderRadius: "12px", padding: "8px 14px", gap: "8px", border: "1px solid var(--border)",
      }}>
        <MapPin size={15} color="var(--fg-accent)" />
        <select
          value={filterBuilding}
          onChange={(e) => setFilterBuilding(e.target.value)}
          style={{
            flex: 1, border: "none", outline: "none", fontSize: "12px", fontWeight: 600,
            color: "var(--fg-strong)", background: "var(--bg-subtle)", cursor: "pointer",
            borderRadius: "8px", padding: "5px 8px",
          }}
        >
          <option value="all">ทุกอาคาร / สถานที่</option>
          {uniqueBuildings.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        {filterBuilding !== "all" && (
          <button onClick={() => setFilterBuilding("all")} style={{
            padding: "2px 6px", borderRadius: "6px", border: "1px solid var(--border)",
            background: "var(--bg-hover)", color: "var(--fg-muted)", fontSize: "10px",
            fontWeight: 600, cursor: "pointer",
          }}>
            ล้าง
          </button>
        )}
      </div>

      <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600 }}>
        แสดง {filtered.length} จาก {visiblePosts.length} โพสต์
      </div>

      {/* Posts List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--fg-muted)", fontSize: "13px" }}>
          <FileText size={32} color="var(--border-strong)" style={{ marginBottom: "8px" }} />
          <div>ไม่พบโพสต์ตามเงื่อนไข</div>
        </div>
      ) : (
        filtered.map((post) => {
          const sl = statusLabel(post);
          return (
            <div key={post.id} onClick={() => setSelectedPost(post)} style={{
              backgroundColor: "var(--bg-card)", borderRadius: "14px", padding: "14px",
              border: "1px solid var(--border)", cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)", transition: "box-shadow 0.15s",
            }}>
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                {post.imageUrl ? (
                  <img src={post.imageUrl} alt="" style={{
                    width: "52px", height: "52px", borderRadius: "10px", objectFit: "cover", flexShrink: 0,
                    border: "1px solid var(--border)",
                  }} />
                ) : (
                  <div style={{
                    width: "52px", height: "52px", borderRadius: "10px", flexShrink: 0,
                    backgroundColor: "var(--bg-hover)", display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1px solid var(--border)",
                  }}>
                    <FileText size={20} color="var(--fg-accent)" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>
                    {post.title}
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                      backgroundColor: sl.bg, color: sl.color,
                    }}>
                      {sl.text}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--fg-faint)" }}>
                      {post.reporterName || "-"} · {post.locationName || "-"}
                    </span>
                    {post.itemType === "found" && post.depositLocation && (
                      <span style={{
                        fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                        backgroundColor: "#0f2a1f", color: "#34d399", border: "1px solid #1f4a35",
                        display: "inline-flex", alignItems: "center", gap: 4,
                      }}>
                        <ShieldAlert size={10} />
                        จุดฝาก: {post.depositLocation}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}

      {/* Post Detail Modal */}
      {selectedPost && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "420px", maxHeight: "80vh", overflowY: "auto",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--fg)", margin: 0 }}>รายละเอียดโพสต์</h3>
              <button onClick={() => { setSelectedPost(null); setPostDetailZoom(null); }} style={{
                background: "var(--bg-hover)", border: "none", borderRadius: "50%", width: "30px", height: "30px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-secondary)",
              }}>
                <X size={16} />
              </button>
            </div>

            {selectedPost.imageUrl && (
              <img
                src={selectedPost.imageUrl}
                alt=""
                onClick={() => setPostDetailZoom(selectedPost.imageUrl ?? null)}
                style={{
                  width: "100%", height: "180px", objectFit: "cover", borderRadius: "12px", marginBottom: "14px",
                  border: "1px solid var(--border)", cursor: "pointer",
                }}
              />
            )}

            <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--fg)", marginBottom: "4px" }}>
              {selectedPost.title}
            </div>
            <div style={{
              fontSize: "10px", color: "var(--fg-faint)", marginBottom: "12px",
              fontFamily: "'SF Mono', monospace",
            }}>
              ID: {selectedPost.id}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", margin: "0 2px 6px" }}>
              <FileText size={13} color="var(--fg-accent)" />
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-strong)" }}>รายละเอียด</span>
            </div>
            {selectedPost.desc && (
              <div style={{
                padding: "12px", backgroundColor: "var(--bg-subtle)", borderRadius: "10px",
                fontSize: "12px", color: "var(--fg-secondary)", lineHeight: 1.6, marginBottom: "12px",
                border: "1px solid var(--border)",
              }}>
                {selectedPost.desc}
              </div>
            )}

            {[
              { icon: MapPin, label: "สถานที่", value: selectedPost.locationName || "-" },
              ...(selectedPost.itemType === "found"
                ? [{ icon: ShieldAlert, label: "จุดฝาก/คืน", value: selectedPost.depositLocation || "ไม่ระบุ" }]
                : []),
              { icon: User, label: "ผู้แจ้ง", value: selectedPost.reporterName || "-" },
              { icon: Clock, label: "วันที่", value: formatDateShort(selectedPost.date) || "-" },
              { icon: Clock, label: "เวลาโพสต์", value: formatClockTime(selectedPost.createdAt) || "-" },
            ].map((r, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 0", borderBottom: "1px solid var(--border)",
              }}>
                <r.icon size={14} color={r.label === "จุดฝาก/คืน" ? "#34d399" : "var(--fg-faint)"} />
                <span style={{ fontSize: "11px", color: "var(--fg-faint)", width: "60px" }}>{r.label}</span>
                <span style={{
                  fontSize: "12px", fontWeight: 600,
                  color: r.label === "จุดฝาก/คืน" ? "#34d399" : "var(--fg-strong)",
                }}>{r.value}</span>
              </div>
            ))}

            <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "8px", width: "100%" }}>
              {selectedPost.status === "under_investigation" && (
                <button onClick={() => handleUnhold(selectedPost)} style={{
                  flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #1f4a35",
                  backgroundColor: "#0f2a1f", color: "#34d399", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                }}>
                  <ShieldCheck size={14} /> ปลดอายัด
                </button>
              )}
              {selectedPost.status !== "suspended" && (
                <button onClick={() => handleSuspend(selectedPost)} style={{
                  flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #4a3418",
                  backgroundColor: "#2a1a10", color: "#fbbf24", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                }}>
                  <Ban size={14} /> ระงับ
                </button>
              )}
              {selectedPost.status === "suspended" && (
                <button onClick={() => handleRestore(selectedPost)} style={{
                  flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #1f4a35",
                  backgroundColor: "#0f2a1f", color: "#34d399", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                }}>
                  <RefreshCw size={14} /> กู้คืน
                </button>
              )}
              <button onClick={() => handleDelete(selectedPost)} disabled={deletingId === selectedPost.id} style={{
                flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #4a1f28",
                backgroundColor: "#2a1418", color: "#f87171", fontSize: "12px", fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
              }}>
                <Trash2 size={14} /> {deletingId === selectedPost.id ? "กำลังลบ..." : "ลบโพสต์"}
              </button>
              </div>
              <button onClick={() => { setSelectedPost(null); setPostDetailZoom(null); }} style={{
                width: "100%", padding: "10px", borderRadius: "10px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                color: "var(--fg-secondary)", fontSize: "12px", fontWeight: 700, cursor: "pointer", marginTop: "4px",
              }}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox: ดูรูปโพสต์ใหญ่ */}
      {postDetailZoom && (
        <div
          onClick={() => setPostDetailZoom(null)}
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.85)",
            backdropFilter: "blur(6px)",
            zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center",
            padding: "20px", cursor: "pointer",
          }}
        >
          <img
            src={postDetailZoom}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%", maxHeight: "88vh", borderRadius: "16px",
              boxShadow: "0 25px 60px rgba(0,0,0,0.7)", border: "1px solid var(--border)",
              objectFit: "contain",
            }}
          />
        </div>
      )}

      {confirmDialog && (
        <ConfirmModal
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

/* ================================================
   SECTION 3.5: MANAGE REPORTS
   ================================================ */
function AdminReports() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<"open" | "closed">("open");
  const [selectedReport, setSelectedReport] = useState<AdminReport | null>(null);
  const [reportPost, setReportPost] = useState<PostItem | null>(null);
  const [replyText, setReplyText] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  // เมื่อแอดมินเข้าดูหน้า "รายงาน" ให้ mark แจ้งเตือนที่เกี่ยวข้องเป็น "อ่านแล้ว"
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "notifications"),
            where("recipientRole", "==", "admin"),
            limit(100)
          )
        );
        if (cancelled) return;
        const unread = snap.docs.filter((d) => {
          const data = d.data();
          return (
            (data.type === "post_report" || data.type === "support_message") &&
            data.read !== true
          );
        });
        if (!unread.length) return;
        const batch = writeBatch(db);
        unread.forEach((d) => batch.update(d.ref, { read: true }));
        await batch.commit();
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = query(collection(db, "reports"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminReport));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching reports:", error);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ดึงโพสต์ที่ถูกรายงานขึ้น preview เมื่อเปิด modal
  useEffect(() => {
    if (!selectedReport?.postId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "posts", selectedReport.postId as string));
        if (cancelled) return;
        setReportPost(
          snap.exists() ? ({ id: snap.id, ...snap.data() } as PostItem) : null
        );
      } catch (e) {
        console.error("Error loading reported post:", e);
        if (!cancelled) setReportPost(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport?.id]);

  const openCount = reports.filter((r) => r.status === "open").length;
  const resolvedCount = reports.filter((r) => r.status !== "open").length;
  const visibleReports = reports.filter((r) =>
    filterTab === "open" ? r.status === "open" : r.status !== "open"
  );
  const kind = selectedReport ? getReportKind(selectedReport) : "post_report";
  const kindMeta = REPORT_KIND_META[kind];

  const closeReportAs = async (report: AdminReport, status: string) => {
    await updateDoc(doc(db, "reports", report.id), { status });
    await notifyReportResult(report, status);
  };

  const readPostOwner = async (postId: string, fallbackTitle?: string) => {
    let ownerId = "";
    let postTitle = fallbackTitle || "";
    try {
      const psnap = await getDoc(doc(db, "posts", postId));
      if (psnap.exists()) {
        const pd = psnap.data();
        ownerId = pd?.userId || pd?.uid || "";
        postTitle = pd?.title || postTitle;
      }
    } catch (e) {
      console.error("Error reading post:", e);
    }
    return { ownerId, postTitle };
  };

  const handleDismiss = (report: AdminReport) => {
    setConfirmDialog({
      title: "ยืนยันปิดรายงาน",
      message: "ยืนยันปิดรายงานนี้ (ไม่พบปัญหา)? ผู้รายงานจะได้รับแจ้งเตือนผลการจัดการ",
      confirmText: "ปิดรายงาน",
      onConfirm: async () => {
        try {
          await closeReportAs(report, "dismissed");
          setSelectedReport(null);
        } catch (e) {
          console.error(e);
          showToast("เกิดข้อผิดพลาด", "error");
        }
      },
    });
  };

  const handleReply = async () => {
    const reporterId = selectedReport?.reporterId || selectedReport?.userId || "";
    const text = replyText.trim();
    if (!reporterId || !text || !selectedReport) return;
    try {
      await addDoc(collection(db, "notifications"), {
        type: "admin_reply",
        recipientUid: reporterId,
        reportId: selectedReport.id,
        postId: selectedReport.postId || "",
        postTitle: selectedReport.postTitle || "",
        category: selectedReport.category || "",
        text,
        read: false,
        createdAt: serverTimestamp(),
      });
      // ตอบแล้ว = ปิดรายงาน (closed) — เห็นได้ในหน้า Profile ของผู้รายงาน
      await updateDoc(doc(db, "reports", selectedReport.id), { status: "closed" });
      if (selectedReport.postId) {
        try {
          const others = await getDocs(
            query(
              collection(db, "reports"),
              where("postId", "==", selectedReport.postId),
              where("status", "==", "open")
            )
          );
          const batch = writeBatch(db);
          others.docs
            .filter((d) => d.id !== selectedReport.id)
            .forEach((d) => batch.update(d.ref, { status: "closed" }));
          await batch.commit();
        } catch (e) {
          console.error("Error closing sibling reports:", e);
        }
      }
      setReplyText("");
      setSelectedReport(null);
      showToast("ส่งตอบกลับแล้วและปิดรายงาน", "success");
    } catch (e) {
      console.error(e);
      showToast("ส่งตอบกลับไม่สำเร็จ", "error");
    }
  };

  const handleDeletePost = (report: AdminReport) => {
    const postId = report.postId;
    if (!postId) return;
    setConfirmDialog({
      title: "ยืนยันลบโพสต์",
      message: `ยืนยันลบโพสต์ "${report.postTitle}"? รายงานอื่นของโพสต์เดียวกันจะถูกปิดทั้งหมด และเจ้าของโพสต์ + ผู้รายงานจะได้รับแจ้งเตือน`,
      confirmText: "ลบโพสต์",
      onConfirm: async () => {
        try {
          const { ownerId, postTitle } = await readPostOwner(postId, report.postTitle);
          await deleteDoc(doc(db, "posts", postId));
          await closeClaimsForDeletedPost(postId, postTitle);
          await closeReportsForDeletedPost(postId);
          if (ownerId) {
            await notifyPostOwner({
              userId: ownerId,
              postId,
              postTitle,
              type: "post_deleted",
            });
          }
          await notifyReportResult(report, "post_deleted");
          setSelectedReport(null);
        } catch (e) {
          console.error(e);
          showToast("เกิดข้อผิดพลาด", "error");
        }
      },
    });
  };

  const handleSuspendPost = (report: AdminReport) => {
    const postId = report.postId;
    if (!postId) return;
    setConfirmDialog({
      title: "ยืนยันระงับโพสต์",
      message: `ยืนยันระงับโพสต์ "${report.postTitle}"? โพสต์จะหายจากหน้าเว็บ และเจ้าของโพสต์จะได้รับแจ้งเตือน`,
      confirmText: "ระงับโพสต์",
      variant: "danger",
      onConfirm: async () => {
        try {
          const { ownerId, postTitle } = await readPostOwner(postId, report.postTitle);
          await updateDoc(doc(db, "posts", postId), {
            status: "suspended",
            suspendedAt: new Date().toISOString(),
          });
          if (ownerId) {
            await notifyPostOwner({
              userId: ownerId,
              postId,
              postTitle,
              type: "post_suspended",
            });
          }
          await closeReportAs(report, "post_suspended");
          setSelectedReport(null);
        } catch (e) {
          console.error(e);
          showToast("เกิดข้อผิดพลาด", "error");
        }
      },
    });
  };

  // อายัดชั่วคราว / ปลดอายัด (สำหรับรายงานแจ้งสวมสิทธิ์)
  const handleHoldPost = (report: AdminReport, hold: boolean) => {
    const postId = report.postId;
    if (!postId) return;
    setConfirmDialog({
      title: hold ? "ยืนยันอายัดชั่วคราว" : "ยืนยันปลดอายัด",
      message: hold
        ? `ยืนยันอายัดโพสต์ "${report.postTitle}" ชั่วคราว? ผู้ใช้จะเห็นแบนเนอร์แจ้งเตือนและถูกปิดการยื่นคำขอจนกว่าจะสอบเสร็จ`
        : `ยืนยันปลดอายัดโพสต์ "${report.postTitle}"? โพสต์จะกลับสู่สถานะใช้งานตามปกติ`,
      confirmText: hold ? "อายัดชั่วคราว" : "ปลดอายัด",
      variant: hold ? "danger" : "primary",
      onConfirm: async () => {
        try {
          const { ownerId, postTitle } = await readPostOwner(postId, report.postTitle);
          await updateDoc(doc(db, "posts", postId), {
            status: hold ? "under_investigation" : "active",
          });
          if (ownerId) {
            await notifyPostOwner({
              userId: ownerId,
              postId,
              postTitle,
              type: "post_hold",
              status: hold ? "held" : "released",
            });
          }
          await closeReportAs(report, hold ? "post_held" : "dismissed");
          setSelectedReport(null);
        } catch (e) {
          console.error(e);
          showToast("เกิดข้อผิดพลาด", "error");
        }
      },
    });
  };

  const handleBanReporter = (report: AdminReport) => {
    const reporterId = report.reporterId || report.userId || "";
    if (!reporterId) return;
    setConfirmDialog({
      title: "ยืนยันแบนผู้ใช้",
      message: `ยืนยันแบนผู้ใช้ "${report.reporterName}"? โพสต์ทั้งหมดของผู้ใช้รายนี้จะถูกระงับ และรายงานอื่นที่เขายื่นจะถูกปิด`,
      confirmText: "แบนผู้ใช้",
      onConfirm: async () => {
        try {
          await banUserAccount(reporterId);
          await notifyReportResult(report, "reporter_banned");
          setSelectedReport(null);
        } catch (e) {
          console.error(e);
          showToast("เกิดข้อผิดพลาด (อาจยังไม่มีเอกสาร user)", "error");
        }
      },
    });
  };

  const statusBadge = (status?: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      open: { label: "เปิด", color: "#fbbf24", bg: "#2a2010" },
      dismissed: { label: "ปิดแล้ว", color: "#6b7280", bg: "#1f1f2f" },
      post_deleted: { label: "ลบโพสต์แล้ว", color: "#f87171", bg: "#2a1418" },
      reporter_banned: { label: "แบนผู้รายงาน", color: "#ef4444", bg: "#2a1010" },
      post_suspended: { label: "ระงับโพสต์แล้ว", color: "#f87171", bg: "#2a1418" },
      post_held: { label: "อายัดชั่วคราว", color: "#fbbf24", bg: "#2a2010" },
    };
    const s = map[status || "open"] || map.open;
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
        borderRadius: 6, fontSize: 10.5, fontWeight: 700, color: s.color, backgroundColor: s.bg,
      }}>
        {s.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)" }}>
        <Loader2 size={32} color="#f87171" style={{ marginBottom: "12px", animation: "spin 1s linear infinite" }} />
        <div style={{ fontSize: "13px", fontWeight: 600 }}>กำลังโหลดรายงาน...</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Stats */}
      <div style={{ display: "flex", gap: "10px" }}>
        <div style={{
          flex: 1, padding: "12px 14px", borderRadius: "12px",
          backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600 }}>ทั้งหมด</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--fg)", marginTop: 2 }}>{reports.length}</div>
        </div>
        <div style={{
          flex: 1, padding: "12px 14px", borderRadius: "12px",
          backgroundColor: "#2a2010", border: "1px solid #4a3a18",
        }}>
          <div style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 600 }}>เปิดอยู่</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#fbbf24", marginTop: 2 }}>{openCount}</div>
        </div>
        <div style={{
          flex: 1, padding: "12px 14px", borderRadius: "12px",
          backgroundColor: "#0f2a1f", border: "1px solid #1f4a35",
        }}>
          <div style={{ fontSize: "11px", color: "#34d399", fontWeight: 600 }}>จัดการแล้ว</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#34d399", marginTop: 2 }}>{resolvedCount}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "6px" }}>
        {(["open", "closed"] as const).map((t) => (
          <button key={t} onClick={() => setFilterTab(t)} style={{
            flex: 1, padding: "10px", borderRadius: "10px",
            border: "1px solid var(--border)",
            backgroundColor: filterTab === t ? "#7c5cfc" : "var(--bg-card)",
            color: filterTab === t ? "var(--fg)" : "var(--fg-muted)",
            fontSize: "12.5px", fontWeight: 700, cursor: "pointer",
          }}>
            {t === "open" ? `เปิดอยู่ (${openCount})` : `จัดการแล้ว (${resolvedCount})`}
          </button>
        ))}
      </div>

      {/* Report List */}
      {visibleReports.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)",
          backgroundColor: "var(--bg-card)", borderRadius: "14px", border: "1px solid var(--border)",
        }}>
          <Flag size={32} color="var(--border-strong)" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: "13px", fontWeight: 600 }}>
            {filterTab === "open" ? "ไม่มีรายงานที่ยังเปิดอยู่" : "ยังไม่มีรายงานที่จัดการแล้ว"}
          </div>
        </div>
      ) : (
        visibleReports.map((report) => {
          const k = getReportKind(report);
          const km = REPORT_KIND_META[k];
          const isOpen = report.status === "open";
          return (
          <button
            key={report.id}
            onClick={() => {
              setReportPost(null);
              setSelectedReport(report);
            }}
            style={{
              display: "flex", alignItems: "flex-start", gap: "12px",
              width: "100%", padding: "14px", borderRadius: "12px",
              backgroundColor: "var(--bg-card)", border: "1px solid var(--border)",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{
              width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
              backgroundColor: isOpen ? km.bg : "#1f1f2f",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Flag size={16} color={isOpen ? km.color : "#6b7280"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: "13px", fontWeight: 700, color: "var(--fg)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {k === "support_message"
                  ? report.category || "ข้อความถึงแอดมิน"
                  : report.postTitle || "โพสต์ไม่ระบุชื่อ"}
              </div>
              <div style={{
                fontSize: "11.5px", color: "var(--fg-muted)", marginTop: 2,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                โดย {report.reporterName || "ไม่ระบุ"} ·{" "}
                {k === "support_message"
                  ? report.detail || "ไม่มีรายละเอียด"
                  : report.category || "ไม่ระบุหมวด"}
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
                  borderRadius: 6, fontSize: 10.5, fontWeight: 700,
                  color: km.color, backgroundColor: km.bg,
                }}>
                  {km.label}
                </span>
                {statusBadge(report.status)}
              </div>
            </div>
            <div style={{
              fontSize: "10px", color: "var(--fg-faint)", flexShrink: 0, marginTop: 2,
            }}>
              {formatDateShort(report.createdAt)}
            </div>
          </button>
          );
        })
      )}

      {/* Report Detail Modal */}
      {selectedReport && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.6)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 5000, padding: "20px",
        }} onClick={() => setSelectedReport(null)}>
          <div style={{
            width: "100%", maxWidth: "420px", backgroundColor: "var(--bg-card)",
            borderRadius: "16px", border: "1px solid var(--border)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)", padding: 0, overflow: "hidden",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              padding: "16px", borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: "10px",
            }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                backgroundColor: "#2a1418", display: "flex",
                alignItems: "center", justifyContent: "center",
              }}>
                <Flag size={16} color="#f87171" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--fg)" }}>
                  รายละเอียดรายงาน
                </div>
                <div style={{ fontSize: "11px", color: "var(--fg-muted)" }}>
                  {formatDateShort(selectedReport.createdAt)}
                </div>
              </div>
              {statusBadge(selectedReport.status)}
              <button onClick={() => setSelectedReport(null)} style={{
                width: "30px", height: "30px", borderRadius: "8px", flexShrink: 0,
                border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--fg-muted)",
              }}>
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
                  borderRadius: 6, fontSize: 10.5, fontWeight: 700,
                  color: kindMeta.color, backgroundColor: kindMeta.bg,
                }}>
                  {kindMeta.label}
                </span>
              </div>
              {selectedReport.postId ? (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: 4 }}>โพสต์ที่ถูกรายงาน</div>
                  {reportPost ? (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "10px", padding: "10px",
                      borderRadius: "10px", backgroundColor: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                    }}>
                      {reportPost.imageUrl && (
                        <img src={reportPost.imageUrl} alt="" style={{
                          width: "44px", height: "44px", borderRadius: "8px",
                          objectFit: "cover", flexShrink: 0,
                        }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: "12.5px", fontWeight: 700, color: "var(--fg)",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{reportPost.title}</div>
                        <div style={{ fontSize: "11px", color: "var(--fg-secondary)", marginTop: 2 }}>
                          {reportPost.itemType === "lost" ? "ของหาย" : "พบของ"} · {reportPost.locationName || "ไม่ระบุสถานที่"}
                        </div>
                        <div style={{ fontSize: "10.5px", color: "var(--fg-faint)", marginTop: 2 }}>ID: {reportPost.id}</div>
                      </div>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
                        borderRadius: 6, fontSize: 10.5, fontWeight: 700, flexShrink: 0,
                        color: reportPost.status === "under_investigation" ? "#fbbf24"
                          : reportPost.status === "resolved" ? "#34d399"
                          : reportPost.status === "suspended" ? "#f87171"
                          : reportPost.status === "in_progress" ? "#60a5fa" : "#34d399",
                        backgroundColor: reportPost.status === "under_investigation" ? "#2a2010"
                          : reportPost.status === "resolved" ? "#0f2a1f"
                          : reportPost.status === "suspended" ? "#2a1418"
                          : reportPost.status === "in_progress" ? "#172036" : "#0f2a1f",
                      }}>
                        {reportPost.status === "under_investigation" ? "อายัด"
                          : reportPost.status === "resolved" ? "คืนแล้ว"
                          : reportPost.status === "suspended" ? "ระงับ"
                          : reportPost.status === "in_progress" ? "ดำเนินการ" : "ใช้งาน"}
                      </span>
                    </div>
                  ) : (
                    <div style={{
                      fontSize: "12px", color: "var(--fg-muted)", padding: "10px",
                      borderRadius: "10px", backgroundColor: "var(--bg-hover)",
                      border: "1px dashed var(--border)",
                    }}>
                      โพสต์นี้ถูกลบไปแล้ว หรือไม่พบในระบบ
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: 2 }}>หัวข้อ</div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>{selectedReport.category || "-"}</div>
                </div>
              )}
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: 2 }}>ผู้รายงาน</div>
                  <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--fg)" }}>{selectedReport.reporterName || "-"}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: 2 }}>หมวดหมู่</div>
                  <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#f87171" }}>{selectedReport.category || "-"}</div>
                </div>
              </div>
<div>
                  <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: 2 }}>รายละเอียด</div>
                  <div style={{
                    fontSize: "12.5px", color: "var(--fg-secondary)", lineHeight: 1.5,
                    padding: "10px", borderRadius: "10px", backgroundColor: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                  }}>
                    {selectedReport.detail || "ไม่มีรายละเอียด"}
                  </div>
                </div>

                {(selectedReport.reporterId || selectedReport.userId) && (
                  <div style={{
                    display: "flex", flexDirection: "column", gap: "6px",
                    padding: "10px", borderRadius: "10px",
                    backgroundColor: "#0f2a1f", border: "1px solid #1f4a35",
                  }}>
                    <div style={{ fontSize: "11px", color: "#34d399", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                      <Reply size={12} /> ตอบกลับผู้ใช้
                    </div>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={2}
                      placeholder="พิมพ์ข้อความตอบกลับ (เช่น แจ้งผลการตรวจสอบ สอบถามข้อมูลเพิ่มเติม)..."
                      style={{
                        width: "100%", borderRadius: "8px", padding: "8px 10px",
                        border: "1px solid var(--border)", background: "var(--bg-card)",
                        color: "var(--fg)", fontSize: "12px", resize: "vertical", outline: "none", fontFamily: "inherit",
                      }}
                    />
                    <button
                      onClick={handleReply}
                      disabled={!replyText.trim()}
                      style={{
                        padding: "8px", borderRadius: "8px",
                        border: "none", background: "#1aa05f", color: "#ffffff",
                        fontSize: "12px", fontWeight: 700, cursor: replyText.trim() ? "pointer" : "not-allowed",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                        opacity: replyText.trim() ? 1 : 0.5,
                      }}
                    >
                      <Send size={13} /> ส่งคำตอบกลับไปยังผู้ใช้
                    </button>
                  </div>
                )}

              {selectedReport.status === "open" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                  <button onClick={() => handleDismiss(selectedReport)} style={{
                    width: "100%", padding: "10px", borderRadius: "10px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                    color: "var(--fg-secondary)", fontSize: "12px", fontWeight: 700,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                  }}>
                    <CheckCircle2 size={14} /> ปิดรายงาน (ไม่พบปัญหา)
                  </button>
                  {selectedReport.postId && (
                    <div style={{ display: "flex", gap: "8px" }}>
                      {kind === "post_report" && (
                        <button onClick={() => handleSuspendPost(selectedReport)} style={{
                          flex: 1, padding: "10px", borderRadius: "10px",
                          border: "1px solid #4a3418", backgroundColor: "#2a1a10",
                          color: "#fbbf24", fontSize: "12px", fontWeight: 700,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                        }}>
                          <Ban size={14} /> ระงับชั่วคราว
                        </button>
                      )}
                      {kind === "claim_dispute" && reportPost?.status !== "under_investigation" && (
                        <button onClick={() => handleHoldPost(selectedReport, true)} style={{
                          flex: 1, padding: "10px", borderRadius: "10px",
                          border: "1px solid #4a3418", backgroundColor: "#2a1a10",
                          color: "#fbbf24", fontSize: "12px", fontWeight: 700,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                        }}>
                          <ShieldAlert size={14} /> อายัดชั่วคราว
                        </button>
                      )}
                      {kind === "claim_dispute" && reportPost?.status === "under_investigation" && (
                        <button onClick={() => handleHoldPost(selectedReport, false)} style={{
                          flex: 1, padding: "10px", borderRadius: "10px",
                          border: "1px solid #1f4a35", backgroundColor: "#0f2a1f",
                          color: "#34d399", fontSize: "12px", fontWeight: 700,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                        }}>
                          <ShieldCheck size={14} /> ปลดอายัด
                        </button>
                      )}
                      <button onClick={() => handleDeletePost(selectedReport)} style={{
                        flex: 1, padding: "10px", borderRadius: "10px",
                        border: "1px solid #4a1f28", backgroundColor: "#2a1418",
                        color: "#f87171", fontSize: "12px", fontWeight: 700,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                      }}>
                        <Trash2 size={14} /> ลบโพสต์
                      </button>
                    </div>
                  )}
                  <button onClick={() => handleBanReporter(selectedReport)} style={{
                    width: "100%", padding: "10px", borderRadius: "10px",
                    border: "1px solid #4a1f28", backgroundColor: "#2a1010",
                    color: "#ef4444", fontSize: "12px", fontWeight: 700,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                  }}>
                    <Ban size={14} /> แบนผู้ใช้
                  </button>
                </div>
              )}

              <button onClick={() => setSelectedReport(null)} style={{
                width: "100%", padding: "10px", borderRadius: "10px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                color: "var(--fg-secondary)", fontSize: "12px", fontWeight: 700, cursor: "pointer", marginTop: "4px",
              }}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmModal
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

/* ================================================
   SECTION 4: MANAGE USERS
   ================================================ */
function AdminUsers({ users }: { users: AdminUser[] }) {
  const [searchText, setSearchText] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);
  const [userPosts, setUserPosts] = useState<PostItem[]>([]);
  const [userClaims, setUserClaims] = useState<AdminClaim[]>([]);

  // ล้างข้อมูลเก่าทันทีเมื่อเปลี่ยนคน (ปรับ state ระหว่าง render ตามแนวทาง React)
  const [displayUid, setDisplayUid] = useState<string | null>(null);
  if (displayUid !== (selectedUser?.id ?? null)) {
    setDisplayUid(selectedUser?.id ?? null);
    setUserPosts([]);
    setUserClaims([]);
  }

  // ดึงโพสต์ + คำขอรับของของผู้ใช้ เมื่อเปิด modal เพื่อดูบริบทก่อนแบน/สืบ
  useEffect(() => {
    if (!selectedUser) return;
    let cancelled = false;
    (async () => {
      try {
        const [ps, cs] = await Promise.all([
          getDocs(
            query(
              collection(db, "posts"),
              where("userId", "==", selectedUser.id),
              limit(50)
            )
          ),
          getDocs(
            query(
              collection(db, "claims"),
              where("claimantId", "==", selectedUser.id),
              limit(50)
            )
          ),
        ]);
        if (cancelled) return;
        setUserPosts(ps.docs.map((d) => ({ id: d.id, ...d.data() }) as PostItem));
        setUserClaims(cs.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminClaim));
      } catch (e) {
        console.error("Error loading user activity:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedUser]);

  const filtered = users.filter((u) => {
    const q = searchText.toLowerCase();
    return !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
  });

  const handleBan = (user: AdminUser) => {
    setConfirmDialog({
      title: "ยืนยันแบนผู้ใช้",
      message: `ยืนยันแบนผู้ใช้ "${user.name || user.email}"? โพสต์ทั้งหมดของผู้ใช้รายนี้จะถูกระงับด้วย`,
      confirmText: "แบนผู้ใช้",
      onConfirm: async () => {
        try {
          await banUserAccount(user.id);
          setSelectedUser(null);
        } catch (e) {
          console.error(e);
          showToast("ไม่สามารถแบนผู้ใช้ได้ (อาจยังไม่มีเอกสารใน collection users)", "error");
        }
      },
    });
  };

  const handleUnban = async (user: AdminUser) => {
    try {
      await updateDoc(doc(db, "users", user.id), { banned: false });
      setSelectedUser(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{
        display: "flex", alignItems: "center", backgroundColor: "var(--bg-card)",
        borderRadius: "12px", padding: "10px 14px", gap: "8px", border: "1px solid var(--border)",
      }}>
        <Search size={16} color="var(--fg-accent)" />
        <input
          type="text" placeholder="ค้นหาชื่อหรืออีเมลผู้ใช้..."
          value={searchText} onChange={(e) => setSearchText(e.target.value)}
          style={{ flex: 1, border: "none", outline: "none", fontSize: "13px", color: "var(--fg-strong)", background: "transparent" }}
        />
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 12px", backgroundColor: "#172036", border: "1px solid #2a3a5c",
        borderRadius: "10px", fontSize: "12px", color: "#93b4f5",
      }}>
        <Users size={14} />
        ทั้งหมด <strong>{users.length}</strong> คน · ถูกแบน <strong>{users.filter((u) => u.banned).length}</strong> คน
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--fg-muted)", fontSize: "13px" }}>
          <Users size={32} color="var(--border-strong)" style={{ marginBottom: "8px" }} />
          <div>ไม่พบผู้ใช้</div>
          <div style={{ fontSize: "11px", marginTop: "4px", color: "var(--fg-faint)" }}>
            หมายเหตุ: ต้องมีเอกสารใน collection "users" ของ Firestore ก่อน
          </div>
        </div>
      ) : (
        filtered.map((user) => (
          <div key={user.id} onClick={() => setSelectedUser(user)} style={{
            backgroundColor: "var(--bg-card)", borderRadius: "14px", padding: "14px 16px",
            border: user.banned ? "1.5px solid #5c2534" : "1px solid var(--border)",
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "42px", height: "42px", borderRadius: "50%", flexShrink: 0,
                background: user.banned
                  ? "linear-gradient(135deg, #dc2626, #ef4444)"
                  : "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--fg)", fontSize: "16px", fontWeight: 800,
              }}>
                {(user.name || user.email || "?").charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>
                  {user.name || "ไม่ระบุชื่อ"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--fg-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.email || "ไม่ระบุอีเมล"}
                </div>
              </div>
              {user.banned && (
                <span style={{
                  fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
                  backgroundColor: "#2a1418", color: "#f87171",
                }}>
                  ถูกแบน
                </span>
              )}
            </div>
          </div>
        ))
      )}

      {/* User Detail Modal */}
      {selectedUser && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
          overflowY: "auto",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "380px", maxHeight: "calc(100vh - 40px)", overflowY: "auto",
            margin: "auto",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--fg)", margin: 0 }}>รายละเอียดผู้ใช้</h3>
              <button onClick={() => setSelectedUser(null)} style={{
                background: "var(--bg-hover)", border: "none", borderRadius: "50%", width: "30px", height: "30px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--fg-secondary)",
              }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <div style={{
                width: "64px", height: "64px", borderRadius: "50%", margin: "0 auto 10px",
                background: selectedUser.banned
                  ? "linear-gradient(135deg, #dc2626, #ef4444)"
                  : "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--fg)", fontSize: "24px", fontWeight: 800,
                border: "3px solid var(--border-strong)", boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
              }}>
                {(selectedUser.name || selectedUser.email || "?").charAt(0).toUpperCase()}
              </div>
              <div style={{ fontSize: "17px", fontWeight: 800, color: "var(--fg)" }}>
                {selectedUser.name || "ไม่ระบุชื่อ"}
              </div>
              <div style={{ fontSize: "12px", color: "var(--fg-muted)" }}>{selectedUser.email || "-"}</div>
              {selectedUser.banned && (
                <span style={{
                  display: "inline-block", marginTop: "8px", fontSize: "11px", fontWeight: 700,
                  padding: "4px 12px", borderRadius: "8px", backgroundColor: "#2a1418", color: "#f87171",
                }}>
                  บัญชีถูกระงับ
                </span>
              )}
            </div>

            {[
              { label: "User ID", value: selectedUser.id },
              { label: "เบอร์โทร", value: selectedUser.phone || "-" },
              { label: "เข้าร่วมเมื่อ", value: selectedUser.createdAt || "-" },
              { label: "สถานะ", value: selectedUser.banned ? "ถูกแบน" : "ปกติ" },
            ].map((r, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", padding: "8px 0",
                borderBottom: "1px solid var(--border)", fontSize: "12px",
              }}>
                <span style={{ color: "var(--fg-faint)" }}>{r.label}</span>
                <span style={{ fontWeight: 700, color: "var(--fg-strong)" }}>{r.value}</span>
              </div>
            ))}

            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg)", marginBottom: "6px" }}>
                  โพสต์ของผู้ใช้ <span style={{ color: "var(--fg-accent)" }}>({userPosts.length})</span>
                </div>
                {userPosts.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "var(--fg-faint)", padding: "8px 0" }}>ยังไม่มีโพสต์</div>
                ) : (
                  <div style={{
                    maxHeight: "140px", overflowY: "auto", borderRadius: "10px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
                  }}>
                    {userPosts.slice(0, 10).map((p) => (
                      <div key={p.id} style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        padding: "8px 10px", borderBottom: "1px solid var(--border)",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.title}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--fg-faint)" }}>
                            {p.itemType === "lost" ? "ของหาย" : "พบของ"} · {p.id}
                          </div>
                        </div>
                        <span style={{
                          fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                          color: p.status === "resolved" ? "#34d399"
                            : p.status === "suspended" ? "#f87171"
                            : p.status === "under_investigation" ? "#fbbf24"
                            : p.status === "in_progress" ? "#60a5fa" : "#34d399",
                          backgroundColor: p.status === "resolved" ? "#0f2a1f"
                            : p.status === "suspended" ? "#2a1418"
                            : p.status === "under_investigation" ? "#2a2010"
                            : p.status === "in_progress" ? "#172036" : "#0f2a1f",
                        }}>
                          {p.status === "resolved" ? "คืนแล้ว"
                            : p.status === "suspended" ? "ถูกระงับ"
                            : p.status === "under_investigation" ? "อายัด"
                            : p.status === "in_progress" ? "ดำเนินการ" : "ใช้งาน"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg)", marginBottom: "6px" }}>
                  คำขอรับของ <span style={{ color: "#fbbf24" }}>({userClaims.length})</span>
                </div>
                {userClaims.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "var(--fg-faint)", padding: "8px 0" }}>ยังไม่เคยยื่นคำขอ</div>
                ) : (
                  <div style={{
                    maxHeight: "140px", overflowY: "auto", borderRadius: "10px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
                  }}>
                    {userClaims.slice(0, 10).map((c) => {
                      const b = getStatusBadge(c);
                      return (
                        <div key={c.id} style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "8px 10px", borderBottom: "1px solid var(--border)",
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.postTitle || "โพสต์ไม่ระบุชื่อ"}
                            </div>
                            <div style={{ fontSize: "10px", color: "var(--fg-faint)" }}>
                              {formatDateShort(c.createdAt) || "-"} · {c.id}
                            </div>
                          </div>
                          <span style={{ fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", color: b.color, backgroundColor: b.bg }}>
                            {b.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              {selectedUser.banned ? (
                <button onClick={() => handleUnban(selectedUser)} style={{
                  flex: 1, padding: "11px", borderRadius: "10px", border: "1px solid #1f4a35",
                  backgroundColor: "#0f2a1f", color: "#34d399", fontSize: "13px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}>
                  <ShieldCheck size={15} /> ปลดแบน
                </button>
              ) : (
                <button onClick={() => handleBan(selectedUser)} style={{
                  flex: 1, padding: "11px", borderRadius: "10px", border: "1px solid #4a1f28",
                  backgroundColor: "#2a1418", color: "#f87171", fontSize: "13px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}>
                  <Ban size={15} /> แบนผู้ใช้
                </button>
              )}
              <button onClick={() => setSelectedUser(null)} style={{
                padding: "11px 20px", borderRadius: "10px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg-card)",
                color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 700, cursor: "pointer",
              }}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmModal
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

/* ================================================
   SECTION 8: MANAGE ADMINS & RETURN POINTS (หัวหน้าแอดมิน)
   - จัดการจุดคืน (returnPoints): เพิ่ม/เปลี่ยนชื่อ
   - จัดการเจ้าหน้าที่ประจำจุด (adminAccounts/{email}): มอบอีเมลให้กับจุด
   - หนึ่งคน = หนึ่งจุด; เปลี่ยนอีเมลที่จุด = ถอดสิทธิ์คนเก่าอัตโนมัติ + แจ้งเตือน
   - อีเมลหัวหน้าแอดมิน (whitelist) ใช้เป็นเจ้าหน้าที่ไม่ได้
   ================================================ */

// อีเมลหัวหน้าแอดมิน (ห้ามนำมาลงเป็นเจ้าหน้าที่ประจำจุด)
import { isHeadAdminEmail } from "../lib/admins";

interface ReturnPoint {
  id: string;
  name?: string;
  active?: boolean;
  createdAt?: FirestoreTimeLike;
}

interface AdminAccount {
  email: string;
  uid?: string;
  pointId?: string;
  pointName?: string;
  addedBy?: string;
  createdAt?: FirestoreTimeLike;
}

function AdminManageAdmins({ isSuper }: { isSuper: boolean }) {
  const [points, setPoints] = useState<ReturnPoint[]>([]);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [newPointName, setNewPointName] = useState("");
  const [assignEmail, setAssignEmail] = useState("");
  const [assignPoint, setAssignPoint] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  // โหลดจุดคืน (เฉพาะหัวหน้าแอดมิน — staff โดน rules ปัด adminAccounts/users อ่าน)
  useEffect(() => {
    if (!isSuper) return;
    const q = query(collection(db, "returnPoints"), orderBy("createdAt", "asc"));
    const un = onSnapshot(
      q,
      (snap) => setPoints(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReturnPoint)),
      (error) => console.error("Error fetching return points:", error)
    );
    return () => un();
  }, [isSuper]);

  // โหลดรายชื่อเจ้าหน้าที่ (adminAccounts)
  useEffect(() => {
    if (!isSuper) return;
    const q = query(collection(db, "adminAccounts"));
    const un = onSnapshot(
      q,
      (snap) =>
        setAdmins(
          snap.docs.map((d) => ({ email: d.id, ...d.data() }) as AdminAccount)
        ),
      (error) => console.error("Error fetching admin accounts:", error)
    );
    return () => un();
  }, [isSuper]);

  if (!isSuper) {
    return (
      <div style={{ textAlign: "center", padding: "50px", color: "var(--fg-muted)", fontSize: "13px" }}>
        <ShieldAlert size={32} color="var(--border-strong)" style={{ marginBottom: "10px" }} />
        <div>เฉพาะหัวหน้าแอดมินเท่านั้นที่จัดการแอดมินและจุดคืนได้</div>
      </div>
    );
  }

  const addPoint = async () => {
    const name = newPointName.trim();
    if (!name || busy) return;
    if (points.some((p) => p.name?.toLowerCase() === name.toLowerCase())) {
      showToast("มีจุดคืนชื่อนี้อยู่แล้ว", "error");
      return;
    }
    setBusy(true);
    try {
      await addDoc(collection(db, "returnPoints"), {
        name,
        active: true,
        createdAt: serverTimestamp(),
      });
      setNewPointName("");
      showToast("เพิ่มจุดคืนเรียบร้อย", "success");
    } catch (e) {
      console.error(e);
      showToast("เพิ่มจุดคืนไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
    }
  };

  // สร้างจุดคืนเริ่มต้น 6 จุด (กันกดซ้ำ + ข้ามชื่อที่มีอยู่แล้ว)
  const seedDefaultPoints = async () => {
    if (seeding || busy || points.length > 0) return;
    setSeeding(true);
    try {
      const existingNames = new Set(
        points.map((p) => p.name?.toLowerCase().trim() || "")
      );
      let created = 0;
      for (const name of DEFAULT_RETURN_POINTS) {
        if (existingNames.has(name.toLowerCase().trim())) continue;
        await addDoc(collection(db, "returnPoints"), {
          name,
          active: true,
          createdAt: serverTimestamp(),
        });
        created++;
      }
      showToast(`สร้างจุดคืนเริ่มต้นแล้ว ${created} จุด`, "success");
    } catch (e) {
      console.error(e);
      showToast("สร้างจุดคืนไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setSeeding(false);
    }
  };

  const startRename = (p: ReturnPoint) => {
    setRenamingId(p.id);
    setRenameText(p.name || "");
  };

  const saveRename = async () => {
    const newName = renameText.trim();
    if (!renamingId || !newName || busy) return;
    const old = points.find((p) => p.id === renamingId);
    if (!old) return;
    if (old.name === newName) {
      setRenamingId(null);
      return;
    }
    if (points.some((p) => p.id !== renamingId && p.name?.toLowerCase() === newName.toLowerCase())) {
      showToast("มีจุดคืนชื่อนี้อยู่แล้ว", "error");
      return;
    }
    setBusy(true);
    try {
      await updateDoc(doc(db, "returnPoints", renamingId), { name: newName });
      // ปรับชื่อในโพสต์ + claims + adminAccounts ของจุดนี้ให้ตรงกัน (rules อ้างอิง pointName เท่ากัน)
      const postSnap = await getDocs(
        query(collection(db, "posts"), where("depositLocation", "==", old.name))
      );
      if (!postSnap.empty) {
        const batch = writeBatch(db);
        postSnap.forEach((d) => batch.update(d.ref, { depositLocation: newName }));
        await batch.commit();
      }
      const claimSnap = await getDocs(
        query(collection(db, "claims"), where("depositLocation", "==", old.name))
      );
      if (!claimSnap.empty) {
        const batch = writeBatch(db);
        claimSnap.forEach((d) => batch.update(d.ref, { depositLocation: newName }));
        await batch.commit();
      }
      // ปรับ pointName ใน notifications ของจุดนี้ให้ตรงกัน (staff อ่านค่าแจ้งเตือนจาก pointName)
      // — กรอง recipientRole=='admin' ตามที่ rules อนุญาตเท่านั้น (super อ่าน notification ที่มี recipientRole==admin ได้)
      const notifSnap = await getDocs(
        query(
          collection(db, "notifications"),
          where("recipientRole", "==", "admin"),
          where("pointName", "==", old.name)
        )
      );
      if (!notifSnap.empty) {
        const batch = writeBatch(db);
        notifSnap.forEach((d) => batch.update(d.ref, { pointName: newName }));
        await batch.commit();
      }
      const accSnap = await getDocs(
        query(collection(db, "adminAccounts"), where("pointName", "==", old.name))
      );
      if (!accSnap.empty) {
        const batch = writeBatch(db);
        accSnap.forEach((d) => batch.update(d.ref, { pointName: newName }));
        await batch.commit();
      }
      setRenamingId(null);
      showToast("เปลี่ยนชื่อจุดคืนเรียบร้อย", "success");
    } catch (e) {
      console.error(e);
      showToast("เปลี่ยนชื่อไม่สำเร็จ", "error");
    } finally {
      setBusy(false);
    }
  };

  const assignAdmin = async () => {
    const email = assignEmail.trim().toLowerCase();
    const pointId = assignPoint;
    if (busy) return;
    if (!email || !pointId) {
      showToast("กรอกอีเมลและเลือกจุดคืนให้ครบ", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast("รูปแบบอีเมลไม่ถูกต้อง", "error");
      return;
    }
    if (isHeadAdminEmail(email)) {
      showToast("อีเมลนี้เป็นหัวหน้าแอดมิน ไม่สามารถตั้งเป็นเจ้าหน้าที่ได้", "error");
      return;
    }
    const point = points.find((p) => p.id === pointId);
    if (!point) return;

    // เช็กอีเมลซ้ำ: อีเมลนี้ถูกใช้อยู่ที่จุดไหนอยู่แล้ว?
    const existing = admins.find((a) => a.email === email);
    if (existing && existing.pointId !== pointId) {
      showToast(
        `อีเมลนี้ถูกใช้เป็นเจ้าหน้าที่จุด "${existing.pointName || "?"}" อยู่แล้ว`,
        "error"
      );
      return;
    }
    // คนปัจจุบันที่อยู่ที่จุดนี้ (จะถูกแทนที่)
    const currentAtPoint = admins.find((a) => a.pointId === pointId);

    const doAssign = async () => {
      setBusy(true);
      try {
        const ref = doc(db, "adminAccounts", email);
        await setDoc(
          ref,
          {
            uid: existing?.uid || "",
            pointId,
            pointName: point.name || "",
            addedBy: auth?.currentUser?.uid || "",
            createdAt: existing?.createdAt || serverTimestamp(),
          },
          { merge: true }
        );
        // ถอนสิทธิ์เจ้าหน้าที่คนเดิมที่ถูกแทนที่ (ลบ adminAccounts + reset role + แจ้งเตือน)
        // ตั้ง role 'admin' ให้ผู้ที่ได้รับสิทธิ์ใหม่ทันที (ถ้ามี users doc อยู่แล้ว)
        // — กันสถานะกึ่งสิทธิ์ที่ต้องรอ re-login
        try {
          const userSnap = await getDocs(
            query(collection(db, "users"), where("email", "==", email), limit(1))
          );
          if (!userSnap.empty) {
            const tgtUid = userSnap.docs[0].id;
            await updateDoc(doc(db, "users", tgtUid), { role: "admin" }).catch(() => {});
            if (existing?.uid !== tgtUid) {
              await updateDoc(ref, { uid: tgtUid }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("Cannot promote user role on assign:", e);
        }
        if (currentAtPoint && currentAtPoint.email !== email) {
          await deleteDoc(doc(db, "adminAccounts", currentAtPoint.email));
          if (currentAtPoint.uid) {
            await setDoc(
              doc(db, "users", currentAtPoint.uid),
              { role: "user" },
              { merge: true }
            ).catch(() => {});
            addDoc(collection(db, "notifications"), {
              type: "admin_revoked",
              recipientUid: currentAtPoint.uid,
              pointName: point.name || "",
              read: false,
              createdAt: serverTimestamp(),
            }).catch(() => {});
          }
          showToast(`มอบสิทธิ์เจ้าหน้าที่จุด "${point.name}" ให้ ${email} เรียบร้อย พร้อมถอดสิทธิ์คนเดิม`, "success");
        } else {
          showToast(`มอบสิทธิ์เจ้าหน้าที่จุด "${point.name}" ให้ ${email} เรียบร้อย`, "success");
        }
        setAssignEmail("");
        setAssignPoint("");
      } catch (e) {
        console.error(e);
        showToast("มอบสิทธิ์ไม่สำเร็จ กรุณาลองใหม่", "error");
      } finally {
        setBusy(false);
      }
    };

    if (currentAtPoint && currentAtPoint.email !== email) {
      setConfirmDialog({
        title: "แทนที่เจ้าหน้าที่จุดนี้?",
        message: `จุด "${point.name}" มี ${currentAtPoint.email} เป็นเจ้าหน้าที่อยู่แล้ว การเปลี่ยนแปลงนี้จะถอดสิทธิ์คนเดิมและมอบให้ ${email} ต่อ`,
        confirmText: "แทนที่",
        variant: "primary",
        onConfirm: doAssign,
      });
    } else {
      doAssign();
    }
  };

  const removeAdmin = (acc: AdminAccount) => {
    setConfirmDialog({
      title: "ถอดสิทธิ์เจ้าหน้าที่?",
      message: `ถอดสิทธิ์ ${acc.email} ออกจากจุด "${acc.pointName || ""}"? เจ้าหน้าที่คนนี้จะไม่สามารถเข้าสู่ระบบโหมดแอดมินได้อีกต่อไป`,
      confirmText: "ถอดสิทธิ์",
      variant: "danger",
      onConfirm: async () => {
        setBusy(true);
        try {
          await deleteDoc(doc(db, "adminAccounts", acc.email));
          if (acc.uid) {
            await setDoc(
              doc(db, "users", acc.uid),
              { role: "user" },
              { merge: true }
            ).catch(() => {});
            addDoc(collection(db, "notifications"), {
              type: "admin_revoked",
              recipientUid: acc.uid,
              pointName: acc.pointName || "",
              read: false,
              createdAt: serverTimestamp(),
            }).catch(() => {});
          }
          showToast("ถอดสิทธิ์เจ้าหน้าที่เรียบร้อย", "success");
        } catch (e) {
          console.error(e);
          showToast("ถอดสิทธิ์ไม่สำเร็จ", "error");
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const deactivatePoint = (p: ReturnPoint) => {
    setConfirmDialog({
      title: p.active ? "ปิดใช้งานจุดคืน" : "เปิดใช้งานจุดคืน",
      message: p.active
        ? `ปิดจุดคืน "${p.name}"? จุดนี้จะไม่แสดงในแบบฟอร์มแจ้งของพบอีกต่อไป`
        : `เปิดจุดคืน "${p.name}" อีกครั้ง?`,
      confirmText: p.active ? "ปิดใช้งาน" : "เปิดใช้งาน",
      variant: p.active ? "danger" : "primary",
      onConfirm: async () => {
        setBusy(true);
        try {
          await updateDoc(doc(db, "returnPoints", p.id), { active: !p.active });
          showToast("อัปเดตจุดคืนเรียบร้อย", "success");
        } catch (e) {
          console.error(e);
          showToast("อัปเดตไม่สำเร็จ", "error");
        } finally {
          setBusy(false);
        }
      },
    });
  };

  // ลบจุดคืน: ลบจุด + ถอดสิทธิ์เจ้าหน้าที่ประจำจุดนั้นด้วย (reset role + แจ้งเตือน) โพสต์เก่ายังคงอยู่
  const deletePoint = (p: ReturnPoint) => {
    const staffAtPoint = admins.filter((a) => a.pointId === p.id);
    // นับโพสต์ของพบที่ยังรอตรวจรับ ณ จุดนี้ (หลังลบจะไม่มีเจ้าหน้าที่รับผิดชอบ)
    let pendingCount = 0;
    getDocs(
      query(
        collection(db, "posts"),
        where("depositLocation", "==", p.name)
      )
    )
      .then((snap) => {
        pendingCount = snap.docs.filter(
          (d) => d.data().itemType === "found" && d.data().status === "pending"
        ).length;
        setConfirmDialog({
          title: "ลบจุดคืนนี้?",
          message: `ลบจุดคืน "${p.name}" ทันที?${
            staffAtPoint.length > 0
              ? ` จุดนี้มีเจ้าหน้าที่ ${staffAtPoint.length} คน จะถูกถอดสิทธิ์พร้อมกันด้วย`
              : ""
          }${
            pendingCount > 0
              ? ` ⚠️ มีโพสต์ของพบที่ยังรอตรวจรับ ${pendingCount} รายการ หลังลบจะไม่มีเจ้าหน้าที่จัดการ`
              : ""
          } โพสต์ที่เคยเลือกจุดนี้จะยังคงแสดงอยู่แต่ไม่สามารถจัดการโดยเจ้าหน้าที่จุดนี้ได้อีกต่อไป`,
          confirmText: "ลบจุดคืน",
          variant: "danger",
          onConfirm: async () => {
            setBusy(true);
            try {
              // 1. ถอดสิทธิ์เจ้าหน้าที่ทุกคนที่ประจำจุดนี้ (ลบ adminAccounts + reset role + แจ้งเตือน)
              for (const acc of staffAtPoint) {
                await deleteDoc(doc(db, "adminAccounts", acc.email));
                if (acc.uid) {
                  await setDoc(
                    doc(db, "users", acc.uid),
                    { role: "user" },
                    { merge: true }
                  ).catch(() => {});
                  addDoc(collection(db, "notifications"), {
                    type: "admin_revoked",
                    recipientUid: acc.uid,
                    pointName: p.name || "",
                    read: false,
                    createdAt: serverTimestamp(),
                  }).catch(() => {});
                }
              }
              // 2. ลบจุดคืน
              await deleteDoc(doc(db, "returnPoints", p.id));
          showToast("ลบจุดคืนเรียบร้อย", "success");
        } catch (e) {
          console.error(e);
          showToast("ลบจุดคืนไม่สำเร็จ", "error");
        } finally {
          setBusy(false);
        }
      },
    });
  });
  };

  const activePoints = points.filter((p) => p.active !== false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* คำอธิบาย */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", backgroundColor: "#1c1a24", border: "1px solid #3a3350", borderRadius: "12px" }}>
        <ShieldCheck size={16} color="#7c5cfc" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: "12px", color: "#c4b5fd", lineHeight: 1.5 }}>
          จัดการจุดคืนและเจ้าหน้าที่ประจำจุด · หนึ่งจุด = เจ้าหน้าที่ 1 คน · เปลี่ยนอีเมลที่จุด = ถอดสิทธิ์คนเดิมอัตโนมัติพร้อมแจ้งเตือน
        </div>
      </div>

      {/* 1) จุดคืน */}
      <div style={{ backgroundColor: "var(--bg-card)", borderRadius: "14px", border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid var(--border)" }}>
          <MapPin size={16} color="var(--fg-accent)" />
          <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--fg)" }}>
            จุดคืนของ ({activePoints.length})
          </span>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {points.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {renamingId === p.id ? (
                <>
                  <input
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    placeholder="ชื่อจุดคืน"
                    style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg-strong)", fontSize: "13px" }}
                  />
                  <button onClick={saveRename} disabled={busy} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg,#7c5cfc,#6a4eff)", color: "#fff", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                    บันทึก
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: "13px", color: "var(--fg)", fontWeight: 600, opacity: p.active === false ? 0.5 : 1 }}>
                    {p.name}{" "}
                    {p.active === false && (
                      <span style={{ fontSize: "10px", color: "#f87171", fontWeight: 700, marginLeft: 6 }}>(ปิดอยู่)</span>
                    )}
                  </span>
                  <button onClick={() => startRename(p)} disabled={busy} title="เปลี่ยนชื่อ" style={{ padding: "5px 9px", borderRadius: "7px", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--fg-secondary)", cursor: "pointer" }}>
                    <RefreshCw size={13} />
                  </button>
                  <button onClick={() => deactivatePoint(p)} disabled={busy} title={p.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"} style={{ padding: "5px 9px", borderRadius: "7px", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--fg-secondary)", cursor: "pointer" }}>
                    {p.active === false ? <CheckCircle2 size={13} /> : <X size={13} />}
                  </button>
                  <button onClick={() => deletePoint(p)} disabled={busy} title="ลบจุดคืน" style={{ padding: "5px 9px", borderRadius: "7px", border: "1px solid #4a1f28", background: "#2a1418", color: "#f87171", cursor: "pointer" }}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
          {points.length === 0 && (
            <div style={{ padding: "12px", borderRadius: "10px", backgroundColor: "var(--bg-subtle)", border: "1px dashed var(--border-strong)", textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "var(--fg-secondary)", marginBottom: "8px", lineHeight: 1.5 }}>
                ยังไม่มีจุดคืนในระบบ — สร้างจุดเริ่มต้น 6 จุด (ป้อมยาม / กองกิจการนิสิต) ตามที่ฝั่งผู้ใช้เคยเห็น หรือกดเพิ่มเองด้านล่าง
              </div>
              <button onClick={seedDefaultPoints} disabled={seeding || busy} style={{ padding: "9px 16px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg,#7c5cfc,#6a4eff)", color: "#fff", fontSize: "12px", fontWeight: 700, cursor: seeding ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                {seeding ? (
                  <>
                    <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> กำลังสร้าง...
                  </>
                ) : (
                  <>
                    <Plus size={13} /> สร้างจุดคืนเริ่มต้น 6 จุด
                  </>
                )}
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
            <input
              value={newPointName}
              onChange={(e) => setNewPointName(e.target.value)}
              placeholder="ชื่อจุดคืนใหม่ (เช่น ป้อมยามประตู 5)"
              style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg-strong)", fontSize: "13px" }}
            />
            <button onClick={addPoint} disabled={busy} style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg,#7c5cfc,#6a4eff)", color: "#fff", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
              <Plus size={13} /> เพิ่มจุดคืน
            </button>
          </div>
        </div>
      </div>

      {/* 2) มอบสิทธิ์เจ้าหน้าที่ */}
      <div style={{ backgroundColor: "var(--bg-card)", borderRadius: "14px", border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid var(--border)" }}>
          <Mail size={16} color="var(--fg-accent)" />
          <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--fg)" }}>
            มอบสิทธิ์เจ้าหน้าที่ประจำจุด
          </span>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <input
              value={assignEmail}
              onChange={(e) => setAssignEmail(e.target.value)}
              placeholder="อีเมลเจ้าหน้าที่ (Google Account)"
              style={{ flex: "1 1 200px", padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg-strong)", fontSize: "13px" }}
            />
            <select
              value={assignPoint}
              onChange={(e) => setAssignPoint(e.target.value)}
              style={{ flex: "1 1 160px", padding: "9px 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg-strong)", fontSize: "13px" }}
            >
              <option value="">เลือกจุดคืน</option>
              {activePoints.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button onClick={assignAdmin} disabled={busy} style={{ padding: "9px 16px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg,#7c5cfc,#6a4eff)", color: "#fff", fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}>
              มอบสิทธิ์
            </button>
          </div>

          {/* รายชื่อเจ้าหน้าที่ปัจจุบัน */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
            {admins.length === 0 ? (
              <div style={{ fontSize: "12px", color: "var(--fg-faint)", textAlign: "center", padding: "12px" }}>
                ยังไม่มีเจ้าหน้าที่ประจำจุด
              </div>
            ) : (
              admins.map((a) => (
                <div key={a.email} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "10px", border: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg)" }}>{a.email}</div>
                    <div style={{ fontSize: "11px", color: "var(--fg-accent)", fontWeight: 600 }}>
                      จุด: {a.pointName || "ไม่ระบุ"}{a.uid ? " · (ล็อกอินแล้ว)" : ""}
                    </div>
                  </div>
                  <button onClick={() => removeAdmin(a)} disabled={busy} title="ถอดสิทธิ์" style={{ padding: "6px 10px", borderRadius: "7px", border: "1px solid #4a1f28", background: "#2a1418", color: "#f87171", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {confirmDialog && (
        <ConfirmModal
          open
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          variant={confirmDialog.variant}
          onConfirm={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}