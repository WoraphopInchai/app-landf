import {
  GraduationCap,
  Home,
  PlusCircle,
  MessageSquare,
  Briefcase,
  LogOut,
  LogIn,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  Bell,
  PackageCheck,
  CheckCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Flag,
  Ban,
  ShieldAlert,
  Trash2,
  Reply,
  PackageSearch,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppUser } from "../types";
import { useTheme } from "../theme";
import { useNotifications, type AppNotification } from "../notifications";
import { showToast } from "../lib/toast";
import type { AdminTab } from "../AdminDashboard/Admin";

type Page = "home" | "report" | "chat" | "profile" | "my-items" | "admin";

interface TopNavProps {
  user?: AppUser;
  // Guest mode (ยังไม่ล็อกอิน): ซ่อนกริ่ง/ออกจากระบบ และเปลี่ยนปุ่มโปรไฟล์เป็น "เข้าสู่ระบบ"
  isGuest?: boolean;
  onLogin?: () => void;
  activePage?: Page;
  onChangePage?: (page: Page) => void;
  onOpenProfile?: () => void;
  onLogout?: () => void;
  isAdmin?: boolean;
  // หัวหน้าแอดมิน (super_admin) — เห็นกริ่งแอดมินทั้งหมด
  isSuperAdmin?: boolean;
  // จุดคืนของเจ้าหน้าที่ประจำจุด — กรองกริ่งแอดมินเฉพาะจุดตัวเอง
  adminPoint?: string | null;
  isAdminOpen?: boolean;
  // จำนวนแชทที่ยังไม่ได้อ่าน (นับ 1 รายการต่อคู่สนทนา) — แสดง badge บนแท็บแชท
  chatUnreadCount?: number;
  onOpenAdmin?: (tab?: AdminTab) => void;
  onOpenPost?: (postId: string) => void;
}

const notificationPopupText = (n: AppNotification): string | null => {
  if (n.type === "post_deleted") return "โพสต์ของคุณถูกลบโดยผู้ดูแลระบบ";
  if (n.type === "post_suspended") return "โพสต์ของคุณถูกระงับโดยผู้ดูแลระบบ";
  if (n.type === "post_hold")
    return n.status === "released"
      ? "โพสต์ของคุณถูกปลดอายัดแล้ว"
      : "โพสต์ของคุณถูกอายัดชั่วคราว รอเจ้าหน้าที่ตรวจสอบ";
  if (n.type === "support_message") return "มีเรื่องแจ้งแอดมินจากผู้ใช้";
  if (n.type === "report_result") return "รายงานของคุณได้รับการจัดการแล้ว";
  if (n.type === "admin_reply") return "แอดมินตอบกลับข้อความของคุณแล้ว";
  if (n.type === "found_approved") return "โพสต์ของพบของคุณถูกอนุมัติแล้ว (นำของไปฝากแล้ว)";
  if (n.type === "found_rejected") return "คำขอโพสต์ของพบของคุณถูกปฏิเสธ";
  if (n.type !== "claim_result") return null;
  if (n.status === "approved") return "คำขอรับของของคุณถูกอนุมัติแล้ว";
  if (n.status === "expired")
    return "คำขอรับของของคุณหมดอายุแล้ว (ไม่ได้มารับตามเวลาที่กำหนด)";
  if (n.status === "post_deleted")
    return "โพสต์ที่คุณขอรับของถูกลบแล้ว คำขอรับของจึงถูกยกเลิก";
  return "คำขอรับของของคุณถูกปฏิเสธ";
};

