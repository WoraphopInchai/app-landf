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
  Phone,
  Link2,
  Camera,
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
import { getPostImages, getPostCover } from "../lib/postImages";
import { uploadToCloudinary } from "../lib/uploadImage";
import ConfirmModal from "../components/ConfirmModal";
import ReviewSheet, {
  InfoGrid,
  InfoRow,
  ImageLightbox,
  ReviewImage,
  SheetButton,
} from "./ReviewSheet";
import HandoverCaptureSheet from "./HandoverCaptureSheet";

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
  // โพสต์ของหายของผู้ขอ ที่ระบุว่าตรงกับโพสต์ของที่พบ (ผู้ใช้เลือกตอนกดขอรับของ)
  matchedPostId?: string | null;
  matchedPostTitle?: string | null;
  status?: string;
  createdAt?: FirestoreTimeLike;
  reviewedAt?: string;
  reviewedByUid?: string;
  expiresAt?: string;
  pickupDate?: string;
  rejectReason?: string;
}

/* หลักฐานการส่งมอบ — เก็บเป็น subcollection คนละเอกสารกับ claim
   (claims/{claimId}/handover/evidence) เพื่อให้กฎ Firestore คุมได้ว่า
   "เฉพาะแอดมินอ่านได้" ผู้ขอจะอ่านรูปนี้ไม่ได้ */
interface HandoverEvidence {
  photoUrl: string;
  depositLocation?: string;
  capturedByUid?: string;
  capturedAt?: string;
}

/* โหลดหลักฐานการส่งมอบของคำขอ — คืน null ถ้าไม่มี (เช่น คำขอที่ยัง pending หรือปฏิเสธ) */
async function loadHandoverEvidence(claimId: string | null | undefined): Promise<HandoverEvidence | null> {
  if (!claimId) return null;
  try {
    const snap = await getDoc(doc(db, "claims", claimId, "handover", "evidence"));
    return snap.exists() ? (snap.data() as HandoverEvidence) : null;
  } catch (e) {
    // ไม่มีสิทธิ์อ่าน (เช่น staff ต่างจุด) → ถือว่าไม่มีหลักฐาน ไม่ทำให้หน้าจอพัง
    console.error("Error loading handover evidence:", e);
    return null;
  }
}

/* โหลดโพสต์แบบปลอดภัย — คืน null ถ้าอ่านไม่ได้ (เช่น staff ต่างจุด) เพื่อไม่ให้หน้าจอพัง */
async function loadPostDoc(id: string | null | undefined): Promise<PostItem | null> {
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, "posts", id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as PostItem) : null;
  } catch (e) {
    console.error("Error loading post:", e);
    return null;
  }
}

/* ปิดโพสต์ของหายที่ผู้ขอเลือกตอนขอรับของ (หลังคำขอนั้นอนุมัติแล้ว)
   ใช้ร่วมกันทั้งตอนอนุมัติใหม่ (confirmHandover) และปุ่มซ่อมเคสที่อนุมัติไปแล้วในหน้าประวัติ
   — กฎ canCloseMatchedLostPost จะตรวจว่าคำขอ approved + matchedPostId ตรง + เป็นเจ้าของโพสต์นั้น */
async function closeMatchedLostPostDoc(postId: string, claimId: string): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    // "returned_matched" = โพสต์ของหายที่ถูกจับคู่กับคำขอที่อนุมัติแล้ว
    // ตั้งใจให้ต่างจาก "resolved" เพราะ Home ดึง status in [active, in_progress, resolved, under_investigation]
    // ถ้าใช้ resolved โพสต์หายจะยังโผล่ในฟีด (แท็บ "คืนแล้ว") จนกว่าจะ deploy หน้าเว็บ
    status: "returned_matched",
    resolvedAt: new Date().toISOString(),
    matchedClaimId: claimId,
  });
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

/* =========================================================
   ทางลัด "ดู/จัดการผู้ใช้" จากทุกแท็บ
   - คลิกชื่อ/อีเมลที่ใดก็ได้ → เปิดการ์ดผู้ใช้ชุดเดียวกัน ไม่ต้องไปกดที่แท็บ "จัดการผู้ใช้"
   - อ่านข้อมูลผู้ใช้จาก users/{uid} โดยตรง (กฎอนุญาตให้แอดมินทุกระดับอ่านได้)
   ========================================================= */

const ROLE_LABEL: Record<string, string> = {
  super_admin: "หัวหน้าแอดมิน",
  admin: "เจ้าหน้าที่ประจำจุด",
  user: "ผู้ใช้ทั่วไป",
};

interface AdminUserProfile extends AdminUser {
  adminPoint?: string | null;
}

/** ชื่อ/อีเมลที่กดได้ — เปิดการ์ดผู้ใช้ทันที */
function UserLink({
  value,
  fallback,
  onClick,
  icon,
}: {
  value?: string | null;
  fallback?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}) {
  const text = (value || "").trim() || fallback || "ไม่ระบุ";
  const clickable = !!onClick;
  return (
    <span
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "คลิกเพื่อดู/จัดการผู้ใช้" : undefined}
      onClick={clickable ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClick?.();
              }
            }
          : undefined
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        cursor: clickable ? "pointer" : "default",
        color: clickable ? "var(--fg-accent)" : "inherit",
        fontWeight: clickable ? 700 : "inherit",
        textDecoration: clickable ? "underline" : "none",
        textUnderlineOffset: "2px",
        wordBreak: "break-word",
      }}
    >
      {icon}
      {text}
    </span>
  );
}

/* แคชข้อมูลผู้ใช้ไว้ในหน่วยความจำ เพื่อไม่ให้ยิง Firestore ซ้ำทุกครั้งที่เปิดรายการ */
const userInfoCache = new Map<string, { name?: string | null; email?: string | null; banned?: boolean }>();

function useUserInfo(uid?: string | null) {
  const [fetchedUid, setFetchedUid] = useState<string | null>(null);
  const [info, setInfo] = useState<{ name?: string | null; email?: string | null; banned?: boolean } | null>(null);

  // เปลี่ยนคนที่กำลังดู → ล้างค่าค้างเดิมทันที (ปรับ state ระหว่าง render ตามแนวทาง React)
  if (fetchedUid !== (uid ?? null)) {
    setFetchedUid(uid ?? null);
    setInfo(uid ? userInfoCache.get(uid) ?? null : null);
  }

  useEffect(() => {
    if (!uid) return;
    if (userInfoCache.has(uid)) return;
    let cancelled = false;
    getDoc(doc(db, "users", uid))
      .then((snap) => {
        const data = (snap.exists() ? snap.data() : {}) as AppUser & { banned?: boolean };
        const entry = { name: data.name ?? data.displayName, email: data.email, banned: data.banned === true };
        userInfoCache.set(uid, entry);
        if (!cancelled) setInfo(entry);
      })
      .catch((e) => {
        console.error("Error loading user info:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return info;
}

/** ชื่อ + อีเมลของผู้ใช้ที่กดได้ทั้งสองช่อง (เปิดทางลัดจัดการผู้ใช้) */
function UserIdentity({
  uid,
  name,
  email,
  onOpen,
  size = "md",
}: {
  uid?: string | null;
  name?: string | null;
  email?: string | null;
  onOpen?: (uid: string) => void;
  size?: "sm" | "md";
}) {
  const info = useUserInfo(uid);
  const open = uid && onOpen ? () => onOpen(uid) : undefined;
  const displayName = (name || info?.name || "").trim() || "ไม่ระบุชื่อ";
  const displayEmail = (email || info?.email || "").trim() || "ไม่ระบุอีเมล";
  const isBanned = info?.banned === true;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
        <UserLink value={displayName} onClick={open} icon={<User size={size === "sm" ? 12 : 14} style={{ flexShrink: 0 }} />} />
        {isBanned && (
          <span
            style={{
              fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "6px",
              color: "var(--sc-danger-fg)", backgroundColor: "var(--sc-danger-bg)",
            }}
          >
            ถูกแบน
          </span>
        )}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
        <UserLink value={displayEmail} onClick={open} icon={<Mail size={size === "sm" ? 12 : 14} style={{ flexShrink: 0 }} />} />
      </span>
    </div>
  );
}

/** ป้ายสถานะโพสต์แบบอ่านง่าย (ใช้ร่วมกันทุกการ์ดในฝั่งแอดมิน) */
const POST_STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  resolved: { label: "คืนแล้ว", fg: "var(--sc-ok-fg)", bg: "var(--sc-ok-bg)" },
  returned_matched: { label: "คืนแล้ว (จับคู่กับโพสต์ของพบ)", fg: "var(--sc-ok-fg)", bg: "var(--sc-ok-bg)" },
  suspended: { label: "ถูกระงับ", fg: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" },
  under_investigation: { label: "อยู่ระหว่างอายัด", fg: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)" },
  in_progress: { label: "ดำเนินการ", fg: "var(--sc-info-fg)", bg: "var(--sc-info-bg)" },
  expired: { label: "หมดอายุ", fg: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" },
  pending: { label: "รอตรวจสอบ", fg: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)" },
  rejected: { label: "ไม่ผ่าน", fg: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" },
  active: { label: "ใช้งาน", fg: "var(--sc-ok-fg)", bg: "var(--sc-ok-bg)" },
};

function postStatusMeta(status?: string) {
  return POST_STATUS_META[status || "active"] || { label: status || "ไม่ระบุ", fg: "var(--fg-secondary)", bg: "var(--bg-hover)" };
}

/** ชุดข้อมูลโพสต์แบบครบถ้วน (ใช้ร่วมกันในทุกแท็บที่เปิดดูรายละเอียดโพสต์) */
function PostFactsGrid({ post }: { post: PostItem }) {
  const st = postStatusMeta(post.status);
  return (
    <InfoGrid>
      <InfoRow icon={Activity} label="สถานะโพสต์" value={st.label} color={st.fg} bg={st.bg} />
      <InfoRow
        icon={ShieldAlert}
        label="จุดฝาก/คืนของ"
        value={post.depositLocation || "ไม่ระบุ"}
        color={post.depositLocation ? "var(--sc-ok-fg)" : undefined}
        bg={post.depositLocation ? "var(--sc-ok-bg)" : undefined}
      />
      <InfoRow
        icon={MapPin}
        label="สถานที่"
        value={post.locationName || post.location || post.building || "ไม่ระบุ"}
      />
      {(post.category || post.faculty) && (
        <InfoRow
          icon={GraduationCap}
          label="ประเภท / คณะ"
          value={[post.category, post.faculty].filter(Boolean).join(" · ")}
        />
      )}
      {post.refCode && <InfoRow icon={IdCard} label="รหัสอ้างอิง" value={post.refCode} />}
      {post.securityZone && (
        <InfoRow icon={ShieldCheck} label="พื้นที่ความปลอดภัย" value={post.securityZone} />
      )}
      <InfoRow
        icon={Clock}
        label="วันที่พบ / เวลา"
        value={[formatDateShort(post.date), formatClockTime(post.createdAt)]
          .filter(Boolean).join(" ") || "-"}
      />
      <InfoRow icon={Clock} label="ส่งโพสต์เมื่อ" value={formatTime(post.createdAt) || "-"} />
      {post.inProgressAt && (
        <InfoRow icon={Activity} label="เริ่มดำเนินการ" value={formatTime(post.inProgressAt) || "-"} />
      )}
      {post.resolvedAt && (
        <InfoRow icon={CheckCircle2} label="ปิดเคสเมื่อ" value={formatTime(post.resolvedAt) || "-"} />
      )}
      {post.reservationClaimId && (
        <InfoRow
          icon={PackageCheck}
          label="คำขอที่กำลังจอง"
          value={post.reservationClaimId}
          color="var(--sc-warn-fg)"
          bg="var(--sc-warn-bg)"
        />
      )}
      <InfoRow
        icon={IdCard}
        label="Post ID"
        value={post.id || "-"}
      />
      <InfoRow
        icon={User}
        label="ผู้แจ้ง (จากโพสต์)"
        value={post.reporterName || post.reporter || "ไม่ระบุ"}
      />
      {post.reporterPhone && (
        <InfoRow icon={Phone} label="เบอร์โทรผู้แจ้ง (จากโพสต์)" value={post.reporterPhone} />
      )}
    </InfoGrid>
  );
}

/** การ์ดโพสต์แบบคู่ (ใช้ในประวัติ: โพสต์พบ + โพสต์หายที่ผู้ขอเลือก) */
function PairedPostCard({
  post,
  label,
  onOpen,
}: {
  post: PostItem;
  label: string;
  onOpen: () => void;
}) {
  const cover = getPostCover(post) || "";
  const st = postStatusMeta(post.status);
  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden",
      backgroundColor: "var(--bg-card)", display: "flex", flexDirection: "column",
    }}>
      {cover ? (
        <img
          src={cover}
          alt=""
          style={{ width: "100%", height: "150px", objectFit: "cover", display: "block", borderBottom: "1px solid var(--border)" }}
        />
      ) : (
        <div style={{
          height: "72px", backgroundColor: "var(--bg-hover)", display: "flex",
          alignItems: "center", justifyContent: "center", borderBottom: "1px solid var(--border)",
        }}>
          <PackageSearch size={20} color="var(--fg-faint)" />
        </div>
      )}
      <div style={{ padding: "12px 13px", display: "flex", flexDirection: "column", gap: "7px", flex: 1 }}>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{
            fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
            backgroundColor: "var(--sc-brand-bg)", color: "var(--sc-brand-fg)", border: "1px solid var(--sc-brand-border)",
          }}>
            {label}
          </span>
          <span style={{
            fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
            backgroundColor: post.itemType === "lost" ? "var(--sc-warn-bg)" : "var(--sc-ok-bg)",
            color: post.itemType === "lost" ? "var(--sc-warn-fg)" : "var(--sc-ok-fg)",
          }}>
            {post.itemType === "lost" ? "โพสต์ของหาย" : "โพสต์ของพบ"}
          </span>
          <span style={{
            fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
            backgroundColor: st.bg, color: st.fg,
          }}>
            {st.label}
          </span>
        </div>
        <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--fg)", wordBreak: "break-word" }}>
          {post.title}
        </div>
        <div style={{ fontSize: "11.5px", color: "var(--fg-muted)", lineHeight: 1.5 }}>
          {post.locationName || post.location || post.building || "ไม่ระบุสถานที่"}
        </div>
        {post.depositLocation && (
          <div style={{ fontSize: "11.5px", color: "var(--sc-ok-fg)" }}>
            จุดฝาก: {post.depositLocation}
          </div>
        )}
        <button
          onClick={onOpen}
          style={{
            marginTop: "auto", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--border)",
            backgroundColor: "var(--bg-hover)", color: "var(--fg-strong)", fontSize: "12px", fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
          }}
        >
          <Eye size={14} /> ดูรายละเอียดโพสต์
        </button>
      </div>
    </div>
  );
}

