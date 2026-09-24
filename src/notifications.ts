import { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  where,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type { FirestoreTimeLike } from "./types";

export interface AppNotification {
  id: string;
  type?: string;
  recipientRole?: string;
  recipientUid?: string;
  pointName?: string;
  claimId?: string;
  postId?: string;
  postTitle?: string;
  itemType?: string;
  claimantName?: string;
  reporterName?: string;
  category?: string;
  detail?: string;
  text?: string;
  status?: string;
  read?: boolean;
  createdAt?: FirestoreTimeLike;
}

const resolveTime = (t?: FirestoreTimeLike): number => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t !== "object") return new Date(t).getTime();
  if (typeof t.toDate === "function") return t.toDate().getTime();
  return 0;
};

export const formatRelative = (t?: FirestoreTimeLike): string => {
  const ms = resolveTime(t);
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "เมื่อกี้นี้";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ชั่วโมงที่แล้ว`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} วันที่แล้ว`;
  return new Date(ms).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
};

export function useNotifications(
  enabled: boolean,
  uid?: string,
  isAdmin?: boolean,
  opts?: { isSuperAdmin?: boolean; adminPoint?: string | null }
) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    // Query ต้องมี where constraint ให้ตรงกับ Security Rules (rules are not filters)
    // ไม่งั้น Firestore จะ deny ทั้ง query ด้วย PERMISSION_DENIED ยกเว้นมี index ที่สอดคล้อง
    const staffPoint = isAdmin && !opts?.isSuperAdmin && opts?.adminPoint;
    const constraints: Parameters<typeof query>[1][] = staffPoint
      ? [
          where("recipientRole", "==", "admin"),
          where("pointName", "==", staffPoint),
          orderBy("createdAt", "desc"),
          limit(50),
        ]
      : isAdmin
      ? [
          where("recipientRole", "==", "admin"),
          orderBy("createdAt", "desc"),
          limit(50),
        ]
      : [
          where("recipientUid", "==", uid || ""),
          orderBy("createdAt", "desc"),
          limit(50),
        ];
    const q = query(collection(db, "notifications"), ...constraints);
    const un = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as AppNotification
        );
        // เจ้าหน้าที่ประจำจุด เห็นเฉพาะการแจ้งเตือนของจุดตัวเอง
        const isOwnPoint =
          isAdmin && !opts?.isSuperAdmin && opts?.adminPoint;
        const list = all.filter((n) =>
          isAdmin
            ? n.recipientRole === "admin" &&
              (!isOwnPoint || n.pointName === opts?.adminPoint)
            : !!uid && n.recipientUid === uid
        );
        setItems(list);
        setUnread(list.filter((n) => !n.read).length);
      },
      (error) => console.error("Error fetching notifications:", error)
    );
    return () => un();
  }, [enabled, uid, isAdmin, opts?.isSuperAdmin, opts?.adminPoint]);

  const markRead = async (id: string) => {
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const markAllRead = async () => {
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    if (!unreadIds.length) return;
    const batch = writeBatch(db);
    unreadIds.forEach((id) =>
      batch.update(doc(db, "notifications", id), { read: true })
    );
    try {
      await batch.commit();
    } catch (error) {
      console.error("Error marking notifications as read:", error);
    }
  };

  const removeNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, "notifications", id));
    } catch (error) {
      console.error("Error deleting notification:", error);
      throw error;
    }
  };

  return { items, unread, markRead, markAllRead, removeNotification, formatRelative };
}