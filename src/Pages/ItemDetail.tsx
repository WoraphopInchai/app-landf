import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  MapPin,
  Clock,
  User,
  MessageCircle,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Flag,
  X,
  Send,
  Navigation,
  Trash2,
  PackageCheck,
  Maximize2,
  ZoomIn,
  ImagePlus,
  GraduationCap,
  Users,
  Sparkles,
  Pencil,
  FileText,
  Search,
  ChevronDown,
  Lock,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Mail,
  Loader2,
  Package,
  Calendar,
  AlertCircle,
} from "lucide-react";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  addDoc,
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { confirmAiPair } from "../lib/aiMatch";
import { db } from "../firebase";
import { uploadToCloudinary, uploadManyToCloudinary } from "../lib/uploadImage";
import {
  CLAIM_ROLE_LABEL,
  resolveClaimRole,
  sessionEmail,
  sessionName,
  toLocalDateTimeInput,
} from "../lib/claimRole";
import { getPostImages, getPostCover, MAX_POST_IMAGES, validateImageFile } from "../lib/postImages";
import { isCurrentUserBanned } from "../lib/userGuard";
import { ITEM_CATEGORIES, UP_LOCATIONS } from "../constants";
import type { AppUser, PostItem, FirestoreTimeLike } from "../types";
import { showToast } from "../lib/toast";
import ToastContainer from "../components/Toast";
import Dialog, { DialogButton } from "../components/Dialog";

// แปลงเวลาจาก Firestore ให้เป็น millisecond (รองรับ Timestamp / Date / string)
// ต้องใช้ตัวนี้แทน new Date(...) เพราะ createdAt ของโพสต์เป็น serverTimestamp() ไม่ใช่ string
const resolvePostTime = (t?: FirestoreTimeLike): number => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t !== "object") return new Date(t).getTime();
  if (typeof t.toDate === "function") return t.toDate().getTime();
  return 0;
};

// จุดรับของเปิดรับนัดเฉพาะช่วงเช้า 07:00-16:00
const PICKUP_OPEN_HOUR = 7;
const PICKUP_CLOSE_MIN = 16 * 60;
// นัดได้ไม่เกิน 3 วันนับรวมวันนี้ (วันนี้, พรุ่งนี้, อีก 1 วัน)
const PICKUP_LAST_DAY_OFFSET = 2;

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** เวลานัดอยู่ในช่วงที่จุดรับของเปิดไหม (07:00-16:00) */
const isPickupTimeAllowed = (d: Date) => {
  const m = minutesOfDay(d);
  return m >= PICKUP_OPEN_HOUR * 60 && m <= PICKUP_CLOSE_MIN;
};

/** วันสุดท้ายที่นัดได้ (วันนี้ + 2 วัน เวลา 16:00) */
const getPickupLastDay = (from?: Date) => {
  const d = from ? new Date(from) : new Date();
  d.setDate(d.getDate() + PICKUP_LAST_DAY_OFFSET);
  d.setHours(16, 0, 0, 0);
  return d;
};

/** บีบเวลาให้อยู่ใน 07:00-16:00 ของวันเดิม (ใช้ตอนผู้ใช้พิมพ์เวลาเอง) */
const clampPickupTimeOfDay = (d: Date) => {
  const out = new Date(d);
  const m = minutesOfDay(out);
  if (m < PICKUP_OPEN_HOUR * 60) out.setHours(PICKUP_OPEN_HOUR, 0, 0, 0);
  else if (m > PICKUP_CLOSE_MIN) out.setHours(16, 0, 0, 0);
  return out;
};

/** ถ้าเวลาที่ได้อยู่นอก 07:00-16:00 ให้ขยับไปวันถัดไปตอนเปิด (ใช้ตอนเลือกว่าจะนัดวันไหน) */
const moveToNextOpenDay = (d: Date) => {
  d.setDate(d.getDate() + 1);
  d.setHours(PICKUP_OPEN_HOUR, 0, 0, 0);
  return d;
};

// ช่วงเวลาที่เลือกนัดรับของได้ (คำนวณใหม่ทุกครั้งที่เปิดฟอร์ม และใช้เวลาท้องถิ่น)
const getPickupWindow = () => {
  const earliest = new Date(Date.now() + 60 * 60 * 1000);
  // เริ่มนัดได้ไม่ก่อน 1 ชั่วโมงนับจากตอนนี้ และต้องอยู่ในช่วง 07:00-16:00
  let min = clampPickupTimeOfDay(earliest);
  if (minutesOfDay(earliest) > PICKUP_CLOSE_MIN) min = moveToNextOpenDay(new Date(earliest));
  return {
    min: toLocalDateTimeInput(min),
    max: toLocalDateTimeInput(getPickupLastDay()),
  };
};

// แสดงวันเวลาที่เลือกนัดแบบอ่านง่าย (เช่น "พรุ่งนี้ 10:00" หรือ "ศ. 3 ต.ค. 10:00")
const formatPickupForDisplay = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, tomorrow)) return `พรุ่งนี้ ${hhmm}`;
  if (sameDay(d, new Date())) return `วันนี้ ${hhmm}`;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + ` ${hhmm}`;
};

// ─── ตัวเลือกวัน/ช่วงเวลาสำหรับ UI ใหม่ ────────────────────────────────────────
// ใช้ปุ่มกดแทน input date/time ของเบราว์เซอร์ เพราะตัวเลือกเวลาบนมือถือกดยากและเลือกนอกเวลาทำการได้
const PICKUP_SLOT_STEP_MIN = 30;
/** ช่วงเวลาที่กดได้ในหนึ่งวัน: 07:00 → 16:00 ทีละ 30 นาที */
const PICKUP_SLOT_MINUTES = (() => {
  const out: number[] = [];
  for (let m = PICKUP_OPEN_HOUR * 60; m <= PICKUP_CLOSE_MIN; m += PICKUP_SLOT_STEP_MIN) {
    out.push(m);
  }
  return out;
})();

const slotLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** ค่านัด "YYYY-MM-DDTHH:mm" ของวันนั้นในเวลา minutes-of-day */
const slotValueOn = (day: Date, m: number) => {
  const d = new Date(day);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return toLocalDateTimeInput(d);
};

/** วันที่นัดได้ทั้งหมด (วันนี้ → +2 วัน) พร้อมชื่อย่อและเช็คว่ายังมีช่วงเวลาว่างไหม */
const buildPickupDays = (minMs: number, maxMs: number) =>
  Array.from({ length: PICKUP_LAST_DAY_OFFSET + 1 }, (_, offset) => {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    day.setHours(0, 0, 0, 0);
    const key = slotValueOn(day, PICKUP_OPEN_HOUR * 60).slice(0, 10);
    const slots = PICKUP_SLOT_MINUTES.map((m) => slotValueOn(day, m));
    const free = slots.filter((v) => {
      const t = new Date(v).getTime();
      return t >= minMs && t <= maxMs;
    });
    return {
      key,
      offset,
      title: offset === 0 ? "วันนี้" : offset === 1 ? "พรุ่งนี้" : day.toLocaleDateString("th-TH", { weekday: "long" }),
      dateLabel: day.toLocaleDateString("th-TH", { day: "numeric", month: "short" }),
      hasFree: free.length > 0,
      firstFree: free[0] || null,
    };
  });

