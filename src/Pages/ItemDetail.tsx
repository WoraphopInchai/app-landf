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
  Loader2,
  GraduationCap,
  Users,
  Sparkles,
  Pencil,
  FileText,
  Search,
  ChevronDown,
  Lock,
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
import { uploadToCloudinary } from "../lib/uploadImage";
import { isCurrentUserBanned } from "../lib/userGuard";
import { ITEM_CATEGORIES, UP_LOCATIONS } from "../constants";
import type { AppUser, PostItem, FirestoreTimeLike } from "../types";
import { showToast } from "../lib/toast";
import ToastContainer from "../components/Toast";

const MIN_PICKUP_DATETIME = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
const MAX_PICKUP_DATETIME = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

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
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
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
  const [claimType, setClaimType] = useState<"student" | "public">("student");
  const [claimName, setClaimName] = useState("");
  const [claimStudentId, setClaimStudentId] = useState("");
  const [claimPhone, setClaimPhone] = useState("");
  const [claimEmail, setClaimEmail] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [claimEvidenceFile, setClaimEvidenceFile] = useState<File | null>(null);
  const [claimEvidenceUrl, setClaimEvidenceUrl] = useState<string>("");
  const [claimPickupDate, setClaimPickupDate] = useState("");
  const [isClaimEvidenceUploading, setIsClaimEvidenceUploading] = useState(false);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
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

  if (!item) {
    return null;
  }

  const isLost = item.itemType === "lost" || item.type === "lost";
  const isResolved = item.status === "resolved";
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
    setEditImageFile(null);
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
      let newImageUrl = item.imageUrl || item.image || "";
      if (editImageFile) {
        try {
          newImageUrl = await uploadToCloudinary(editImageFile);
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
      } = {
        category: editCategory,
        title: editTitle.trim(),
        desc: editDesc.trim(),
        locationName: editLocation.trim(),
        building: editLocation.trim(),
        imageUrl: newImageUrl || null,
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

    if (!claimName.trim()) {
      showToast("กรุณาระบุชื่อ-นามสกุล", "info");
      return;
    }

    if (claimType === "student") {
      if (!claimStudentId.trim()) {
        showToast("กรุณาระบุรหัสนิสิต", "info");
        return;
      }
      if (!claimPhone.trim()) {
        showToast("กรุณาระบุเบอร์โทร", "info");
        return;
      }
    } else {
      if (!claimPhone.trim()) {
        showToast("กรุณาระบุเบอร์โทร", "info");
        return;
      }
      if (!claimEmail.trim() || !/^\S+@\S+\.\S+$/.test(claimEmail.trim())) {
        showToast("กรุณาระบุอีเมลที่ถูกต้อง เช่น name@example.com", "info");
        return;
      }
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
        claimantName: claimName.trim(),
        claimType,
        studentId: claimType === "student" ? claimStudentId.trim() : "",
        phone: claimPhone.trim(),
        email: claimType === "public" ? claimEmail.trim() : "",
        contact: claimPhone.trim() || "ไม่ระบุช่องทางติดต่อ",
        note: claimNote.trim(),
        evidenceUrl,
        status: "pending",
        expiresAt,
        expiresAtMs: new Date(expiresAt).getTime(),
        pickupDate: claimPickupDate || null,
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
          claimantName: claimName.trim(),
          read: false,
          createdAt: serverTimestamp(),
        });
      } catch (notifError) {
        console.error("Error creating claim notification:", notifError);
      }

      showToast(claimPickupDate
        ? "ส่งคำขอรับของเรียบร้อย ระบบได้จองโพสต์นี้ไว้แล้วจนถึงวันนัดรับ กรุณามารับของตามเวลาที่กำหนด"
        : "ส่งคำขอรับของเรียบร้อย ระบบได้จองโพสต์นี้ไว้แล้ว (24 ชม.) กรุณามาติดต่อเจ้าหน้าที่เพื่อรับของ");
      setShowClaimModal(false);
      setClaimType("student");
      setClaimName("");
      setClaimStudentId("");
      setClaimPhone("");
      setClaimEmail("");
      setClaimNote("");
      setClaimPickupDate("");
      setClaimEvidenceFile(null);
      setClaimEvidenceUrl("");
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
    if (isSuspended) return { label: "ถูกระงับชั่วคราว", bg: "#fef2f2", border: "#fca5a5", color: "#dc2626", icon: <ShieldAlert size={16} /> };
    if (isInvestigating) return { label: "อยู่ระหว่างการอายัด", bg: "#fef2f2", border: "#fca5a5", color: "#dc2626", icon: <ShieldAlert size={16} /> };
    if (isPending) return { label: "รอแอดมินตรวจรับของ", bg: "#fffbeb", border: "#fcd34d", color: "#b45309", icon: <Clock size={16} /> };
    if (isRejected) return { label: "คำขอถูกปฏิเสธ", bg: "#fef2f2", border: "#fca5a5", color: "#dc2626", icon: <ShieldAlert size={16} /> };
    if (isResolved) return { label: "คืนเรียบร้อยแล้ว", bg: "#f0fdf4", border: "#86efac", color: "#16a34a", icon: <CheckCircle2 size={16} /> };
    if (isInProgress) return { label: "กำลังดำเนินการ", bg: "#eff6ff", border: "#bfdbfe", color: "#2563eb", icon: <Navigation size={16} /> };
    if (isLost) return { label: "ตามหาอยู่", bg: "#fffbeb", border: "#fde68a", color: "#d97706", icon: <AlertTriangle size={16} /> };
    return { label: "พบแล้ว", bg: "#ecfdf5", border: "#a7f3d0", color: "#059669", icon: <PackageCheck size={16} /> };
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
        {item.imageUrl || item.image ? (
          <button
            onClick={() => setShowImageViewer(true)}
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
          >
            <img
              src={item.imageUrl || item.image || undefined}
              alt={item.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: isResolved ? "grayscale(20%)" : "none",
              }}
            />
          </button>
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

        {(item.imageUrl || item.image) && (
          <div
            onClick={() => setShowImageViewer(true)}
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
            backgroundColor: "#141c30", border: "1px solid #2a3a5c", borderRadius: "14px",
            padding: "13px 14px", marginBottom: "12px", display: "flex", gap: "10px", alignItems: "flex-start",
          }}>
            <Navigation size={18} color="#60a5fa" style={{ flexShrink: 0, marginTop: "1px" }} />
            <div style={{ fontSize: "12px", color: "#a3c2f7", lineHeight: "1.6" }}>
              <strong>กำลังดำเนินการ:</strong> มีผู้แจ้งว่าเป็นเจ้าของและกำลังเดินทางไปรับของชิ้นนี้ที่จุดรับของ
            </div>
          </div>
        )}

        {isInvestigating && (
          <div className="detail-card" style={{
            backgroundColor: "#2a1418", border: "1px solid #4a1f28", borderRadius: "14px",
            padding: "13px 14px", marginBottom: "12px", display: "flex", gap: "10px", alignItems: "flex-start",
          }}>
            <ShieldAlert size={18} color="#f87171" style={{ flexShrink: 0, marginTop: "1px" }} />
            <div style={{ fontSize: "12px", color: "#fca5a5", lineHeight: "1.6" }}>
              <strong>เคสนี้ถูกอายัดชั่วคราว:</strong> เนื่องจากมีการแจ้งสวมสิทธิ์หรือรายงานข้อผิดพลาด เจ้าหน้าที่กำลังตรวจสอบข้อมูลความถูกต้อง
            </div>
          </div>
        )}

        {isResolved && (
          <div className="detail-card" style={{
            backgroundColor: "#0f2a1f", border: "1px solid #1f4a35", borderRadius: "14px",
            padding: "13px 14px", marginBottom: "12px", display: "flex", gap: "10px", alignItems: "flex-start",
          }}>
            <CheckCircle2 size={18} color="#34d399" style={{ flexShrink: 0, marginTop: "1px" }} />
            <div style={{ fontSize: "12px", color: "#6ee7b7", lineHeight: "1.6" }}>
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
                background: "#0f2a1f", border: "1px solid #1f4a35",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <ShieldAlert size={17} color="#34d399" />
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#34d399", fontWeight: 700, marginBottom: "2px" }}>
                  จุดรับของ
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#6ee7b7", lineHeight: 1.4 }}>
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
                    background: mp.confirmed ? "#0f2a1f" : "#2a2118",
                    border: mp.confirmed ? "1px solid #1f4a35" : "1px solid #4a3418",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <CheckCircle2 size={14} color={mp.confirmed ? "#34d399" : "#fbbf24"} />
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
                        color: mp.confirmed ? "#34d399" : "#fbbf24",
                        background: mp.confirmed ? "#0f2a1f" : "#2a2118",
                        border: mp.confirmed ? "1px solid #1f4a35" : "1px solid #4a3418",
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
                            height: 26,
                            padding: "0 10px",
                            borderRadius: 7,
                            border: "1px solid rgba(52,211,153,0.5)",
                            background: "rgba(52,211,153,0.14)",
                            color: "#34d399",
                            fontSize: 10.5,
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
                            height: 26,
                            padding: "0 10px",
                            borderRadius: 7,
                            border: "1px solid rgba(244,63,94,0.5)",
                            background: "rgba(244,63,94,0.10)",
                            color: "#f87171",
                            fontSize: 10.5,
                            fontWeight: 800,
                            cursor: busyConfirmKey ? "wait" : "pointer",
                          }}
                        >
                          ไม่ใช่ของฉัน
                        </button>
                      </div>
                    ) : (
                      <div style={{
                        fontSize: "10.5px", color: "#34d399", marginTop: "4px",
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
              { label: "ตรวจสอบ", sub: "รอการตรวจสอบจากเจ้าหน้าที่", done: isInvestigating || isInProgress || isResolved, color: "#60a5fa" },
              { label: isLost ? "เจ้าของมารับ" : "ส่งมอบของ", sub: isResolved ? "ดำเนินการเรียบร้อยแล้ว" : "รอการดำเนินการ", done: isResolved, color: "#34d399" },
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
              backgroundColor: isPending ? "#2a1a10" : "#2a1418",
              border: isPending ? "1px solid #4a3418" : "1px solid #4a1f28",
              color: isPending ? "#fbbf24" : "#f87171",
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
                  onRequireLogin?.(() => setShowClaimModal(true));
                  return;
                }
                setShowClaimModal(true);
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
                border: "1.5px solid #4a1f28", backgroundColor: "#2a1418",
                color: "#f87171", fontSize: "14px", fontWeight: 700,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              }}
            >
              <AlertTriangle size={18} color="#f87171" />
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
                e.currentTarget.style.color = "#f87171";
                e.currentTarget.style.borderColor = "#f87171";
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
                border: "1px solid #4a1f28", backgroundColor: "#2a1418",
                color: "#f87171", fontSize: "13px", fontWeight: 700,
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
      {showClaimModal && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "16px", animation: "fadeIn 0.2s ease",
          overflowY: "auto",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px",
            width: "100%", maxWidth: "400px",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(124,92,252,0.12)",
            border: "1px solid var(--border)",
            margin: "auto",
            maxHeight: "calc(100vh - 32px)",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              position: "relative",
              padding: "20px 20px 16px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}>
              <button
                onClick={() => {
                  setShowClaimModal(false);
                  setClaimType("student");
                  setClaimName("");
                  setClaimStudentId("");
                  setClaimPhone("");
                  setClaimEmail("");
                  setClaimNote("");
                  setClaimPickupDate("");
                  setClaimEvidenceFile(null);
                  setClaimEvidenceUrl("");
                }}
                style={{
                  position: "absolute", top: 16, right: 16,
                  width: 30, height: 30, borderRadius: "50%",
                  background: "var(--bg-hover)", border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--fg-secondary)",
                }}
              >
                <X size={16} />
              </button>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  width: "56px", height: "56px", borderRadius: "16px", margin: "0 auto 12px",
                  background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 8px 20px rgba(124,92,252,0.45)",
                }}>
                  <PackageCheck size={26} color="var(--accent-fg)" />
                </div>
                <h3 style={{ fontSize: "17px", fontWeight: 800, color: "var(--fg)", margin: "0 0 6px 0" }}>
                  ส่งคำขอรับของถึงแอดมิน
                </h3>
                <p style={{ fontSize: "12px", color: "var(--fg-muted)", lineHeight: "1.6", margin: 0, paddingRight: "16px" }}>
                  ส่งแล้วโพสต์จะถูกจองให้คุณทันที (24 ชม. หรือตามวันที่นัดรับ) แล้วนำหลักฐานไปแสดงกับเจ้าหน้าที่ที่จุดรับของ
                </p>
              </div>
            </div>

            {/* Scrollable Body */}
            <div
              className="claim-modal-body"
              style={{
                flex: 1, overflowY: "auto", padding: "16px 20px 20px",
                scrollbarWidth: "none", msOverflowStyle: "none",
                minHeight: 0,
              }}
            >
              <div style={{
                backgroundColor: "#2a2118", border: "1px solid #4a3418", borderRadius: "12px",
                padding: "12px", marginBottom: "16px",
              }}>
                <div style={{ fontSize: "11px", color: "#fcd34d", lineHeight: 1.5 }}>
                  <strong>ขั้นตอนการรับของ:</strong><br />
                  1. ส่งคำขอ → โพสต์จะถูกจองให้คุณทันที (24 ชม. / ตามวันนัด)<br />
                  2. ไปที่จุดรับของพร้อมหลักฐานความเป็นเจ้าของ<br />
                  3. เจ้าหน้าที่ตรวจสอบและยืนยัน → ระบบจะปิดเคสเป็น "คืนแล้ว"
                </div>
              </div>

              {/* Tabs: นิสิต / บุคคลทั่วไป (เหมือนหน้า Login) */}
              <div style={{
                display: "flex",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                padding: "4px",
                marginBottom: "16px",
                position: "relative",
              }}>
                <div style={{
                  position: "absolute",
                  top: "4px",
                  bottom: "4px",
                  width: "calc(50% - 4px)",
                  borderRadius: "9px",
                  background: "linear-gradient(135deg, #7c5cfc, #6a4eff)",
                  boxShadow: "0 4px 16px rgba(124,92,252,0.4)",
                  transition: "left 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
                  zIndex: 0,
                  left: claimType === "public" ? "calc(50% + 0px)" : "0px",
                }} />
                <button
                  type="button"
                  onClick={() => setClaimType("student")}
                  style={{
                    flex: 1,
                    position: "relative",
                    zIndex: 1,
                    padding: "11px 0",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: claimType === "student" ? "#fff" : "var(--fg-muted)",
                    transition: "color 0.2s ease",
                  }}
                >
                  <GraduationCap size={14} />
                  นิสิต
                </button>
                <button
                  type="button"
                  onClick={() => setClaimType("public")}
                  style={{
                    flex: 1,
                    position: "relative",
                    zIndex: 1,
                    padding: "11px 0",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "7px",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: claimType === "public" ? "#fff" : "var(--fg-muted)",
                    transition: "color 0.2s ease",
                  }}
                >
                  <Users size={14} />
                  บุคคลทั่วไป
                </button>
              </div>

              {/* ชื่อ-นามสกุล (มีทั้งสองฝั่ง) */}
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  ชื่อ-นามสกุล *
                </label>
                <input
                  type="text"
                  value={claimName}
                  onChange={(e) => setClaimName(e.target.value)}
                  placeholder="เช่น สมชาย ใจดี"
                  required
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                    transition: "border-color 0.15s",
                  }}
                />
              </div>

              {/* เฉพาะนิสิต: รหัสนิสิต */}
              {claimType === "student" && (
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                    รหัสนิสิต *
                  </label>
                  <input
                    type="text"
                    value={claimStudentId}
                    onChange={(e) => setClaimStudentId(e.target.value)}
                    placeholder="เช่น 63XXXXXXXX"
                    required
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px",
                      border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                      boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                      transition: "border-color 0.15s",
                    }}
                  />
                </div>
              )}

              {/* เบอร์โทร (มีทั้งสองฝั่ง) */}
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  เบอร์โทร *
                </label>
                <input
                  type="tel"
                  value={claimPhone}
                  onChange={(e) => setClaimPhone(e.target.value)}
                  placeholder="เช่น 08X-XXX-XXXX"
                  required
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                    transition: "border-color 0.15s",
                  }}
                />
              </div>

              {/* เฉพาะบุคคลทั่วไป: อีเมล */}
              {claimType === "public" && (
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                    อีเมล *
                  </label>
                  <input
                    type="email"
                    value={claimEmail}
                    onChange={(e) => setClaimEmail(e.target.value)}
                    placeholder="เช่น name@example.com"
                    required
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px",
                      border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                      boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                      transition: "border-color 0.15s",
                    }}
                  />
                </div>
              )}

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  รายละเอียด / หลักฐาน (เพิ่มเติม)
                </label>
                <textarea
                  rows={3}
                  value={claimNote}
                  onChange={(e) => setClaimNote(e.target.value)}
                  placeholder="ระบุตำหนิ รายละเอียดที่พอจำได้ หรือหลักฐานยืนยันตัวตน"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", fontFamily: "inherit", resize: "none",
                    backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                    transition: "border-color 0.15s",
                  }}
                />
              </div>

              <div style={{ marginBottom: "4px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
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
                      onClick={() => { setClaimEvidenceFile(null); setClaimEvidenceUrl(""); }}
                      style={{
                        position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: "50%",
                        background: "rgba(0,0,0,0.6)", border: "none", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor="claim-evidence-upload"
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      padding: "22px 16px", borderRadius: "12px", cursor: "pointer",
                      border: "1.5px dashed var(--border-strong)", backgroundColor: "var(--bg-subtle)",
                      color: "var(--fg-muted)", fontSize: "12px", fontWeight: 600, gap: "8px",
                      transition: "border-color 0.15s",
                    }}
                  >
                    <ImagePlus size={22} color="var(--fg-accent)" />
                    แตะเพื่อเลือกรูปหลักฐาน
                    <span style={{ fontSize: "10px", color: "var(--fg-faint)" }}>PNG, JPG สูงสุด 5MB</span>
                  </label>
                )}
              </div>
            </div>

            {/* นัดวันรับของ (ไม่บังคับ) */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                นัดวัน-เวลามารับของ <span style={{ color: "var(--fg-faint)", fontWeight: 500 }}>(ไม่บังคับ · ถ้าไม่เลือกคำขอมีอายุ 24 ชม.)</span>
              </label>
              <input
                type="datetime-local"
                value={claimPickupDate}
                min={MIN_PICKUP_DATETIME}
                max={MAX_PICKUP_DATETIME}
                onChange={(e) => setClaimPickupDate(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: "10px",
                  border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                  boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  colorScheme: "dark",
                }}
              />
              <div style={{ fontSize: "10.5px", color: "var(--fg-faint)", marginTop: "5px", lineHeight: 1.5 }}>
                ระบุวันมารับที่คุณสะดวก คำขอจะถูกจองไว้จนถึงเวลานั้น (ถ้าไม่มาตรงเวลาจะโดนปล่อยให้คนถัดไป)
              </div>
            </div>

            {/* Sticky Footer */}
            <div style={{
              display: "flex", gap: "10px", flexShrink: 0,
              padding: "14px 20px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-card)",
            }}>
              <button
                onClick={() => {
                  setShowClaimModal(false);
                  setClaimType("student");
                  setClaimName("");
                  setClaimStudentId("");
                  setClaimPhone("");
                  setClaimEmail("");
                  setClaimNote("");
                  setClaimPickupDate("");
                  setClaimEvidenceFile(null);
                  setClaimEvidenceUrl("");
                }}
                style={{
                  flex: 1, padding: "12px", borderRadius: "12px",
                  border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                  color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 700, cursor: "pointer",
                }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleClaimItem}
                disabled={isSubmitting}
                style={{
                  flex: 1, padding: "12px", borderRadius: "12px", border: "none",
                  background: "#7c5cfc",
                  color: "var(--accent-fg)", fontSize: "13px", fontWeight: 700,
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  boxShadow: "0 6px 18px rgba(124,92,252,0.4)",
                }}
              >
                {isSubmitting ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={15} />}
                {isSubmitting
                  ? isClaimEvidenceUploading
                    ? "กำลังอัปโหลดรูปหลักฐาน..."
                    : "กำลังส่งคำขอ..."
                  : "ส่งคำขอรับของ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Post Modal */}
      {showEditModal && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px", animation: "fadeIn 0.2s ease",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "400px",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
            maxHeight: "calc(100vh - 32px)", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--fg-strong)", fontWeight: 800, fontSize: "16px" }}>
                <Pencil size={20} />
                แก้ไขโพสต์
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                style={{
                  border: "none", background: "var(--bg-hover)", cursor: "pointer",
                  color: "var(--fg-secondary)", borderRadius: "50%", width: "30px", height: "30px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  ประเภท *
                </label>
                <select
                  disabled
                  value={item.itemType || item.type || "lost"}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg-faint)",
                    cursor: "not-allowed", opacity: 0.75,
                  }}
                >
                  <option value="lost">ของหาย</option>
                  <option value="found">ของที่พบ</option>
                </select>
                <div style={{ fontSize: 10.5, color: "var(--fg-faint)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <Lock size={11} /> ไม่สามารถเปลี่ยนประเภทโพสต์หลังประกาศแล้ว
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  หมวดหมู่สิ่งของ *
                </label>
                <select
                  required
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
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

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  ชื่อสิ่งของ *
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="เช่น กระติกน้ำสีฟ้า, กุญแจพร้อมสายคล้อง"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  }}
                />
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  สถานที่ / ตึกเรียน *
                </label>
                <div ref={editLocationDropdownRef} style={{ position: "relative" }}>
                  <div
                    onClick={() => setEditLocationOpen((o) => !o)}
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px",
                      border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                      boxSizing: "border-box", backgroundColor: "var(--bg-subtle)",
                      color: editLocation ? "var(--fg)" : "var(--fg-faint)",
                      cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <span>{editLocation || "คลิกเพื่อเลือกหรือพิมพ์ค้นหาตึกเรียน/สถานที่..."}</span>
                    <ChevronDown size={15} color="var(--fg-muted)" />
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
                        <Search size={14} color="var(--fg-accent)" />
                        <input
                          type="text"
                          placeholder="พิมพ์ค้นหาชื่อคณะ อาคาร หรือพื้นที่..."
                          value={editLocationSearch}
                          onChange={(e) => setEditLocationSearch(e.target.value)}
                          autoFocus
                          style={{
                            border: "none", background: "transparent", fontSize: "12px",
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
                                padding: "9px 10px", fontSize: "12px", cursor: "pointer",
                                borderRadius: "4px", backgroundColor: "var(--bg-hover)",
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
                                padding: "9px 10px", fontSize: "12px", cursor: "pointer",
                                borderRadius: "4px",
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
                          <div style={{ padding: "10px", fontSize: "12px", color: "var(--fg-faint)", textAlign: "center" }}>
                            ไม่พบสถานที่ "{editLocationSearch.trim()}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {item.itemType === "found" && (
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                    จุดฝาก / จุดคืน *
                  </label>
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      width: "100%", padding: "10px 12px", borderRadius: "10px",
                      border: "1.5px solid #1f4a35", fontSize: "12px", boxSizing: "border-box",
                      backgroundColor: "#0f2a1f", color: "#6ee7b7",
                    }}
                  >
                    <Lock size={13} />
                    <span>{item.depositLocation || "ไม่ระบุจุด"}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--fg-faint)", marginTop: 4 }}>
                    แอดมินอนุมัติจุดนี้แล้ว ไม่สามารถแก้ไขได้ — โปรดติดต่อแอดมินหากต้องการเปลี่ยน
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  รายละเอียดเพิ่มเติม
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="สี, ตำหนิ, รายละเอียดที่ช่วยระบุตัว..."
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", fontFamily: "inherit", resize: "none",
                    backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  }}
                />
              </div>

              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  รูปภาพ (เลือกใหม่เท่านั้น ไม่เลือก = ใช้รูปเดิม)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setEditImageFile(e.target.files?.[0] || null)}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg-secondary)",
                  }}
                />
                {!editImageFile && (item.imageUrl || item.image) && (
                  <img
                    src={item.imageUrl || item.image || ""}
                    alt="รูปปัจจุบัน"
                    style={{ marginTop: "8px", width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "12px" }}
                  />
                )}
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSavingEdit}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "12px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                    color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 700,
                    cursor: isSavingEdit ? "not-allowed" : "pointer",
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "12px", border: "none",
                    background: "linear-gradient(135deg, #7c5cfc 0%, #4f3bd6 100%)",
                    color: "var(--accent-fg)", fontSize: "13px", fontWeight: 700,
                    cursor: isSavingEdit ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  }}
                >
                  {isSavingEdit ? <Loader2 size={15} className="spin" /> : <Pencil size={15} />}
                  {isSavingEdit ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px", animation: "fadeIn 0.2s ease",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "24px",
            width: "100%", maxWidth: "360px", textAlign: "center",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", color: "#f87171" }}>
              <Trash2 size={36} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, color: "var(--fg)", marginBottom: "8px" }}>
              ยืนยันการลบโพสต์?
            </h3>
            <p style={{ fontSize: "13px", color: "var(--fg-muted)", marginBottom: "20px", lineHeight: "1.6" }}>
              เมื่อลบโพสต์นี้แล้ว ข้อมูลจะหายไปจากระบบและไม่สามารถกู้คืนได้อีก
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{
                  flex: 1, padding: "12px", borderRadius: "12px",
                  border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                  color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 700, cursor: "pointer",
                }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleDeletePost}
                disabled={isDeleting}
                style={{
                  flex: 1, padding: "12px", borderRadius: "12px", border: "none",
                  backgroundColor: "#dc2626", color: "var(--fg)",
                  fontSize: "13px", fontWeight: 700,
                  cursor: isDeleting ? "not-allowed" : "pointer",
                }}
              >
                {isDeleting ? "กำลังลบ..." : "ยืนยันลบ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px", animation: "fadeIn 0.2s ease",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "400px",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#f87171", fontWeight: 800, fontSize: "16px" }}>
                <ShieldAlert size={20} />
                แจ้งสวมสิทธิ์ / คืนผิดคน
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                style={{
                  border: "none", background: "var(--bg-hover)", cursor: "pointer",
                  color: "var(--fg-secondary)", borderRadius: "50%", width: "30px", height: "30px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "16px", lineHeight: "1.6" }}>
              หากท่านเป็นเจ้าของทรัพย์สินนี้ แต่มีการส่งมอบให้ผู้อื่นผิดพลาด กรุณาระบุรายละเอียด
              เรื่องจะถูกส่งให้เจ้าหน้าที่ตรวจสอบ (โพสต์ยังแสดงตามปกติจนกว่าจะตรวจสอบเสร็จ)
            </p>

            <form onSubmit={handleReportImpersonation}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
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
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", fontFamily: "inherit", resize: "none",
                    backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  }}
                />
              </div>

              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  เบอร์ติดต่อกลับ / Line ID
                </label>
                <input
                  type="text"
                  value={reporterContact}
                  onChange={(e) => setReporterContact(e.target.value)}
                  placeholder="สำหรับเจ้าหน้าที่ติดต่อกลับ"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  style={{
                    flex: 1, padding: "11px", borderRadius: "10px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                    color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 700, cursor: "pointer",
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    flex: 1, padding: "11px", borderRadius: "10px", border: "none",
                    backgroundColor: "#dc2626", color: "var(--fg)",
                    fontSize: "13px", fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  }}
                >
                  <Send size={14} />
                  {isSubmitting ? "กำลังส่ง..." : "ส่งเรื่องท้วง"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Viewer Modal */}
      {showImageViewer && (item.imageUrl || item.image) && (
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
              top: "16px",
              right: "16px",
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
              src={item.imageUrl || item.image || undefined}
              alt={item.title}
              style={{
                maxWidth: "100%",
                maxHeight: "calc(100vh - 140px)",
                borderRadius: "12px",
                objectFit: "contain",
                boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              }}
            />
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 600 }}>
              <ZoomIn size={15} />
              {item.title}
            </div>
          </div>
        </div>
      )}

      {/* General Report Modal */}
      {showGeneralReportModal && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(5,4,10,0.72)",
          backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px", animation: "fadeIn 0.2s ease",
        }}>
          <div style={{
            backgroundColor: "var(--bg-card)", borderRadius: "20px", padding: "22px",
            width: "100%", maxWidth: "400px",
            boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#f87171", fontWeight: 800, fontSize: "16px" }}>
                <Flag size={20} />
                รายงานโพสต์
              </div>
              <button
                onClick={() => {
                  setShowGeneralReportModal(false);
                  setGeneralReportDetail("");
                  setGeneralReportCategory("เนื้อหาไม่เหมาะสม");
                }}
                style={{
                  border: "none", background: "var(--bg-hover)", cursor: "pointer",
                  color: "var(--fg-secondary)", borderRadius: "50%", width: "30px", height: "30px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "14px", lineHeight: "1.6" }}>
              หากโพสต์นี้มีเนื้อหาที่ไม่เหมาะสม ข้อมูลเท็จ หรือสแปม โปรดแจ้งให้แอดมินทราบ
            </p>

            <form onSubmit={handleGeneralReport}>
              {/* เลือกหมวดหมู่ */}
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  หมวดหมู่รายงาน *
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {GENERAL_REPORT_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setGeneralReportCategory(cat)}
                      style={{
                        padding: "5px 10px", borderRadius: 8, fontSize: "11px", fontWeight: 600,
                        border: "1px solid",
                        borderColor: generalReportCategory === cat ? "#f87171" : "var(--border)",
                        background: generalReportCategory === cat ? "rgba(248,113,113,0.12)" : "var(--bg-card)",
                        color: generalReportCategory === cat ? "#f87171" : "var(--fg-muted)",
                        cursor: "pointer",
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* รายละเอียด */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)", marginBottom: "6px" }}>
                  รายละเอียดเพิ่มเติม (ถ้ามี)
                </label>
                <textarea
                  rows={3}
                  value={generalReportDetail}
                  onChange={(e) => setGeneralReportDetail(e.target.value)}
                  placeholder="อธิบายปัญหาที่พบ..."
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px",
                    border: "1.5px solid var(--border)", fontSize: "12px", outline: "none",
                    boxSizing: "border-box", fontFamily: "inherit", resize: "none",
                    backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowGeneralReportModal(false);
                    setGeneralReportDetail("");
                    setGeneralReportCategory("เนื้อหาไม่เหมาะสม");
                  }}
                  style={{
                    flex: 1, padding: "11px", borderRadius: "10px",
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                    color: "var(--fg-secondary)", fontSize: "13px", fontWeight: 700, cursor: "pointer",
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingGeneralReport}
                  style={{
                    flex: 1, padding: "11px", borderRadius: "10px", border: "none",
                    backgroundColor: "#dc2626", color: "#fff",
                    fontSize: "13px", fontWeight: 700, cursor: isSubmittingGeneralReport ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                    opacity: isSubmittingGeneralReport ? 0.7 : 1,
                  }}
                >
                  <Send size={14} />
                  {isSubmittingGeneralReport ? "กำลังส่ง..." : "ส่งรายงาน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}