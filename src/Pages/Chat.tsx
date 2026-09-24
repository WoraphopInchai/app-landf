import { useState, useEffect, useRef, useCallback, useMemo, Fragment, type ReactNode } from "react";
import {
  ArrowLeft,
  Send,
  MoreVertical,
  UserCircle,
  MessageSquare,
  Search,
  Check,
  CheckCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  where,
  getDoc,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, FirestoreTimeLike } from "../types";
import ToastContainer from "../components/Toast";
import { showToast } from "../lib/toast";
import { isCurrentUserBanned } from "../lib/userGuard";
import ConfirmModal from "../components/ConfirmModal";

// =========================
// Types
// =========================
interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  imageUrl?: string;
  createdAt?: FirestoreTimeLike;
}

interface ChatInfo {
  id: string;
  postId?: string;
  postTitle?: string;
  participants?: string[];
  participantIds?: string[];
  participantNames?: Record<string, string>;
  lastMessage?: string;
  lastMessageAt?: FirestoreTimeLike;
  lastSenderId?: string;
  unread?: Record<string, number>;
  deletedBy?: string[];
}

export interface InitialChatTarget {
  postId: string;
  postTitle: string;
  otherUserId: string;
  otherName: string;
}

interface ChatProps {
  currentUser: AppUser;
  onOpenProfile: () => void;
  initialChat?: InitialChatTarget | null;
}

// =========================
// Helpers
// =========================
const resolveTime = (t?: FirestoreTimeLike): number => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t !== "object") return new Date(t).getTime();
  if (typeof t.toDate === "function") return t.toDate().getTime();
  return 0;
};

const formatMessageTime = (ts?: FirestoreTimeLike) => {
  const t = resolveTime(ts);
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
};

const formatListTime = (ts?: FirestoreTimeLike) => {
  const t = resolveTime(ts);
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (!sameDay && d.toDateString() === yesterday.toDateString()) return "เมื่อวาน";
  return sameDay
    ? formatMessageTime(ts)
    : d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
};

// Avatar — gradient ตามชื่อ (สุ่มเบาๆ จาก hash) เพื่อความรู้สึกทันสมัย
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #6f6b80 0%, #3a3550 100%)",
  "linear-gradient(135deg, #9a94b0 0%, #5c5670 100%)",
  "linear-gradient(135deg, #7f7a94 0%, #423d58 100%)",
  "linear-gradient(135deg, #c9c3d8 0%, #7a7490 100%)",
  "linear-gradient(135deg, #58536b 0%, #2a2538 100%)",
  "linear-gradient(135deg, #b8b2c8 0%, #6a6578 100%)",
];

const avatarGradient = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
};

const avatarInitial = (name: string) => (name || "?").trim().charAt(0).toUpperCase();

// ลบชื่อที่ซ้ำกันแบบ "สมชาย สมชาย" -> "สมชาย" และบีบช่องว่างหลายจุดให้เหลือหนึ่ง
const cleanName = (name?: string): string => {
  const trimmed = (name || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  const words = trimmed.split(" ");
  const out: string[] = [];
  for (const w of words) {
    if (out.length && out[out.length - 1].toLowerCase() === w.toLowerCase()) continue;
    out.push(w);
  }
  return out.join(" ");
};

// ตัวคั่นระหว่างรายวัน (วันนี้ / เมื่อวาน / วันที่)
const formatDaySeparator = (ts?: FirestoreTimeLike): string | null => {
  const t = resolveTime(ts);
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "วันนี้";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "เมื่อวาน";
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });
};