/** การ์ดผู้ใช้แบบลอย (ทางลัด) — ใช้ร่วมกันทุกแท็บ */
function AdminUserSheet({
  userId,
  onClose,
  zIndex = 300,
  canManage,
  onManageUsers,
}: {
  userId: string | null;
  onClose: () => void;
  zIndex?: number;
  /** true = หัวหน้าแอดมิน (แบน/ปลดแบน + เปิดหน้าจัดการผู้ใช้ได้) */
  canManage?: boolean;
  onManageUsers?: (uid: string) => void;
}) {
  const [profile, setProfile] = useState<AdminUserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmBan, setConfirmBan] = useState(false);

  // สลับคน → ล้างข้อมูลเก่าทันที (ปรับ state ระหว่าง render ตามแนวทาง React)
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  if (loadedUid !== (userId ?? null)) {
    setLoadedUid(userId ?? null);
    setLoading(!!userId);
    setLoadError("");
    setProfile(null);
    setPosts([]);
    setClaims([]);
    setConfirmBan(false);
  }

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", userId));
        if (cancelled) return;
        setProfile(snap.exists() ? ({ id: snap.id, ...snap.data() } as AdminUserProfile) : null);
        if (!snap.exists()) setLoadError("ไม่พบข้อมูลผู้ใช้ในระบบ (อาจเป็นผู้ใช้ที่ยังไม่ได้เข้าระบบ)");
      } catch (e) {
        console.error("Error loading user profile:", e);
        if (!cancelled) setLoadError("โหลดข้อมูลผู้ใช้ไม่สำเร็จ (ไม่มีสิทธิ์อ่าน)");
      } finally {
        if (!cancelled) setLoading(false);
      }
      // กิจกรรมของผู้ใช้ (โพสต์/คำขอ) — อ่านไม่ได้บางกรณีก็ไม่ทำให้หน้าจอพัง
      const safe = async <T,>(fn: () => Promise<T>, apply: (v: T) => void) => {
        try {
          const v = await fn();
          if (!cancelled) apply(v);
        } catch (e) {
          console.error("Error loading user activity:", e);
        }
      };
      await safe(
        async () =>
          getDocs(
            query(collection(db, "posts"), where("userId", "==", userId), limit(20))
          ).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as PostItem)),
        setPosts
      );
      await safe(
        async () =>
          getDocs(
            query(collection(db, "claims"), where("claimantId", "==", userId), limit(20))
          ).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminClaim)),
        setClaims
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const runBan = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      if (profile.banned) {
        await updateDoc(doc(db, "users", profile.id), { banned: false });
        setProfile({ ...profile, banned: false });
        showToast("ปลดแบนผู้ใช้แล้ว", "success");
      } else {
        await banUserAccount(profile.id);
        setProfile({ ...profile, banned: true });
        showToast("แบนผู้ใช้แล้ว (โพสต์ทั้งหมดถูกระงับ)", "success");
      }
      setConfirmBan(false);
    } catch (e) {
      console.error(e);
      showToast("ทำรายการไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setBusy(false);
    }
  };

  const name = profile?.name || "ไม่ระบุชื่อ";
  const email = profile?.email || "-";

  return (
    <>
      <ReviewSheet
        open={!!userId}
        onClose={onClose}
        title="ข้อมูลผู้ใช้"
        subtitle={name}
        zIndex={zIndex}
        maxWidth={720}
        busy={busy}
        badge={
          profile
            ? profile.banned
              ? { label: "บัญชีถูกระงับ", bg: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)" }
              : { label: "ปกติ", bg: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)" }
            : undefined
        }
        footer={
          <>
            {canManage && profile && (
              <>
                {profile.banned ? (
                  <SheetButton tone="ok" icon={ShieldCheck} disabled={busy} onClick={runBan}>
                    ปลดแบน
                  </SheetButton>
                ) : (
                  <SheetButton tone="danger" icon={Ban} disabled={busy} onClick={() => setConfirmBan(true)}>
                    แบนผู้ใช้
                  </SheetButton>
                )}
                {onManageUsers && (
                  <SheetButton
                    icon={Users}
                    onClick={() => {
                      onClose();
                      onManageUsers(profile.id);
                    }}
                  >
                    จัดการผู้ใช้
                  </SheetButton>
                )}
              </>
            )}
            <SheetButton onClick={onClose}>ปิด</SheetButton>
          </>
        }
      >
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "24px", color: "var(--fg-muted)", fontSize: "13px" }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> กำลังโหลดข้อมูลผู้ใช้...
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <div
                style={{
                  width: "64px", height: "64px", borderRadius: "50%", flexShrink: 0,
                  background: profile?.banned
                    ? "linear-gradient(135deg, #dc2626, #ef4444)"
                    : "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--fg)", fontSize: "24px", fontWeight: 800,
                  border: "3px solid var(--border-strong)", boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
                }}
              >
                {(profile?.name || profile?.email || "?").charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--fg)", wordBreak: "break-word" }}>
                  {name}
                </div>
                <div style={{ fontSize: "13.5px", color: "var(--fg-muted)", wordBreak: "break-all" }}>
                  {email}
                </div>
              </div>
            </div>

            {loadError && (
              <div
                style={{
                  padding: "10px 12px", backgroundColor: "var(--sc-danger-bg)",
                  border: "1px solid var(--sc-danger-border)", borderRadius: "10px",
                  fontSize: "12.5px", color: "var(--sc-danger-fg)",
                }}
              >
                {loadError}
              </div>
            )}

            {profile && (
              <InfoGrid>
                <InfoRow icon={Mail} label="อีเมล" value={email} />
                <InfoRow icon={User} label="ชื่อที่แสดง" value={name} />
                <InfoRow
                  icon={ShieldCheck}
                  label="สิทธิ์"
                  value={ROLE_LABEL[profile.role || "user"] || profile.role || "ผู้ใช้ทั่วไป"}
                />
                {profile.adminPoint && (
                  <InfoRow icon={MapPin} label="จุดประจำ" value={profile.adminPoint} />
                )}
                <InfoRow
                  icon={Phone}
                  label="เบอร์โทร"
                  value={profile.phoneNumber || profile.phone || "-"}
                />
                <InfoRow
                  icon={IdCard}
                  label="User ID"
                  value={userId || "-"}
                />
                <InfoRow icon={Clock} label="เข้าร่วมเมื่อ" value={formatTime(profile.createdAt) || formatDateShort(profile.createdAt) || "-"} />
                <InfoRow
                  icon={profile.banned ? Ban : ShieldCheck}
                  label="สถานะ"
                  value={profile.banned ? `ถูกแบน${profile.bannedAt ? ` · ${formatDateShort(profile.bannedAt)}` : ""}` : "ปกติ"}
                  color={profile.banned ? "var(--sc-danger-fg)" : "var(--sc-ok-fg)"}
                  bg={profile.banned ? "var(--sc-danger-bg)" : "var(--sc-ok-bg)"}
                />
              </InfoGrid>
            )}

            {!canManage && (
              <div
                style={{
                  padding: "10px 12px", backgroundColor: "var(--sc-info-bg)",
                  border: "1px solid var(--sc-info-border)", borderRadius: "10px",
                  fontSize: "12.5px", color: "var(--sc-info-fg)",
                }}
              >
                การแบน/ปลดแบนและการเปลี่ยนสิทธิ์ ทำได้โดยหัวหน้าแอดมินเท่านั้น
              </div>
            )}

            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "8px" }}>
                โพสต์ของผู้ใช้ <span style={{ color: "var(--fg-accent)" }}>({posts.length})</span>
              </div>
              {posts.length === 0 ? (
                <div style={{ fontSize: "13px", color: "var(--fg-faint)", padding: "10px 0" }}>
                  ไม่มีโพสต์ (หรือไม่มีสิทธิ์ดูโพสต์ของผู้ใช้รายนี้)
                </div>
              ) : (
                <div
                  style={{
                    maxHeight: "220px", overflowY: "auto", borderRadius: "12px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
                  }}
                >
                  {posts.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 12px", borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {(getPostCover(p) || "") && (
                        <img
                          src={getPostCover(p) || ""}
                          alt=""
                          style={{
                            width: "36px", height: "36px", borderRadius: "8px",
                            objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)",
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--fg)", wordBreak: "break-word" }}>
                          {p.title}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--fg-faint)", wordBreak: "break-all" }}>
                          {p.itemType === "lost" ? "ของหาย" : "พบของ"} · {p.id}
                        </div>
                      </div>
                      <span
                        style={{
                          flexShrink: 0, fontSize: "12px", fontWeight: 700, padding: "3px 9px", borderRadius: "7px",
                          color: p.status === "resolved" ? "var(--sc-ok-fg)"
                            : p.status === "suspended" ? "var(--sc-danger-fg)"
                            : p.status === "under_investigation" ? "var(--sc-warn-fg)"
                            : p.status === "in_progress" ? "var(--sc-info-fg)" : "var(--sc-ok-fg)",
                          backgroundColor: p.status === "resolved" ? "var(--sc-ok-bg)"
                            : p.status === "suspended" ? "var(--sc-danger-bg)"
                            : p.status === "under_investigation" ? "var(--sc-warn-bg)"
                            : p.status === "in_progress" ? "var(--sc-info-bg)" : "var(--sc-ok-bg)",
                        }}
                      >
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
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "8px" }}>
                คำขอรับของ <span style={{ color: "var(--sc-warn-fg)" }}>({claims.length})</span>
              </div>
              {claims.length === 0 ? (
                <div style={{ fontSize: "13px", color: "var(--fg-faint)", padding: "10px 0" }}>
                  ยังไม่เคยยื่นคำขอ (หรือไม่มีสิทธิ์ดูคำขอของผู้ใช้รายนี้)
                </div>
              ) : (
                <div
                  style={{
                    maxHeight: "220px", overflowY: "auto", borderRadius: "12px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
                  }}
                >
                  {claims.map((c) => {
                    const b = getStatusBadge(c);
                    return (
                      <div
                        key={c.id}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "10px 12px", borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--fg)", wordBreak: "break-word" }}>
                            {c.postTitle || "โพสต์ไม่ระบุชื่อ"}
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--fg-faint)", wordBreak: "break-all" }}>
                            {formatDateShort(c.createdAt) || "-"} · {c.id}
                          </div>
                        </div>
                        <span
                          style={{
                            flexShrink: 0, fontSize: "12px", fontWeight: 700, padding: "3px 9px",
                            borderRadius: "7px", color: b.color, backgroundColor: b.bg,
                          }}
                        >
                          {b.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </ReviewSheet>

      {confirmBan && profile && (
        <ConfirmModal
          open
          title="ยืนยันแบนผู้ใช้"
          message={`ยืนยันแบน "${name}"? โพสต์ทั้งหมดของผู้ใช้รายนี้จะถูกระงับ และเขาจะเข้าใช้งานไม่ได้จนกว่าจะปลดแบน`}
          confirmText="แบนผู้ใช้"
          variant="danger"
          busy={busy}
          onConfirm={runBan}
          onCancel={() => !busy && setConfirmBan(false)}
        />
      )}
    </>
  );
}

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
  if (c.status === "approved") return { label: "ส่งมอบแล้ว", bg: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)" };
  if (c.status === "rejected") return { label: "ถูกปฏิเสธ", bg: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)" };
  if (c.status === "expired") return { label: "หมดอายุแล้ว", bg: "var(--sc-muted-bg)", color: "var(--fg-secondary)" };
  if (c.status === "post_deleted") return { label: "โพสต์ถูกลบ", bg: "var(--sc-muted-bg)", color: "var(--fg-faint)" };
  return { label: "รอตรวจสอบ", bg: "var(--sc-warn-bg)", color: "var(--sc-warn-fg)" };
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
  post_report: { label: "รายงานโพสต์", color: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)" },
  claim_dispute: { label: "แจ้งสวมสิทธิ์", color: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" },
  support_message: { label: "ติดต่อแอดมิน", color: "var(--sc-brand-fg)", bg: "var(--sc-brand-bg)" },
};

// ป้ายสถานะโพสต์ (ใช้ร่วมกันหลายแท็บ)
const statusLabel = (p: PostItem) => {
  if (p.status === "rejected") return { text: "ถูกปฏิเสธ", bg: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)" };
  if (p.status === "pending") return { text: "รอตรวจสอบ", bg: "var(--sc-warn-bg)", color: "var(--sc-warn-fg)" };
  if (p.status === "suspended") return { text: "ระงับ", bg: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)" };
  if (p.status === "resolved") return { text: "คืนแล้ว", bg: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)" };
  if (p.status === "under_investigation") return { text: "อายัด", bg: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)" };
  if (p.status === "in_progress") return { text: "ดำเนินการ", bg: "var(--sc-info-bg)", color: "var(--sc-info-fg)" };
  return { text: "ใช้งาน", bg: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)" };
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

  // ทางลัดจากการ์ดผู้ใช้ → ข้ามไปแท็บ "จัดการผู้ใช้" แล้วเปิดการ์ดของคนนั้นทันที
  const [focusUser, setFocusUser] = useState<AdminUser | null>(null);
  const openUserManager = (uid: string) => {
    setActiveTab("users");
    const inList = users.find((u) => u.id === uid);
    if (inList) {
      setFocusUser(inList);
      return;
    }
    // ไม่อยู่ใน 200 คนแรก → ดึงจาก Firestore โดยตรง (ทำใน event handler เพื่อไม่ยิงซ้ำทุก render)
    setFocusUser(null);
    getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (snap.exists()) {
          setFocusUser({ id: snap.id, ...snap.data() } as AdminUser);
        } else {
          showToast("ไม่พบข้อมูลผู้ใช้รายนี้", "error");
        }
      })
      .catch((e) => {
        console.error("Error loading user for management:", e);
        showToast("เปิดข้อมูลผู้ใช้ไม่สำเร็จ", "error");
      });
  };

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
    { id: "found", label: "รับโพสต์ของพบ", icon: PackageSearch, color: "var(--sc-warn-fg)" },
    { id: "claims", label: "คำขอรับของ", icon: ClipboardCheck, color: "var(--sc-warn-fg)" },
    { id: "history", label: "ประวัติ", icon: History, color: "var(--sc-brand-fg)" },
  ];
  // เจ้าหน้าที่ประจำจุด: จัดการโพสต์เฉพาะจุดของตัวเอง
  if (isStaff) {
    allTabs.push({ id: "posts", label: "จัดการโพสต์", icon: FileText, color: "var(--sc-info-fg)" });
  }
  // เฉพาะหัวหน้าแอดมิน: จัดการโพสต์/รายงาน/ผู้ใช้/เจ้าหน้าที่-จุดคืน
  if (isSuper) {
    allTabs.push(
      { id: "posts", label: "จัดการโพสต์", icon: FileText, color: "var(--sc-info-fg)" },
      { id: "reports", label: "รายงาน", icon: Flag, color: "var(--sc-danger-fg)" },
      { id: "users", label: "จัดการผู้ใช้", icon: Users, color: "var(--sc-ok-fg)" },
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
      <div
        className="adm-topbar"
        style={{
          background: "color-mix(in srgb, var(--bg) 78%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          padding: "10px 20px", display: "flex", alignItems: "center", gap: "12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          height: 60,
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 auto" }}>
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
            <div className="adm-hide-narrow" style={{ fontSize: "10.5px", color: "var(--fg-accent)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "1px" }}>
              Admin Panel
            </div>
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: "0 0 4px" }} />

        {/* ชื่อจุดคืนของเจ้าหน้าที่ประจำจุด — เห็นทุกแท็บ กันเข้าใจผิดว่าอยู่จุดไหน
            (จอแคบซ่อนข้อความไว้ เหลือแค่ไอคอน ชื่อจุดยังดูได้จาก title) */}
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
              border: "1px solid var(--sc-info-border)",
              background: "var(--sc-info-bg)",
              color: "var(--sc-info-fg)",
            }}
          >
            <MapPin size={15} />
            <span className="adm-hide-narrow" style={{ fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
              จุดคืน: {adminPoint}
            </span>
          </div>
        )}

        {/* Theme toggle */}
        <button onClick={toggleTheme} title={theme === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"} style={{
          width: "40px", height: "40px", borderRadius: "10px", flexShrink: 0,
          border: "1px solid var(--border)", background: "var(--bg-card)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          color: "var(--fg-secondary)",
          transition: "background 0.13s ease",
        }}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Logout */}
        <button onClick={onLogout} title="ออกจากระบบ" style={{
          display: "flex", alignItems: "center", gap: "7px",
          height: "40px", padding: "0 14px", borderRadius: "10px", flexShrink: 0,
          border: "1px solid var(--sc-danger-border)", background: "var(--sc-danger-bg)",
          color: "var(--sc-danger-fg)", fontSize: "12.5px", fontWeight: 700, cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          transition: "filter 0.15s ease",
        }}>
          <LogOut size={15} />
          <span className="adm-hide-narrow">ออกจากระบบ</span>
        </button>
      </div>

      {/* Tab Navigation */}
      <div
        className="adm-tabs"
        style={{
          display: "flex", gap: "6px", padding: "12px 16px 8px",
          backgroundColor: "var(--bg)", borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {allTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className="adm-tab" style={{
              flex: "0 0 auto", borderRadius: "10px",
              border: isActive ? "none" : "1px solid var(--border)",
              backgroundColor: isActive ? "#7c5cfc" : "var(--bg-card)",
              color: isActive ? "var(--fg)" : "var(--fg-muted)",
              fontSize: "12px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "6px",
              boxShadow: isActive ? "0 4px 14px rgba(124,92,252,0.35)" : "none",
              transition: "background 0.15s ease", whiteSpace: "nowrap",
            }}>
              <Icon size={15} />
              {tab.label}
              {tab.id === "found" && pendingFoundCount > 0 && (
                <span style={{
                  minWidth: "16px", height: "16px", padding: "0 4px", borderRadius: "999px",
                  backgroundColor: "var(--sc-warn-fg)", color: "#1a1208", fontSize: "10px", fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  {pendingFoundCount > 99 ? "99+" : pendingFoundCount}
                </span>
              )}
              {tab.id === "claims" && pendingClaimsCount > 0 && (
                <span style={{
                  minWidth: "16px", height: "16px", padding: "0 4px", borderRadius: "999px",
                  backgroundColor: "var(--sc-info-fg)", color: "#0b1526", fontSize: "10px", fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  {pendingClaimsCount > 99 ? "99+" : pendingClaimsCount}
                </span>
              )}
              {tab.id === "reports" && openReportsCount > 0 && (
                <span style={{
                  minWidth: "16px", height: "16px", padding: "0 4px", borderRadius: "999px",
                  backgroundColor: "var(--sc-danger-fg)", color: "#241012", fontSize: "10px", fontWeight: 800,
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
      <div className="adm-body" style={{ flex: 1, overflowY: "auto", padding: "16px" }}>

        {isStaff && !adminPoint ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)" }}>
            <MapPin size={32} color="var(--sc-info-fg)" style={{ marginBottom: "12px" }} />
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
            <AlertTriangle size={32} color="var(--sc-danger-fg)" style={{ marginBottom: "12px" }} />
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
                isSuper={isSuper}
                onManageUsers={isSuper ? openUserManager : undefined}
              />
            )}
            {activeTab === "claims" && (
              <AdminClaims
                adminUid={currentUser?.uid || ""}
                adminPoint={isStaff ? adminPoint : null}
                isStaff={isStaff}
                isSuper={isSuper}
                onManageUsers={isSuper ? openUserManager : undefined}
              />
            )}
            {activeTab === "history" && (
              <AdminHistory
                isStaff={isStaff}
                adminPoint={isStaff ? adminPoint : null}
                isSuper={isSuper}
                onManageUsers={isSuper ? openUserManager : undefined}
              />
            )}
            {activeTab === "posts" && (
              <AdminPosts
                posts={posts}
                isSuper={isSuper}
                onManageUsers={isSuper ? openUserManager : undefined}
              />
            )}
            {isSuper && activeTab === "reports" && <AdminReports />}
            {isSuper && activeTab === "users" && (
              <AdminUsers users={users} focusUser={focusUser} />
            )}
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
    { label: "ของค้าง", value: unresolvedPosts.length, icon: Clock, color: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)" },
    { label: "กำลังดำเนินการ", value: inProgressPosts, icon: Activity, color: "var(--sc-info-fg)", bg: "var(--sc-info-bg)" },
    { label: "ของหาย", value: lostPosts, icon: AlertTriangle, color: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)" },
    { label: "พบของ", value: foundPosts, icon: PackageCheck, color: "var(--sc-ok-fg)", bg: "var(--sc-ok-bg)" },
    { label: "คืนสำเร็จ", value: resolvedPosts, icon: CheckCircle2, color: "var(--sc-ok-fg)", bg: "var(--sc-ok-bg)" },
  ];
  if (isSuper) {
    stats.push(
      { label: "โพสต์ทั้งหมด", value: totalPosts, icon: FileText, color: "var(--fg-accent)", bg: "var(--bg-hover)" },
      { label: "รายงานค้าง", value: openReports, icon: Flag, color: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" },
      { label: "ผู้ใช้งานทั้งหมด", value: totalUsers, icon: Users, color: "var(--sc-info-fg)", bg: "var(--sc-info-bg)" },
      { label: "ผู้ใช้ที่ถูกแบน", value: bannedUsers, icon: UserX, color: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" }
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
        <div className="adm-grid-2">
          {[
            { label: "โพสต์ของพบรออนุมัติ", value: pendingFoundPosts, icon: PackageSearch, color: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)", tab: "found" as AdminTab },
            { label: "คำขอเคลมรออนุมัติ", value: pendingClaims, icon: ClipboardCheck, color: "var(--sc-info-fg)", bg: "var(--sc-info-bg)", tab: "claims" as AdminTab },
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
      <div className="adm-grid-2">
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
          <Clock size={16} color="var(--sc-warn-fg)" /> ของค้างเกิน {agingDays} วัน
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
                backgroundColor: post.itemType === "lost" ? "var(--sc-warn-fg)" : "var(--sc-ok-fg)",
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
                backgroundColor: "var(--sc-warn-bg)", color: "var(--sc-warn-fg)",
                border: "1px solid var(--sc-warn-border)", whiteSpace: "nowrap",
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
              backgroundColor: post.status === "resolved" ? "var(--sc-ok-fg)"
                : post.status === "under_investigation" ? "var(--sc-danger-fg)"
                : post.status === "in_progress" ? "var(--sc-info-fg)"
                : post.itemType === "lost" ? "var(--sc-warn-fg)" : "var(--sc-ok-fg)",
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
              backgroundColor: post.itemType === "lost" ? "var(--sc-warn-bg)" : "var(--sc-ok-bg)",
              color: post.itemType === "lost" ? "var(--sc-warn-fg)" : "var(--sc-ok-fg)",
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
  isSuper,
  onManageUsers,
}: {
  posts: PostItem[];
  adminPoint?: string | null;
  isSuper?: boolean;
  onManageUsers?: (uid: string) => void;
}) {
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);
  // ปุ่ม "ตรวจสอบ" — เปิดดูรายละเอียดโพสต์ของพบแบบเต็มจอก่อนตัดสินใจ
  const [selectedPost, setSelectedPost] = useState<PostItem | null>(null);
  const [postZoom, setPostZoom] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  // ทางลัดดู/จัดการผู้ใช้ — กดที่ชื่อหรืออีเมลของผู้พบได้เลย
  const [quickUserId, setQuickUserId] = useState<string | null>(null);

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
        setProcessingId(post.id ?? "");
        try {
          await updateDoc(doc(db, "posts", post.id ?? ""), {
            status: "active",
            approvedAt: serverTimestamp(),
          });
          await notifyFinder(post, "found_approved");
          setConfirmDialog(null);
          setSelectedPost(null);
          showToast("อนุมัติโพสต์ของพบแล้ว", "success");
        } catch (e) {
          console.error(e);
          showToast("อนุมัติไม่สำเร็จ กรุณาลองใหม่", "error");
        } finally {
          setProcessingId(null);
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
        setProcessingId(post.id ?? "");
        try {
          await updateDoc(doc(db, "posts", post.id ?? ""), {
            status: "rejected",
            rejectedAt: serverTimestamp(),
          });
          await notifyFinder(post, "found_rejected");
          setConfirmDialog(null);
          setSelectedPost(null);
          showToast("ปฏิเสธโพสต์แล้ว", "success");
        } catch (e) {
          console.error(e);
          showToast("ปฏิเสธไม่สำเร็จ กรุณาลองใหม่", "error");
        } finally {
          setProcessingId(null);
        }
      },
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 12px", backgroundColor: "var(--sc-warn-bg)", border: "1px solid var(--sc-warn-border)",
        borderRadius: "10px", fontSize: "12px", color: "var(--sc-warn-fg)",
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
            border: "1px solid var(--sc-warn-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}>
            <div style={{ display: "flex", gap: "12px" }}>
              {post.imageUrl ? (
                <img
                  src={post.imageUrl}
                  alt=""
                  onClick={() => setSelectedPost(post)}
                  title="แตะเพื่อตรวจสอบรายละเอียด"
                  style={{
                    width: "64px", height: "64px", borderRadius: "10px",
                    objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                />
              ) : (
                <div
                  onClick={() => setSelectedPost(post)}
                  title="แตะเพื่อตรวจสอบรายละเอียด"
                  style={{
                    width: "64px", height: "64px", borderRadius: "10px", flexShrink: 0,
                    backgroundColor: "var(--sc-warn-bg)", color: "var(--sc-warn-fg)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <PackageSearch size={24} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  onClick={() => setSelectedPost(post)}
                  style={{ fontSize: "13.5px", fontWeight: 800, color: "var(--fg)", cursor: "pointer" }}
                >
                  {post.title}
                </div>
                <div style={{ fontSize: "11px", color: "var(--fg-muted)", marginTop: 2 }}>
                  ผู้พบ:{" "}
                  <UserLink
                    value={post.reporterName}
                    fallback="ไม่ระบุชื่อ"
                    onClick={post.userId || post.uid ? () => setQuickUserId((post.userId || post.uid) as string) : undefined}
                  />{" "}
                  · {formatDateShort(post.createdAt) || "-"}
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
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
              <button
                onClick={() => setSelectedPost(post)}
                style={{
                  width: "100%", padding: "11px", borderRadius: "10px", border: "1px solid var(--border-strong)",
                  backgroundColor: "var(--bg-subtle)", color: "var(--fg-strong)", fontSize: "12.5px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}
              >
                <Eye size={15} /> ตรวจสอบ
              </button>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => handleApprove(post)} style={{
                  flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid var(--sc-ok-border)",
                  backgroundColor: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                }}>
                  <CheckCircle2 size={14} /> ตรวจรับแล้ว อนุมัติโพสต์
                </button>
                <button onClick={() => handleReject(post)} style={{
                  flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid var(--sc-danger-border)",
                  backgroundColor: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)", fontSize: "12px", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                }}>
                  <XCircle size={14} /> ปฏิเสธ
                </button>
              </div>
            </div>
          </div>
      )))} 

      {/* หน้าตรวจสอบโพสต์ของพบ — ดูรายละเอียดเต็มก่อนตัดสินใจ */}
      {selectedPost && (
        <ReviewSheet
          open
          onClose={() => { setSelectedPost(null); setPostZoom(null); }}
          title="ตรวจสอบโพสต์ของพบ"
          subtitle={`ผู้พบ: ${selectedPost.reporterName || "ไม่ระบุ"} · ${formatDateShort(selectedPost.createdAt) || "-"}`}
          badge={{ label: "รอตรวจรับ", bg: "var(--sc-warn-bg)", color: "var(--sc-warn-fg)" }}
          busy={!!processingId}
          footer={
            <>
              <SheetButton
                tone="danger"
                disabled={!!processingId}
                onClick={() => handleReject(selectedPost)}
              >
                <XCircle size={18} /> ปฏิเสธโพสต์
              </SheetButton>
              <SheetButton
                tone="ok"
                disabled={!!processingId}
                onClick={() => handleApprove(selectedPost)}
              >
                <CheckCircle2 size={18} /> ตรวจรับแล้ว อนุมัติโพสต์
              </SheetButton>
            </>
          }
        >
            <ReviewImage src={selectedPost.imageUrl} images={getPostImages(selectedPost)} alt={selectedPost.title} onZoom={setPostZoom} />

          <div>
            <div style={{ fontSize: "21px", fontWeight: 800, color: "var(--fg)", lineHeight: 1.3 }}>
              {selectedPost.title}
            </div>
            <div style={{
              fontSize: "11px", color: "var(--fg-faint)", marginTop: "5px",
              fontFamily: "'SF Mono', monospace", wordBreak: "break-all",
            }}>
              ID: {selectedPost.id}
            </div>
          </div>

          {selectedPost.desc && (
            <div style={{
              padding: "14px 16px", backgroundColor: "var(--bg-subtle)", borderRadius: "12px",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <FileText size={14} /> รายละเอียดจากผู้พบ
              </div>
              <div style={{
                fontSize: "14.5px", color: "var(--fg-secondary)", lineHeight: 1.75,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {selectedPost.desc}
              </div>
            </div>
          )}

          <div style={{
            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
            padding: "11px 13px", borderRadius: "12px",
            border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
          }}>
            <span style={{
              fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
              display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
            }}>
              <User size={14} /> ผู้พบ / เจ้าของโพสต์
            </span>
            <UserIdentity
              uid={selectedPost.userId || selectedPost.uid}
              name={selectedPost.reporterName || selectedPost.reporter}
              onOpen={(uid) => setQuickUserId(uid)}
              size="sm"
            />
          </div>

          <InfoGrid>
            <InfoRow icon={User} label="ผู้พบ" value={selectedPost.reporterName || "ไม่ระบุ"} />
            {selectedPost.reporterPhone && (
              <InfoRow icon={Phone} label="เบอร์โทรผู้พบ" value={selectedPost.reporterPhone} />
            )}
            <InfoRow
              icon={ShieldAlert}
              label="จุดฝาก/คืนของ"
              value={selectedPost.depositLocation || "ไม่ระบุ"}
              color="var(--sc-ok-fg)"
              bg="var(--sc-ok-bg)"
            />
            <InfoRow
              icon={MapPin}
              label="สถานที่พบ"
              value={selectedPost.locationName || selectedPost.location || selectedPost.building || "ไม่ระบุ"}
            />
            {(selectedPost.category || selectedPost.faculty) && (
              <InfoRow
                icon={GraduationCap}
                label="ประเภท / คณะ"
                value={[selectedPost.category, selectedPost.faculty].filter(Boolean).join(" · ")}
              />
            )}
            {selectedPost.refCode && (
              <InfoRow icon={IdCard} label="รหัสอ้างอิง" value={selectedPost.refCode} />
            )}
            {selectedPost.securityZone && (
              <InfoRow icon={ShieldCheck} label="พื้นที่ความปลอดภัย" value={selectedPost.securityZone} />
            )}
            <InfoRow
              icon={Clock}
              label="วันที่พบ"
              value={[formatDateShort(selectedPost.date), formatClockTime(selectedPost.createdAt)]
                .filter(Boolean).join(" ") || "-"}
            />
            <InfoRow icon={Clock} label="ส่งโพสต์เมื่อ" value={formatTime(selectedPost.createdAt) || "-"} />
          </InfoGrid>

          <div style={{
            padding: "12px 14px", backgroundColor: "var(--sc-warn-bg)", borderRadius: "12px",
            border: "1px solid var(--sc-warn-border)", fontSize: "13px", color: "var(--sc-warn-fg)",
            lineHeight: 1.6, display: "flex", alignItems: "flex-start", gap: "8px",
          }}>
            <PackageSearch size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
            <span>
              ตรวจของจริงกับผู้พบที่จุดรับก่อนเสมอ ถ้าของตรงกับโพสต์ของหาย กด
              &quot;ตรวจรับแล้ว อนุมัติโพสต์&quot; ได้เลย
            </span>
          </div>
        </ReviewSheet>
      )}

        <ImageLightbox
          src={postZoom}
          images={selectedPost ? getPostImages(selectedPost) : null}
          onClose={() => setPostZoom(null)}
        />

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

      {/* ทางลัดดู/จัดการผู้ใช้ — เปิดจากชื่อหรืออีเมลของผู้พบ */}
      <AdminUserSheet
        userId={quickUserId}
        onClose={() => setQuickUserId(null)}
        zIndex={320}
        canManage={isSuper}
        onManageUsers={onManageUsers}
      />
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
  isSuper,
  onManageUsers,
}: {
  adminUid?: string;
  adminPoint?: string | null;
  isStaff?: boolean;
  isSuper?: boolean;
  onManageUsers?: (uid: string) => void;
}) {
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selectedClaim, setSelectedClaim] = useState<AdminClaim | null>(null);
  const [claimPost, setClaimPost] = useState<PostItem | null>(null);
  const [claimPostZoom, setClaimPostZoom] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  // กรอบถ่ายรูปหลักฐาน (บังคับก่อนอนุมัติ) + ข้อความผิดพลาดที่ค้างไว้ให้เห็นในกรอบ
  const [handoverClaim, setHandoverClaim] = useState<AdminClaim | null>(null);
  const [handoverError, setHandoverError] = useState<string | null>(null);
  // หลักฐานการส่งมอบของคำขอที่เปิดดูอยู่ (ผูกกับ claimId เพื่อไม่ให้รูปค้างข้ามคำขอ)
  const [claimHandover, setClaimHandover] = useState<{
    claimId: string;
    data: HandoverEvidence | null;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);
  // ทางลัดดู/จัดการผู้ใช้ — กดที่ชื่อหรืออีเมลของผู้ขอรับของได้เลย
  const [quickUserId, setQuickUserId] = useState<string | null>(null);

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

  // โหลดหลักฐานการส่งมอบเมื่อเปิดดูคำขอที่อนุมัติแล้ว
  // เก็บผลผูกกับ claimId เพื่อแสดงเฉพาะตอนเปิดคำขอใบเดียวกัน
  // (ผู้ขอ/คนอื่นอ่านไม่ได้ตามกฎ → คืน null ไม่ทำให้หน้าจอพัง)
  const selectedClaimId = selectedClaim?.id ?? null;
  const selectedClaimApproved = selectedClaim?.status === "approved";
  useEffect(() => {
    if (!selectedClaimId || !selectedClaimApproved) return;
    let cancelled = false;
    loadHandoverEvidence(selectedClaimId).then((ev) => {
      if (!cancelled) setClaimHandover({ claimId: selectedClaimId, data: ev });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedClaimId, selectedClaimApproved]);
  const claimHandoverShown =
    claimHandover?.claimId === selectedClaimId ? claimHandover.data : null;

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

  /* เปิดกรอบถ่ายรูปหลักฐาน — บังคับก่อนบันทึกการอนุมัติ
     ยืนยันว่าจะส่งมอบของให้ถูกคนก่อนเปิดกล้อง และซ่อมเมื่อมีสิทธิ์จริง */
  const handleApprove = (claim: AdminClaim) => {
    if (processingId) return;
    setHandoverError(null);
    setHandoverClaim(claim);
  };

  /* บันทึกการส่งมอบ 3 จังหวะ (เรียงตามข้อจำกัดของกฎ Firestore)
     1) อัปโหลดรูปหลักฐาน → ล้มเหลว = ยกเลิก ไม่อนุมัติ (fail-closed)
     2) commit หลักฐานลง claims/{id}/handover/evidence (claim ยัง pending)
     3) transaction อนุมัติ — กฎตรวจ hasHandoverEvidence จึงผ่าน
        ถ้าพัง → ลบหลักฐานทิ้งเพื่อไม่ให้เหลือหลักฐานกำพร้า */
  const confirmHandover = async (claim: AdminClaim, file: File) => {
    if (processingId) return;
    setProcessingId(claim.id);
    setHandoverError(null);
    const evidenceRef = doc(db, "claims", claim.id, "handover", "evidence");
    let evidenceWritten = false;
    try {
      // จังหวะที่ 1: อัปโหลดรูปหลักฐาน
      let photoUrl: string;
      try {
        photoUrl = await uploadToCloudinary(file);
      } catch (uploadError) {
        console.error("Error uploading handover evidence:", uploadError);
        setHandoverError("อัปโหลดรูปหลักฐานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง (ยังไม่ได้อนุมัติคำขอ)");
        return;
      }

      // จังหวะที่ 2: บันทึกหลักฐาน (commit แยก — กฎอ่านค่าก่อนเริ่ม transaction)
      await setDoc(evidenceRef, {
        photoUrl,
        depositLocation: claim.depositLocation || "",
        capturedByUid: adminUid || "",
        capturedAt: new Date().toISOString(),
      });
      evidenceWritten = true;

          // จังหวะที่ 3: อนุมัติ (transaction เดิมที่กันส่งของชิ้นเดียวให้ 2 คน)
          const nowIso = new Date().toISOString();
          const matchedPostId = claim.matchedPostId || null;
          // โพสต์ของหายที่ผู้ขอเลือกตอนขอรับของ — ต้องปิดด้วยตอนคืนของสำเร็จ
          // (ไม่มีโพสต์หายที่เลือก = ไม่ต้องแตะ ปิดใน transaction เดียวกันไม่ได้เพราะกฎอ่าน claim ก่อนเขียน)
          let matchedPostWarning: string | null = null;
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

            // จังหวะที่ 4: ปิดโพสต์ของหายที่ผู้ขอเลือก (แยกจาก transaction เพราะกฎ canCloseMatchedLostPost
            // ต้องเห็นสถานะคำขอเป็น 'approved' แล้ว — ทำใน transaction เดียวกันกฎจะยังเห็นเป็น 'pending')
            if (matchedPostId) {
              try {
                await closeMatchedLostPostDoc(matchedPostId, claim.id);
              } catch (e) {
                console.error("Error closing matched lost post:", e);
                matchedPostWarning =
                  "อนุมัติคำขอแล้ว แต่ปิดโพสต์ของหายที่ผู้ขอเลือกไม่สำเร็จ (กฎ Firestore อาจยังไม่ได้ deploy) — เปิดรายการในหน้าประวัติแล้วกด 'ปิดโพสต์ของหาย' เพื่อซ่อม";
              }
            }
          } else {
            await updateDoc(doc(db, "claims", claim.id), {
              status: "approved",
              reviewedAt: nowIso,
              reviewedByUid: adminUid || "",
            });
            if (matchedPostId) {
              try {
                await closeMatchedLostPostDoc(matchedPostId, claim.id);
              } catch (e) {
                console.error("Error closing matched lost post:", e);
                matchedPostWarning =
                  "อนุมัติคำขอแล้ว แต่ปิดโพสต์ของหายที่ผู้ขอเลือกไม่สำเร็จ (กฎ Firestore อาจยังไม่ได้ deploy) — เปิดรายการในหน้าประวัติแล้วกด 'ปิดโพสต์ของหาย' เพื่อซ่อม";
              }
            }
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
          setHandoverClaim(null);
          setHandoverError(null);
          setSelectedClaim(null);
          setClaimPost(null);
          setClaimPostZoom(null);
          // อนุมัติสำเร็จ แต่ปิดโพสต์ของหายไม่สำเร็จ → เตือนให้เจ้าหน้าที่ไปตรวจสอบ (ไม่ย้อนกลับการอนุมัติ)
          if (matchedPostWarning) {
            showToast(matchedPostWarning, "error");
          }
        } catch (e) {
          console.error("[confirmHandover] error:", e);
          const msg = (e as { message?: string; code?: string })?.message || "";
          const code = (e as { code?: string })?.code || "";
          const full = code ? `[${code}] ${msg}` : msg;
          // อนุมัติไม่สำเร็จ → ลบหลักฐานทิ้ง (กฎอนุญาตลบตราบใดที่ claim ยัง pending)
          if (evidenceWritten) {
            deleteDoc(evidenceRef).catch((de) => console.error("[confirmHandover] cleanup failed:", de));
          }
          if (msg === "already_resolved") {
            setHandoverError("โพสต์นี้ถูกส่งมอบ (resolved) ไปแล้วในแท็บอื่น");
            showToast("โพสต์นี้ถูกส่งมอบ (resolved) ไปแล้วในแท็บอื่น", "error");
          } else if (msg === "wrong_reservation_claim") {
            setHandoverError("คำขอนี้ไม่ใช่ผู้ที่จองโพสต์ไว้อยู่จริง ตรวจสอบคำขออีกครั้ง");
            showToast("คำขอนี้ไม่ใช่ผู้ที่จองโพสต์ไว้อยู่จริง ตรวจสอบคำขออีกครั้ง", "error");
          } else {
            setHandoverError(full || "เกิดข้อผิดพลาดในการยืนยัน ยังไม่ได้อนุมัติคำขอ");
            showToast(full || "เกิดข้อผิดพลาดในการยืนยัน ยังไม่ได้อนุมัติคำขอ", "error");
          }
        } finally {
          setProcessingId(null);
        }
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
        // เช็คว่ายังมี claim ที่ "รออยู่" (pending) ของโพสต์นี้หรือไม่
        // แยก try/catch เฉพาะการ query: ถ้าล้มเหลวห้ามทำให้การปล่อยโพสต์ด้านล่างพังตาม
        // (เดิม query อยู่ใน try เดียวกับการปล่อยโพสต์ → query error แล้วโพสต์ค้าง in_progress ตลอด)
        let hasOtherPending = true; // ค่าเริ่มต้นแบบอนุรักษ์: ไม่รู้ = ไม่คืนสถานะ active
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
          hasOtherPending = !others.empty;
        } catch (queryError) {
          console.error("Error checking remaining pending claims:", queryError);
        }

        // เคลียร์ reservation ทุกครั้งที่ปฏิเสธ (กันโพสต์ติดอยู่กับ claim ที่ reject แล้ว)
        try {
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
            // คืนสถานะ active ได้เฉพาะเมื่อยืนยันแน่ใจว่าไม่มี claim ค้างอยู่
            if (!hasOtherPending) {
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
      <div style={{ display: "flex", gap: "8px", padding: "12px", backgroundColor: "var(--sc-warn-bg)", border: "1px solid var(--sc-warn-border)", borderRadius: "12px" }}>
        <ClipboardCheck size={16} color="var(--sc-warn-fg)" style={{ flexShrink: 0, marginTop: "1px" }} />
        <div style={{ fontSize: "12px", color: "var(--sc-warn-fg-strong)", lineHeight: 1.5 }}>
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
              border: claim.status === "pending" ? "1.5px solid var(--sc-warn-border)" : "1px solid var(--border)",
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
                      backgroundColor: claim.claimType === "student" ? "var(--sc-info-bg)" : "var(--sc-warn-bg)",
                      color: claim.claimType === "student" ? "var(--sc-info-fg)" : "var(--sc-warn-fg)",
                      border: `1px solid ${claim.claimType === "student" ? "var(--sc-info-border)" : "var(--sc-warn-border)"}`,
                    }}>
                      {claim.claimType === "student" ? "นิสิตและบุคลากร" : "บุคคลทั่วไป"}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--fg-secondary)", lineHeight: 1.5 }}>
                    ผู้ขอ:{" "}
                    <span style={{ fontWeight: 700 }}>
                      <UserLink
                        value={claim.claimantName}
                        fallback="ไม่ระบุชื่อ"
                        onClick={claim.claimantId ? () => setQuickUserId(claim.claimantId as string) : undefined}
                      />
                    </span>{" "}
                    · {formatTime(claim.createdAt)}
                  </div>
                  {claim.status === "pending" && claim.expiresAt && (
                    <div style={{ fontSize: "11px", color: claim.pickupDate ? "var(--sc-warn-fg-strong)" : "var(--sc-info-fg)", marginTop: "2px" }}>
                      {claim.pickupDate
                        ? <>นัดรับ: {formatTime(claim.expiresAt)}</>
                        : <>หมดอายุใน: {formatTime(claim.expiresAt)}</>}
                    </div>
                  )}
                  {claim.studentId && (
                    <div style={{ fontSize: "11px", color: "var(--fg-secondary)", marginTop: "2px" }}>
                      รหัสนิสิต: <strong style={{ color: "var(--sc-info-fg)" }}>{claim.studentId}</strong>
                    </div>
                  )}
                  {((claim.phone || claim.contact) && (claim.phone || claim.contact) !== "ไม่ระบุช่องทางติดต่อ") && (
                    <div style={{ fontSize: "11px", color: "var(--sc-info-fg)", marginTop: "2px" }}>
                      โทร: {claim.phone || claim.contact}
                    </div>
                  )}
                  {(claim.email || claim.claimantId) && (
                    <div style={{ fontSize: "11px", color: "var(--fg-secondary)", marginTop: "2px" }}>
                      อีเมล:{" "}
                      <UserLink
                        value={claim.email}
                        fallback="กดเพื่อดูอีเมลจากบัญชี"
                        onClick={claim.claimantId ? () => setQuickUserId(claim.claimantId as string) : undefined}
                      />
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
                      flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid var(--sc-ok-border)",
                      backgroundColor: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)", fontSize: "12px", fontWeight: 700,
                      cursor: isProcessing ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                    }}>
                      <Camera size={14} /> ถ่ายรูปแล้วยืนยันส่งมอบ
                    </button>
                    <button onClick={() => handleReject(claim)} disabled={isProcessing} style={{
                      flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid var(--sc-danger-border)",
                      backgroundColor: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)", fontSize: "12px", fontWeight: 700,
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
        <ReviewSheet
          open
          onClose={() => { setSelectedClaim(null); setClaimPost(null); setClaimPostZoom(null); }}
          title="ตรวจสอบคำขอรับของ"
          subtitle={`${selectedClaim.postTitle || "-"} · ผู้ขอ: ${selectedClaim.claimantName || "ไม่ระบุ"}`}
          badge={getStatusBadge(selectedClaim)}
          busy={processingId === selectedClaim.id}
          footer={
            selectedClaim.status === "pending" ? (
              <>
                <SheetButton
                  tone="danger"
                  disabled={processingId === selectedClaim.id}
                  onClick={() => handleReject(selectedClaim)}
                >
                  <XCircle size={18} /> ปฏิเสธคำขอ
                </SheetButton>
                <SheetButton
                  tone="ok"
                  disabled={processingId === selectedClaim.id}
                  onClick={() => handleApprove(selectedClaim)}
                  icon={Camera}
                >
                  ถ่ายรูปแล้วยืนยันส่งมอบ
                </SheetButton>
              </>
            ) : undefined
          }
        >
          {selectedClaim.evidenceUrl && (
            <div>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <ShieldCheck size={14} /> รูปหลักฐานจากผู้ขอ
              </div>
              <ReviewImage
                src={selectedClaim.evidenceUrl}
                alt="หลักฐาน"
                onZoom={setClaimPostZoom}
              />
            </div>
          )}

          {/* หลักฐานการส่งมอบ (รูปที่แอดมินถ่ายตอนกดอนุมัติ) */}
          {selectedClaim.status === "approved" && (
            <div>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--sc-ok-fg)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <Camera size={14} /> หลักฐานการส่งมอบ (ถ่ายโดยแอดมิน)
              </div>
              {claimHandoverShown?.photoUrl ? (
                <>
                  <ReviewImage
                    src={claimHandoverShown.photoUrl}
                    alt="หลักฐานการส่งมอบ"
                    onZoom={setClaimPostZoom}
                  />
                  {claimHandoverShown.capturedAt && (
                    <div style={{ fontSize: "11.5px", color: "var(--fg-muted)", marginTop: "6px" }}>
                      ถ่ายเมื่อ {formatTime(claimHandoverShown.capturedAt) || claimHandoverShown.capturedAt}
                    </div>
                  )}
                </>
              ) : (
                <div style={{
                  padding: "12px 14px", backgroundColor: "var(--sc-warn-bg)",
                  border: "1px solid var(--sc-warn-border)", borderRadius: "12px",
                  fontSize: "12.5px", color: "var(--sc-warn-fg)", lineHeight: 1.6,
                  display: "flex", alignItems: "flex-start", gap: "8px",
                }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                  <span>ไม่พบรูปหลักฐานการส่งมอบ (อาจเป็นคำขอที่อนุมัติก่อนมีระบบนี้)</span>
                </div>
              )}
            </div>
          )}

          {selectedClaim.postImageUrl && (
            <div>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <PackageSearch size={14} /> รูปในโพสต์ที่ถูกขอรับ
              </div>
              <ReviewImage
                src={selectedClaim.postImageUrl}
                alt="โพสต์"
                onZoom={setClaimPostZoom}
              />
            </div>
          )}

          <div>
            <div style={{ fontSize: "21px", fontWeight: 800, color: "var(--fg)", lineHeight: 1.3 }}>
              {selectedClaim.postTitle}
            </div>
            <div style={{ fontSize: "12px", color: "var(--fg-faint)", marginTop: "5px" }}>
              คำขอ ID: {selectedClaim.id}
            </div>
          </div>

          <SheetButton
            tone="neutral"
            disabled={!!processingId}
            onClick={() => openClaimPost(selectedClaim)}
          >
            <Eye size={18} /> ดูรายละเอียดโพสต์ฉบับเต็ม
          </SheetButton>

          <div style={{
            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
            padding: "11px 13px", borderRadius: "12px",
            border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
          }}>
            <span style={{
              fontSize: "12px", fontWeight: 700, color: "var(--sc-info-fg)",
              display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
            }}>
              <User size={14} /> ผู้ขอรับของ
            </span>
            <UserIdentity
              uid={selectedClaim.claimantId}
              name={selectedClaim.claimantName}
              email={selectedClaim.email}
              onOpen={(uid) => setQuickUserId(uid)}
              size="sm"
            />
          </div>

          <InfoGrid>
            <InfoRow
              icon={User}
              label="ผู้ขอรับของ"
              value={selectedClaim.claimantName || "-"}
              color="var(--sc-info-fg)"
              bg="var(--sc-info-bg)"
            />
            <InfoRow
              icon={GraduationCap}
              label="ประเภทผู้ขอ"
              value={selectedClaim.claimType === "student" ? "นิสิตและบุคลากร" : "บุคคลทั่วไป"}
              color={selectedClaim.claimType === "student" ? "var(--sc-info-fg)" : "var(--sc-warn-fg)"}
              bg={selectedClaim.claimType === "student" ? "var(--sc-info-bg)" : "var(--sc-warn-bg)"}
            />
            {selectedClaim.matchedPostId && (
              <InfoRow
                icon={Link2}
                label="จับคู่กับโพสต์ของหายของผู้ขอ"
                value={selectedClaim.matchedPostTitle || selectedClaim.matchedPostId}
                color="var(--sc-ok-fg)"
                bg="var(--sc-ok-bg)"
              />
            )}
            {selectedClaim.studentId && (
              <InfoRow
                icon={IdCard}
                label="รหัสนิสิต"
                value={selectedClaim.studentId}
                color="var(--sc-info-fg)"
                bg="var(--sc-info-bg)"
              />
            )}
            {((selectedClaim.phone || selectedClaim.contact) &&
              (selectedClaim.phone || selectedClaim.contact) !== "ไม่ระบุช่องทางติดต่อ") && (
              <InfoRow
                icon={Phone}
                label="เบอร์โทร / ช่องทางติดต่อ"
                value={selectedClaim.phone || selectedClaim.contact || "-"}
              />
            )}
            {selectedClaim.email && (
              <InfoRow icon={Mail} label="อีเมล" value={selectedClaim.email} />
            )}
            <InfoRow
              icon={Clock}
              label="ส่งคำขอเมื่อ"
              value={formatTime(selectedClaim.createdAt) || "-"}
              color="var(--sc-warn-fg)"
              bg="var(--sc-warn-bg)"
            />
            {selectedClaim.expiresAt && (
              <InfoRow
                icon={Clock}
                label={selectedClaim.pickupDate ? "นัดรับ" : "หมดอายุใน"}
                value={formatTime(selectedClaim.expiresAt) || "-"}
                color="var(--sc-warn-fg)"
                bg="var(--sc-warn-bg)"
              />
            )}
            {selectedClaim.depositLocation && (
              <InfoRow
                icon={MapPin}
                label="จุดฝาก/คืน"
                value={selectedClaim.depositLocation}
                color="var(--sc-ok-fg)"
                bg="var(--sc-ok-bg)"
              />
            )}
            <InfoRow
              icon={MapPin}
              label="สถานะคำขอ"
              value={getStatusBadge(selectedClaim).label}
              color="var(--sc-ok-fg)"
              bg="var(--sc-ok-bg)"
            />
          </InfoGrid>

          {selectedClaim.note && (
            <div style={{
              padding: "14px 16px", backgroundColor: "var(--bg-subtle)", borderRadius: "12px",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <FileText size={14} /> รายละเอียดจากผู้ขอ
              </div>
              <div style={{
                fontSize: "14.5px", color: "var(--fg-secondary)", lineHeight: 1.75,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {selectedClaim.note}
              </div>
            </div>
          )}

          {selectedClaim.status === "pending" && (
            <div style={{
              padding: "12px 14px", backgroundColor: "var(--sc-warn-bg)", borderRadius: "12px",
              border: "1px solid var(--sc-warn-border)", fontSize: "13px", color: "var(--sc-warn-fg)",
              lineHeight: 1.6, display: "flex", alignItems: "flex-start", gap: "8px",
            }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
              <span>
                ยืนยันกับผู้ขอด้วยตัวเองก่อนส่งมอบของ — ปุ่ม &quot;ถ่ายรูปแล้วยืนยันส่งมอบ&quot;
                จะเปิดกล้องให้ถ่ายหลักฐาน และปิดคำขออื่นของโพสต์นี้อัตโนมัติ
              </span>
            </div>
          )}
        </ReviewSheet>
      )}

      {/* กรอบถ่ายรูปหลักฐาน — บังคับก่อนบันทึกการอนุมัติ
          (mount/unmount ตาม handoverClaim → เริ่มรูปใหม่ทุกครั้งที่เปิด) */}
      {handoverClaim && (
        <HandoverCaptureSheet
          target={handoverClaim}
          busy={processingId === handoverClaim.id}
          error={handoverError}
          onCancel={() => {
            if (processingId) return;
            setHandoverClaim(null);
            setHandoverError(null);
          }}
          onConfirm={(file) => confirmHandover(handoverClaim, file)}
        />
      )}

      {/* Post Detail Modal (ที่เปิดจากคำขอรับของ) */}
      {claimPost && (
        <ReviewSheet
          open
          onClose={() => { setClaimPost(null); setClaimPostZoom(null); }}
          title="รายละเอียดโพสต์"
          subtitle={claimPost.title}
          zIndex={101}
          footer={
            <SheetButton
              tone="neutral"
              onClick={() => { setClaimPost(null); setClaimPostZoom(null); }}
            >
              <X size={18} /> ปิด
            </SheetButton>
          }
        >
            <ReviewImage src={claimPost.imageUrl} images={getPostImages(claimPost)} alt={claimPost.title} onZoom={setClaimPostZoom} />

          <div>
            <div style={{ fontSize: "21px", fontWeight: 800, color: "var(--fg)", lineHeight: 1.3 }}>
              {claimPost.title}
            </div>
            <div style={{
              fontSize: "11px", color: "var(--fg-faint)", marginTop: "5px",
              fontFamily: "'SF Mono', monospace", wordBreak: "break-all",
            }}>
              ID: {claimPost.id}
            </div>
          </div>

          {claimPost.desc && (
            <div style={{
              padding: "14px 16px", backgroundColor: "var(--bg-subtle)", borderRadius: "12px",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <FileText size={14} /> รายละเอียด
              </div>
              <div style={{
                fontSize: "14.5px", color: "var(--fg-secondary)", lineHeight: 1.75,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {claimPost.desc}
              </div>
            </div>
          )}

          <div style={{
            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
            padding: "11px 13px", borderRadius: "12px",
            border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
          }}>
            <span style={{
              fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
              display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
            }}>
              <User size={14} /> ผู้แจ้งโพสต์
            </span>
            <UserIdentity
              uid={claimPost.userId || claimPost.uid}
              name={claimPost.reporterName || claimPost.reporter}
              onOpen={(uid) => setQuickUserId(uid)}
              size="sm"
            />
          </div>

          <PostFactsGrid post={claimPost} />
        </ReviewSheet>
      )}

        <ImageLightbox
          src={claimPostZoom}
          images={claimPost ? getPostImages(claimPost) : null}
          onClose={() => setClaimPostZoom(null)}
        />

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

      {/* ทางลัดดู/จัดการผู้ใช้ — เปิดจากชื่อหรืออีเมลของผู้ขอรับของ/ผู้แจ้งโพสต์ */}
      <AdminUserSheet
        userId={quickUserId}
        onClose={() => setQuickUserId(null)}
        zIndex={320}
        canManage={isSuper}
        onManageUsers={onManageUsers}
      />
    </div>
  );
}

function AdminHistory({
  isStaff,
  adminPoint,
  isSuper,
  onManageUsers,
}: {
  isStaff?: boolean;
  adminPoint?: string | null;
  isSuper?: boolean;
  onManageUsers?: (uid: string) => void;
}) {
  const [history, setHistory] = useState<AdminClaim[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selected, setSelected] = useState<AdminClaim | null>(null);
  const [selectedZoom, setSelectedZoom] = useState<string | null>(null);
  // ทางลัดดู/จัดการผู้ใช้ — กดที่ชื่อหรืออีเมลของผู้ขอรับของในประวัติได้เลย
  const [quickUserId, setQuickUserId] = useState<string | null>(null);
  // หลักฐานการส่งมอบของรายการที่เปิดดูอยู่ (โหลดเฉพาะรายการที่อนุมัติแล้ว)
  const [selectedHandoverState, setSelectedHandover] = useState<{
    claimId: string;
    data: HandoverEvidence | null;
  } | null>(null);
  // โพสต์ที่เกี่ยวข้องของรายการที่อนุมัติแล้ว: โพสต์ของพบ + โพสต์ของหายที่ผู้ขอเลือก (ไม่มีก็ไม่ดึง)
  const [selectedPostsState, setSelectedPosts] = useState<{
    claimId: string;
    found: PostItem | null;
    lost: PostItem | null;
  } | null>(null);
  // ดูรายละเอียดโพสต์แบบเต็ม (เปิดจากประวัติ)
  const [postDetail, setPostDetail] = useState<{ post: PostItem; label: string } | null>(null);
  const [postDetailZoom, setPostDetailZoom] = useState<string | null>(null);
  // ลบรายการประวัติ
  const [deleteTarget, setDeleteTarget] = useState<AdminClaim | null>(null);
  const [deleting, setDeleting] = useState(false);
  // กำลังปิดโพสต์ของหายที่ผู้ขอเลือก (ซ่อมเคสย้อนหลังในหน้าประวัติ)
  const [closingPostId, setClosingPostId] = useState<string | null>(null);

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

  // โหลดหลักฐานการส่งมอบเมื่อเปิดดูประวัติรายการที่อนุมัติแล้ว
  // รายการที่ปฏิเสธ/หมดอายุ/โพสต์ถูกลบ → ไม่มีหลักฐาน และไม่ต้องแสดงรูป
  // เก็บผลผูกกับ claimId เพื่อแสดงเฉพาะตอนเปิดรายการเดียวกัน
  const selectedHistoryId = selected?.id ?? null;
  const selectedHistoryApproved = selected?.status === "approved";
  useEffect(() => {
    if (!selectedHistoryId || !selectedHistoryApproved) return;
    let cancelled = false;
    loadHandoverEvidence(selectedHistoryId).then((ev) => {
      if (!cancelled) setSelectedHandover({ claimId: selectedHistoryId, data: ev });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedHistoryId, selectedHistoryApproved]);
  const selectedHandover =
    selectedHandoverState?.claimId === selectedHistoryId ? selectedHandoverState.data : null;

  // รายการที่ "คืนของแล้ว" → ดึงโพสต์พบ + โพสต์หายที่ผู้ขอเลือกมาแสดงคู่กัน
  // (ถ้าไม่มี matchedPostId จะไม่ดึงโพสต์หาย — รายการปฏิเสธแสดงตามปกติ ไม่ต้องดึง)
  const loadSelectedPosts = async (claimId: string, postId?: string | null, matchedPostId?: string | null) => {
    const found = await loadPostDoc(postId);
    const lost = await loadPostDoc(matchedPostId);
    setSelectedPosts({ claimId, found, lost });
  };
  useEffect(() => {
    if (!selectedHistoryId || !selectedHistoryApproved) return;
    let cancelled = false;
    (async () => {
      const found = await loadPostDoc(selected?.postId);
      const lost = await loadPostDoc(selected?.matchedPostId);
      if (!cancelled) setSelectedPosts({ claimId: selectedHistoryId, found, lost });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHistoryId, selectedHistoryApproved, selected?.postId, selected?.matchedPostId]);

  const selectedPosts =
    selectedPostsState?.claimId === selectedHistoryId ? selectedPostsState : null;

  // ซ่อมเคสที่อนุมัติไปแล้วแต่โพสต์ของหายยังไม่ถูกปิด (เช่น ตอนกฎ Firestore ยังไม่ได้ deploy)
  const handleCloseMatchedPost = async (claim: AdminClaim, lostPostId: string) => {
    setClosingPostId(lostPostId);
    try {
      await closeMatchedLostPostDoc(lostPostId, claim.id);
      await loadSelectedPosts(claim.id, claim.postId, claim.matchedPostId);
      showToast("ปิดโพสต์ของหายที่ผู้ขอเลือกแล้ว (หายจากหน้า Home)", "success");
    } catch (e) {
      console.error("Error closing matched lost post:", e);
      showToast("ปิดไม่สำเร็จ — ถ้ายังไม่ได้ deploy กฎ Firestore ใหม่ ระบบจะปฏิเสธการแก้โพสต์หาย", "error");
    } finally {
      setClosingPostId(null);
    }
  };

  // เปิดดูรายละเอียดโพสต์เต็มจากการ์ดประวัติ (ดึงสดเสมอ ไม่ต้องรอเปิดการ์ดรายละเอียดก่อน)
  const openPostDetail = async (postId: string | null | undefined, label: string) => {
    if (!postId) return;
    const post = await loadPostDoc(postId);
    if (post) setPostDetail({ post, label });
    else showToast("ไม่สามารถเปิดรายละเอียดโพสต์ได้", "error");
  };

  // ลบรายการประวัติ (เฉพาะรายการที่ปิดเคสแล้ว — กฎ Firestore บังคับให้คำขอที่ยัง pending ลบไม่ได้)
  const handleDeleteHistory = async (claim: AdminClaim) => {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "claims", claim.id));
      showToast("ลบรายการประวัติแล้ว", "success");
      setDeleteTarget(null);
      if (selected?.id === claim.id) setSelected(null);
    } catch (e) {
      console.error("Error deleting history record:", e);
      showToast("ลบไม่สำเร็จ (ไม่มีสิทธิ์ลบรายการนี้)", "error");
    } finally {
      setDeleting(false);
    }
  };

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
      <div style={{ display: "flex", gap: "8px", padding: "12px", backgroundColor: "var(--sc-muted-bg)", border: "1px solid var(--sc-muted-border)", borderRadius: "12px" }}>
        <History size={16} color="var(--sc-brand-fg)" style={{ flexShrink: 0, marginTop: "1px" }} />
        <div style={{ fontSize: "12px", color: "var(--sc-brand-fg)", lineHeight: 1.5 }}>
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
                      backgroundColor: claim.claimType === "student" ? "var(--sc-info-bg)" : "var(--sc-warn-bg)",
                      color: claim.claimType === "student" ? "var(--sc-info-fg)" : "var(--sc-warn-fg)",
                      border: `1px solid ${claim.claimType === "student" ? "var(--sc-info-border)" : "var(--sc-warn-border)"}`,
                    }}>
                      {claim.claimType === "student" ? "นิสิตและบุคลากร" : "บุคคลทั่วไป"}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--fg-secondary)", lineHeight: 1.6 }}>
                    ผู้ขอ: <strong>{claim.claimantName}</strong>{" "}
                    {claim.studentId && <>(รหัส <strong style={{ color: "var(--sc-info-fg)" }}>{claim.studentId}</strong>)</>}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--fg-secondary)", lineHeight: 1.6 }}>
                    ยื่นเมื่อ: {formatTime(claim.createdAt)} · จบเมื่อ: {closedAt ? formatTime(claim.reviewedAt) : "-"}
                  </div>
                  {(claim.phone || claim.contact) && (claim.phone || claim.contact) !== "ไม่ระบุช่องทางติดต่อ" && (
                    <div style={{ fontSize: "11px", color: "var(--sc-info-fg)", marginTop: "2px" }}>
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
                {claim.postId && (
                  <button
                    onClick={() => openPostDetail(claim.postId, "โพสต์ของพบ")}
                    title="ดูรายละเอียดโพสต์ของพบ"
                    style={{
                      padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                      backgroundColor: "var(--bg-card)", color: "var(--fg-strong)", fontSize: "12px", fontWeight: 700,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                    }}
                  >
                    <FileText size={14} /> โพสต์
                  </button>
                )}
                <button
                  onClick={() => setDeleteTarget(claim)}
                  title="ลบรายการประวัตินี้"
                  style={{
                    padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--sc-danger-border)",
                    backgroundColor: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)", fontSize: "12px", fontWeight: 700,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                  }}
                >
                  <Trash2 size={14} /> ลบ
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* Detail Modal (อ่านอย่างเดียว) */}
      <ReviewSheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="รายละเอียดประวัติ"
        subtitle={selected?.postTitle}
        badge={selected ? getStatusBadge(selected) : undefined}
        maxWidth={860}
        footer={
          <>
            {selected && (
              <>
                {selected.postId && (
                  <SheetButton
                    tone="neutral"
                    icon={FileText}
                    onClick={() => openPostDetail(selected.postId, "โพสต์ของพบ")}
                  >
                    ดูโพสต์ของพบ
                  </SheetButton>
                )}
                {selected.matchedPostId && (
                  <SheetButton
                    tone="neutral"
                    icon={FileText}
                    onClick={() => openPostDetail(selected.matchedPostId, "โพสต์ของหาย")}
                  >
                    ดูโพสต์ของหาย
                  </SheetButton>
                )}
                <SheetButton tone="danger" icon={Trash2} onClick={() => setDeleteTarget(selected)}>
                  ลบประวัติ
                </SheetButton>
              </>
            )}
            <SheetButton onClick={() => setSelected(null)}>ปิด</SheetButton>
          </>
        }
      >
        {selected && (
          <>
            <ReviewImage src={selected.postImageUrl} alt="รูปโพสต์" onZoom={setSelectedZoom} />

            {/* รูปหลักฐานจากผู้ขอ — แสดงเฉพาะรายการที่อนุมัติเท่านั้น
                (requirement: รายการที่ถูกปฏิเสธไม่ต้องแสดงรูปหลักฐาน) */}
            {selected.status === "approved" && selected.evidenceUrl && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{
                  fontSize: "12px", fontWeight: 700, color: "var(--fg-muted)",
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <ShieldCheck size={14} /> รูปหลักฐานที่ผู้ขอแนบ
                </div>
                <ReviewImage src={selected.evidenceUrl} alt="รูปหลักฐาน" onZoom={setSelectedZoom} />
              </div>
            )}

            {/* หลักฐานการส่งมอบ — รูปที่แอดมินถ่ายตอนกดอนุมัติ */}
            {selected.status === "approved" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{
                  fontSize: "12px", fontWeight: 700, color: "var(--sc-ok-fg)",
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <Camera size={14} /> หลักฐานการส่งมอบ (ถ่ายโดยแอดมิน)
                </div>
                {selectedHandover?.photoUrl ? (
                  <>
                    <ReviewImage
                      src={selectedHandover.photoUrl}
                      alt="หลักฐานการส่งมอบ"
                      onZoom={setSelectedZoom}
                    />
                    {selectedHandover.capturedAt && (
                      <div style={{ fontSize: "11.5px", color: "var(--fg-muted)" }}>
                        ถ่ายเมื่อ {formatTime(selectedHandover.capturedAt) || selectedHandover.capturedAt}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{
                    padding: "12px 14px", backgroundColor: "var(--sc-warn-bg)",
                    border: "1px solid var(--sc-warn-border)", borderRadius: "12px",
                    fontSize: "12.5px", color: "var(--sc-warn-fg)", lineHeight: 1.6,
                    display: "flex", alignItems: "flex-start", gap: "8px",
                  }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                    <span>ไม่พบรูปหลักฐานการส่งมอบ (อาจเป็นรายการที่อนุมัติก่อนมีระบบนี้)</span>
                  </div>
                )}
              </div>
            )}

            {/* รายการที่ "คืนของแล้ว" → โพสต์พบ + โพสต์หายที่ผู้ขอเลือก แสดงคู่กัน
                (ถ้าคำขอไม่ได้เลือกโพสต์ของหาย จะไม่ดึงและไม่แสดงฝั่งนั้น)
                รายการที่ปฏิเสธ → แสดงตามปกติ ไม่ดึงโพสต์มาแสดงคู่ */}
            {selected.status === "approved" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{
                  fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <PackageCheck size={14} />
                  คืนของแล้ว — ดูโพสต์ทั้งสองฝั่ง
                  {selected.matchedPostId && (
                    <span style={{ color: "var(--fg-faint)", fontWeight: 600 }}>(โพสต์พบ + โพสต์หายที่ผู้ขอเลือก)</span>
                  )}
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "12px",
                }}>
                  {selectedPosts?.found ? (
                    <PairedPostCard
                      post={selectedPosts.found}
                      label="โพสต์ของพบ"
                      onOpen={() => openPostDetail(selected.postId, "โพสต์ของพบ")}
                    />
                  ) : (
                    <div style={{
                      padding: "14px", borderRadius: "12px", border: "1px dashed var(--border-strong)",
                      fontSize: "12px", color: "var(--fg-muted)", display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                      {selected.postId ? "กำลังโหลดโพสต์ของพบ..." : "ไม่พบโพสต์ของพบ (ถูกลบไปแล้ว)"}
                    </div>
                  )}
                  {selected.matchedPostId && (
                    selectedPosts?.lost ? (
                      <>
                        <PairedPostCard
                          post={selectedPosts.lost}
                          label="โพสต์ของหายที่ผู้ขอเลือก"
                          onOpen={() => openPostDetail(selected.matchedPostId, "โพสต์ของหาย")}
                        />
                        {/* เคสที่อนุมัติไปแล้วแต่โพสต์หายยังไม่ถูกปิด (ของอนุมัติก่อนมีระบบนี้ หรือตอนกฎยังไม่ deploy) */}
                        {selectedPosts.lost.status !== "returned_matched" && (
                          <div style={{
                            gridColumn: "1 / -1",
                            padding: "12px 14px", borderRadius: "12px",
                            backgroundColor: "var(--sc-warn-bg)", border: "1px solid var(--sc-warn-border)",
                            fontSize: "12.5px", color: "var(--sc-warn-fg)", lineHeight: 1.65,
                            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
                          }}>
                            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: "200px" }}>
                              คืนของแล้วแต่โพสต์ของหายฝั่งนี้ยังไม่ถูกปิด — ตอนนี้ยังขึ้นอยู่ในหน้า Home
                            </span>
                            <button
                              onClick={() => handleCloseMatchedPost(selected, selected.matchedPostId as string)}
                              disabled={closingPostId === selected.matchedPostId}
                              style={{
                                padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--sc-warn-border)",
                                backgroundColor: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)", fontSize: "12px",
                                fontWeight: 700, cursor: closingPostId === selected.matchedPostId ? "wait" : "pointer",
                                display: "flex", alignItems: "center", gap: "6px", opacity: closingPostId === selected.matchedPostId ? 0.6 : 1,
                              }}
                            >
                              {closingPostId === selected.matchedPostId ? (
                                <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> กำลังปิด...</>
                              ) : (
                                <><PackageCheck size={14} /> ปิดโพสต์ของหาย</>
                              )}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{
                        padding: "14px", borderRadius: "12px", border: "1px dashed var(--border-strong)",
                        fontSize: "12px", color: "var(--fg-muted)", display: "flex", alignItems: "center", gap: "8px",
                      }}>
                        {selectedPosts
                          ? "ไม่พบโพสต์ของหาย (ถูกลบไปแล้ว)"
                          : <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> กำลังโหลดโพสต์ของหาย...</>}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            <div style={{
              fontSize: "21px",
              fontWeight: 800,
              color: "var(--fg)",
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}>
              {selected.postTitle}
            </div>

            <div style={{
              display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
              padding: "11px 13px", borderRadius: "12px",
              border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
            }}>
              <span style={{
                fontSize: "12px", fontWeight: 700, color: "var(--sc-info-fg)",
                display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
              }}>
                <User size={14} /> ผู้ขอรับของ
              </span>
              <UserIdentity
                uid={selected.claimantId}
                name={selected.claimantName}
                email={selected.email}
                onOpen={(uid) => setQuickUserId(uid)}
                size="sm"
              />
            </div>

            <InfoGrid>
              <InfoRow icon={User} label="ผู้ขอรับของ" value={selected.claimantName || "-"} color="var(--sc-info-fg)" />
              <InfoRow
                icon={GraduationCap}
                label="ประเภทผู้ขอ"
                value={selected.claimType === "student" ? "นิสิตและบุคลากร" : "บุคคลทั่วไป"}
                color={selected.claimType === "student" ? "var(--sc-info-fg)" : "var(--sc-warn-fg)"}
                bg={selected.claimType === "student" ? "var(--sc-info-bg)" : "var(--sc-warn-bg)"}
              />
              {selected.matchedPostId && (
                <InfoRow
                  icon={Link2}
                  label="จับคู่กับโพสต์ของหายของผู้ขอ"
                  value={selected.matchedPostTitle || selected.matchedPostId}
                  color="var(--sc-ok-fg)"
                  bg="var(--sc-ok-bg)"
                />
              )}
              {selected.studentId && (
                <InfoRow icon={IdCard} label="รหัสนิสิต" value={selected.studentId} color="var(--sc-info-fg)" bg="var(--sc-info-bg)" />
              )}
              {((selected.phone || selected.contact) && (selected.phone || selected.contact) !== "ไม่ระบุช่องทางติดต่อ") && (
                <InfoRow icon={ShieldCheck} label="เบอร์โทร / ช่องทางติดต่อ" value={selected.phone || selected.contact} />
              )}
              {selected.email && (
                <InfoRow icon={Mail} label="อีเมล" value={selected.email} />
              )}
              {selected.depositLocation && (
                <InfoRow icon={MapPin} label="จุดฝาก / คืน" value={selected.depositLocation} />
              )}
              <InfoRow
                icon={Clock}
                label="ยื่นคำขอเมื่อ"
                value={formatTime(selected.createdAt) || "-"}
                color="var(--sc-warn-fg)"
                bg="var(--sc-warn-bg)"
              />
              <InfoRow
                icon={CheckCircle2}
                label="จบ (ส่งมอบ/ปิด) เมื่อ"
                value={resolveTime(selected.reviewedAt) ? formatTime(selected.reviewedAt) : "-"}
                color="var(--sc-brand-fg)"
                bg="var(--sc-muted-bg)"
              />
              {selected.pickupDate && (
                <InfoRow icon={Clock} label="นัดรับของ" value={selected.pickupDate} />
              )}
              {selected.expiresAt && (
                <InfoRow icon={Clock} label="หมดอายุคำขอ" value={selected.expiresAt} color="var(--sc-danger-fg)" bg="var(--sc-danger-bg)" />
              )}
              <InfoRow icon={IdCard} label="ID คำขอ" value={selected.id} />
            </InfoGrid>

            {selected.note && (
              <div style={{
                padding: "12px 14px",
                background: "var(--sc-muted-bg)",
                border: "1px solid var(--sc-muted-border)",
                borderRadius: "12px",
                fontSize: "14.5px",
                lineHeight: 1.7,
                color: "var(--fg-strong)",
                wordBreak: "break-word",
              }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-muted)", marginBottom: "4px" }}>
                  รายละเอียดจากผู้ขอ
                </div>
                {selected.note}
              </div>
            )}

            {selected.status === "rejected" && selected.rejectReason && (
              <div style={{
                padding: "12px 14px", backgroundColor: "var(--sc-danger-bg)", borderRadius: "12px",
                fontSize: "14.5px", color: "var(--sc-danger-fg-strong)", lineHeight: 1.7,
                border: "1px solid var(--sc-danger-border)",
                wordBreak: "break-word",
              }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--sc-danger-fg)", marginBottom: "4px" }}>
                  เหตุผลการปิดคำขอ
                </div>
                {selected.rejectReason}
              </div>
            )}
          </>
        )}
      </ReviewSheet>
      <ImageLightbox src={selectedZoom} onClose={() => setSelectedZoom(null)} />

      {/* รายละเอียดโพสต์แบบเต็ม (เปิดจากประวัติ — ทั้งโพสต์พบและโพสต์หาย) */}
      {postDetail && (
        <ReviewSheet
          open
          onClose={() => { setPostDetail(null); setPostDetailZoom(null); }}
          title={postDetail.label}
          subtitle={postDetail.post.title}
          zIndex={340}
          maxWidth={720}
          footer={
            <SheetButton
              tone="neutral"
              onClick={() => { setPostDetail(null); setPostDetailZoom(null); }}
            >
              <X size={18} /> ปิด
            </SheetButton>
          }
        >
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{
              fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "7px",
              backgroundColor: postDetail.post.itemType === "lost" ? "var(--sc-warn-bg)" : "var(--sc-ok-bg)",
              color: postDetail.post.itemType === "lost" ? "var(--sc-warn-fg)" : "var(--sc-ok-fg)",
            }}>
              {postDetail.post.itemType === "lost" ? "โพสต์ของหาย" : "โพสต์ของพบ"}
            </span>
            <span style={{
              fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "7px",
              backgroundColor: postStatusMeta(postDetail.post.status).bg,
              color: postStatusMeta(postDetail.post.status).fg,
            }}>
              {postStatusMeta(postDetail.post.status).label}
            </span>
            <span style={{ fontSize: "11px", color: "var(--fg-faint)", fontFamily: "'SF Mono', monospace" }}>
              ID: {postDetail.post.id}
            </span>
          </div>

          <ReviewImage
            src={postDetail.post.imageUrl}
            images={getPostImages(postDetail.post)}
            alt={postDetail.post.title}
            onZoom={(src) => setPostDetailZoom(src)}
          />

          {postDetail.post.desc && (
            <div style={{
              padding: "14px 16px", backgroundColor: "var(--bg-subtle)", borderRadius: "12px",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <FileText size={14} /> รายละเอียด
              </div>
              <div style={{
                fontSize: "14.5px", color: "var(--fg-secondary)", lineHeight: 1.75,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {postDetail.post.desc}
              </div>
            </div>
          )}

          <div style={{
            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
            padding: "11px 13px", borderRadius: "12px",
            border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
          }}>
            <span style={{
              fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
              display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
            }}>
              <User size={14} /> ผู้แจ้ง / เจ้าของโพสต์
            </span>
            <UserIdentity
              uid={postDetail.post.userId || postDetail.post.uid}
              name={postDetail.post.reporterName || postDetail.post.reporter}
              onOpen={(uid) => setQuickUserId(uid)}
              size="sm"
            />
          </div>

          <PostFactsGrid post={postDetail.post} />
        </ReviewSheet>
      )}

      <ImageLightbox
        src={postDetailZoom}
        images={postDetail ? getPostImages(postDetail.post) : null}
        onClose={() => setPostDetailZoom(null)}
      />

      {/* ยืนยันลบรายการประวัติ */}
      {deleteTarget && (
        <ConfirmModal
          open
          title="ยืนยันลบรายการประวัติ"
          message={`ลบประวัติคำขอของ "${deleteTarget.claimantName || deleteTarget.postTitle || "ไม่ระบุชื่อ"}"? รายการนี้จะหายจากประวัติถาวร (โพสต์และหลักฐานที่เกี่ยวข้องยังอยู่)`}
          confirmText="ลบรายการ"
          variant="danger"
          busy={deleting}
          onConfirm={() => handleDeleteHistory(deleteTarget)}
          onCancel={() => !deleting && setDeleteTarget(null)}
        />
      )}

      {/* ทางลัดดู/จัดการผู้ใช้ — เปิดจากชื่อหรืออีเมลในประวัติ */}
      <AdminUserSheet
        userId={quickUserId}
        onClose={() => setQuickUserId(null)}
        zIndex={320}
        canManage={isSuper}
        onManageUsers={onManageUsers}
      />
    </div>
  );
}

/* ================================================
   SECTION 3: MANAGE POSTS
   ================================================ */
function AdminPosts({
  posts,
  isSuper,
  onManageUsers,
}: {
  posts: PostItem[];
  isSuper?: boolean;
  onManageUsers?: (uid: string) => void;
}) {
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
  // ทางลัดดู/จัดการผู้ใช้ — กดที่ชื่อหรืออีเมลของเจ้าของโพสต์ได้เลย
  const [quickUserId, setQuickUserId] = useState<string | null>(null);

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
                      <UserLink
                        value={post.reporterName}
                        fallback="ไม่ระบุชื่อ"
                        onClick={post.userId || post.uid ? () => setQuickUserId((post.userId || post.uid) as string) : undefined}
                      />{" "}
                      · {post.locationName || "-"}
                    </span>
                    {post.itemType === "found" && post.depositLocation && (
                      <span style={{
                        fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                        backgroundColor: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)", border: "1px solid var(--sc-ok-border)",
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
      <ReviewSheet
        open={Boolean(selectedPost)}
        onClose={() => { setSelectedPost(null); setPostDetailZoom(null); }}
        title="รายละเอียดโพสต์"
        subtitle={selectedPost?.title}
        badge={selectedPost ? (() => {
          const sl = statusLabel(selectedPost);
          return { label: sl.text, bg: sl.bg, color: sl.color };
        })() : undefined}
        maxWidth={720}
        footer={
          <>
            {selectedPost?.status === "under_investigation" && (
              <SheetButton onClick={() => handleUnhold(selectedPost)} tone="ok" icon={ShieldCheck}>
                ปลดอายัด
              </SheetButton>
            )}
            {selectedPost?.status === "suspended" && (
              <SheetButton onClick={() => handleRestore(selectedPost)} tone="ok" icon={RefreshCw}>
                กู้คืน
              </SheetButton>
            )}
            {selectedPost && selectedPost.status !== "suspended" && (
              <SheetButton onClick={() => handleSuspend(selectedPost)} tone="warn" icon={Ban}>
                ระงับ
              </SheetButton>
            )}
            {selectedPost && (
              <SheetButton
                onClick={() => handleDelete(selectedPost)}
                tone="danger"
                icon={Trash2}
                disabled={deletingId === selectedPost.id}
                full
              >
                {deletingId === selectedPost.id ? "กำลังลบ..." : "ลบโพสต์"}
              </SheetButton>
            )}
            <SheetButton onClick={() => { setSelectedPost(null); setPostDetailZoom(null); }} full>
              ปิด
            </SheetButton>
          </>
        }
      >
        {selectedPost && (
          <>
            <ReviewImage
              src={selectedPost.imageUrl}
              images={getPostImages(selectedPost)}
              alt="รูปโพสต์"
              onZoom={(src) => setPostDetailZoom(src)}
            />

            <div style={{
              fontSize: "12px",
              color: "var(--fg-faint)",
              fontFamily: "'SF Mono', monospace",
              wordBreak: "break-all",
            }}>
              ID: {selectedPost.id}
            </div>

            {selectedPost.desc && (
              <div style={{
                padding: "14px 16px", backgroundColor: "var(--bg-subtle)", borderRadius: "12px",
                border: "1px solid var(--border)",
              }}>
                <div style={{
                  fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                  marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <FileText size={14} /> รายละเอียด
                </div>
                <div style={{
                  fontSize: "14.5px",
                  color: "var(--fg-secondary)",
                  lineHeight: 1.75,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {selectedPost.desc}
                </div>
              </div>
            )}

            <div style={{
              display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
              padding: "11px 13px", borderRadius: "12px",
              border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
            }}>
              <span style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
              }}>
                <User size={14} /> ผู้แจ้ง / เจ้าของโพสต์
              </span>
              <UserIdentity
                uid={selectedPost.userId || selectedPost.uid}
                name={selectedPost.reporterName || selectedPost.reporter}
                onOpen={(uid) => setQuickUserId(uid)}
                size="sm"
              />
            </div>

            <PostFactsGrid post={selectedPost} />
          </>
        )}
      </ReviewSheet>

      {/* Lightbox: ดูรูปโพสต์ใหญ่ */}
        <ImageLightbox
          src={postDetailZoom}
          images={selectedPost ? getPostImages(selectedPost) : null}
          onClose={() => setPostDetailZoom(null)}
        />

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

      {/* ทางลัดดู/จัดการผู้ใช้ — เปิดจากชื่อหรืออีเมลของเจ้าของโพสต์ */}
      <AdminUserSheet
        userId={quickUserId}
        onClose={() => setQuickUserId(null)}
        zIndex={320}
        canManage={isSuper}
        onManageUsers={onManageUsers}
      />
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
  const [reportPreview, setReportPreview] = useState<PostItem | null>(null);
  const [reportZoom, setReportZoom] = useState<string | null>(null);
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

  // โหลดรูปเล็กของโพสต์ที่ถูกรายงาน เพื่อแสดง thumbnail ในกรอบรายงาน (ไม่เปิดกรอบเต็ม)
  useEffect(() => {
    const postId = selectedReport?.postId;
    if (!postId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "posts", postId));
        if (cancelled) return;
        if (!snap.exists()) return;
        setReportPreview({ id: snap.id, ...snap.data() } as PostItem);
      } catch (e) {
        console.error("Error fetching reported post preview:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedReport?.postId]);

  // thumbnail ใช้ได้เฉพาะเมื่อเป็นโพสต์ของรายงานที่เลือกอยู่จริง
  const reportPreviewPost =
    reportPreview && reportPreview.id === selectedReport?.postId ? reportPreview : null;
  const reportCover = reportPreviewPost ? getPostCover(reportPreviewPost) : null;

  // เปิดกรอบรายละเอียดโพสต์ที่ถูกรายงาน (กดจากปุ่ม "ตรวจสอบรายละเอียดโพสต์ฉบับเต็ม")
  const openReportPost = async (report: AdminReport) => {
    if (!report.postId) {
      showToast("ไม่พบโพสต์ที่เกี่ยวข้องกับรายงานนี้", "info");
      return;
    }
    try {
      const snap = await getDoc(doc(db, "posts", report.postId));
      if (snap.exists()) {
        setReportPost({ id: snap.id, ...snap.data() } as PostItem);
        setReportZoom(null);
      } else {
        setReportPost(null);
        setReportZoom(null);
        showToast("ไม่พบโพสต์นี้ (อาจถูกลบไปแล้ว)", "error");
      }
    } catch (e) {
      console.error("Error fetching reported post:", e);
      showToast("ไม่สามารถดึงข้อมูลโพสต์ได้", "error");
    }
  };

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

  const reportStatusMeta = (status?: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      open: { label: "เปิด", color: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)" },
      dismissed: { label: "ปิดแล้ว", color: "#6b7280", bg: "#1f1f2f" },
      post_deleted: { label: "ลบโพสต์แล้ว", color: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" },
      reporter_banned: { label: "แบนผู้รายงาน", color: "#ef4444", bg: "var(--sc-danger-bg)" },
      post_suspended: { label: "ระงับโพสต์แล้ว", color: "var(--sc-danger-fg)", bg: "var(--sc-danger-bg)" },
      post_held: { label: "อายัดชั่วคราว", color: "var(--sc-warn-fg)", bg: "var(--sc-warn-bg)" },
      closed: { label: "ปิดแล้ว (ตอบผู้ใช้แล้ว)", color: "#6b7280", bg: "#1f1f2f" },
    };
    return map[status || "open"] || map.open;
  };

  const statusBadge = (status?: string) => {
    const s = reportStatusMeta(status);
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
        borderRadius: 6, fontSize: 12, fontWeight: 700, color: s.color, backgroundColor: s.bg,
      }}>
        {s.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)" }}>
        <Loader2 size={32} color="var(--sc-danger-fg)" style={{ marginBottom: "12px", animation: "spin 1s linear infinite" }} />
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
          backgroundColor: "var(--sc-warn-bg)", border: "1px solid #4a3a18",
        }}>
          <div style={{ fontSize: "11px", color: "var(--sc-warn-fg)", fontWeight: 600 }}>เปิดอยู่</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--sc-warn-fg)", marginTop: 2 }}>{openCount}</div>
        </div>
        <div style={{
          flex: 1, padding: "12px 14px", borderRadius: "12px",
          backgroundColor: "var(--sc-ok-bg)", border: "1px solid var(--sc-ok-border)",
        }}>
          <div style={{ fontSize: "11px", color: "var(--sc-ok-fg)", fontWeight: 600 }}>จัดการแล้ว</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--sc-ok-fg)", marginTop: 2 }}>{resolvedCount}</div>
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
              setReportZoom(null);
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
                  borderRadius: 6, fontSize: 12, fontWeight: 700,
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
      <ReviewSheet
        open={Boolean(selectedReport)}
        onClose={() => setSelectedReport(null)}
        title="รายละเอียดรายงาน"
        subtitle={selectedReport ? formatDateShort(selectedReport.createdAt) : undefined}
        badge={selectedReport ? (() => {
          const s = reportStatusMeta(selectedReport.status);
          return { label: s.label, bg: s.bg, color: s.color };
        })() : undefined}
        zIndex={5000}
        maxWidth={720}
        footer={
          <>
            {selectedReport?.status === "open" && (
              <>
                <SheetButton onClick={() => handleDismiss(selectedReport)} icon={CheckCircle2}>
                  ปิดรายงาน (ไม่พบปัญหา)
                </SheetButton>
                {selectedReport.postId && kind === "post_report" && (
                  <SheetButton onClick={() => handleSuspendPost(selectedReport)} tone="warn" icon={Ban}>
                    ระงับชั่วคราว
                  </SheetButton>
                )}
                {selectedReport.postId && kind === "claim_dispute" && reportPost?.status !== "under_investigation" && (
                  <SheetButton onClick={() => handleHoldPost(selectedReport, true)} tone="warn" icon={ShieldAlert}>
                    อายัดชั่วคราว
                  </SheetButton>
                )}
                {selectedReport.postId && kind === "claim_dispute" && reportPost?.status === "under_investigation" && (
                  <SheetButton onClick={() => handleHoldPost(selectedReport, false)} tone="ok" icon={ShieldCheck}>
                    ปลดอายัด
                  </SheetButton>
                )}
                {selectedReport.postId && (
                  <SheetButton onClick={() => handleDeletePost(selectedReport)} tone="danger" icon={Trash2}>
                    ลบโพสต์
                  </SheetButton>
                )}
                <SheetButton onClick={() => handleBanReporter(selectedReport)} tone="danger" icon={Ban} full>
                  แบนผู้ใช้
                </SheetButton>
              </>
            )}
            <SheetButton onClick={() => setSelectedReport(null)} full>ปิด</SheetButton>
          </>
        }
      >
        {selectedReport && (
          <>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                color: kindMeta.color, backgroundColor: kindMeta.bg,
              }}>
                {kindMeta.label}
              </span>
            </div>

            {selectedReport.postId ? (
              <>
                {/* รูปเล็ก + ข้อมูลโพสต์ที่ถูกรายงาน */}
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: "12px",
                  padding: "12px 14px", borderRadius: "12px",
                  backgroundColor: "var(--bg-subtle)", border: "1px solid var(--border)",
                }}>
                  {reportCover ? (
                    <img
                      src={reportCover}
                      alt=""
                      style={{
                        width: "72px", height: "72px", borderRadius: "10px",
                        objectFit: "cover", flexShrink: 0,
                        border: "1px solid var(--border)",
                      }}
                    />
                  ) : (
                    <div style={{
                      width: "72px", height: "72px", borderRadius: "10px", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      backgroundColor: "var(--bg-hover)", border: "1px solid var(--border)",
                    }}>
                      <FileText size={20} color="var(--fg-faint)" />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-muted)" }}>
                      โพสต์ที่ถูกรายงาน
                    </div>
                    <div style={{
                      fontSize: "14.5px", fontWeight: 700, color: "var(--fg-strong)",
                      lineHeight: 1.5, wordBreak: "break-word", marginTop: 2,
                    }}>
                      {selectedReport.postTitle || reportPreviewPost?.title || "-"}
                    </div>
                    <div style={{
                      fontSize: "12.5px", fontWeight: 600, color: "var(--fg-secondary)",
                      marginTop: "4px", lineHeight: 1.5,
                    }}>
                      {reportPreviewPost?.itemType === "found"
                        ? "พบของ"
                        : reportPreviewPost?.itemType === "lost"
                          ? "ของหาย"
                          : selectedReport.postType === "lost" ? "ของหาย" : "พบของ"}
                    </div>
                    <div style={{
                      fontSize: "12px", color: "var(--fg-faint)", marginTop: "4px",
                      fontFamily: "'SF Mono', monospace", wordBreak: "break-all",
                    }}>
                      ID: {selectedReport.postId}
                    </div>
                  </div>
                </div>

                <SheetButton
                  tone="neutral"
                  onClick={() => openReportPost(selectedReport)}
                >
                  <Eye size={18} /> ตรวจสอบรายละเอียดโพสต์ฉบับเต็ม
                </SheetButton>
              </>
            ) : (
              <InfoRow
                icon={Flag}
                label="หัวข้อ"
                value={selectedReport.category || "-"}
              />
            )}

            <InfoGrid>
              <InfoRow icon={User} label="ผู้รายงาน" value={selectedReport.reporterName || "-"} />
              <InfoRow
                icon={Flag}
                label="หมวดหมู่"
                value={selectedReport.category || "-"}
                color="var(--sc-danger-fg)"
                bg="var(--sc-danger-bg)"
              />
            </InfoGrid>

            <div>
              <div style={{ fontSize: "12px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: "6px" }}>
                รายละเอียด
              </div>
              <div style={{
                fontSize: "15px", color: "var(--fg-secondary)", lineHeight: 1.75,
                padding: "12px 14px", borderRadius: "12px", backgroundColor: "var(--bg-hover)",
                border: "1px solid var(--border)", whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {selectedReport.detail || "ไม่มีรายละเอียด"}
              </div>
            </div>

            {(selectedReport.reporterId || selectedReport.userId) && (
              <div style={{
                display: "flex", flexDirection: "column", gap: "8px",
                padding: "12px", borderRadius: "12px",
                backgroundColor: "var(--sc-ok-bg)", border: "1px solid var(--sc-ok-border)",
              }}>
                <div style={{ fontSize: "12.5px", color: "var(--sc-ok-fg)", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  <Reply size={14} /> ตอบกลับผู้ใช้
                </div>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  placeholder="พิมพ์ข้อความตอบกลับ (เช่น แจ้งผลการตรวจสอบ สอบถามข้อมูลเพิ่มเติม)..."
                  style={{
                    width: "100%", boxSizing: "border-box", borderRadius: "10px", padding: "10px 12px",
                    border: "1px solid var(--border)", background: "var(--bg-card)",
                    color: "var(--fg)", fontSize: "14px", lineHeight: 1.6,
                    resize: "vertical", outline: "none", fontFamily: "inherit",
                  }}
                />
                <button
                  onClick={handleReply}
                  disabled={!replyText.trim()}
                  style={{
                    minHeight: "48px", padding: "0 16px", borderRadius: "12px",
                    border: "none", background: "#1aa05f", color: "#ffffff",
                    fontSize: "14.5px", fontWeight: 700, cursor: replyText.trim() ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    opacity: replyText.trim() ? 1 : 0.5,
                  }}
                >
                  <Send size={16} /> ส่งคำตอบกลับไปยังผู้ใช้
                </button>
              </div>
            )}
          </>
        )}
      </ReviewSheet>

      {/* กรอบรายละเอียดโพสต์ที่ถูกรายงาน (เปิดจากปุ่ม "ตรวจสอบรายละเอียดโพสต์ฉบับเต็ม") */}
      {reportPost && (
        <ReviewSheet
          open
          onClose={() => { setReportPost(null); setReportZoom(null); }}
          title="รายละเอียดโพสต์ที่ถูกรายงาน"
          subtitle={reportPost.title}
          badge={(() => {
            const sl = statusLabel(reportPost);
            return { label: sl.text, bg: sl.bg, color: sl.color };
          })()}
          zIndex={5010}
          footer={
            <SheetButton
              tone="neutral"
              onClick={() => { setReportPost(null); setReportZoom(null); }}
            >
              <X size={18} /> ปิด
            </SheetButton>
          }
        >
          <ReviewImage
            src={reportPost.imageUrl}
            images={getPostImages(reportPost)}
            alt={reportPost.title}
            onZoom={setReportZoom}
          />

          {/* ID ของโพสต์ */}
          <div style={{
            fontSize: "12px",
            color: "var(--fg-faint)",
            fontFamily: "'SF Mono', monospace",
            wordBreak: "break-all",
          }}>
            ID: {reportPost.id}
          </div>

          {/* รายละเอียด */}
          {reportPost.desc && (
            <div style={{
              padding: "14px 16px", backgroundColor: "var(--bg-subtle)", borderRadius: "12px",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                fontSize: "12px", fontWeight: 700, color: "var(--fg-accent)",
                marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px",
              }}>
                <FileText size={14} /> รายละเอียด
              </div>
              <div style={{
                fontSize: "14.5px",
                color: "var(--fg-secondary)",
                lineHeight: 1.75,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {reportPost.desc}
              </div>
            </div>
          )}

          {/* ข้อมูลตัวเลขและสถานะ */}
          {(() => {
            const sl = statusLabel(reportPost);
            return (
              <InfoGrid>
                <InfoRow
                  icon={ShieldAlert}
                  label="สถานะโพสต์"
                  value={(
                    <span style={{
                      fontSize: "12px", fontWeight: 700, padding: "2px 8px",
                      borderRadius: "6px", backgroundColor: sl.bg, color: sl.color,
                    }}>
                      {sl.text}
                    </span>
                  )}
                />
                <InfoRow
                  icon={PackageSearch}
                  label="ประเภทโพสต์"
                  value={reportPost.itemType === "found" ? "ของที่พบ" : "ของหาย"}
                />
                <InfoRow icon={MapPin} label="สถานที่" value={reportPost.locationName || "-"} />
                {reportPost.itemType === "found" && (
                  <InfoRow
                    icon={ShieldAlert}
                    label="จุดฝาก/คืน"
                    value={reportPost.depositLocation || "ไม่ระบุ"}
                    color="var(--sc-ok-fg)"
                    bg="var(--sc-ok-bg)"
                  />
                )}
                <InfoRow icon={User} label="ผู้แจ้ง" value={reportPost.reporterName || "-"} />
                <InfoRow
                  icon={Clock}
                  label="วันที่ / เวลาโพสต์"
                  value={[
                    formatDateShort(reportPost.date),
                    formatClockTime(reportPost.createdAt),
                  ].filter(Boolean).join(" ") || "-"}
                />
              </InfoGrid>
            );
          })()}
        </ReviewSheet>
      )}

      {/* Lightbox: ดูรูปโพสต์ใหญ่ (ต้องอยู่เหนือกรอบซ้อน zIndex 5010) */}
      {reportZoom && (
        <ImageLightbox
          src={reportZoom}
          images={getPostImages(reportPost)}
          onClose={() => setReportZoom(null)}
          zIndex={5020}
        />
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
function AdminUsers({
  users,
  focusUser,
}: {
  users: AdminUser[];
  focusUser?: AdminUser | null;
}) {
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

  // ทางลัด: มาจากการ์ดผู้ใช้ในแท็บอื่น → เปิดการ์ดของคนนั้นทันที (ข้อมูลผู้ใช้โหลดไว้ที่ฝั่งหน้าหลักแล้ว)
  const [displayFocusKey, setDisplayFocusKey] = useState<string | null>(null);
  const focusKey = focusUser ? `${focusUser.id}|${focusUser.name ?? ""}|${focusUser.banned ? 1 : 0}` : null;
  if (displayFocusKey !== focusKey) {
    setDisplayFocusKey(focusKey);
    if (focusUser) setSelectedUser(focusUser);
  }

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
        padding: "10px 12px", backgroundColor: "var(--sc-info-bg)", border: "1px solid var(--sc-info-border)",
        borderRadius: "10px", fontSize: "12px", color: "var(--sc-info-fg)",
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
            border: user.banned ? "1.5px solid var(--sc-danger-border)" : "1px solid var(--border)",
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
                  backgroundColor: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)",
                }}>
                  ถูกแบน
                </span>
              )}
            </div>
          </div>
        ))
      )}

      {/* User Detail Modal */}
      <ReviewSheet
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        title="รายละเอียดผู้ใช้"
        subtitle={selectedUser?.name || "ไม่ระบุชื่อ"}
        badge={selectedUser ? (selectedUser.banned
          ? { label: "บัญชีถูกระงับ", bg: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)" }
          : { label: "ปกติ", bg: "var(--sc-ok-bg)", color: "var(--sc-ok-fg)" }) : undefined}
        maxWidth={720}
        footer={
          <>
            {selectedUser?.banned ? (
              <SheetButton onClick={() => handleUnban(selectedUser)} tone="ok" icon={ShieldCheck}>
                ปลดแบน
              </SheetButton>
            ) : selectedUser ? (
              <SheetButton onClick={() => handleBan(selectedUser)} tone="danger" icon={Ban}>
                แบนผู้ใช้
              </SheetButton>
            ) : null}
            <SheetButton onClick={() => setSelectedUser(null)}>ปิด</SheetButton>
          </>
        }
      >
        {selectedUser && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <div style={{
                width: "64px", height: "64px", borderRadius: "50%", flexShrink: 0,
                background: selectedUser.banned
                  ? "linear-gradient(135deg, #dc2626, #ef4444)"
                  : "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--fg)", fontSize: "24px", fontWeight: 800,
                border: "3px solid var(--border-strong)", boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
              }}>
                {(selectedUser.name || selectedUser.email || "?").charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--fg)", wordBreak: "break-word" }}>
                  {selectedUser.name || "ไม่ระบุชื่อ"}
                </div>
                <div style={{ fontSize: "13.5px", color: "var(--fg-muted)", wordBreak: "break-all" }}>
                  {selectedUser.email || "-"}
                </div>
              </div>
            </div>

            <InfoGrid>
              <InfoRow icon={IdCard} label="User ID" value={selectedUser.id} />
              <InfoRow icon={Phone} label="เบอร์โทร" value={selectedUser.phone || "-"} />
              <InfoRow icon={Clock} label="เข้าร่วมเมื่อ" value={selectedUser.createdAt || "-"} />
              <InfoRow
                icon={selectedUser.banned ? Ban : ShieldCheck}
                label="สถานะ"
                value={selectedUser.banned ? "ถูกแบน" : "ปกติ"}
                color={selectedUser.banned ? "var(--sc-danger-fg)" : "var(--sc-ok-fg)"}
                bg={selectedUser.banned ? "var(--sc-danger-bg)" : "var(--sc-ok-bg)"}
              />
            </InfoGrid>

            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "8px" }}>
                โพสต์ของผู้ใช้ <span style={{ color: "var(--fg-accent)" }}>({userPosts.length})</span>
              </div>
              {userPosts.length === 0 ? (
                <div style={{ fontSize: "13px", color: "var(--fg-faint)", padding: "10px 0" }}>ยังไม่มีโพสต์</div>
              ) : (
                <div style={{
                  maxHeight: "220px", overflowY: "auto", borderRadius: "12px",
                  border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
                }}>
                  {userPosts.slice(0, 10).map((p) => (
                    <div key={p.id} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "10px 12px", borderBottom: "1px solid var(--border)",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--fg)", wordBreak: "break-word" }}>
                          {p.title}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--fg-faint)", wordBreak: "break-all" }}>
                          {p.itemType === "lost" ? "ของหาย" : "พบของ"} · {p.id}
                        </div>
                      </div>
                      <span style={{
                        flexShrink: 0, fontSize: "12px", fontWeight: 700, padding: "3px 9px", borderRadius: "7px",
                        color: p.status === "resolved" ? "var(--sc-ok-fg)"
                          : p.status === "suspended" ? "var(--sc-danger-fg)"
                          : p.status === "under_investigation" ? "var(--sc-warn-fg)"
                          : p.status === "in_progress" ? "var(--sc-info-fg)" : "var(--sc-ok-fg)",
                        backgroundColor: p.status === "resolved" ? "var(--sc-ok-bg)"
                          : p.status === "suspended" ? "var(--sc-danger-bg)"
                          : p.status === "under_investigation" ? "var(--sc-warn-bg)"
                          : p.status === "in_progress" ? "var(--sc-info-bg)" : "var(--sc-ok-bg)",
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
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "8px" }}>
                คำขอรับของ <span style={{ color: "var(--sc-warn-fg)" }}>({userClaims.length})</span>
              </div>
              {userClaims.length === 0 ? (
                <div style={{ fontSize: "13px", color: "var(--fg-faint)", padding: "10px 0" }}>ยังไม่เคยยื่นคำขอ</div>
              ) : (
                <div style={{
                  maxHeight: "220px", overflowY: "auto", borderRadius: "12px",
                  border: "1px solid var(--border)", backgroundColor: "var(--bg-hover)",
                }}>
                  {userClaims.slice(0, 10).map((c) => {
                    const b = getStatusBadge(c);
                    return (
                      <div key={c.id} style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 12px", borderBottom: "1px solid var(--border)",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--fg)", wordBreak: "break-word" }}>
                            {c.postTitle || "โพสต์ไม่ระบุชื่อ"}
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--fg-faint)", wordBreak: "break-all" }}>
                            {formatDateShort(c.createdAt) || "-"} · {c.id}
                          </div>
                        </div>
                        <span style={{
                          flexShrink: 0, fontSize: "12px", fontWeight: 700, padding: "3px 9px",
                          borderRadius: "7px", color: b.color, backgroundColor: b.bg,
                        }}>
                          {b.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </ReviewSheet>

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
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", backgroundColor: "var(--sc-muted-bg)", border: "1px solid var(--sc-muted-border)", borderRadius: "12px" }}>
        <ShieldCheck size={16} color="#7c5cfc" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: "12px", color: "var(--sc-brand-fg)", lineHeight: 1.5 }}>
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
                      <span style={{ fontSize: "10px", color: "var(--sc-danger-fg)", fontWeight: 700, marginLeft: 6 }}>(ปิดอยู่)</span>
                    )}
                  </span>
                  <button onClick={() => startRename(p)} disabled={busy} title="เปลี่ยนชื่อ" style={{ padding: "5px 9px", borderRadius: "7px", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--fg-secondary)", cursor: "pointer" }}>
                    <RefreshCw size={13} />
                  </button>
                  <button onClick={() => deactivatePoint(p)} disabled={busy} title={p.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"} style={{ padding: "5px 9px", borderRadius: "7px", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--fg-secondary)", cursor: "pointer" }}>
                    {p.active === false ? <CheckCircle2 size={13} /> : <X size={13} />}
                  </button>
                  <button onClick={() => deletePoint(p)} disabled={busy} title="ลบจุดคืน" style={{ padding: "5px 9px", borderRadius: "7px", border: "1px solid var(--sc-danger-border)", background: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)", cursor: "pointer" }}>
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
                  <button onClick={() => removeAdmin(a)} disabled={busy} title="ถอดสิทธิ์" style={{ padding: "6px 10px", borderRadius: "7px", border: "1px solid var(--sc-danger-border)", background: "var(--sc-danger-bg)", color: "var(--sc-danger-fg)", cursor: "pointer", fontSize: "11px", fontWeight: 700 }}>
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