// ปิดคำขอรับของ pending + รายงาน open ของโพสต์ที่ผู้ใช้ลบเอง
const closeDataForDeletedPost = async (postId: string, postTitle?: string) => {
  const nowIso = new Date().toISOString();
  try {
    const pendingClaimants: Array<{ uid: string; claimId: string; title: string }> = [];

    const claimSnap = await getDocs(
      query(
        collection(db, "claims"),
        where("postId", "==", postId),
        where("status", "==", "pending")
      )
    );

    if (!claimSnap.empty) {
      const batch = writeBatch(db);
      claimSnap.docs.forEach((d) => {
        const data = d.data();
        batch.update(d.ref, {
          status: "post_deleted",
          reviewedAt: nowIso,
          rejectReason: "โพสต์ถูกลบ คำขอรับของจึงถูกยกเลิก",
        });
        if (data.claimantId) {
          pendingClaimants.push({
            uid: data.claimantId,
            claimId: d.id,
            title: postTitle || data.postTitle || "",
          });
        }
      });
      await batch.commit();
    }

    const reportSnap = await getDocs(
      query(
        collection(db, "reports"),
        where("postId", "==", postId),
        where("status", "==", "open")
      )
    );
    if (!reportSnap.empty) {
      const batch = writeBatch(db);
      reportSnap.docs.forEach((d) => batch.update(d.ref, { status: "post_deleted" }));
      await batch.commit();
    }

    pendingClaimants.forEach((c) => {
      addDoc(collection(db, "notifications"), {
        type: "claim_result",
        recipientUid: c.uid,
        status: "post_deleted",
        claimId: c.claimId,
        postId,
        postTitle: c.title,
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    });
  } catch (e) {
    console.error("Error closing data for deleted post:", e);
  }
};

const formatItemDate = (d?: FirestoreTimeLike): string => {
  if (!d) return "";
  const t =
    typeof d === "object" && typeof (d as { toDate?: () => Date }).toDate === "function"
      ? (d as { toDate: () => Date }).toDate().getTime()
      : new Date(d as string).getTime();
  if (isNaN(t)) return String(d);
  return new Date(t).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
};

// แสดงเวลาที่โพสต์ถูกสร้าง (เวลาโพสต์)
const formatItemTime = (d?: FirestoreTimeLike): string => {
  if (!d) return "";
  const t =
    typeof d === "object" && typeof (d as { toDate?: () => Date }).toDate === "function"
      ? (d as { toDate: () => Date }).toDate().getTime()
      : new Date(d as string).getTime();
  if (isNaN(t)) return String(d);
  return new Date(t).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
};

interface ItemDetailProps {
  item: PostItem;
  onBack: () => void;
  currentUser?: AppUser;
  onStartChat?: (item: PostItem) => void;
  // Guest mode: ยังไม่ล็อกอิน กดฟีเจอร์ที่ต้องใช้บัญชี → เปิดหน้าเข้าสู่ระบบ
  // (รับ action ที่ค้างไว้ เพื่อกลับมาทำต่อหลังล็อกอิน)
  onRequireLogin?: (afterLogin?: () => void) => void;
}

export default function ItemDetail({ item: initialItem, onBack, currentUser, onStartChat, onRequireLogin }: ItemDetailProps) {
  const [item, setItem] = useState<PostItem>(initialItem);
  const [prevItem, setPrevItem] = useState<PostItem>(initialItem);

  if (prevItem !== initialItem) {
    setPrevItem(initialItem);
    setItem(initialItem);
  }

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporterContact, setReporterContact] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editCategory, setEditCategory] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editNewFiles, setEditNewFiles] = useState<File[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editLocationOpen, setEditLocationOpen] = useState(false);
  const [editLocationSearch, setEditLocationSearch] = useState("");
  const editLocationDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        editLocationDropdownRef.current &&
        !editLocationDropdownRef.current.contains(event.target as Node)
      ) {
        setEditLocationOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimName, setClaimName] = useState("");
  const [claimPhone, setClaimPhone] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [claimEvidenceFile, setClaimEvidenceFile] = useState<File | null>(null);
  const [claimEvidenceUrl, setClaimEvidenceUrl] = useState<string>("");
  const [claimPickupDate, setClaimPickupDate] = useState("");
  // โพสต์ของหายของผู้ใช้เองที่ใช้ยืนยันว่าตรงกับโพสต์ของที่พบที่กดขอรับ
  const [myLostPosts, setMyLostPosts] = useState<PostItem[]>([]);
  const [isLoadingMyPosts, setIsLoadingMyPosts] = useState(false);
  const [claimMatchedPostId, setClaimMatchedPostId] = useState("");
  const [isClaimEvidenceUploading, setIsClaimEvidenceUploading] = useState(false);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  // คาราเซลรูป: heroIndex = รูปที่แสดงใน hero, viewerIndex = รูปที่เปิดใน lightbox
  const [heroIndex, setHeroIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [myMatchedPosts, setMyMatchedPosts] = useState<
    {
      postId: string;
      title: string;
      score: number;
      reason?: string;
      confirmed?: boolean;
      rejected?: boolean;
    }[]
  >([]);
  // State สำหรับ Modal รายงานโพสต์ทั่วไป
  const [showGeneralReportModal, setShowGeneralReportModal] = useState(false);
  const [generalReportCategory, setGeneralReportCategory] = useState("เนื้อหาไม่เหมาะสม");
  const [generalReportDetail, setGeneralReportDetail] = useState("");
  const [isSubmittingGeneralReport, setIsSubmittingGeneralReport] = useState(false);

  const GENERAL_REPORT_CATEGORIES = [
    "เนื้อหาไม่เหมาะสม",
    "ข้อมูลเท็จ / หลอกลวง",
    "สแปม / ซ้ำซ้อน",
    "โพสต์ที่ไม่เกี่ยวข้อง",
    "อื่นๆ",
  ];

  const handleGeneralReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item?.id || !currentUser?.uid) {
      onRequireLogin?.();
      return;
    }
    setIsSubmittingGeneralReport(true);
    try {
      await addDoc(collection(db, "reports"), {
        type: "post_report",
        postId: item.id,
        postTitle: item.title,
        postType: item.itemType || "unknown",
        reporterId: currentUser.uid,
        reporterName: currentUser.displayName || "ผู้ใช้ทั่วไป",
        category: generalReportCategory,
        detail: generalReportDetail.trim(),
        status: "open",
        createdAt: serverTimestamp(),
      });
      addDoc(collection(db, "notifications"), {
        type: "post_report",
        recipientRole: "admin",
        postId: item.id,
        postTitle: item.title,
        reporterId: currentUser.uid,
        reporterName: currentUser.displayName || "ผู้ใช้ทั่วไป",
        category: generalReportCategory,
        detail: generalReportDetail.trim(),
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      showToast("ส่งรายงานเรียบร้อยแล้ว ขอบคุณที่ช่วยตรวจสอบ");
      setShowGeneralReportModal(false);
      setGeneralReportDetail("");
      setGeneralReportCategory("เนื้อหาไม่เหมาะสม");
    } catch (error) {
      console.error("Error submitting general report:", error);
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsSubmittingGeneralReport(false);
    }
  };

  // ตรวจสอบว่าผู้ใช้ตนนี้ส่งคำขอรับของ pending สำหรับโพสต์นี้แล้วหรือยัง
  useEffect(() => {
    if (!item || !currentUser?.uid) return;
    const q = query(
      collection(db, "claims"),
      where("postId", "==", item.id),
      where("claimantId", "==", currentUser.uid),
      where("status", "==", "pending")
    );
    const un = onSnapshot(
      q,
      (snap) => setAlreadyRequested(!snap.empty),
      (error) => console.error("Error checking claim requests:", error)
    );
    return () => un();
  }, [item?.id, item, currentUser?.uid]);

  const [busyConfirmKey, setBusyConfirmKey] = useState<string | null>(null);
  const handleConfirmDecision = async (
    otherPostId: string,
    myPostId: string,
    action: "confirm" | "reject"
  ) => {
    const key = `${myPostId}|${otherPostId}`;
    if (busyConfirmKey || !item?.id) return;
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

  // ตรวจสอบว่าโพสต์นี้ (ของคนอื่น) match กับโพสต์ไหนของฉัน
  useEffect(() => {
    if (!item || !currentUser?.uid) return;
    if (item.userId === currentUser.uid) return; // โพสต์ของตัวเองไม่ต้องเช็ก
    if (!item.matches || item.matches.length === 0) return;

    let cancelled = false;
    const fetchMatches = async () => {
      const results: {
        postId: string;
        title: string;
        score: number;
        reason?: string;
        confirmed?: boolean;
        rejected?: boolean;
      }[] = [];
      for (const m of item.matches || []) {
        if (m.rejected) continue;
        try {
          const snap = await getDoc(doc(db, "posts", m.matchedPostId));
          if (snap.exists() && snap.data().userId === currentUser.uid) {
            results.push({
              postId: m.matchedPostId,
              title: snap.data().title || m.matchedTitle || "โพสต์ของคุณ",
              score: m.similarityScore,
              reason: m.reason,
              confirmed: !!m.confirmed,
            });
          }
        } catch {
          // skip errors
        }
      }
      if (!cancelled && results.length > 0) {
        setMyMatchedPosts(results.sort((a, b) => b.score - a.score));
      }
    };
    fetchMatches();
    return () => { cancelled = true; };
  }, [item?.id, item, currentUser?.uid]);

  // รูปทั้งหมดของโพสต์ (รองรับทั้งโพสต์เก่าที่มีแค่ imageUrl และโพสต์ใหม่ที่มี imageUrls)
  const postImages = item ? getPostImages(item) : [];
  // จำกัดค่าให้อยู่ในช่วงเสมอ (กันกรณีสลับโพสต์/ลบรูปแล้ว index ค้าง)
  const heroSafe = postImages.length > 0 ? Math.min(heroIndex, postImages.length - 1) : 0;
  const viewerSafe = postImages.length > 0 ? Math.min(viewerIndex, postImages.length - 1) : 0;
  const goHero = (next: number) =>
    setHeroIndex((postImages.length + next) % postImages.length);
  const goViewer = (next: number) =>
    setViewerIndex((postImages.length + next) % postImages.length);

  // Role ของผู้ขอรับของ มาจาก session ที่ล็อกอินอยู่ (ผู้ใช้เลือกเองไม่ได้)
  const claimRole = resolveClaimRole(currentUser);
  const isStudentRole = claimRole === "student";
  const claimRoleLabel = CLAIM_ROLE_LABEL[claimRole];
  // ชื่อ/อีเมลดึงจากระบบยืนยันตัวตน ไม่ต้องให้ผู้ใช้กรอก
  const sessionClaimName = sessionName(currentUser);
  const sessionClaimEmail = sessionEmail(currentUser);
  // โพสต์ของหายของผู้ใช้เองที่เลือกไว้ (ใช้ยืนยันการจับคู่กับโพสต์ของที่พบ)
  const selectedMyLostPost = myLostPosts.find((p) => p.id === claimMatchedPostId) || null;
  // ช่วงเวลานัดรับของ (คำนวณใหม่ทุกครั้งที่เปิดฟอร์ม และใช้เวลาท้องถิ่น)
  const [pickupWindow, setPickupWindow] = useState(() => getPickupWindow());
  const [showPickupPicker, setShowPickupPicker] = useState(false);

  // แยกวันออกจากค่า "YYYY-MM-DDTHH:mm" เพื่อใช้เทียบกับปุ่มวันที่ใน UI
  const pickupDatePart = claimPickupDate.slice(0, 10);

  /* ตรวจว่าเวลานัดที่เลือกอยู่ในช่วงที่ระบบรับได้ (อย่างน้อย 1 ชม. ไม่เกิน 3 วันนับรวมวันนี้ และอยู่ในเวลา 07:00-16:00)
     ใช้ pickupWindow ที่คำนวณตอนเปิดฟอร์ม (อยู่ใน state) เป็นขอบเขต เพื่อไม่เรียก Date.now() ระหว่าง render */
  const pickupError = (() => {
    if (!claimPickupDate) return "";
    const d = new Date(claimPickupDate);
    const ms = d.getTime();
    if (Number.isNaN(ms)) return "รูปแบบวันและเวลาไม่ถูกต้อง";
    if (!isPickupTimeAllowed(d)) return "เวลานัดต้องอยู่ระหว่าง 07:00-16:00";
    if (ms < new Date(pickupWindow.min).getTime()) {
      return "ต้องนัดหลังจากตอนนี้อย่างน้อย 1 ชั่วโมง";
    }
    if (ms > new Date(pickupWindow.max).getTime()) {
      return "ต้องนัดภายใน 3 วันนับจากวันนี้ (ไม่เกินวันที่ " +
        getPickupLastDay().toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + ")";
    }
    return "";
  })();

  // ตัวเลือกวัน + ช่วงเวลาสำหรับ UI เลือกนัด (คำนวณจาก pickupWindow เดียวกับที่ validate)
  const pickupMinMs = new Date(pickupWindow.min).getTime();
  const pickupMaxMs = new Date(pickupWindow.max).getTime();
  const pickupDays = buildPickupDays(pickupMinMs, pickupMaxMs);
  const selectedPickupDay =
    pickupDays.find((d) => d.key === pickupDatePart) ||
    pickupDays.find((d) => d.hasFree) ||
    pickupDays[0];
  const pickupSlotsOfDay = PICKUP_SLOT_MINUTES.map((m) => {
    const value = slotValueOn(new Date(`${selectedPickupDay.key}T00:00:00`), m);
    const t = new Date(value).getTime();
    return { value, label: slotLabel(m), disabled: t < pickupMinMs || t > pickupMaxMs };
  });
  // ช่วงเช้า/บ่าย แยกกลุ่มให้สแกนง่ายแทนการเห็นช่วงเวลารวดเดียว 19 ช่อง
  const pickupSlotGroups = [
    { title: "ช่วงเช้า", from: PICKUP_OPEN_HOUR * 60, to: 12 * 60 - 1 },
    { title: "ช่วงบ่าย", from: 12 * 60, to: PICKUP_CLOSE_MIN },
  ]
    .map((g) => ({
      ...g,
      slots: pickupSlotsOfDay.filter((s) => {
        const m = Number(s.label.slice(0, 2)) * 60 + Number(s.label.slice(3, 5));
        return m >= g.from && m <= g.to;
      }),
    }))
    .filter((g) => g.slots.length > 0);

  // เลือกวัน → เลือกช่วงเวลาว่างแรกของวันนั้นให้อัตโนมัติ (ลดคลิกที่ต้องทำ)
  const pickPickupDay = (dayKey: string) => {
    const day = pickupDays.find((d) => d.key === dayKey);
    if (!day?.hasFree || !day.firstFree) return;
    setClaimPickupDate(day.firstFree);
  };

  // เลื่อนด้วยคีย์บอร์ดตอนเปิด lightbox (ปิดด้วย Escape)
  useEffect(() => {
    if (!showImageViewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowImageViewer(false);
      if (e.key === "ArrowRight" && postImages.length > 1) goViewer(1);
      if (e.key === "ArrowLeft" && postImages.length > 1) goViewer(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImageViewer, postImages.length]);

  // เลื่อนรูปด้วยการปัดนิ้ว (มือถือ) — แยกจุดเริ่มของ hero กับ lightbox
  const SWIPE_THRESHOLD = 45;
  const [heroTouchX, setHeroTouchX] = useState<number | null>(null);
  const [viewerTouchX, setViewerTouchX] = useState<number | null>(null);

  const heroSwipe = {
    onTouchStart: (e: React.TouchEvent) =>
      setHeroTouchX(e.touches[0]?.clientX ?? null),
    onTouchEnd: (e: React.TouchEvent) => {
      const start = heroTouchX;
      setHeroTouchX(null);
      if (start === null) return;
      const delta = (e.changedTouches[0]?.clientX ?? start) - start;
      // ข้ามที่ปัดสั้นเกินไป เพื่อไม่ให้ติดกับการเลื่อนแนวตั้ง
      if (Math.abs(delta) < SWIPE_THRESHOLD) return;
      goHero(delta < 0 ? 1 : -1);
    },
  };

  const viewerSwipe = {
    onTouchStart: (e: React.TouchEvent) =>
      setViewerTouchX(e.touches[0]?.clientX ?? null),
    onTouchEnd: (e: React.TouchEvent) => {
      const start = viewerTouchX;
      setViewerTouchX(null);
      if (start === null) return;
      const delta = (e.changedTouches[0]?.clientX ?? start) - start;
      if (Math.abs(delta) < SWIPE_THRESHOLD) return;
      goViewer(delta < 0 ? 1 : -1);
    },
  };

  if (!item) {
    return null;
  }

  const isLost = item.itemType === "lost" || item.type === "lost";
  // "returned_matched" = โพสต์ของหายที่ถูกจับคู่กับคำขอรับของที่อนุมัติแล้ว (เจ้าของได้รับของชิ้นนี้แล้ว)
  const isResolved = item.status === "resolved" || item.status === "returned_matched";

  const isInvestigating = item.status === "under_investigation";
  const isInProgress = item.status === "in_progress";
  const isSuspended = item.status === "suspended";
  const isPending = item.status === "pending";
  const isRejected = item.status === "rejected";

  const handleDeletePost = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const itemRef = doc(db, "posts", item.id || "");
      await closeDataForDeletedPost(item.id || "", item.title);
      await deleteDoc(itemRef);
      showToast("ลบโพสต์เรียบร้อยแล้ว");
      onBack();
    } catch (error) {
      console.error("Error deleting document: ", error);
      showToast("เกิดข้อผิดพลาดในการลบโพสต์ กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const openEditModal = () => {
    if (!item) return;
    setEditCategory(item.category || "");
    setEditTitle(item.title || "");
    setEditDesc(item.desc || "");
    setEditLocation(item.locationName || item.building || item.location || "");
    setEditImages(getPostImages(item));
    setEditNewFiles([]);
    setEditLocationOpen(false);
    setEditLocationSearch("");
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingEdit || !item?.id) return;
    if (!editTitle.trim()) {
      showToast("กรุณาระบุชื่อสิ่งของ", "info");
      return;
    }
    if (!editCategory) {
      showToast("กรุณาเลือกหมวดหมู่", "info");
      return;
    }
    if (!editLocation.trim()) {
      showToast("กรุณาระบุสถานที่", "info");
      return;
    }

    setIsSavingEdit(true);
    try {
      // รูปที่เหลืออยู่ = รูปเดิมที่ยังไม่ถูกลบ + รูปใหม่ที่เพิ่งอัปโหลด
      let finalImages = [...editImages];
      if (editNewFiles.length > 0) {
        try {
          const uploaded = await uploadManyToCloudinary(editNewFiles);
          if (uploaded.length === 0) {
            showToast("อัปโหลดรูปใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
            setIsSavingEdit(false);
            return;
          }
          if (uploaded.length < editNewFiles.length) {
            showToast(
              `อัปโหลดสำเร็จ ${uploaded.length} จาก ${editNewFiles.length} รูป`,
              "info"
            );
          }
          finalImages = [...finalImages, ...uploaded].slice(0, MAX_POST_IMAGES);
        } catch (uploadError) {
          console.error("Error uploading image:", uploadError);
          showToast("อัปโหลดรูปใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
          setIsSavingEdit(false);
          return;
        }
      }

      const patch: {
        category: string;
        title: string;
        desc: string;
        locationName: string;
        building: string;
        imageUrl?: string | null;
        imageUrls?: string[];
      } = {
        category: editCategory,
        title: editTitle.trim(),
        desc: editDesc.trim(),
        locationName: editLocation.trim(),
        building: editLocation.trim(),
        imageUrl: finalImages[0] || null,
        imageUrls: finalImages,
      };

      await updateDoc(doc(db, "posts", item.id), patch);
      setItem((prev) => ({ ...prev, ...patch }) as PostItem);
      setShowEditModal(false);
      showToast("แก้ไขโพสต์เรียบร้อยแล้ว");
    } catch (error) {
      console.error("Error editing post:", error);
      showToast("เกิดข้อผิดพลาดในการแก้ไขโพสต์ กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsSavingEdit(false);
    }
  };

  /* โหลด "โพสต์ของหายของผู้ใช้เอง" มาให้เลือกจับคู่กับโพสต์ของที่พบ
     (เฉพาะของหายของตัวเอง และตัดโพสต์ที่กำลังกดขอรับอยู่ออก)
     หมายเหตุ: จงค้นด้วยเงื่อนไขเดียว (userId) แล้วกรอง itemType + เรียงลำดับใน client
     เพราะ query แบบ userId + itemType + orderBy(createdAt) ต้องใช้ composite index
     ซึ่งยังไม่ได้ deploy จึงจะ error FAILED_PRECONDITION และได้รายการว่าง */
  const loadMyLostPosts = async () => {
    if (!currentUser?.uid) {
      setMyLostPosts([]);
      return;
    }
    setIsLoadingMyPosts(true);
    try {
      const q = query(
        collection(db, "posts"),
        where("userId", "==", currentUser.uid)
      );
      const snap = await getDocs(q);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as PostItem)
        .filter((p) => p.itemType === "lost" && p.id !== item.id)
        .sort((a, b) => resolvePostTime(b.createdAt) - resolvePostTime(a.createdAt))
        .slice(0, 30);
      setMyLostPosts(rows);
    } catch (err) {
      console.error("Error loading my lost posts:", err);
      setMyLostPosts([]);
    } finally {
      setIsLoadingMyPosts(false);
    }
  };

  /* เปิดฟอร์มขอรับของ: เตรียมค่าเริ่มต้นตาม role ที่ล็อกอินอยู่ + โหลดรายการโพสต์ของหายของตัวเอง */
  const openClaimModal = () => {
    // บุคคลทั่วไปต้องกรอกชื่อเอง (เติมชื่อจาก session ไว้ให้แก้ได้)
    // นิสิต/บุคลากรดึงชื่อจากระบบยืนยันตัวตนอัตโนมัติ
    setClaimName(sessionClaimName);
    setClaimPhone("");
    setClaimNote("");
    setClaimPickupDate("");
    setClaimEvidenceFile(null);
    setClaimEvidenceUrl("");
    setClaimMatchedPostId("");
    setPickupWindow(getPickupWindow());
    setShowPickupPicker(false);
    setShowClaimModal(true);
    void loadMyLostPosts();
  };

  /* ปิดฟอร์มขอรับของแล้วล้างค่าที่กรอกค้างไว้ทุกครั้ง */
  const closeClaimModal = () => {
    setShowClaimModal(false);
    setShowPickupPicker(false);
    setClaimName("");
    setClaimPhone("");
    setClaimNote("");
    setClaimPickupDate("");
    setClaimEvidenceFile(null);
    setClaimEvidenceUrl("");
  };

  const handleClaimItem = async () => {
    if (isSubmitting || !currentUser?.uid) return;

    try {
      const userSnap = await getDoc(doc(db, "users", currentUser.uid));
      if (userSnap.exists() && userSnap.data().banned === true) {
        showToast("บัญชีของคุณถูกระงับการใช้งาน ไม่สามารถขอรับของได้", "error");
        return;
      }
    } catch (e) {
      console.error("Error checking user status:", e);
    }

    // ชื่อ: นิสิต/บุคลากรดึงจากระบบยืนยันตัวตน · บุคคลทั่วไปกรอกเอง (หรือแก้ชื่อที่เติมให้ได้)
    const finalName = (isStudentRole ? sessionClaimName : claimName).trim();
    if (!finalName) {
      showToast("กรุณาระบุชื่อ-นามสกุล", "info");
      return;
    }
    if (!claimPhone.trim()) {
      showToast("กรุณาระบุเบอร์โทร", "info");
      return;
    }
    // อีเมล: ดึงจาก session ที่ล็อกอิน ใช้ยืนยันตัวตน (ผู้ใช้แก้เองไม่ได้)
    if (!sessionClaimEmail || !/^\S+@\S+\.\S+$/.test(sessionClaimEmail)) {
      showToast("ไม่พบอีเมลของบัญชีที่ล็อกอินอยู่ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่", "info");
      return;
    }
    // เวลานัดรับของ: ต้องอยู่ในช่วงที่ระบบรับได้ (อย่างน้อย 1 ชม. ไม่เกิน 3 วันนับรวมวันนี้ และอยู่ใน 07:00-16:00) ตาม canCreateValidClaim()
    if (pickupError) {
      showToast(pickupError, "info");
      setShowPickupPicker(true);
      return;
    }

    setIsSubmitting(true);
    try {
      let evidenceUrl = "";
      if (claimEvidenceFile) {
        setIsClaimEvidenceUploading(true);
        try {
          evidenceUrl = await uploadToCloudinary(claimEvidenceFile);
        } catch (uploadError) {
          console.error("Error uploading evidence:", uploadError);
          showToast("อัปโหลดรูปหลักฐานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
          return;
        } finally {
          setIsClaimEvidenceUploading(false);
        }
      }

      const expiresAt = claimPickupDate
        ? new Date(claimPickupDate).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const claimRef = await addDoc(collection(db, "claims"), {
        itemId: item.id,
        postId: item.id,
        postTitle: item.title,
        itemType: item.itemType || item.type || "found",
        depositLocation: item.depositLocation || "",
        postImageUrl: item.imageUrl || "",
        claimantId: currentUser.uid,
        claimantName: finalName,
        claimType: claimRole, // เก็บ role ตาม session เดิม (student/public)
        studentId: isStudentRole ? "" : "",
        phone: claimPhone.trim(),
        email: sessionClaimEmail,
        contact: claimPhone.trim() || "ไม่ระบุช่องทางติดต่อ",
        note: claimNote.trim(),
        evidenceUrl,
        status: "pending",
        expiresAt,
        expiresAtMs: new Date(expiresAt).getTime(),
        pickupDate: claimPickupDate || null,
        // ฟิลด์ใหม่เพื่อแสดงในแอดมินว่าจับคู่กับโพสต์ของหายไหน
        matchedPostId: selectedMyLostPost?.id || null,
        matchedPostTitle: selectedMyLostPost?.title || null,
        createdAt: serverTimestamp(),
      });

      // พยายามจองโพสต์  ถ้าโพสต์ถูกผู้ใช้อื่นจองไว้แล้ว (rules กันซ้ำซ้อน) => ลบคำขอที่เพิ่งสร้างทิ้ง + แจ้งผู้ใช้อย่างตรงไปตรงมา
      try {
        await updateDoc(doc(db, "posts", item.id || ""), {
          status: "in_progress",
          inProgressAt: new Date().toISOString(),
          reservationClaimId: claimRef.id,
        });
      } catch (postErr) {
        console.error("Error marking post as in progress:", postErr);
        try {
          await deleteDoc(claimRef);
        } catch (deleteErr) {
          console.error("Error rolling back claim:", deleteErr);
        }
        showToast(
          "โพสต์นี้ถูกจองโดยผู้ใช้อื่นไว้แล้ว (หรือยังไม่ถึงกำหนดปลดล็อก) คุณสามารถกดขอรับได้อีกครั้งเมื่อหมดเวลาจองเดิม",
          "info"
        );
        setIsSubmitting(false);
        return;
      }

      try {
        await addDoc(collection(db, "notifications"), {
          type: "claim",
          recipientRole: "admin",
          pointName: item.depositLocation || "",
          claimId: claimRef.id,
          postId: item.id,
          postTitle: item.title,
          itemType: item.itemType || item.type || "found",
          claimantName: finalName,
          read: false,
          createdAt: serverTimestamp(),
        });
      } catch (notifError) {
        console.error("Error creating claim notification:", notifError);
      }

      showToast(claimPickupDate
        ? "ส่งคำขอรับของเรียบร้อย ระบบได้จองโพสต์นี้ไว้แล้วจนถึงวันนัดรับ กรุณามารับของตามเวลาที่กำหนด"
        : "ส่งคำขอรับของเรียบร้อย ระบบได้จองโพสต์นี้ไว้แล้ว (24 ชม.) กรุณามาติดต่อเจ้าหน้าที่เพื่อรับของ");
      closeClaimModal();
    } catch (error) {
      console.error("Error creating claim request:", error);
      showToast("ส่งคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEvidenceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        showToast("ขนาดไฟล์ต้องไม่เกิน 5MB", "info");
        e.target.value = "";
        return;
      }
      setClaimEvidenceFile(file);
      setClaimEvidenceUrl(URL.createObjectURL(file));
    }
  };

  const handleReportImpersonation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) {
      showToast("กรุณาระบุรายละเอียดหรือเหตุผลในการแจ้งสวมสิทธิ์", "info");
      return;
    }
    if (!item?.id || !currentUser?.uid) {
      onRequireLogin?.();
      return;
    }
    if (await isCurrentUserBanned()) {
      showToast("บัญชีของคุณถูกระงับการใช้งาน ไม่สามารถส่งรายงานได้", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const existing = await getDocs(
        query(
          collection(db, "reports"),
          where("reporterId", "==", currentUser.uid),
          where("status", "==", "open")
        )
      );
      if (
        !existing.empty &&
        existing.docs.some(
          (d) =>
            d.data().postId === item.id &&
            d.data().type === "claim_dispute"
        )
      ) {
        showToast("คุณได้แจ้งท้วงโพสต์นี้ไปแล้ว รอเจ้าหน้าที่ตรวจสอบ", "info");
        setShowReportModal(false);
        return;
      }

      await addDoc(collection(db, "reports"), {
        type: "claim_dispute",
        postId: item.id,
        postTitle: item.title,
        postType: item.itemType || "unknown",
        reporterId: currentUser.uid,
        reporterName: currentUser.displayName || "ผู้ใช้ทั่วไป",
        category: "แจ้งสวมสิทธิ์ / คืนผิดคน",
        detail: reportReason.trim(),
        contact: reporterContact || "ไม่ระบุช่องทางติดต่อ",
        status: "open",
        createdAt: serverTimestamp(),
      });

      addDoc(collection(db, "notifications"), {
        type: "post_report",
        recipientRole: "admin",
        postId: item.id,
        postTitle: item.title,
        reporterId: currentUser.uid,
        reporterName: currentUser.displayName || "ผู้ใช้ทั่วไป",
        category: "แจ้งสวมสิทธิ์ / คืนผิดคน",
        detail: reportReason.trim(),
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});

      showToast("ส่งเรื่องแจ้งสวมสิทธิ์เรียบร้อยแล้ว เจ้าหน้าที่จะตรวจสอบโดยเร็ว (โพสต์ยังแสดงตามปกติ)");
      setShowReportModal(false);
    } catch (error) {
      console.error("Error reporting dispute:", error);
      showToast("เกิดข้อผิดพลาดในการส่งข้อมูล กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // เป็นเจ้าของโพสต์จริงเท่านั้น (ต้องมี uid และตรงกับ userId/uid ของโพสต์)
  // — กัน guest/คนอื่น ๆ หลุดเป็น isOwner (uid ว่าง ไปเท่ากับ item.uid ที่ว่างเปล่า)
  const isOwner = !!(
    currentUser?.uid &&
    (currentUser.uid === item.userId || currentUser.uid === item.uid)
  );

  const locationText = item.locationName
    || (item.faculty || item.building
      ? `${item.faculty || ""} ${item.building || ""}`.trim()
      : item.location)
    || "ไม่ระบุสถานที่";

  const getStatusConfig = () => {
    if (isSuspended) return { label: "ถูกระงับชั่วคราว", bg: "var(--sc-danger-bg)", border: "var(--sc-danger-border)", color: "var(--sc-danger-fg)", icon: <ShieldAlert size={16} /> };
    if (isInvestigating) return { label: "อยู่ระหว่างการอายัด", bg: "var(--sc-danger-bg)", border: "var(--sc-danger-border)", color: "var(--sc-danger-fg)", icon: <ShieldAlert size={16} /> };
    if (isPending) return { label: "รอแอดมินตรวจรับของ", bg: "var(--sc-warn-bg)", border: "var(--sc-warn-border)", color: "var(--sc-warn-fg)", icon: <Clock size={16} /> };
    if (isRejected) return { label: "คำขอถูกปฏิเสธ", bg: "var(--sc-danger-bg)", border: "var(--sc-danger-border)", color: "var(--sc-danger-fg)", icon: <ShieldAlert size={16} /> };
    if (isResolved) return { label: "คืนเรียบร้อยแล้ว", bg: "var(--sc-ok-bg)", border: "var(--sc-ok-border)", color: "var(--sc-ok-fg)", icon: <CheckCircle2 size={16} /> };
    if (isInProgress) return { label: "กำลังดำเนินการ", bg: "var(--sc-info-bg)", border: "var(--sc-info-border)", color: "var(--sc-info-fg)", icon: <Navigation size={16} /> };
    if (isLost) return { label: "ตามหาอยู่", bg: "var(--sc-warn-bg)", border: "var(--sc-warn-border)", color: "var(--sc-warn-fg)", icon: <AlertTriangle size={16} /> };
    return { label: "พบแล้ว", bg: "var(--sc-ok-bg)", border: "var(--sc-ok-border)", color: "var(--sc-ok-fg)", icon: <PackageCheck size={16} /> };
  };

  const statusCfg = getStatusConfig();

  return (
    <div
      className="laf-page-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        backgroundColor: "var(--bg)",
        paddingBottom: "32px",
        position: "relative",
      }}
    >
      <style>{`
        div::-webkit-scrollbar { display: none; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes toastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .detail-card { animation: slideUp 0.3s ease both; }
        .detail-card:nth-child(2) { animation-delay: 0.05s; }
        .detail-card:nth-child(3) { animation-delay: 0.1s; }
        .detail-card:nth-child(4) { animation-delay: 0.15s; }
        .detail-card:nth-child(5) { animation-delay: 0.2s; }
      `}</style>

      {/* Header */}
      <div
        className="laf-page-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          borderBottom: "1px solid var(--border)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            width: "38px",
            height: "38px",
            borderRadius: "10px",
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={18} color="var(--fg-strong)" />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            University of Phayao
          </div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)", marginTop: "1px", letterSpacing: "-0.01em" }}>
            รายละเอียดสิ่งของ
          </div>
        </div>
      </div>

      {/* Hero Image */}
      <div
        style={{
          width: "100%",
          height: "280px",
          backgroundColor: "var(--bg-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {postImages.length > 0 ? (
          <>
            <button
              onClick={() => {
                setViewerIndex(heroSafe);
                setShowImageViewer(true);
              }}
              style={{
                width: "100%",
                height: "100%",
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                display: "block",
              }}
              aria-label="ดูรูปภาพขนาดใหญ่"
              {...(postImages.length > 1 ? heroSwipe : {})}
            >
              <img
                src={postImages[heroSafe]}
                alt={item.title}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: isResolved ? "grayscale(20%)" : "none",
                }}
              />
            </button>

            {/* ลูกศรเลื่อนรูป (แสดงเมื่อมีมากกว่า 1 รูป) */}
            {postImages.length > 1 && (
              <>
                {([-1, 1] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => goHero(heroSafe + dir)}
                    aria-label={dir === -1 ? "รูปก่อนหน้า" : "รูปถัดไป"}
                    style={{
                      position: "absolute",
                      top: "50%",
                      [dir === -1 ? "left" : "right"]: "10px",
                      transform: "translateY(-50%)",
                      width: "34px",
                      height: "34px",
                      borderRadius: "50%",
                      border: "none",
                      backgroundColor: "rgba(11, 10, 16, 0.62)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      backdropFilter: "blur(8px)",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                      zIndex: 2,
                    }}
                  >
                    {dir === -1 ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
                  </button>
                ))}
              </>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", color: "var(--fg-faint)" }}>
            <PackageCheck size={48} color="var(--fg-faint)" style={{ marginBottom: "8px" }} />
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg-secondary)" }}>ไม่มีรูปภาพ</div>
          </div>
        )}

        {/* Status Badge */}
        <div
          style={{
            position: "absolute",
            top: "14px",
            right: "14px",
            padding: "6px 12px",
            borderRadius: "20px",
            backgroundColor: statusCfg.bg,
            border: `1.5px solid ${statusCfg.border}`,
            color: statusCfg.color,
            fontSize: "11px",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: "5px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
          }}
        >
          {statusCfg.icon}
          {statusCfg.label}
        </div>

        {/* Gradient Overlay Bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "60px",
            background: "linear-gradient(transparent, rgba(0,0,0,0.5))",
          }}
        />

        {postImages.length > 0 && (
          <div
            onClick={() => {
              setViewerIndex(heroSafe);
              setShowImageViewer(true);
            }}
            style={{
              position: "absolute",
              bottom: "12px",
              right: "14px",
              padding: "6px 12px",
              borderRadius: "20px",
              backgroundColor: "rgba(11, 10, 16, 0.7)",
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backdropFilter: "blur(8px)",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
          >
            <Maximize2 size={13} />
            แตะเพื่อดูรูปใหญ่
          </div>
        )}

        {/* จุดบอกตำแหน่งรูป + ลิขนาสถานะ */}
        {postImages.length > 1 && (
          <>
            <div
              style={{
                position: "absolute",
                bottom: "14px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: "6px",
                zIndex: 2,
              }}
            >
              {postImages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setHeroIndex(i)}
                  aria-label={`ดูรูปที่ ${i + 1}`}
                  style={{
                    width: i === heroSafe ? "20px" : "7px",
                    height: "7px",
                    padding: 0,
                    borderRadius: "999px",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor: i === heroSafe ? "#fff" : "rgba(255,255,255,0.5)",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                    transition: "all 0.2s ease",
                  }}
                />
              ))}
            </div>
            <div
              style={{
                position: "absolute",
                top: "14px",
                left: "14px",
                padding: "4px 10px",
                borderRadius: "20px",
                backgroundColor: "rgba(11, 10, 16, 0.7)",
                color: "#fff",
                fontSize: "11px",
                fontWeight: 800,
                backdropFilter: "blur(8px)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}
            >
              {heroSafe + 1}/{postImages.length}
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          padding: "0 16px",
          margin: "-20px auto 0",
          maxWidth: 780,
          width: "100%",
          position: "relative",
        }}
      >

        {/* Status Banners */}
        {isInProgress && (
          <div className="detail-card" style={{
            backgroundColor: "var(--sc-info-bg)", border: "1px solid var(--sc-info-border)", borderRadius: "14px",
            padding: "13px 14px", marginBottom: "12px", display: "flex", gap: "10px", alignItems: "flex-start",
          }}>
            <Navigation size={18} color="var(--sc-info-fg)" style={{ flexShrink: 0, marginTop: "1px" }} />
            <div style={{ fontSize: "12px", color: "var(--sc-info-fg)", lineHeight: "1.6" }}>
              <strong>กำลังดำเนินการ:</strong> มีผู้แจ้งว่าเป็นเจ้าของและกำลังเดินทางไปรับของชิ้นนี้ที่จุดรับของ
            </div>
          </div>
        )}

        {isInvestigating && (
          <div className="detail-card" style={{
            backgroundColor: "var(--sc-danger-bg)", border: "1px solid var(--sc-danger-border)", borderRadius: "14px",
            padding: "13px 14px", marginBottom: "12px", display: "flex", gap: "10px", alignItems: "flex-start",
          }}>
            <ShieldAlert size={18} color="var(--sc-danger-fg)" style={{ flexShrink: 0, marginTop: "1px" }} />
            <div style={{ fontSize: "12px", color: "var(--sc-danger-fg-strong)", lineHeight: "1.6" }}>
              <strong>เคสนี้ถูกอายัดชั่วคราว:</strong> เนื่องจากมีการแจ้งสวมสิทธิ์หรือรายงานข้อผิดพลาด เจ้าหน้าที่กำลังตรวจสอบข้อมูลความถูกต้อง
            </div>
          </div>
        )}

        {isResolved && (
          <div className="detail-card" style={{
            backgroundColor: "var(--sc-ok-bg)", border: "1px solid var(--sc-ok-border)", borderRadius: "14px",
            padding: "13px 14px", marginBottom: "12px", display: "flex", gap: "10px", alignItems: "flex-start",
          }}>
            <CheckCircle2 size={18} color="var(--sc-ok-fg)" style={{ flexShrink: 0, marginTop: "1px" }} />
            <div style={{ fontSize: "12px", color: "var(--sc-ok-fg-strong)", lineHeight: "1.6" }}>
              <strong>ส่งมอบคืนเรียบร้อยแล้ว:</strong> รายการนี้จะแสดงในระบบอีก 7 วัน หากท่านเป็นเจ้าของที่แท้จริงและสงสัยว่ามีการสวมสิทธิ์ สามารถกดปุ่มแจ้งสวมสิทธิ์ได้
            </div>
          </div>
        )}

        {/* Main Info Card */}
        <div className="detail-card" style={{
          backgroundColor: "var(--bg-card)",
          borderRadius: "18px",
          padding: "20px 16px",
          boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
          border: "1px solid var(--border)",
          marginBottom: "12px",
        }}>
          {/* Title */}
          <h1 style={{
            fontSize: "22px", fontWeight: 800, color: "var(--fg)", margin: "0 0 10px 0", lineHeight: 1.35,
            letterSpacing: "-0.02em",
          }}>
            {item.title}
          </h1>

          {/* Post ID */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            backgroundColor: "var(--bg-hover)", border: "1px solid var(--border)",
            padding: "4px 10px", borderRadius: "8px", marginBottom: "14px",
          }}>
            <span style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600 }}>รหัสโพสต์</span>
            <span style={{
              fontSize: "11px", fontWeight: 800, color: "var(--fg-accent)",
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              letterSpacing: "0.03em",
            }}>
              #{(item.refCode || item.id || "").toString().slice(-8).toUpperCase()}
            </span>
          </div>

          {/* Description */}
          {item.desc && (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: "6px",
                marginBottom: "6px",
              }}>
                <FileText size={14} color="var(--fg-accent)" />
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg-strong)" }}>รายละเอียด</span>
              </div>
              <div style={{
                fontSize: "13.5px", lineHeight: 1.7, color: "var(--fg-secondary)",
                backgroundColor: "var(--bg-subtle)", borderRadius: "12px", padding: "14px",
                border: "1px solid var(--border)",
              }}>
                {item.desc}
              </div>
            </>
          )}
        </div>

        {/* Location & Deposit Card */}
        <div className="detail-card" style={{
          backgroundColor: "var(--bg-card)",
          borderRadius: "18px",
          overflow: "hidden",
          boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
          border: "1px solid var(--border)",
          marginBottom: "12px",
        }}>
          {/* Section Header */}
          <div style={{
            padding: "14px 16px 10px",
            borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: "8px",
          }}>
            <div style={{
              width: "28px", height: "28px", borderRadius: "8px",
              background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 12px rgba(124,92,252,0.4)",
            }}>
              <MapPin size={14} color="var(--accent-fg)" />
            </div>
            <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--fg)" }}>สถานที่</span>
          </div>

          {/* Location Found/Lost */}
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "38px", height: "38px", borderRadius: "10px",
              backgroundColor: "var(--bg-hover)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <MapPin size={17} color="var(--fg-accent)" />
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: "2px" }}>
                {isLost ? "สถานที่ที่ทำหาย" : "สถานที่ที่พบ"}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)", lineHeight: 1.4 }}>
                {locationText}
              </div>
            </div>
          </div>

          {/* Divider */}
          {item.depositLocation && (
            <div style={{ margin: "0 16px", borderTop: "1px dashed var(--border-strong)" }} />
          )}

          {/* Deposit Location */}
          {item.depositLocation && (
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "38px", height: "38px", borderRadius: "10px",
                background: "var(--sc-ok-bg)", border: "1px solid var(--sc-ok-border)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <ShieldAlert size={17} color="var(--sc-ok-fg)" />
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "var(--sc-ok-fg)", fontWeight: 700, marginBottom: "2px" }}>
                  จุดรับของ
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--sc-ok-fg-strong)", lineHeight: 1.4 }}>
                  {item.depositLocation}
                </div>
              </div>
            </div>
          )}

          {/* Time */}
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "38px", height: "38px", borderRadius: "10px",
              backgroundColor: "var(--bg-hover)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Clock size={17} color="var(--fg-secondary)" />
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: "2px" }}>
                {isLost ? "วันที่ทำหาย" : "วันที่พบ"}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>
                {formatItemDate(item.date) || item.time || "ไม่ระบุเวลา"}
              </div>
            </div>
          </div>

          {/* Posted time */}
          <div style={{ padding: "0 16px 12px", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "38px", height: "38px", borderRadius: "10px",
              backgroundColor: "var(--bg-hover)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Clock size={17} color="var(--fg-accent)" />
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: "2px" }}>
                เวลาโพสต์
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>
                {formatItemTime(item.createdAt) || "-"}
              </div>
            </div>
          </div>

          {/* Reporter */}
          <div style={{ padding: "12px 16px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "38px", height: "38px", borderRadius: "10px",
              backgroundColor: "var(--bg-hover)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <User size={17} color="var(--fg-secondary)" />
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--fg-muted)", fontWeight: 600, marginBottom: "2px" }}>
                ผู้แจ้ง
              </div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>
                {item.reporterName || item.reporter || "ไม่ระบุผู้แจ้ง"}
              </div>
            </div>
          </div>
        </div>

        {/* AI Match Card - แสดงเฉพาะโพสต์คนอื่นที่ตรงกับโพสต์ของเรา */}
        {myMatchedPosts.length > 0 && (
          <div className="detail-card" style={{
            backgroundColor: "var(--bg-card)",
            borderRadius: "18px",
            overflow: "hidden",
            boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
            border: "1px solid rgba(124,92,252,0.3)",
            marginBottom: "12px",
          }}>
            <div style={{
              padding: "14px 16px 10px",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: "8px",
            }}>
              <div style={{
                width: "28px", height: "28px", borderRadius: "8px",
                background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 4px 12px rgba(124,92,252,0.4)",
              }}>
                <Sparkles size={14} color="var(--accent-fg)" />
              </div>
              <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--fg)" }}>
                AI พบว่าตรงกับโพสต์ของคุณ
              </span>
            </div>
            <div style={{ padding: "12px 16px" }}>
              {myMatchedPosts.map((mp) => (
                <div
                  key={mp.postId}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    padding: "10px 12px",
                    backgroundColor: "var(--bg-subtle)",
                    border: mp.confirmed
                      ? "1px solid rgba(52,211,153,0.45)"
                      : "1px solid rgba(251,191,36,0.3)",
                    borderRadius: "10px",
                    marginBottom: "8px",
                  }}
                >
                  <div style={{
                    width: "32px", height: "32px", borderRadius: "8px",
                    background: mp.confirmed ? "var(--sc-ok-bg)" : "var(--sc-warn-bg)",
                    border: mp.confirmed ? "1px solid var(--sc-ok-border)" : "1px solid var(--sc-warn-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <CheckCircle2 size={14} color={mp.confirmed ? "var(--sc-ok-fg)" : "var(--sc-warn-fg)"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                      <span style={{
                        fontSize: "12.5px", fontWeight: 700, color: "var(--fg)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {mp.title}
                      </span>
                      <span style={{
                        fontSize: "11px", fontWeight: 800,
                        color: mp.confirmed ? "var(--sc-ok-fg)" : "var(--sc-warn-fg)",
                        background: mp.confirmed ? "var(--sc-ok-bg)" : "var(--sc-warn-bg)",
                        border: mp.confirmed ? "1px solid var(--sc-ok-border)" : "1px solid var(--sc-warn-border)",
                        padding: "2px 8px", borderRadius: "8px",
                        whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        {mp.confirmed ? `แมทจริง ${mp.score}%` : `แนะนำ ${mp.score}%`}
                      </span>
                    </div>
                    {mp.reason && (
                      <div style={{
                        fontSize: "11px", color: "var(--fg-muted)", marginTop: "4px",
                        lineHeight: 1.5,
                      }}>
                        {mp.reason}
                      </div>
                    )}
                    {!mp.confirmed ? (
                      <div style={{
                        display: "flex", alignItems: "center", gap: "8px", marginTop: "6px",
                        flexWrap: "wrap",
                      }}>
                        <span style={{
                          fontSize: "10.5px", color: "var(--fg-accent)",
                          fontWeight: 600,
                        }}>
                          โพสต์ของคุณที่ตรงกัน
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                          type="button"
                          disabled={busyConfirmKey !== null}
                          onClick={() =>
                            handleConfirmDecision(item.id || "", mp.postId, "confirm")
                          }
                          style={{
                            minHeight: 40,
                            padding: "0 14px",
                            borderRadius: 10,
                            border: "1px solid rgba(52,211,153,0.5)",
                            background: "rgba(52,211,153,0.14)",
                            color: "var(--sc-ok-fg)",
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: busyConfirmKey ? "wait" : "pointer",
                          }}
                        >
                          ใช่ของฉัน
                        </button>
                        <button
                          type="button"
                          disabled={busyConfirmKey !== null}
                          onClick={() =>
                            handleConfirmDecision(item.id || "", mp.postId, "reject")
                          }
                          style={{
                            minHeight: 40,
                            padding: "0 14px",
                            borderRadius: 10,
                            border: "1px solid rgba(244,63,94,0.5)",
                            background: "rgba(244,63,94,0.10)",
                            color: "var(--sc-danger-fg)",
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: busyConfirmKey ? "wait" : "pointer",
                          }}
                        >
                          ไม่ใช่ของฉัน
                        </button>
                      </div>
                    ) : (
                      <div style={{
                        fontSize: "10.5px", color: "var(--sc-ok-fg)", marginTop: "4px",
                        fontWeight: 700,
                      }}>
                        <CheckCircle2 size={11} style={{ verticalAlign: "-1px" }} />
                        {" "}แมทจริง · ยืนยันแล้ว
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Timeline */}
        <div className="detail-card" style={{
          backgroundColor: "var(--bg-card)",
          borderRadius: "18px",
          padding: "18px 16px",
          boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
          border: "1px solid var(--border)",
          marginBottom: "12px",
        }}>
          <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--fg)", marginBottom: "16px" }}>
            ไทม์ไลน์สถานะ
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            {[
              { label: "แจ้งข้อมูล", sub: "ผู้ใช้ทำการแจ้งของหาย/พบของ", done: true, color: "#7c5cfc" },
              { label: "ตรวจสอบ", sub: "รอการตรวจสอบจากเจ้าหน้าที่", done: isInvestigating || isInProgress || isResolved, color: "var(--sc-info-fg)" },
              { label: isLost ? "เจ้าของมารับ" : "ส่งมอบของ", sub: isResolved ? "ดำเนินการเรียบร้อยแล้ว" : "รอการดำเนินการ", done: isResolved, color: "var(--sc-ok-fg)" },
            ].map((step, i, arr) => (
              <div key={i} style={{ display: "flex", gap: "12px" }}>
                {/* Line + Dot */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "20px" }}>
                  <div style={{
                    width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0,
                    backgroundColor: step.done ? step.color : "var(--bg-ghost)",
                    border: step.done ? "none" : "2px solid var(--border-strong)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: step.done ? `0 2px 10px ${step.color}55` : "none",
                  }}>
                    {step.done && <CheckCircle2 size={12} color="var(--fg)" />}
                  </div>
                  {i < arr.length - 1 && (
                    <div style={{
                      width: "2px", height: "32px",
                      backgroundColor: step.done ? `${step.color}66` : "var(--border)",
                    }} />
                  )}
                </div>
                {/* Text */}
                <div style={{ paddingBottom: i < arr.length - 1 ? "16px" : "0" }}>
                  <div style={{
                    fontSize: "13px", fontWeight: 700,
                    color: step.done ? "var(--fg)" : "var(--fg-faint)",
                  }}>
                    {step.label}
                  </div>
                  <div style={{
                    fontSize: "11px", marginTop: "2px",
                    color: step.done ? "var(--fg-muted)" : "var(--fg-dim)",
                  }}>
                    {step.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="detail-card" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
          {(isPending || isRejected) && (
            <div style={{
              padding: "12px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, lineHeight: 1.5,
              backgroundColor: isPending ? "var(--sc-warn-bg)" : "var(--sc-danger-bg)",
              border: isPending ? "1px solid var(--sc-warn-border)" : "1px solid var(--sc-danger-border)",
              color: isPending ? "var(--sc-warn-fg)" : "var(--sc-danger-fg)",
            }}>
              {isPending
                ? "โพสต์นี้ยังไม่ถูกเผยแพร่ — รอแอดมินตรวจรับของที่จุดรับ นำของไปฝากที่จุดรับให้แอดมินตรวจแล้วจึงกดอนุมัติ"
                : "คำขอโพสต์นี้ถูกปฏิเสธ (ของยังไม่ได้รับการตรวจรับ) — คุณสามารถลบโพสต์นี้เพื่อส่งคำขอใหม่ได้"}
            </div>
          )}
          {/* Main Claim Button — เฉพาะโพสต์ของพบ และไม่ได้เป็นเจ้าของโพสต์ */}
          {!isLost && !isOwner && !isResolved && (
            <>
              <button
              onClick={() => {
                if (!currentUser?.uid) {
                  // หลังล็อกอิน ให้เปิด modal คำขอรับของต่อทันที
                  onRequireLogin?.(() => openClaimModal());
                  return;
                }
                openClaimModal();
              }}
              disabled={isSubmitting || alreadyRequested}
              style={{
                width: "100%", padding: "15px", borderRadius: "14px", border: "none",
                background: alreadyRequested
                  ? "linear-gradient(135deg, var(--border-strong) 0%, var(--border) 100%)"
                  : "linear-gradient(135deg, #7c5cfc 0%, #4f3bd6 100%)",
                color: alreadyRequested ? "var(--fg-secondary)" : "var(--accent-fg)", fontSize: "15px", fontWeight: 800,
                cursor: isSubmitting || alreadyRequested ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                boxShadow: alreadyRequested
                  ? "none"
                  : "0 10px 28px -6px rgba(124, 92, 252, 0.5)",
                letterSpacing: "0.01em",
                opacity: isInProgress || alreadyRequested ? 0.7 : 1,
              }}
            >
              <PackageCheck size={20} />
              {alreadyRequested
                ? "ส่งคำขอแล้ว (รอแอดมินตรวจสอบ)"
                : isInProgress
                  ? "ยื่นคำขอ (มีคนรอตรวจสอบแล้ว)"
                  : "ขอรับของ"}
            </button>
            {isInProgress && !alreadyRequested && (
              <div style={{
                fontSize: "11px", color: "var(--fg-secondary)", textAlign: "center", lineHeight: 1.5,
              }}>
                มีคนยื่นคำขอไว้ก่อนแล้ว ระบบเรียงตามลำดับก่อน-หลัง และเจ้าหน้าที่จะเป็นผู้คัดเลือก
              </div>
            )}
            </>
          )}

          {!isResolved && !isInvestigating && (
            <div style={{ display: "flex", gap: "10px" }}>
              {!isOwner && (
                <button
                  onClick={() => onStartChat?.(item)}
                  style={{
                    flex: 1, padding: "14px", borderRadius: "14px",
                    border: "1.5px solid var(--border)", backgroundColor: "var(--bg-card)",
                    color: "var(--fg-strong)", fontSize: "13px", fontWeight: 700,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <MessageCircle size={17} />
                  ติดต่อผู้แจ้ง
                </button>
              )}
            </div>
          )}

          {isResolved && (
            <button
              onClick={() => setShowReportModal(true)}
              style={{
                width: "100%", padding: "14px", borderRadius: "14px",
                border: "1.5px solid var(--sc-danger-border)", backgroundColor: "var(--sc-danger-bg)",
                color: "var(--sc-danger-fg)", fontSize: "14px", fontWeight: 700,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              }}
            >
              <AlertTriangle size={18} color="var(--sc-danger-fg)" />
              แจ้งสวมสิทธิ์ / รายงานความผิดพลาด
            </button>
          )}

          {/* ปุ่มรายงานโพสต์ทั่วไป (เฉพาะโพสต์คนอื่น) */}
          {!isOwner && (
            <button
              onClick={() => setShowGeneralReportModal(true)}
              style={{
                width: "100%", padding: "12px", borderRadius: "14px",
                border: "1px solid var(--border)", backgroundColor: "transparent",
                color: "var(--fg-muted)", fontSize: "12.5px", fontWeight: 600,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                transition: "color 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--sc-danger-fg)";
                e.currentTarget.style.borderColor = "var(--sc-danger-fg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--fg-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <Flag size={14} />
              รายงานโพสต์นี้
            </button>
          )}

          {isOwner && !isResolved && (
            <button
              onClick={openEditModal}
              style={{
                width: "100%", padding: "13px", borderRadius: "14px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                color: "var(--fg-strong)", fontSize: "13px", fontWeight: 700,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                marginTop: "2px",
              }}
            >
              <Pencil size={17} />
              แก้ไขโพสต์นี้
            </button>
          )}

          {isOwner && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                width: "100%", padding: "13px", borderRadius: "14px",
                border: "1px solid var(--sc-danger-border)", backgroundColor: "var(--sc-danger-bg)",
                color: "var(--sc-danger-fg)", fontSize: "13px", fontWeight: 700,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                marginTop: "2px",
              }}
            >
              <Trash2 size={17} />
              ลบโพสต์นี้
            </button>
          )}
        </div>
      </div>

      {/* Claim Confirmation Modal */}
      <Dialog
        open={showClaimModal}
        onClose={closeClaimModal}
        title="ส่งคำขอรับของถึงแอดมิน"
        subtitle="ส่งแล้วโพสต์จะถูกจองให้คุณทันที (24 ชม. หรือตามวันที่นัดรับ) แล้วนำหลักฐานไปแสดงกับเจ้าหน้าที่ที่จุดรับของ"
        icon={PackageCheck}
        iconTone="primary"
        align="start"
        maxWidth={480}
        dismissible={false}
        footer={
          <>
            <DialogButton onClick={closeClaimModal} disabled={isSubmitting}>ยกเลิก</DialogButton>
            <DialogButton
              onClick={handleClaimItem}
              tone="primary"
              disabled={isSubmitting}
              icon={isSubmitting ? undefined : Send}
            >
              {isSubmitting
                ? (isClaimEvidenceUploading ? "กำลังอัปโหลดรูปหลักฐาน..." : "กำลังส่งคำขอ...")
                : "ส่งคำขอรับของ"}
            </DialogButton>
          </>
        }
      >
        <form
          id="claim-form"
          onSubmit={(e) => { e.preventDefault(); void handleClaimItem(); }}
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          <div style={{
            backgroundColor: "var(--sc-warn-bg)", border: "1px solid var(--sc-warn-border)", borderRadius: "12px",
            padding: "12px 14px",
          }}>
            <div style={{ fontSize: "12.5px", color: "var(--sc-warn-fg-strong)", lineHeight: 1.7 }}>
              <strong>ขั้นตอนการรับของ:</strong><br />
              1. ส่งคำขอ → โพสต์จะถูกจองให้คุณทันที (24 ชม. / ตามวันนัด)<br />
              2. ไปที่จุดรับของพร้อมหลักฐานความเป็นเจ้าของ<br />
              3. เจ้าหน้าที่ตรวจสอบและยืนยัน → ระบบจะปิดเคสเป็น "คืนแล้ว"
            </div>
          </div>

          {/* Role ผู้ขอรับของ — ระบบเลือกให้อัตโนมัติจากช่องทางที่ล็อกอินอยู่ (ผู้ใช้เลือกเองไม่ได้) */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 14px",
            borderRadius: "12px",
            background: isStudentRole ? "rgba(124,92,252,0.12)" : "rgba(13,148,136,0.12)",
            border: `1px solid ${isStudentRole ? "rgba(124,92,252,0.35)" : "rgba(13,148,136,0.35)"}`,
          }}>
            {isStudentRole
              ? <GraduationCap size={20} color="#c4b5fd" style={{ flexShrink: 0 }} />
              : <Users size={20} color="#5eead4" style={{ flexShrink: 0 }} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--fg-muted)" }}>
                ประเภทผู้ขอรับของ (จากช่องทางที่ล็อกอิน)
              </div>
              <div style={{
                fontSize: "14px", fontWeight: 800, lineHeight: 1.4,
                color: isStudentRole ? "#c4b5fd" : "#5eead4",
              }}>
                {claimRoleLabel}
              </div>
            </div>
            <ShieldCheck size={16} color="var(--fg-faint)" style={{ flexShrink: 0 }} />
          </div>

          {/* ชื่อ-นามสกุล: นิสิต/บุคลากรดึงจากระบบยืนยันตัวตน · บุคคลทั่วไปกรอกเอง */}
          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              ชื่อ-นามสกุล *
            </label>
            {isStudentRole ? (
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                color: "var(--fg-faint)", fontSize: "13.5px",
              }}>
                <User size={15} style={{ flexShrink: 0 }} />
                {sessionClaimName || "ไม่พบชื่อในระบบ"}
              </div>
            ) : (
              <input
                type="text"
                value={claimName}
                onChange={(e) => setClaimName(e.target.value)}
                placeholder="เช่น สมชาย ใจดี"
                required
                style={{
                  width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                  border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                  boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  transition: "border-color 0.15s",
                }}
              />
            )}
            {isStudentRole && (
              <div style={{ fontSize: "12px", color: "var(--fg-faint)", marginTop: "6px", lineHeight: 1.6 }}>
                ดึงชื่ออัตโนมัติจากบัญชีที่ยืนยันอีเมล @up.ac.th แล้ว
              </div>
            )}
          </div>

          {/* อีเมล: ดึงจากระบบล็อกอินมาใช้ยืนยัน (ทั้ง 2 role) */}
          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              อีเมลยืนยันตัวตน
            </label>
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
              border: "1.5px solid var(--border)", backgroundColor: "var(--bg-subtle)",
              color: "var(--fg-faint)", fontSize: "13.5px", wordBreak: "break-all",
            }}>
              <Mail size={15} style={{ flexShrink: 0 }} />
              {sessionClaimEmail || "ไม่พบอีเมลในระบบ"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--fg-faint)", marginTop: "6px", lineHeight: 1.6 }}>
              ดึงจากระบบยืนยันตัวตนอัตโนมัติ แก้ไขไม่ได้
            </div>
          </div>

          {/* เบอร์โทร — ทั้ง 2 role ต้องกรอกเอง */}
          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              เบอร์โทรศัพท์ *
            </label>
            <input
              type="tel"
              value={claimPhone}
              onChange={(e) => setClaimPhone(e.target.value)}
              placeholder="เช่น 08X-XXX-XXXX"
              required
              style={{
                width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                transition: "border-color 0.15s",
              }}
            />
          </div>

          {/* เลือกโพสต์ของหายของตัวเอง เพื่อยืนยันว่าตรงกับโพสต์ของที่พบ */}
          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              โพสต์ของหายของคุณที่ตรงกับ <span style={{ color: "var(--fg-faint)", fontWeight: 500 }}>(ช่วยให้แอดมินตรวจสอบได้เร็วขึ้น)</span>
            </label>
            {isLoadingMyPosts ? (
              <div style={{
                minHeight: "46px", display: "flex", alignItems: "center", gap: "8px",
                padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                color: "var(--fg-faint)", fontSize: "13.5px",
              }}>
                <Loader2 size={15} style={{ animation: "spin 0.8s linear infinite" }} />
                กำลังโหลดโพสต์ของคุณ...
              </div>
            ) : myLostPosts.length === 0 ? (
              <div style={{
                padding: "12px", borderRadius: "10px",
                border: "1.5px dashed var(--border-strong)", backgroundColor: "var(--bg-subtle)",
                color: "var(--fg-faint)", fontSize: "12.5px", lineHeight: 1.6,
              }}>
                ยังไม่มีโพสต์ของหายของคุณในระบบ — ถ้าคุณเคยลงโพสต์ของหายไว้ ให้ตรวจสอบว่าอยู่ในบัญชีนี้และเลือกแท็บ “ของหาย” ในหน้า “ของฉัน”
              </div>
            ) : (
              <select
                value={claimMatchedPostId}
                onChange={(e) => setClaimMatchedPostId(e.target.value)}
                style={{
                  width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                  border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                  boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                }}
              >
                <option value="">— ไม่ระบุ / ไม่แน่ใจ —</option>
                {myLostPosts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || "ไม่ระบุชื่อ"} · {p.locationName || p.building || "ไม่ระบุสถานที่"}
                  </option>
                ))}
              </select>
            )}
            {selectedMyLostPost && (
              <div style={{
                marginTop: "8px", display: "flex", alignItems: "center", gap: "10px",
                padding: "10px", borderRadius: "10px",
                border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
              }}>
                {getPostCover(selectedMyLostPost) ? (
                  <img
                    src={getPostCover(selectedMyLostPost) || undefined}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: 9, objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 48, height: 48, borderRadius: 9, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--bg-card)", border: "1px solid var(--border)",
                  }}>
                    <Package size={18} color="var(--fg-faint)" />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)", lineHeight: 1.4 }}>
                    {selectedMyLostPost.title || "ไม่ระบุชื่อ"}
                  </div>
                  <div style={{ fontSize: "11.5px", color: "var(--fg-faint)", marginTop: "2px" }}>
                    จับคู่กับโพสต์ของที่พบนี้แล้ว
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setClaimMatchedPostId("")}
                  aria-label="ล้างการเลือกโพสต์ที่จับคู่"
                  style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    background: "var(--bg-card)", border: "1px solid var(--border)",
                    color: "var(--fg-muted)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              รายละเอียดสิ่งของ (เพิ่มเติม)
            </label>
            <textarea
              rows={3}
              value={claimNote}
              onChange={(e) => setClaimNote(e.target.value)}
              placeholder="ระบุตำหนิ รายละเอียดที่พอจำได้ หรือหลักฐานยืนยันตัวตน"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                boxSizing: "border-box", fontFamily: "inherit", resize: "none", lineHeight: 1.6,
                backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                transition: "border-color 0.15s",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              รูปหลักฐานความเป็นเจ้าของ (ถ้ามี)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleEvidenceFileSelect}
              style={{ display: "none" }}
              id="claim-evidence-upload"
            />
            {claimEvidenceUrl ? (
              <div style={{ position: "relative", borderRadius: "12px", overflow: "hidden", border: "1.5px solid var(--border)" }}>
                <img src={claimEvidenceUrl} alt="หลักฐาน" style={{ width: "100%", height: "160px", objectFit: "cover", display: "block" }} />
                <button
                  type="button"
                  aria-label="ลบรูปหลักฐาน"
                  onClick={() => { setClaimEvidenceFile(null); setClaimEvidenceUrl(""); }}
                  style={{
                    position: "absolute", top: 8, right: 8, width: 40, height: 40, borderRadius: "50%",
                    background: "rgba(0,0,0,0.6)", border: "none", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <label
                htmlFor="claim-evidence-upload"
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  minHeight: "96px", padding: "18px 16px", borderRadius: "12px", cursor: "pointer",
                  border: "1.5px dashed var(--border-strong)", backgroundColor: "var(--bg-subtle)",
                  color: "var(--fg-muted)", fontSize: "13.5px", fontWeight: 600, gap: "6px", textAlign: "center",
                  transition: "border-color 0.15s",
                }}
              >
                <ImagePlus size={24} color="var(--fg-accent)" />
                แตะเพื่อเลือกรูปหลักฐาน
                <span style={{ fontSize: "12px", color: "var(--fg-faint)" }}>PNG, JPG สูงสุด 5MB</span>
              </label>
            )}
          </div>

          {/* ปุ่มนัดวัน-เวลามารับของ (ไม่บังคับ) */}
          <div>
            <label
              htmlFor="claim-pickup-trigger"
              style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}
            >
              นัดวัน-เวลามารับของ{" "}
              <span style={{ color: "var(--fg-faint)", fontWeight: 500 }}>
                (ไม่บังคับ · เปิดรับ 07:00-16:00 ภายใน 3 วัน · ถ้าไม่เลือกคำขอมีอายุ 24 ชม.)
              </span>
            </label>

            {/* ปุ่มหลัก: กดเพื่อเปิด/ปิดช่องเลือกวันและเวลา */}
            <button
              id="claim-pickup-trigger"
              type="button"
              onClick={() => setShowPickupPicker((v) => !v)}
              aria-expanded={showPickupPicker}
              style={{
                width: "100%", minHeight: "48px", padding: "11px 14px", borderRadius: "10px",
                border: pickupError ? "1.5px solid var(--danger)" : "1.5px solid var(--accent)",
                fontSize: "14px", fontWeight: 700, outline: "none", cursor: "pointer",
                boxSizing: "border-box", textAlign: "left",
                backgroundColor: claimPickupDate ? "var(--accent-soft)" : "var(--bg-subtle)",
                color: claimPickupDate ? "var(--fg)" : "var(--fg-muted)",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                <Calendar size={17} color="var(--fg-accent)" style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {claimPickupDate
                    ? formatPickupForDisplay(claimPickupDate)
                    : "กดเพื่อเลือกวันและเวลาที่สะดวกมารับ"}
                </span>
              </span>
              <ChevronDown
                size={17}
                color="var(--fg-faint)"
                style={{ flexShrink: 0, transform: showPickupPicker ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
              />
            </button>

            {pickupError && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--danger)", marginTop: "6px", fontWeight: 600 }}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                {pickupError}
              </div>
            )}

            {showPickupPicker && (
              <div
                style={{
                  marginTop: "10px", padding: "14px", borderRadius: "14px",
                  border: "1.5px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                }}
              >
                {/* เลือกวัน — ปุ่มกดแทน date picker */}
                <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "8px" }}>
                  เลือกวัน
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                  {pickupDays.map((day) => {
                    const active = day.key === selectedPickupDay.key;
                    return (
                      <button
                        key={day.key}
                        type="button"
                        disabled={!day.hasFree}
                        onClick={() => pickPickupDay(day.key)}
                        aria-pressed={active}
                        style={{
                          minHeight: "52px", padding: "8px 6px", borderRadius: "12px",
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px",
                          fontSize: "12.5px", fontWeight: 800, cursor: day.hasFree ? "pointer" : "not-allowed",
                          backgroundColor: active ? "var(--accent-soft)" : "var(--bg-card)",
                          color: active ? "var(--fg)" : day.hasFree ? "var(--fg-secondary)" : "var(--fg-faint)",
                          border: active ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                          boxShadow: active ? "0 0 0 1px var(--accent) inset" : "none",
                          opacity: day.hasFree ? 1 : 0.55,
                        }}
                      >
                        <span>{day.title}</span>
                        <span style={{ fontSize: "10.5px", fontWeight: 600, opacity: 0.75 }}>
                          {day.hasFree ? day.dateLabel : "ไม่ว่าง"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* เลือกช่วงเวลา — ปุ่มกดแทน time picker (ขนาดกดใหญ่ ≥44px บนมือถือ) */}
                <div
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
                    margin: "16px 0 8px",
                  }}
                >
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--fg-secondary)" }}>
                    เลือกเวลา · {selectedPickupDay.title} {selectedPickupDay.dateLabel}
                  </div>
                  {claimPickupDate && (
                    <button
                      type="button"
                      onClick={() => setClaimPickupDate("")}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 10px",
                        borderRadius: 8, fontSize: "12px", fontWeight: 700, cursor: "pointer",
                        backgroundColor: "transparent", color: "var(--fg-muted)", border: "1.5px solid var(--border)",
                      }}
                    >
                      <X size={12} /> ล้าง
                    </button>
                  )}
                </div>

                {pickupSlotsOfDay.every((s) => s.disabled) ? (
                  <div
                    style={{
                      padding: "12px", borderRadius: "10px", fontSize: "12.5px", color: "var(--fg-faint)",
                      backgroundColor: "var(--bg-card)", border: "1.5px dashed var(--border)", textAlign: "center",
                    }}
                  >
                    วันนี้ไม่มีช่วงเวลาที่รับได้แล้ว — เลือกวันถัดไป
                  </div>
                ) : (
                  pickupSlotGroups.map((group) => (
                    <div key={group.title} style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--fg-faint)", marginBottom: "6px" }}>
                        {group.title}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))", gap: "8px" }}>
                        {group.slots.map((slot) => {
                          const active = claimPickupDate === slot.value;
                          return (
                            <button
                              key={slot.value}
                              type="button"
                              disabled={slot.disabled}
                              onClick={() => setClaimPickupDate(slot.value)}
                              aria-pressed={active}
                              style={{
                                minHeight: "44px", padding: "8px 4px", borderRadius: "10px",
                                fontSize: "13.5px", fontWeight: 700, cursor: slot.disabled ? "not-allowed" : "pointer",
                                backgroundColor: active ? "var(--accent)" : "var(--bg-card)",
                                color: active ? "var(--accent-fg)" : slot.disabled ? "var(--fg-faint)" : "var(--fg-secondary)",
                                border: active ? "1.5px solid var(--accent)" : "1.5px solid var(--border)",
                                opacity: slot.disabled ? 0.45 : 1,
                              }}
                            >
                              {slot.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}

                <div style={{ fontSize: "11.5px", color: "var(--fg-faint)", marginTop: "10px", lineHeight: 1.6 }}>
                  เปิดรับ 07:00-16:00 · นัดได้ภายใน 3 วันนับจากวันนี้
                  <br />
                  ตั้งแต่ {formatPickupForDisplay(pickupWindow.min)} ถึง {formatPickupForDisplay(pickupWindow.max)}
                </div>
              </div>
            )}

            <div style={{ fontSize: "12px", color: "var(--fg-faint)", marginTop: "8px", lineHeight: 1.6 }}>
              ระบุวันมารับที่คุณสะดวก คำขอจะถูกจองไว้จนถึงเวลานั้น (ถ้าไม่มาตรงเวลาจะโดนปล่อยให้คนถัดไป)
            </div>
          </div>
        </form>
      </Dialog>

      {/* Edit Post Modal */}
      <Dialog
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="แก้ไขโพสต์"
        icon={Pencil}
        align="start"
        maxWidth={460}
        footer={
          <>
            <DialogButton onClick={() => setShowEditModal(false)} disabled={isSavingEdit}>
              ยกเลิก
            </DialogButton>
            <DialogButton type="submit" formId="laf-edit-post" tone="primary" disabled={isSavingEdit} icon={isSavingEdit ? undefined : Pencil}>
              {isSavingEdit ? "กำลังบันทึก..." : "บันทึก"}
            </DialogButton>
          </>
        }
      >
        <form
          id="laf-edit-post"
          onSubmit={handleSaveEdit}
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              ประเภท *
            </label>
            <select
              disabled
              value={item.itemType || item.type || "lost"}
              style={{
                width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg-faint)",
                cursor: "not-allowed", opacity: 0.75,
              }}
            >
              <option value="lost">ของหาย</option>
              <option value="found">ของที่พบ</option>
            </select>
            <div style={{ fontSize: 12, color: "var(--fg-faint)", marginTop: "6px", display: "flex", alignItems: "center", gap: 5 }}>
              <Lock size={13} /> ไม่สามารถเปลี่ยนประเภทโพสต์หลังประกาศแล้ว
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              หมวดหมู่สิ่งของ *
            </label>
            <select
              required
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              style={{
                width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                cursor: "pointer",
              }}
            >
              <option value="" disabled>
                เลือกหมวดหมู่...
              </option>
              {ITEM_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              ชื่อสิ่งของ *
            </label>
            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="เช่น กระติกน้ำสีฟ้า, กุญแจพร้อมสายคล้อง"
              style={{
                width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              สถานที่ / ตึกเรียน *
            </label>
            <div ref={editLocationDropdownRef} style={{ position: "relative" }}>
              <div
                onClick={() => setEditLocationOpen((o) => !o)}
                style={{
                  width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                  border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                  boxSizing: "border-box", backgroundColor: "var(--bg-subtle)",
                  color: editLocation ? "var(--fg)" : "var(--fg-faint)",
                  cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                }}
              >
                <span>{editLocation || "คลิกเพื่อเลือกหรือพิมพ์ค้นหาตึกเรียน/สถานที่..."}</span>
                <ChevronDown size={16} color="var(--fg-muted)" style={{ flexShrink: 0 }} />
              </div>

              {editLocationOpen && (
                <div
                  style={{
                    position: "absolute", top: "100%", left: 0, right: 0,
                    backgroundColor: "var(--bg-card)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "12px", boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
                    zIndex: 30, marginTop: "6px", padding: "10px",
                    display: "flex", flexDirection: "column", gap: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      padding: "8px 10px", backgroundColor: "var(--bg-subtle)",
                      borderRadius: "8px", border: "1px solid var(--border)",
                    }}
                  >
                    <Search size={15} color="var(--fg-accent)" />
                    <input
                      type="text"
                      placeholder="พิมพ์ค้นหาชื่อคณะ อาคาร หรือพื้นที่..."
                      value={editLocationSearch}
                      onChange={(e) => setEditLocationSearch(e.target.value)}
                      autoFocus
                      style={{
                        border: "none", background: "transparent", fontSize: "13.5px",
                        outline: "none", width: "100%", color: "var(--fg-strong)",
                      }}
                    />
                  </div>

                  <div style={{ maxHeight: "190px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {editLocationSearch.trim() &&
                      !UP_LOCATIONS.map((l) => l.toLowerCase()).includes(editLocationSearch.trim().toLowerCase()) && (
                        <div
                          onClick={() => {
                            setEditLocation(editLocationSearch.trim());
                            setEditLocationOpen(false);
                            setEditLocationSearch("");
                          }}
                          style={{
                            padding: "11px 10px", fontSize: "13.5px", cursor: "pointer",
                            borderRadius: "8px", backgroundColor: "var(--bg-hover)",
                            color: "var(--fg-accent)", fontWeight: 600,
                            borderBottom: "1px dashed var(--border-strong)", marginBottom: "4px",
                          }}
                        >
                          ใช้ข้อความที่พิมพ์ : "{editLocationSearch.trim()}"
                        </div>
                      )}

                    {UP_LOCATIONS.map((loc) => {
                      const visible =
                        !editLocationSearch.trim() ||
                        loc.toLowerCase().includes(editLocationSearch.trim().toLowerCase());
                      if (!visible) return null;
                      return (
                        <div
                          key={loc}
                          onClick={() => {
                            setEditLocation(loc);
                            setEditLocationOpen(false);
                            setEditLocationSearch("");
                          }}
                          style={{
                            padding: "11px 10px", fontSize: "13.5px", cursor: "pointer",
                            borderRadius: "8px",
                            backgroundColor: editLocation === loc ? "var(--bg-hover)" : "transparent",
                            color: editLocation === loc ? "var(--fg)" : "var(--fg-secondary)",
                            fontWeight: editLocation === loc ? 600 : 400,
                          }}
                        >
                          {loc}
                        </div>
                      );
                    })}
                    {editLocationSearch.trim() &&
                      UP_LOCATIONS.every(
                        (l) => !l.toLowerCase().includes(editLocationSearch.trim().toLowerCase())
                      ) && (
                        <div style={{ padding: "12px", fontSize: "13px", color: "var(--fg-faint)", textAlign: "center" }}>
                          ไม่พบสถานที่ "{editLocationSearch.trim()}"
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {item.itemType === "found" && (
            <div>
              <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                จุดฝาก / จุดคืน *
              </label>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", minHeight: "46px", padding: "10px 12px", borderRadius: "10px",
                  border: "1.5px solid var(--sc-ok-border)", fontSize: "13.5px", boxSizing: "border-box",
                  backgroundColor: "var(--sc-ok-bg)", color: "var(--sc-ok-fg-strong)",
                }}
              >
                <Lock size={14} />
                <span>{item.depositLocation || "ไม่ระบุจุด"}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-faint)", marginTop: "6px", lineHeight: 1.6 }}>
                แอดมินอนุมัติจุดนี้แล้ว ไม่สามารถแก้ไขได้ — โปรดติดต่อแอดมินหากต้องการเปลี่ยน
              </div>
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              รายละเอียดเพิ่มเติม
            </label>
            <textarea
              rows={3}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="สี, ตำหนิ, รายละเอียดที่ช่วยระบุตัว..."
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "13.5px", outline: "none",
                boxSizing: "border-box", fontFamily: "inherit", resize: "none", lineHeight: 1.6,
                backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13.5px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              รูปภาพ (สูงสุด {MAX_POST_IMAGES} รูป · รูปแรกคือรูปปก)
            </label>

            {/* รูปที่มีอยู่แล้ว — กดที่รูปเพื่อดูรูปปก ปุ่มลบมุมขวา */}
            {editImages.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "8px",
                  marginBottom: "10px",
                }}
              >
                {editImages.map((src, i) => (
                  <div
                    key={`${src.slice(-24)}-${i}`}
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      borderRadius: "12px",
                      overflow: "hidden",
                      border: "1px solid var(--border)",
                      background: "var(--bg-subtle)",
                    }}
                  >
                    <img
                      src={src}
                      alt={`รูปที่ ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    {i === 0 && (
                      <span style={{
                        position: "absolute", top: "4px", left: "4px",
                        padding: "2px 6px", borderRadius: "999px",
                        background: "rgba(0,0,0,0.66)", color: "#fff",
                        fontSize: "9.5px", fontWeight: 700, lineHeight: 1.5,
                      }}>
                        รูปปก
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditImages((prev) => prev.filter((_, x) => x !== i))}
                      aria-label={`ลบรูปที่ ${i + 1}`}
                      style={{
                        position: "absolute", top: "4px", right: "4px",
                        width: "24px", height: "24px", borderRadius: "50%",
                        background: "rgba(0,0,0,0.62)", color: "#fff", border: "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* รูปใหม่ที่เลือกแล้ว (ยังไม่อัปโหลด) */}
            {editNewFiles.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "8px",
                  marginBottom: "10px",
                }}
              >
                {editNewFiles.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      borderRadius: "12px",
                      overflow: "hidden",
                      border: "1.5px dashed var(--border-strong)",
                      background: "var(--bg-subtle)",
                    }}
                  >
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`รูปใหม่ที่ ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <button
                      type="button"
                      onClick={() => setEditNewFiles((prev) => prev.filter((_, x) => x !== i))}
                      aria-label={`เอารูปใหม่ที่ ${i + 1} ออก`}
                      style={{
                        position: "absolute", top: "4px", right: "4px",
                        width: "24px", height: "24px", borderRadius: "50%",
                        background: "rgba(0,0,0,0.62)", color: "#fff", border: "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {editImages.length + editNewFiles.length < MAX_POST_IMAGES ? (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "12px",
                  borderRadius: "12px",
                  backgroundColor: "var(--bg-subtle)",
                  border: "1.5px dashed var(--border-strong)",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--fg-secondary)",
                }}
              >
                <ImagePlus size={17} color="var(--fg-accent)" />
                เพิ่มรูปภาพ ({editImages.length + editNewFiles.length}/{MAX_POST_IMAGES})
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []);
                    e.target.value = "";
                    const room = MAX_POST_IMAGES - editImages.length - editNewFiles.length;
                    const accepted: File[] = [];
                    for (const f of picked) {
                      if (accepted.length >= room) break;
                      const err = validateImageFile(f);
                      if (err) {
                        showToast(err, "info");
                        continue;
                      }
                      accepted.push(f);
                    }
                    if (accepted.length > 0) setEditNewFiles((prev) => [...prev, ...accepted]);
                  }}
                  style={{ display: "none" }}
                />
              </label>
            ) : (
              <div style={{ fontSize: "11.5px", color: "var(--fg-muted)" }}>
                ครบ {MAX_POST_IMAGES} รูปแล้ว · ลบรูปที่ไม่ต้องการเพื่อเพิ่มรูปใหม่
              </div>
            )}
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="ยืนยันการลบโพสต์?"
        icon={Trash2}
        maxWidth={400}
        footer={
          <>
            <DialogButton onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting}>
              ยกเลิก
            </DialogButton>
            <DialogButton onClick={handleDeletePost} tone="danger" disabled={isDeleting}>
              {isDeleting ? "กำลังลบ..." : "ยืนยันลบ"}
            </DialogButton>
          </>
        }
      >
        <div style={{
          fontSize: "14.5px",
          color: "var(--fg-secondary)",
          lineHeight: 1.65,
        }}>
          เมื่อลบโพสต์นี้แล้ว ข้อมูลจะหายไปจากระบบและไม่สามารถกู้คืนได้อีก
        </div>
      </Dialog>

      {/* Report Modal */}
      <Dialog
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        title="แจ้งสวมสิทธิ์ / คืนผิดคน"
        subtitle="หากท่านเป็นเจ้าของทรัพย์สินนี้ แต่มีการส่งมอบให้ผู้อื่นผิดพลาด กรุณาระบุรายละเอียด เรื่องจะถูกส่งให้เจ้าหน้าที่ตรวจสอบ (โพสต์ยังแสดงตามปกติจนกว่าจะตรวจสอบเสร็จ)"
        icon={ShieldAlert}
        align="start"
        maxWidth={460}
        footer={
          <>
            <DialogButton onClick={() => setShowReportModal(false)} disabled={isSubmitting}>
              ยกเลิก
            </DialogButton>
            <DialogButton type="submit" formId="laf-report-impersonation" tone="danger" disabled={isSubmitting} icon={Send}>
              {isSubmitting ? "กำลังส่ง..." : "ส่งเรื่องท้วง"}
            </DialogButton>
          </>
        }
      >
        <form id="laf-report-impersonation" onSubmit={handleReportImpersonation}>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              เหตุผล / หลักฐานความเป็นเจ้าของ *
            </label>
            <textarea
              required
              rows={3}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="ระบุ เช่น มีตำหนิตรงไหน, หลักฐานการเป็นเจ้าของ..."
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "14px", outline: "none",
                boxSizing: "border-box", fontFamily: "inherit", resize: "none",
                backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              เบอร์ติดต่อกลับ / Line ID
            </label>
            <input
              type="text"
              value={reporterContact}
              onChange={(e) => setReporterContact(e.target.value)}
              placeholder="สำหรับเจ้าหน้าที่ติดต่อกลับ"
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "14px", outline: "none",
                boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
              }}
            />
          </div>
        </form>
      </Dialog>

      {/* Image Viewer Modal */}
      {showImageViewer && postImages.length > 0 && (
        <div
          onClick={() => setShowImageViewer(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.92)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "max(12px, env(safe-area-inset-top, 0px)) 12px max(12px, env(safe-area-inset-bottom, 0px))",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowImageViewer(false);
            }}
            style={{
              position: "absolute",
              top: "max(12px, env(safe-area-inset-top, 0px))",
              right: "12px",
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.3)",
              background: "rgba(0,0,0,0.5)",
              color: "var(--fg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 2,
            }}
            aria-label="ปิด"
          >
            <X size={22} />
          </button>

          <div style={{ maxWidth: "100%", maxHeight: "100%", textAlign: "center", padding: "24px" }}>
            <img
              src={postImages[viewerSafe]}
              alt={item.title}
              className="lightbox-cap"
              style={{
                maxWidth: "100%",
                maxHeight: "calc(100dvh - 140px)",
                borderRadius: "12px",
                objectFit: "contain",
                boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              }}
              {...(postImages.length > 1 ? viewerSwipe : {})}
            />
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 600 }}>
              <ZoomIn size={15} />
              {item.title}
              {postImages.length > 1 && (
                <span style={{ color: "#fff" }}>
                  ({viewerSafe + 1}/{postImages.length})
                </span>
              )}
            </div>

            {/* ลูกศรเลื่อนรูปใน lightbox */}
            {postImages.length > 1 &&
              ([-1, 1] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goViewer(viewerSafe + dir);
                  }}
                  aria-label={dir === -1 ? "รูปก่อนหน้า" : "รูปถัดไป"}
                  style={{
                    position: "absolute",
                    top: "50%",
                    [dir === -1 ? "left" : "right"]: "12px",
                    transform: "translateY(-50%)",
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    border: "1px solid rgba(255,255,255,0.3)",
                    background: "rgba(0,0,0,0.5)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    zIndex: 2,
                  }}
                >
                  {dir === -1 ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
                </button>
              ))}

            {/* ทริครูปย่อ */}
            {postImages.length > 1 && (
              <div
                style={{
                  marginTop: "14px",
                  display: "flex",
                  justifyContent: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                {postImages.map((src, i) => (
                  <button
                    key={`${src.slice(-24)}-${i}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewerIndex(i);
                    }}
                    aria-label={`ดูรูปที่ ${i + 1}`}
                    style={{
                      width: "52px",
                      height: "52px",
                      padding: 0,
                      borderRadius: "10px",
                      overflow: "hidden",
                      cursor: "pointer",
                      border:
                        i === viewerSafe
                          ? "2px solid #7c5cfc"
                          : "2px solid rgba(255,255,255,0.2)",
                      background: "transparent",
                      opacity: i === viewerSafe ? 1 : 0.6,
                    }}
                  >
                    <img
                      src={src}
                      alt={`รูปที่ ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* General Report Modal */}
      <Dialog
        open={showGeneralReportModal}
        onClose={() => {
          setShowGeneralReportModal(false);
          setGeneralReportDetail("");
          setGeneralReportCategory("เนื้อหาไม่เหมาะสม");
        }}
        title="รายงานโพสต์"
        subtitle="หากโพสต์นี้มีเนื้อหาที่ไม่เหมาะสม ข้อมูลเท็จ หรือสแปม โปรดแจ้งให้แอดมินทราบ"
        icon={Flag}
        align="start"
        maxWidth={460}
        footer={
          <>
            <DialogButton
              onClick={() => {
                setShowGeneralReportModal(false);
                setGeneralReportDetail("");
                setGeneralReportCategory("เนื้อหาไม่เหมาะสม");
              }}
              disabled={isSubmittingGeneralReport}
            >
              ยกเลิก
            </DialogButton>
            <DialogButton
              type="submit"
              formId="laf-report-general"
              tone="danger"
              disabled={isSubmittingGeneralReport}
              icon={Send}
            >
              {isSubmittingGeneralReport ? "กำลังส่ง..." : "ส่งรายงาน"}
            </DialogButton>
          </>
        }
      >
        <form id="laf-report-general" onSubmit={handleGeneralReport}>
          {/* เลือกหมวดหมู่ */}
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "8px" }}>
              หมวดหมู่รายงาน *
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {GENERAL_REPORT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setGeneralReportCategory(cat)}
                  style={{
                    padding: "8px 12px", borderRadius: 8, fontSize: "13px", fontWeight: 600,
                    border: "1px solid",
                    borderColor: generalReportCategory === cat ? "var(--sc-danger-fg)" : "var(--border)",
                    background: generalReportCategory === cat ? "rgba(248,113,113,0.12)" : "var(--bg-card)",
                    color: generalReportCategory === cat ? "var(--sc-danger-fg)" : "var(--fg-muted)",
                    cursor: "pointer",
                    minHeight: "40px",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* รายละเอียด */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
              รายละเอียดเพิ่มเติม (ถ้ามี)
            </label>
            <textarea
              rows={3}
              value={generalReportDetail}
              onChange={(e) => setGeneralReportDetail(e.target.value)}
              placeholder="อธิบายปัญหาที่พบ..."
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "10px",
                border: "1.5px solid var(--border)", fontSize: "14px", outline: "none",
                boxSizing: "border-box", fontFamily: "inherit", resize: "none",
                backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
              }}
            />
          </div>
        </form>
      </Dialog>

      <ToastContainer />
    </div>
  );
}