// ปัดซ้ายเพื่อลบการแจ้งเตือน (เหมือนรายการแชท) — รองรับทั้งปัดเต็มแรงและปุ่มลบด้านหลัง
function SwipeableNotifRow(props: {
  onDelete: () => void;
  children: ReactNode;
}) {
  const { onDelete, children } = props;
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
      onDelete();
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

  const handleClickCapture = (e: React.MouseEvent) => {
    // ปิด click หลอกๆ ที่เกิดหลัง swipe เพื่อไม่ให้เผลอเปิด notification
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <button
        onClick={onDelete}
        aria-label="ลบการแจ้งเตือน"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: ACTION_WIDTH,
          border: "none",
          background: "#dc2626",
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          cursor: "pointer",
        }}
      >
        <Trash2 size={16} />
        <span style={{ fontSize: 11, fontWeight: 700 }}>ลบ</span>
      </button>
      <div
        onClickCapture={handleClickCapture}
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
          backgroundColor: "var(--bg-card)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function TopNav({
  user,
  isGuest,
  onLogin,
  activePage,
  onChangePage,
  onOpenProfile,
  onLogout,
  isAdmin,
  isSuperAdmin,
  adminPoint,
  isAdminOpen,
  chatUnreadCount = 0,
  onOpenAdmin,
  onOpenPost,
}: TopNavProps) {
  const { theme, toggleTheme } = useTheme();
  const { items, unread, markRead, markAllRead, removeNotification, formatRelative } =
    useNotifications(!!user?.uid, user?.uid, isAdmin, {
      isSuperAdmin,
      adminPoint,
    });
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifOpen]);

  const notifPopSeen = useRef<Set<string>>(new Set());
  const notifPopInit = useRef(false);
  useEffect(() => {
    if (!items.length) return;
    if (!notifPopInit.current) {
      items.forEach((n) => notifPopSeen.current.add(n.id));
      notifPopInit.current = true;
      return;
    }
    const fresh = items.filter(
      (n) =>
        !notifPopSeen.current.has(n.id) &&
        n.recipientUid === user?.uid
    );
    if (!fresh.length) return;
    fresh.forEach((n) => notifPopSeen.current.add(n.id));
    const text = notificationPopupText(fresh[0]);
    if (text) showToast(text, "info");
  }, [items, user?.uid]);
  const menus = [
    { id: "home" as Page, label: "หน้าแรก", icon: Home },
    { id: "report" as Page, label: "แจ้งของ", icon: PlusCircle },
    { id: "chat" as Page, label: "แชท", icon: MessageSquare },
    { id: "my-items" as Page, label: "รายการของฉัน", icon: Briefcase },
  ];

  const name = user?.name || user?.displayName || "ผู้ใช้งาน";
  const initials = name.charAt(0).toUpperCase();

  return (
    <>
      {/* Top Announcement Banner */}
      <div
        style={{
          position: "relative",
          zIndex: 1001,
          background:
            "linear-gradient(90deg, #7c5cfc 0%, #4f3bd6 55%, #2f2a6d 100%)",
          color: "var(--accent-fg)",
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: "center",
          padding: "7px 16px",
          letterSpacing: "0.01em",
          boxShadow: "0 4px 24px rgba(124, 92, 252, 0.35)",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        <style>{`
          .topnav-label { display: none; }
          @media (min-width: 721px) { .topnav-label { display: inline; } }
          @media (max-width: 768px) { .topnav-navlinks { display: none !important; } }
          @media (max-width: 560px) { .topnav-brand-text { display: none !important; } }
        `}</style>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={13} style={{ flexShrink: 0 }} />
          UP Lost &amp; Found · แพลตฟอร์มแจ้งและตามหาของหายของมหา'ลัยพะเยา
          <span style={{ opacity: 0.75, fontWeight: 500 }}>· ใช้งานฟรี</span>
        </span>
      </div>

      <header
        style={{
          height: 60,
          flexShrink: 0,
          backgroundColor: "color-mix(in srgb, var(--bg) 75%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--border)",
          position: "relative",
          zIndex: 1000,
        }}
      >
        <style>{`
          .topnav-link { border-radius: 8px; transition: background 0.13s ease, color 0.13s ease; }
          .topnav-link:hover { background: rgba(124, 92, 252, 0.12); }
        `}</style>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            height: "100%",
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 20px",
          }}
        >
          {/* Brand / Logo */}
          <button
            onClick={() => onChangePage?.("home")}
            title="หน้าแรก"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "none",
              border: "none",
              cursor: "pointer",
              flexShrink: 0,
              padding: 0,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(135deg, #7c5cfc 0%, #4f3bd6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 14px rgba(124, 92, 252, 0.5)",
              }}
            >
              <GraduationCap size={18} color="var(--accent-fg)" />
            </div>
            <div className="topnav-brand-text" style={{ textAlign: "left" }}>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 800,
                  color: "var(--fg)",
                  lineHeight: 1.15,
                  letterSpacing: "-0.01em",
                }}
              >
                UP Lost &amp; Found
              </div>
              <div
                className="topnav-label"
                style={{
                  fontSize: 10,
                  color: "var(--fg-muted)",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                University of Phayao
              </div>
            </div>
          </button>

          {/* Nav Links — ซ่อนเมื่อเปิดหน้า Admin */}
          {!isAdminOpen && (
          <nav
            className="topnav-navlinks"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              flex: 1,
            }}
          >
            {menus.map((menu) => {
              const Icon = menu.icon;
              const active = activePage === menu.id;
              return (
                <button
                  key={menu.id}
                  onClick={() => onChangePage?.(menu.id)}
                  className="topnav-link"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "8px 12px",
                    border: "none",
                    cursor: "pointer",
                    background: active ? "rgba(124,92,252,0.16)" : "transparent",
                    color: active ? "var(--fg)" : "var(--fg-muted)",
                    fontWeight: active ? 700 : 500,
                    fontSize: 13.5,
                    whiteSpace: "nowrap",
                    boxShadow: active ? "inset 0 0 0 1px rgba(124,92,252,0.35)" : "none",
                  }}
                >
                  <span style={{ position: "relative", display: "inline-flex" }}>
                    <Icon size={16} color={active ? "var(--fg-accent)" : "var(--fg-muted)"} />
                    {menu.id === "chat" && chatUnreadCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          top: -7,
                          right: -10,
                          minWidth: 16,
                          height: 16,
                          padding: "0 4px",
                          borderRadius: 999,
                          backgroundColor: "#ef4444",
                          color: "#ffffff",
                          fontSize: 9.5,
                          fontWeight: 800,
                          lineHeight: "16px",
                          textAlign: "center",
                          boxShadow: "0 2px 6px rgba(239,68,68,0.5)",
                          pointerEvents: "none",
                        }}
                      >
                        {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                      </span>
                    )}
                  </span>
                  <span className="topnav-label">{menu.label}</span>
                </button>
              );
            })}
          </nav>
          )}
          {!isAdminOpen && <div style={{ flex: 1 }} />}

          {/* Right Side */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {isAdmin && (
              <button
                onClick={() => onOpenAdmin?.()}
                title="เปิด Admin Dashboard"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 11px",
                  borderRadius: 8,
                  border: "1px solid rgba(124,92,252,0.4)",
                  background: "rgba(124,92,252,0.14)",
                  color: "var(--fg-accent)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <ShieldCheck size={15} color="var(--fg-accent)" />
                <span className="topnav-label">Admin</span>
              </button>
            )}

            {!isGuest && (
            <div ref={notifRef} style={{ position: "relative", flexShrink: 0 }}>
                <button
                  onClick={() => setNotifOpen((o) => !o)}
                  title="การแจ้งเตือน"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-card)",
                    color: "var(--fg-secondary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    position: "relative",
                    transition: "border-color 0.13s ease",
                  }}
                >
                  <Bell size={16} />
                  {unread > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        minWidth: 16,
                        height: 16,
                        padding: "0 4px",
                        borderRadius: 999,
                        background: "#ef4444",
                        color: "#ffffff",
                        fontSize: 10,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 2px 8px rgba(239,68,68,0.5)",
                      }}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <>
                    <div
                      onClick={() => setNotifOpen(false)}
                      style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 2000,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        right: 0,
                        width: 330,
                        maxHeight: 430,
                        overflowY: "auto",
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: 14,
                        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
                        zIndex: 2001,
                        padding: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 14px",
                          borderBottom: "1px solid var(--border)",
                          position: "sticky",
                          top: 0,
                          background: "var(--bg-card)",
                          borderRadius: "14px 14px 0 0",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: "var(--fg)",
                          }}
                        >
                          การแจ้งเตือน
                          {unread > 0 && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                fontWeight: 800,
                                color: "#ef4444",
                              }}
                            >
                              {unread} ข้อความใหม่
                            </span>
                          )}
                        </span>
                        {unread > 0 && (
                          <button
                            onClick={markAllRead}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              background: "none",
                              border: "none",
                              color: "var(--fg-accent)",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              padding: "2px 4px",
                            }}
                          >
                            <CheckCheck size={13} />
                            อ่านทั้งหมด
                          </button>
                        )}
                      </div>

                      {items.length === 0 ? (
                        <div
                          style={{
                            padding: "32px 16px",
                            textAlign: "center",
                            color: "var(--fg-muted)",
                            fontSize: 12.5,
                          }}
                        >
                          <Bell
                            size={26}
                            color="var(--border-strong)"
                            style={{ marginBottom: 8 }}
                          />
                          <div>ยังไม่มีการแจ้งเตือน</div>
                        </div>
                      ) : (
                        items.slice(0, 20).map((n) => {
                          const unreadItem = !n.read;
                          const isClaim = n.type === "claim";
                          const isResult = n.type === "claim_result";
                          const isReport = n.type === "post_report";
                          const isPostDeleted = n.type === "post_deleted";
                          const isPostSuspended = n.type === "post_suspended";
                          const isPostHeld = n.type === "post_hold";
                          const heldReleased = isPostHeld && n.status === "released";
                          const isSupportMessage = n.type === "support_message";
                          const isReportResult = n.type === "report_result";
                          const isAdminReply = n.type === "admin_reply";
                          const isPostEvent = isPostDeleted || isPostSuspended || isPostHeld;
                          const isFoundPending = n.type === "found_pending";
                          const isFoundApproved = n.type === "found_approved";
                          const isFoundRejected = n.type === "found_rejected";
                          const isAdminRevoked = n.type === "admin_revoked";
                          const approved = isResult && n.status === "approved";
                          const isExpired = isResult && n.status === "expired";
                          const isPostDeletedResult = isResult && n.status === "post_deleted";
                          const iconBg = isReport || isPostDeleted
                            ? "#2a1418"
                            : isPostSuspended || (isPostHeld && !heldReleased)
                            ? "#2a1a10"
                            : isSupportMessage ? "#1c1626"
                            : isFoundPending ? "#2a1a10"
                            : (isClaim || approved || heldReleased || isReportResult || isAdminReply || isFoundApproved) ? "#0f2a1f"
                            : isAdminRevoked ? "#2a1418"
                            : "#2a1418";
                          const openNotif = () => {
                            markRead(n.id);
                            setNotifOpen(false);
                            // เจ้าหน้าที่ประจำจุด (staff) เปิดหน้า reports/posts ไม่ได้ → fallback ไป overview
                            const staffAdmin = isAdmin === true && isSuperAdmin !== true;
                            if (isClaim) {
                              onOpenAdmin?.("claims");
                            } else if ((isReport || isSupportMessage) && !staffAdmin) {
                              onOpenAdmin?.("reports");
                            } else if (isReport || isSupportMessage) {
                              onOpenAdmin?.("overview");
                            } else if (isFoundPending) {
                              onOpenAdmin?.("found");
                            } else if (isPostEvent || isReportResult || isAdminRevoked) {
                              // โพสต์ถูกลบ/ระงับ/อายัด หรือเป็นผลรายงาน/การถอดสิทธิ์ — ไม่เปิดหน้าโพสต์
                            } else if (isAdminReply) {
                              // คำตอบของแอดมินเกี่ยวกับรายงาน/เรื่องแจ้ง → เปิดหน้าโปรไฟล์ (ที่ใช้แจ้งเรื่อง)
                              onChangePage?.("profile");
                            } else if (!n.postId) {
                              // notification ไม่มีโพสต์อ้างอิง — ไม่เปิดหน้าโพสต์
                            } else {
                              onOpenPost?.(n.postId);
                            }
                          };
                          const row = (
                            <button
                              onClick={openNotif}
                              style={{
                                display: "flex",
                                gap: 10,
                                width: "100%",
                                padding: "11px 14px",
                                border: "none",
                                borderBottom: "1px solid var(--border)",
                                background: unreadItem
                                  ? "var(--bg-hover)"
                                  : "transparent",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 9,
                                  flexShrink: 0,
                                  background: iconBg,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {isClaim ? (
                                  <PackageCheck
                                    size={15}
                                    color={unreadItem ? "#34d399" : "#6a9b8a"}
                                  />
                                ) : isReport ? (
                                  <Flag size={15} color={unreadItem ? "#f87171" : "#a05050"} />
                                ) : isPostDeleted ? (
                                  <Trash2 size={15} color={unreadItem ? "#f87171" : "#a05050"} />
                                ) : isPostSuspended ? (
                                  <Ban size={15} color={unreadItem ? "#fbbf24" : "#a57d3a"} />
                                ) : isPostHeld ? (
                                  heldReleased ? (
                                    <ShieldCheck size={15} color={unreadItem ? "#34d399" : "#6a9b8a"} />
                                  ) : (
                                    <ShieldAlert size={15} color={unreadItem ? "#fbbf24" : "#a57d3a"} />
                                  )
                                ) : isSupportMessage ? (
                                  <MessageSquare size={15} color={unreadItem ? "#a78bfa" : "#7a5f9e"} />
                                ) : isFoundPending ? (
                                  <PackageSearch size={15} color={unreadItem ? "#fbbf24" : "#a57d3a"} />
                                ) : isFoundApproved ? (
                                  <CheckCircle2 size={15} color={unreadItem ? "#34d399" : "#6a9b8a"} />
                                ) : isFoundRejected ? (
                                  <XCircle size={15} color="#f87171" />
                                ) : isAdminReply ? (
                                  <Reply size={15} color={unreadItem ? "#34d399" : "#6a9b8a"} />
                                ) : isAdminRevoked ? (
                                  <ShieldAlert size={15} color={unreadItem ? "#f87171" : "#a05050"} />
                                ) : isReportResult ? (
                                  <CheckCheck size={15} color={unreadItem ? "#34d399" : "#6a9b8a"} />
                                ) : isExpired ? (
                                  <Clock size={15} color={unreadItem ? "#fbbf24" : "#a57d3a"} />
                                ) : approved ? (
                                  <CheckCircle2 size={15} color="#34d399" />
                                ) : (
                                  <XCircle size={15} color="#f87171" />
                                )}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 12.5,
                                    fontWeight: unreadItem ? 800 : 600,
                                    color: unreadItem ? "var(--fg)" : "var(--fg-secondary)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {isClaim ? (
                                    <>
                                      มีคำขอรับของใหม่จาก{" "}
                                      <span style={{ color: "var(--fg-accent)" }}>
                                        {n.claimantName || "ผู้ใช้งาน"}
                                      </span>
                                    </>
                                  ) : isReport ? (
                                    <>
                                      มีรายงานโพสต์ใหม่จาก{" "}
                                      <span style={{ color: "#f87171" }}>
                                        {n.reporterName || "ผู้ใช้งาน"}
                                      </span>
                                    </>
                                  ) : isPostDeleted ? (
                                    <>
                                      โพสต์ของคุณ{" "}
                                      <span style={{ color: "#f87171" }}>ถูกลบ</span>{" "}
                                      โดยผู้ดูแลระบบ
                                    </>
                                  ) : isPostSuspended ? (
                                    <>
                                      โพสต์ของคุณ{" "}
                                      <span style={{ color: "#fbbf24" }}>ถูกระงับ</span>{" "}
                                      โดยผู้ดูแลระบบ
                                    </>
                                  ) : isPostHeld ? (
                                    heldReleased ? (
                                      <>
                                        โพสต์ของคุณ{" "}
                                        <span style={{ color: "#34d399" }}>ถูกปลดอายัดแล้ว</span>
                                      </>
                                    ) : (
                                      <>
                                        โพสต์ของคุณ{" "}
                                        <span style={{ color: "#fbbf24" }}>ถูกอายัดชั่วคราว</span>{" "}
                                        รอเจ้าหน้าที่ตรวจสอบ
                                      </>
                                    )
                                  ) : isSupportMessage ? (
                                    <>
                                      มีเรื่องแจ้งแอดมินจาก{" "}
                                      <span style={{ color: "#a78bfa" }}>
                                        {n.reporterName || "ผู้ใช้"}
                                      </span>
                                    </>
                                  ) : isFoundPending ? (
                                    <>
                                      มีคำขอโพสต์ของพบจาก{" "}
                                      <span style={{ color: "#fbbf24" }}>
                                        {n.reporterName || "ผู้ใช้"}
                                      </span>
                                    </>
                                  ) : isFoundApproved ? (
                                    <>
                                      โพสต์ของพบของคุณ{" "}
                                      <span style={{ color: "#34d399" }}>ถูกอนุมัติแล้ว</span>{" "}
                                      (นำของไปฝากแล้ว)
                                    </>
                                  ) : isFoundRejected ? (
                                    <>
                                      คำขอโพสต์ของพบของคุณ{" "}
                                      <span style={{ color: "#f87171" }}>ถูกปฏิเสธ</span>
                                    </>
                                  ) : isAdminReply ? (
                                    <>
                                      แอดมินตอบกลับ:{" "}
                                      <span style={{ color: "#34d399" }}>
                                        {n.text || "ข้อความจากผู้ดูแลระบบ"}
                                      </span>
                                    </>
                                  ) : isAdminRevoked ? (
                                    <>
                                      สิทธิ์เจ้าหน้าที่ประจำจุดของคุณ{" "}
                                      <span style={{ color: "#f87171" }}>ถูกถอดออกแล้ว</span>
                                    </>
                                  ) : isReportResult ? (
                                    <>
                                      รายงานของคุณ{" "}
                                      <span style={{ color: "#34d399" }}>ได้รับการจัดการแล้ว</span>
                                    </>
                                  ) : approved ? (
                                    <>
                                      คำขอรับของของคุณถูก{" "}
                                      <span style={{ color: "#34d399" }}>อนุมัติแล้ว</span>
                                    </>
                                  ) : isExpired ? (
                                    <>
                                      คำขอรับของของคุณ{" "}
                                      <span style={{ color: "#fbbf24" }}>หมดอายุแล้ว</span>{" "}
                                      (ไม่ได้มารับตามเวลาที่กำหนด)
                                    </>
                                  ) : isPostDeletedResult ? (
                                    <>
                                      โพสต์ที่คุณขอรับของ{" "}
                                      <span style={{ color: "var(--fg-faint)" }}>ถูกลบแล้ว</span>{" "}
                                      คำขอจึงถูกยกเลิก
                                    </>
                                  ) : (
                                    <>
                                      คำขอรับของของคุณถูก{" "}
                                      <span style={{ color: "#f87171" }}>ปฏิเสธ</span>
                                    </>
                                  )}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--fg-muted)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    marginTop: 1,
                                  }}
                                >
                                  {n.postTitle || n.category || (isAdminRevoked ? `จุด ${n.pointName || ""}` : " ")}
                                </div>
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: "var(--fg-faint)",
                                    marginTop: 2,
                                  }}
                                >
                                  {formatRelative(n.createdAt)}
                                </div>
                              </div>
                                {unreadItem && (
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: isReport || isPostDeleted
                                      ? "#f87171"
                                      : isAdminRevoked ? "#f87171"
                                      : isSupportMessage ? "#a78bfa"
                                      : isFoundPending ? "#fbbf24"
                                      : isExpired || isPostSuspended || (isPostHeld && !heldReleased) ? "#fbbf24"
                                      : isPostDeletedResult ? "var(--fg-faint)"
                                      : isResult && !approved ? "#f87171" : "#34d399",
                                    flexShrink: 0,
                                    marginTop: 5,
                                  }}
                                />
                              )}
                            </button>
                          );
                          const canDelete =
                            (!!n.recipientUid && n.recipientUid === user?.uid) ||
                            (n.recipientRole === "admin" && !!isAdmin);
                          return canDelete ? (
                            <SwipeableNotifRow
                              key={n.id}
                              onDelete={() => {
                                removeNotification(n.id).catch(() =>
                                  showToast("ลบการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่", "error")
                                );
                              }}
                            >
                              {row}
                            </SwipeableNotifRow>
                          ) : (
                            row
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
                color: "var(--fg-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "border-color 0.13s ease",
              }}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {isGuest ? (
              <button
                onClick={onLogin}
                title="เข้าสู่ระบบ"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "9px 14px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                  color: "var(--accent-fg)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  boxShadow: "0 6px 16px rgba(124, 92, 252, 0.35)",
                  transition: "border-color 0.13s ease",
                }}
              >
                <LogIn size={15} />
                <span className="topnav-label">เข้าสู่ระบบ</span>
              </button>
            ) : (
              <button
                onClick={onOpenProfile}
                title={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 10px 4px 4px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "var(--bg-card)",
                  cursor: "pointer",
                  transition: "border-color 0.13s ease",
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                    color: "var(--accent-fg)",
                    fontSize: 12,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {initials}
                </div>
                <span
                  className="topnav-label"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--fg)",
                    maxWidth: 130,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {name}
                </span>
              </button>
            )}

            {!isGuest && (
            <button
              onClick={onLogout}
              title="ออกจากระบบ"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
                color: "var(--fg-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "border-color 0.13s ease",
              }}
            >
              <LogOut size={15} />
            </button>
            )}
          </div>
        </div>
      </header>
    </>
  );
}