// =========================
// รายการแชทแบบปัดซ้ายเพื่อลบ (คล้าย Messenger)
// =========================
function SwipeableChatRow(props: {
  chat: ChatInfo;
  onOpen: (chat: ChatInfo) => void;
  onDelete: (chat: ChatInfo) => void;
  children: ReactNode;
}) {
  const { chat, onOpen, onDelete, children } = props;
  const ACTION_WIDTH = 88;
  const [offset, setOffset] = useState(0);
  const [snapped, setSnapped] = useState(false);
  const [dragging, setDragging] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const maxLeft = useRef(0);
  const horizontal = useRef<boolean | null>(null);
  const suppressClick = useRef(false);

  const handleDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    maxLeft.current = snapped ? -ACTION_WIDTH : 0;
    horizontal.current = null;
    suppressClick.current = false;
    setDragging(true);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (horizontal.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      horizontal.current = Math.abs(dx) > Math.abs(dy);
    }
    if (horizontal.current === false) return;
    if (horizontal.current === true) {
      const base = snapped ? -ACTION_WIDTH : 0;
      const raw = base + dx;
      if (raw < maxLeft.current) maxLeft.current = raw;
      setOffset(Math.max(-ACTION_WIDTH, Math.min(0, raw)));
    }
  };

  const handleUp = () => {
    if (!dragging) return;
    setDragging(false);
    const wasSwipe = horizontal.current === true || suppressClick.current;
    horizontal.current = null;
    if (wasSwipe) suppressClick.current = true;
    if (maxLeft.current <= -(ACTION_WIDTH + 60)) {
      suppressClick.current = true;
      onDelete(chat);
      return;
    }
    if (offset < -ACTION_WIDTH * 0.55) {
      setOffset(-ACTION_WIDTH);
      setSnapped(true);
    } else {
      setOffset(0);
      setSnapped(false);
    }
  };

  const handleClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (snapped) {
      setOffset(0);
      setSnapped(false);
      return;
    }
    onOpen(chat);
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 10 }}>
      <button
        onClick={() => onDelete(chat)}
        aria-label="ลบแชท"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: ACTION_WIDTH,
          border: "none",
          background: "#dc2626",
          color: "var(--fg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "5px",
          cursor: "pointer",
        }}
      >
        <Trash2 size={18} />
        <span style={{ fontSize: "11px", fontWeight: 700 }}>ลบ</span>
      </button>
      <div
        onClick={handleClick}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "relative",
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 0.18s ease",
          touchAction: "pan-y",
          cursor: "pointer",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function Chat({ currentUser, onOpenProfile, initialChat }: ChatProps) {
  const uid = currentUser?.uid || "";
  const myName = (currentUser?.name as string) || "ผู้ใช้งาน";

  // =========================
  // State
  // =========================
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [chatLoading, setChatLoading] = useState(true);
  const [selectedChat, setSelectedChat] = useState<ChatInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [otherLastRead, setOtherLastRead] = useState<FirestoreTimeLike>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    variant?: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingWrite = useRef(0);
  const lastReadWrite = useRef(0);

  // บันทึกเวลาที่เราเปิด/อ่านแชท (บางครั้ง/2 วินาที เพื่อลดการเขียนซ้ำ)
  const updateLastRead = useCallback(
    (chatId: string) => {
      if (!uid) return;
      const now = Date.now();
      if (now - lastReadWrite.current < 2000) return;
      lastReadWrite.current = now;
      updateDoc(doc(db, "chats", chatId), {
        [`lastRead.${uid}`]: serverTimestamp(),
        [`unread.${uid}`]: 0,
      }).catch(() => {});
    },
    [uid]
  );

  // =========================
  // ดึงรายการแชท Realtime
  // =========================
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "chats"),
      where("participantIds", "array-contains", uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ChatInfo[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as Partial<ChatInfo>;
          if (data.deletedBy?.includes(uid)) return;
          list.push({ id: d.id, ...data });
        });
        list.sort((a, b) => {
          const ta = resolveTime(a.lastMessageAt);
          const tb = resolveTime(b.lastMessageAt);
          return tb - ta;
        });
        setChats(list);
        setChatLoading(false);
        setChatError(null);
      },
      (error) => {
        console.error("Error fetching chats:", error);
        setChatLoading(false);
        setChatError(
          "code" in error && error.code === "permission-denied"
            ? "สิทธิ์ไม่พอในการโหลดแชท — เปิดใช้งาน Firestore Rules จากไฟล์ firestore.rules แล้วลองอีกครั้ง"
            : "โหลดรายการแชทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
        );
      }
    );

    return () => unsubscribe();
  }, [uid]);

  // =========================
  // หา / สร้างห้องแชทเมื่อกดจากโพสต์
  // =========================
  const findOrCreateChat = useCallback(
    async (target: InitialChatTarget) => {
      if (
        !target.otherUserId ||
        target.otherUserId === "anonymous" ||
        target.otherUserId === uid
      ) {
        const err = new Error("CHAT_NO_OWNER") as Error & { code?: string };
        err.code = "no-valid-chat-partner";
        throw err;
      }
      const sorted = [uid, target.otherUserId].slice().sort();
      // แชท 1:1 ต่อคน (เหมือน Messenger) — ไม่แยกห้องตามโพสต์
      const pairId = `${sorted[0]}_${sorted[1]}`;
      const pairRef = doc(db, "chats", pairId);

      const myCleanName = cleanName(myName) || "ผู้ใช้งาน";
      const otherCleanName = cleanName(target.otherName) || "ผู้ใช้งาน";

      // 1) ใช้ห้องมาตรฐาน (1:1 ต่อคน) เดิมถ้ามีอยู่แล้ว
      try {
        const snap = await getDoc(pairRef);
        if (snap.exists()) {
          await updateDoc(pairRef, {
            [`participantNames.${uid}`]: myCleanName,
            [`participantNames.${target.otherUserId}`]: otherCleanName,
            postTitle: target.postTitle,
            deletedBy: arrayRemove(uid),
          });
          return pairId;
        }
      } catch {
        // ยังไม่มีห้อง -> ต่อไป
      }

      // 2) หาแชทที่เคยคุยกับคนนี้ไว้เดิม (แม้เป็นระบบเก่าที่แยกตามโพสต์) แล้วไปใช้ห้องนั้น
      try {
        const q = query(
          collection(db, "chats"),
          where("participantIds", "array-contains", uid)
        );
        const qs = await getDocs(q);
        let existingId: string | null = null;
        let bestTime = -1;
        qs.forEach((d) => {
          const data = d.data() as Partial<ChatInfo>;
          const pids = data.participantIds || [];
          if (
            pids.length === 2 &&
            pids.includes(uid) &&
            pids.includes(target.otherUserId)
          ) {
            const t = resolveTime(data.lastMessageAt);
            if (t > bestTime) {
              bestTime = t;
              existingId = d.id;
            }
          }
        });
        if (existingId) {
          await updateDoc(doc(db, "chats", existingId), {
            [`participantNames.${uid}`]: myCleanName,
            [`participantNames.${target.otherUserId}`]: otherCleanName,
          });
          return existingId;
        }
      } catch (error) {
        console.error("Error finding existing chat:", error);
      }

      // 3) ยังไม่เคยคุย -> สร้างห้อง 1:1 ใหม่
      await setDoc(
        pairRef,
        {
          postId: target.postId,
          postTitle: target.postTitle,
          participants: [uid, target.otherUserId],
          participantIds: sorted,
          participantNames: {
            [uid]: myCleanName,
            [target.otherUserId]: otherCleanName,
          },
          lastMessage: "",
          lastMessageAt: null,
          lastSenderId: null,
          unread: { [uid]: 0, [target.otherUserId]: 0 },
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      return pairId;
    },
    [uid, myName]
  );

  useEffect(() => {
    if (!initialChat || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const chatId = await findOrCreateChat(initialChat);
        if (cancelled) return;
        setMessages([]);
        setIsOtherTyping(false);
        setOtherLastRead(null);
        setSelectedChat({
          id: chatId,
          postId: initialChat.postId,
          postTitle: initialChat.postTitle,
          participants: [uid, initialChat.otherUserId],
          participantIds: [uid, initialChat.otherUserId].sort(),
          participantNames: {
            [uid]: myName,
            [initialChat.otherUserId]: initialChat.otherName,
          },
          unread: { [uid]: 0, [initialChat.otherUserId]: 0 },
        });
        updateLastRead(chatId);
      } catch (error) {
        console.error("Error opening chat:", error);
        const err = error as { code?: string };
        setChatError(
          err.code === "permission-denied"
            ? "สิทธิ์ไม่พอในการเปิดแชท — ตรวจสอบ Firestore Rules (firestore.rules) แล้วลองอีกครั้ง"
            : err.code === "no-valid-chat-partner"
            ? "ไม่สามารถเปิดแชทได้กับโพสต์นี้ เนื่องจากไม่พบเจ้าของโพสต์ที่ติดต่อได้"
            : "เปิดแชทไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialChat, uid, myName, findOrCreateChat, updateLastRead]);

  // =========================
  // ดึงข้อความ Realtime ของห้องที่เลือก
  // =========================
  const selectedChatId = selectedChat?.id;
  useEffect(() => {
    if (!selectedChatId) return;

    const q = query(
      collection(db, "chats", selectedChatId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Message[] = [];
        snapshot.forEach((d) => {
          list.push({ ...(d.data() as Omit<Message, "id">), id: d.id });
        });
        setMessages(list);
        setChatError(null);
        const hasIncoming = list.some((m) => m.senderId !== uid);
        if (hasIncoming) updateLastRead(selectedChatId);
      },
      (error) => {
        console.error("Error fetching messages:", error);
        setChatError(
          error?.code === "permission-denied"
            ? "สิทธิ์ไม่พอในการโหลดข้อความ — เปิดใช้งาน Firestore Rules จากไฟล์ firestore.rules แล้วลองอีกครั้ง"
            : "โหลดข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"
        );
      }
    );

    return () => unsubscribe();
  }, [selectedChatId, uid, updateLastRead]);

  // เลื่อนข้อความลงล่างสุดอัตโนมัติ
  useEffect(() => {
    if (selectedChatId) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [selectedChatId, messages.length]);

  // =========================
  // ฟังสถานะ "กำลังพิมพ์" + "อ่านแล้ว" ของอีกฝ่าย Realtime
  // =========================
  useEffect(() => {
    if (!selectedChatId || !selectedChat) return;
    const otherUid =
      (selectedChat.participantIds || selectedChat.participants || []).find(
        (id) => id !== uid
      ) || uid;

    const unsubscribe = onSnapshot(
      doc(db, "chats", selectedChatId),
      (snap) => {
        const data = snap.data() as {
          typing?: Record<string, FirestoreTimeLike>;
          lastRead?: Record<string, FirestoreTimeLike>;
        };
        const typingMap = data?.typing || {};
        const ts = typingMap[otherUid];
        if (!ts) {
          setIsOtherTyping(false);
        } else {
          const t = resolveTime(ts);
          setIsOtherTyping(t !== 0 && Date.now() - t < 3500);
        }

        const lastReadMap = data?.lastRead || {};
        setOtherLastRead(lastReadMap[otherUid] || null);
      },
      (error) => {
        console.error("Error fetching typing status:", error);
      }
    );

    return () => unsubscribe();
  }, [selectedChatId, selectedChat, uid]);

  // เคลียร์ตัวจับเวลา "กำลังพิมพ์" เมื่อออกจากหน้า
  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  // =========================
  // Utils
  // =========================
  const getOtherUid = useCallback(
    (chat: ChatInfo) =>
      (chat.participantIds || chat.participants || []).find((id) => id !== uid) || uid,
    [uid]
  );

  const getOtherName = useCallback(
    (chat: ChatInfo) =>
      cleanName(
        chat.participantNames?.[getOtherUid(chat)] ||
          chat.participantNames?.[uid] ||
          "ผู้ใช้งาน"
      ),
    [uid, getOtherUid]
  );

  const openChat = (chat: ChatInfo) => {
    setMessages([]);
    setIsOtherTyping(false);
    setOtherLastRead(null);
    setSelectedChat(chat);
    updateLastRead(chat.id);
  };

  // ลบแชท (ปัดซ้าย) — Soft Delete: ลบเฉพาะฝั่งเรา อีกฝ่ายยังเห็นข้อความเดิม
  // ถ้าทั้ง 2 ฝ่ายลบแล้ว → ลบข้อมูลจริงออกจาก Firebase
  const handleDeleteChat = (chat: ChatInfo) => {
    const otherUid = getOtherUid(chat);
    setConfirmDialog({
      title: "ลบแชท",
      message: "ลบแชทกับผู้ใช้คนนี้? แชทจะหายจากฝั่งคุณเพียงคนเดียว — อีกฝ่ายยังเห็นประวัติข้อความเดิมอยู่",
      confirmText: "ลบแชท",
      onConfirm: async () => {
        try {
          const targetChats = chats.filter((c) => getOtherUid(c) === otherUid);
          for (const c of targetChats) {
            const chatRef = doc(db, "chats", c.id);
            const snap = await getDoc(chatRef);
            const deletedBy = (snap.data()?.deletedBy as string[] | undefined) || [];
            if (deletedBy.includes(otherUid)) {
              // อีกฝ่ายลบไปแล้ว → ลบจริง (ข้อความ + ห้อง)
              const msgSnap = await getDocs(collection(db, "chats", c.id, "messages"));
              const batch = writeBatch(db);
              msgSnap.docs.forEach((d) => batch.delete(d.ref));
              await batch.commit();
              await deleteDoc(chatRef);
            } else {
              // ฝั่งเรายังแค่ซ่อน — อีกฝ่ายยังเห็นข้อความเต็ม
              await updateDoc(chatRef, { deletedBy: arrayUnion(uid) });
            }
          }
          if (selectedChat && getOtherUid(selectedChat) === otherUid) {
            setSelectedChat(null);
            setMessages([]);
            setIsOtherTyping(false);
            setOtherLastRead(null);
          }
        } catch (error) {
          console.error("Error deleting chat:", error);
          const code =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof (error as { code: unknown }).code === "string"
              ? (error as { code: string }).code
              : "";
          if (code === "permission-denied") {
            setChatError(
              "ลบแชทไม่สำเร็จ — Firestore Rules บน Firebase ยังเป็นเวอร์ชันเก่า กด Publish ไฟล์ firestore.rules ก่อนลองใหม่ (Firebase Console → Firestore → Rules → วางไฟล์ → Publish)"
            );
          } else if (code) {
            setChatError(`ลบแชทไม่สำเร็จ — ข้อผิดพลาด (${code}) กรุณาลองใหม่อีกครั้ง`);
          } else {
            setChatError("ลบแชทไม่สำเร็จ — เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
          }
        }
      },
    });
  };

  const clearTyping = () => {
    if (!selectedChat) return;
    if (typingTimer.current) clearTimeout(typingTimer.current);
    lastTypingWrite.current = 0;
    updateDoc(doc(db, "chats", selectedChat.id), {
      [`typing.${uid}`]: null,
    }).catch(() => {});
  };

  const updateTyping = () => {
    if (!selectedChat) return;
    const now = Date.now();
    if (now - lastTypingWrite.current < 800) return;
    lastTypingWrite.current = now;
    const chatRef = doc(db, "chats", selectedChat.id);
    updateDoc(chatRef, { [`typing.${uid}`]: serverTimestamp() }).catch(() => {});
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      updateDoc(chatRef, { [`typing.${uid}`]: null }).catch(() => {});
    }, 3000);
  };

  const handleSendMessage = async () => {
    if (!selectedChat) return;
    const text = message.trim();
    if (!text) return;
    if (await isCurrentUserBanned()) {
      showToast("บัญชีของคุณถูกระงับการใช้งาน ไม่สามารถส่งข้อความได้", "error");
      return;
    }
    setMessage("");
    clearTyping();

    const chatRef = doc(db, "chats", selectedChat.id);
    const otherUid = getOtherUid(selectedChat);

    try {
      await updateDoc(chatRef, {
        [`participantNames.${uid}`]: myName,
        [`unread.${uid}`]: 0,
      }).catch(() => {});

      await addDoc(collection(db, "chats", selectedChat.id, "messages"), {
        senderId: uid,
        senderName: myName,
        text,
        createdAt: serverTimestamp(),
      });

      await updateDoc(chatRef, {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        lastSenderId: uid,
        deletedBy: [],
        [`unread.${otherUid}`]: increment(1),
      });
    } catch (error) {
      console.error("Error sending message:", error);
      showToast("ส่งข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
    }
  };

  // =========================
  // จัดกลุ่มแชทเป็น 1 แถวต่อคน (รวมทุกห้องกับคนเดียวกัน เหมือน Messenger)
  // =========================
  const chatGroups = useMemo(() => {
    const map = new Map<string, ChatInfo>();
    for (const c of chats) {
      const other = getOtherUid(c);
      const existing = map.get(other);
      if (!existing) {
        map.set(other, c);
        continue;
      }
      const mergedUnread = (existing.unread?.[uid] || 0) + (c.unread?.[uid] || 0);
      const rep =
        resolveTime(c.lastMessageAt) > resolveTime(existing.lastMessageAt)
          ? c
          : existing;
      map.set(other, {
        ...rep,
        unread: { ...rep.unread, [uid]: mergedUnread },
      });
    }
    return Array.from(map.values()).sort(
      (a, b) => resolveTime(b.lastMessageAt) - resolveTime(a.lastMessageAt)
    );
  }, [chats, uid, getOtherUid]);

  // =========================
  // Filter Chats List
  // =========================
  const filteredChats = chatGroups.filter((chat) => {
    const otherName = getOtherName(chat).toLowerCase();
    const postTitle = (chat.postTitle || "").toLowerCase();
    const term = searchTerm.toLowerCase().trim();
    return otherName.includes(term) || postTitle.includes(term);
  });

  // =========================
  // Chat Detail View
  // =========================
  if (selectedChat) {
    const otherName = getOtherName(selectedChat);

    const otherReadTime = resolveTime(otherLastRead);
    const hasReadReceipt = otherReadTime !== 0;

    let lastReadIndex = -1;
    messages.forEach((m, i) => {
      if (!m?.createdAt) return;
      const mt = resolveTime(m.createdAt);
      if (hasReadReceipt && mt !== 0 && mt <= otherReadTime) {
        lastReadIndex = i;
      }
    });

    const detailTyping = (
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <div style={{ maxWidth: "70%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: avatarGradient(otherName),
                color: "#fff",
                fontSize: 10,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {avatarInitial(otherName)}
            </div>
            <div style={{ fontSize: 10, color: "#737373", fontWeight: 600 }}>
              {otherName}
            </div>
          </div>
          <div
            style={{
              marginTop: 6,
              padding: "12px 16px",
              borderRadius: "18px 18px 18px 6px",
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border)",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              color: "var(--fg-muted)",
              fontSize: 12,
            }}
          >
            <span style={{ display: "inline-flex", gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    backgroundColor: "var(--fg-accent)",
                    animation: `lafTypingBounce 1s ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </span>
            กำลังพิมพ์...
          </div>
        </div>
      </div>
    );

    return (
      <div
        className="laf-page-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg)",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes lafMsgIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: none; }
          }
          @keyframes lafTypingBounce {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
            30% { transform: translateY(-3px); opacity: 1; }
          }
          .laf-bubble-enter { animation: lafMsgIn 0.22s ease both; }
          .laf-btn-ghost:hover { background: var(--bg-hover) !important; }
          .laf-send-btn:active { transform: scale(0.93); }
        `}</style>

        {/* Header */}
        <div
          className="laf-page-header"
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
            boxShadow: "0 1px 8px rgba(0, 0, 0, 0.3)",
            zIndex: 10,
          }}
        >
          <button
            onClick={() => setSelectedChat(null)}
            aria-label="กลับ"
            className="laf-btn-ghost"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              border: "none",
              background: "var(--bg-card)",
              transition: "background 0.15s ease",
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={19} color="var(--fg-strong)" />
          </button>

          <div style={{ position: "relative", flexShrink: 0 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: avatarGradient(otherName),
                color: "var(--fg)",
                fontSize: 16,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {avatarInitial(otherName)}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.01em" }}>
              {otherName}
            </div>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2, fontWeight: 500 }}>
              {selectedChat.postTitle
                ? `เกี่ยวกับ "${selectedChat.postTitle}"`
                : "แชทในระบบ UP Lost & Found"}
            </div>
          </div>

          <MoreVertical size={19} color="var(--fg-faint)" style={{ cursor: "pointer", flexShrink: 0 }} />
        </div>

        {/* Error Banner */}
        {chatError && (
          <div
            style={{
              backgroundColor: "#2a1418",
              border: "1px solid #4a1f28",
              borderLeft: "4px solid #f87171",
              color: "#fca5a5",
              fontSize: 12,
              lineHeight: 1.5,
              padding: "10px 14px",
              margin: "10px 16px 0",
              borderRadius: 10,
              flexShrink: 0,
            }}
          >
            {chatError}
          </div>
        )}

        {/* Messages */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "20px 20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            width: "100%",
            maxWidth: 780,
            alignSelf: "center",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10.5,
                color: "var(--fg-muted)",
                fontWeight: 600,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                padding: "5px 12px",
                borderRadius: 999,
              }}
            >
              <MessageSquare size={12} color="var(--fg-accent)" />
              การสนทนาเกี่ยวกับรายการนี้
            </div>
          </div>

          {messages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--fg-muted)",
                fontSize: 13,
                gap: 10,
                textAlign: "center",
                padding: "20px",
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MessageSquare size={26} color="#7c5cfc" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>
                ทักทายกันได้เลย
              </div>
              <div style={{ maxWidth: 280, lineHeight: 1.6 }}>
                เริ่มการสนทนาเกี่ยวกับ "{selectedChat.postTitle || "โพสต์"}" ได้เลย
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isMe = msg.senderId === uid;
              const showName = !isMe && (idx === 0 || messages[idx - 1].senderId !== msg.senderId);

              const dayLabel = formatDaySeparator(msg.createdAt);
              const prevDayLabel = idx > 0 ? formatDaySeparator(messages[idx - 1].createdAt) : null;
              const showDaySeparator = !!dayLabel && dayLabel !== prevDayLabel;

              const msgTime = resolveTime(msg.createdAt);
              const isRead =
                isMe && hasReadReceipt && msgTime !== 0 &&
                msgTime <= otherReadTime;
              const isLastRead = isRead && lastReadIndex === idx;

              return (
                <Fragment key={msg.id}>
                  {showDaySeparator && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        margin: "10px 0 2px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10.5,
                          color: "var(--fg-muted)",
                          fontWeight: 700,
                          background: "var(--bg-card)",
                          border: "1px solid var(--border)",
                          padding: "4px 12px",
                          borderRadius: 999,
                        }}
                      >
                        {dayLabel}
                      </span>
                    </div>
                  )}
                  <div
                    className="laf-bubble-enter"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: isMe ? "flex-end" : "flex-start",
                    }}
                  >
                    {showName && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 10.5,
                          color: "var(--fg-secondary)",
                          fontWeight: 700,
                          margin: "0 0 4px 4px",
                        }}
                      >
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: avatarGradient(otherName),
                            color: "#fff",
                            fontSize: 8,
                            fontWeight: 800,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {avatarInitial(otherName)}
                        </span>
                        {otherName}
                      </div>
                    )}
                  <div style={{ maxWidth: "75%" }}>
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: isMe ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
                        background: isMe
                          ? "#7c5cfc"
                          : "var(--bg-card)",
                        color: isMe ? "var(--fg)" : "var(--fg-strong)",
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        boxShadow: isMe
                          ? "0 6px 16px rgba(124, 92, 252, 0.3)"
                          : "0 2px 8px rgba(0, 0, 0, 0.3)",
                        border: isMe ? "none" : "1px solid var(--border)",
                        wordBreak: "break-word",
                      }}
                    >
                      {msg.text && <div>{msg.text}</div>}
                    </div>

                    <div
                      style={{
                        fontSize: 10,
                        color: isLastRead ? "var(--fg-accent)" : isMe ? "#8a82a8" : "var(--fg-faint)",
                        fontWeight: 600,
                        marginTop: 4,
                        padding: "0 4px",
                        textAlign: isMe ? "right" : "left",
                        display: isMe ? "flex" : "block",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 3,
                      }}
                    >
                      {formatMessageTime(msg.createdAt)}
                      {isMe && msgTime !== 0 && !isRead && (
                        <Check size={11} color="#8a82a8" />
                      )}
                      {isMe && isRead && (
                        <CheckCheck
                          size={isLastRead ? 13 : 11}
                          color={isLastRead ? "var(--fg-accent)" : "#8a82a8"}
                        />
                      )}
                      {isLastRead && (
                        <span style={{ fontWeight: 700 }}>
                          อ่านแล้ว {formatMessageTime(otherLastRead)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                </Fragment>
              );
            })
          )}
          {isOtherTyping && detailTyping}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div
          className="laf-page-header"
          style={{
            borderTop: "1px solid var(--border)",
            padding: "12px 16px 14px",
            flexShrink: 0,
            boxShadow: "0 -2px 12px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 780,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="text"
                value={message}
                placeholder="พิมพ์ข้อความ... (Enter เพื่อส่ง)"
                onChange={(e) => {
                  setMessage(e.target.value);
                  updateTyping();
                }}
                onFocus={updateTyping}
                onBlur={clearTyping}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSendMessage();
                  }
                }}
                style={{
                  flex: 1,
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "12px 18px",
                  outline: "none",
                  fontSize: 13.5,
                  backgroundColor: "var(--bg-subtle)",
                  color: "var(--fg)",
                  boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.25)",
                  transition: "border-color 0.15s ease",
                }}
              />

              <button
                type="button"
                onClick={handleSendMessage}
                aria-label="ส่งข้อความ"
                className="laf-send-btn"
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  border: "none",
                  background: "#7c5cfc",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                  boxShadow: "0 4px 16px rgba(124, 92, 252, 0.4)",
                  transition: "transform 0.12s ease, box-shadow 0.15s ease",
                }}
              >
                <Send size={17} color="var(--accent-fg)" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================
  // Chat List View
  // =========================
  return (
    <div
      className="laf-page-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg)",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <style>{`
        @keyframes lafSpin { to { transform: rotate(360deg); } }
        .laf-row:hover { box-shadow: 0 6px 20px rgba(124, 92, 252, 0.18) !important; }
        .laf-btn-ghost:hover { background: var(--bg-hover) !important; }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          padding: "20px 24px 18px",
          color: "var(--fg)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--fg-muted)", fontWeight: 700, textTransform: "uppercase" }}>
              University of Phayao
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 3, letterSpacing: "-0.02em" }}>
              แชทของคุณ
              {chatGroups.length > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 22,
                    height: 22,
                    padding: "0 7px",
                    marginLeft: 8,
                    borderRadius: 999,
                    background: "rgba(124,92,252,0.16)",
                    border: "1px solid rgba(124,92,252,0.4)",
                    color: "var(--fg-accent)",
                    fontSize: 12,
                    fontWeight: 800,
                    verticalAlign: "middle",
                  }}
                >
                  {chatGroups.length}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onOpenProfile}
            aria-label="ไปหน้าโปรไฟล์"
            className="laf-btn-ghost"
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
          >
            <UserCircle size={21} color="var(--fg-strong)" />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginTop: 16 }}>
          <Search
            size={16}
            color="#7c5cfc"
            style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาชื่อผู้ใช้หรือหัวข้อโพสต์..."
            style={{
              width: "100%",
              boxSizing: "border-box",
              height: 40,
              padding: "0 64px 0 38px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              outline: "none",
              fontSize: 13.5,
              backgroundColor: "var(--bg-subtle)",
              color: "var(--fg)",
              caretColor: "#7c5cfc",
              transition: "border-color 0.15s ease",
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              aria-label="ล้างการค้นหา"
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "var(--bg-ghost)",
                border: "none",
                borderRadius: "50%",
                width: 20,
                height: 20,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={12} color="var(--fg-secondary)" />
            </button>
          )}
          {!searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "1px 5px",
                fontSize: 11,
                color: "var(--fg-faint)",
                cursor: "default",
                pointerEvents: "none",
              }}
            >
              ⌘K
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {chatError && (
        <div
          style={{
            backgroundColor: "#2a1418",
            border: "1px solid #4a1f28",
            borderLeft: "4px solid #f87171",
            color: "#fca5a5",
            fontSize: 12,
            lineHeight: 1.5,
            padding: "10px 14px",
            margin: "12px 16px 0",
            borderRadius: 10,
          }}
        >
          {chatError}
        </div>
      )}

      {/* Chat List */}
      <div style={{ padding: "16px 16px 24px", maxWidth: 760, margin: "0 auto", width: "100%", flex: 1, minHeight: 0 }}>
        {chatLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "60px 20px", color: "var(--fg-muted)", fontSize: 13 }}>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "3px solid var(--border)",
                borderTopColor: "#7c5cfc",
                animation: "lafSpin 0.8s linear infinite",
              }}
            />
            กำลังโหลดรายการแชท...
          </div>
        ) : filteredChats.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "var(--fg-muted)",
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 70,
                height: 70,
                borderRadius: "50%",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MessageSquare size={28} color="#7c5cfc" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>
              {searchTerm ? "ไม่พบแชทที่ตรงกับการค้นหา" : "ยังไม่มีแชท"}
            </div>
            <div style={{ maxWidth: 300, lineHeight: 1.6 }}>
              {searchTerm
                ? "ลองค้นหาด้วยชื่ออื่นหรือหัวข้ออื่นอีกครั้ง"
                : 'กดปุ่ม "ติดต่อผู้แจ้ง" จากโพสต์เพื่อเริ่มแชท'}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredChats.map((chat) => {
              const lastMessageText = chat.lastMessage || "";
              const lastMessageTime = chat.lastMessageAt;
              const unreadCount = chat.unread?.[uid] || 0;
              const isLastFromMe = chat.lastSenderId === uid;
              const otherName = getOtherName(chat);

              return (
                <SwipeableChatRow
                  key={chat.id}
                  chat={chat}
                  onOpen={openChat}
                  onDelete={handleDeleteChat}
                >
                  <div
                    className="laf-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "13px 14px",
                      backgroundColor: "var(--bg-card)",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
                      transition: "box-shadow 0.2s ease",
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        background: avatarGradient(otherName),
                        color: "var(--fg)",
                        fontSize: 18,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.14)",
                      }}
                    >
                      {avatarInitial(otherName)}
                    </div>

                    {/* Text Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {otherName}
                        </div>
                        {lastMessageTime && (
                          <div style={{ fontSize: 10.5, color: unreadCount > 0 ? "var(--fg-accent)" : "var(--fg-faint)", fontWeight: unreadCount > 0 ? 800 : 600, flexShrink: 0 }}>
                            {formatListTime(lastMessageTime)}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#7c5cfc",
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ fontSize: 11.5, color: "var(--fg-secondary)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {chat.postTitle || "โพสต์"}
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--fg-muted)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {lastMessageText
                            ? `${isLastFromMe ? "คุณ: " : ""}${lastMessageText}`
                            : "เริ่มการสนทนา"}
                        </div>

                        {unreadCount > 0 && (
                          <div
                            style={{
                              background: "#7c5cfc",
                              color: "var(--accent-fg)",
                              fontSize: 10.5,
                              fontWeight: 800,
                              minWidth: 21,
                              height: 21,
                              borderRadius: 999,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "0 7px",
                              flexShrink: 0,
                              boxShadow: "0 3px 10px rgba(124, 92, 252, 0.4)",
                            }}
                          >
                            {unreadCount}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </SwipeableChatRow>
              );
            })}
          </div>
        )}
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
      <ToastContainer />
    </div>
  );
}