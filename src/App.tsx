import { useState, useEffect, useRef } from "react";
import { Lock, X, ArrowLeft } from "lucide-react";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDocFromServer, onSnapshot, collection, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { AppUser, PostItem, ChatTarget } from "./types";

import Login from "./Pages/Login";
import Home from "./Pages/Home";
import ReportItem from "./Pages/ReportItem";
import Chat from "./Pages/Chat";
import Profile from "./Pages/Profile";
import ItemDetail from "./Pages/ItemDetail";
import MyItems from "./Pages/MyItems";
import Admin from "./AdminDashboard/Admin";
import type { AdminTab } from "./AdminDashboard/Admin";
import TopNav from "./components/TopNav";
import BottomNav from "./components/BottomNav";
import LogoutConfirmModal from "./components/LogoutConfirmModal";
import RevokedModal from "./components/RevokedModal";
import { showToast } from "./lib/toast";
import { isHeadAdminEmail } from "./lib/admins";

type Page = "home" | "report" | "chat" | "profile" | "my-items" | "admin";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState<Page>("home");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("overview");
  const [selectedItem, setSelectedItem] = useState<PostItem | null>(null);
  const [loginRole, setLoginRole] = useState<"admin" | "user" | null>(null);
  const [adminRole, setAdminRole] = useState<"super_admin" | "admin" | null>(null);
  const [adminPoint, setAdminPoint] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth <= 768
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [adminDeniedEmail, setAdminDeniedEmail] = useState<string | null>(null);
  const [revokedModal, setRevokedModal] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  // Guest mode: ผู้ใช้ครั้งแรกท่องเว็บได้โดยไม่ต้องล็อกอิน
  // เมื่อกดใช้ฟีเจอร์ที่ต้องใช้บัญชี (promptLogin) จะเปิดหน้า Login แบบ overlay
  const [guestLoginOpen, setGuestLoginOpen] = useState(false);
  // ผลักดันว่า "กำลังล็อกอินอยู่" (จากหน้า Login) — เพื่อไม่ให้ App สลับไปหน้า main
  // ระหว่างรอเช็กสิทธิ์ admin ทำให้หน้า Login ไม่ถูก unmount และ popup แสดงได้
  const loginAttemptInProgress = useRef(false);

  const auth = getAuth();

  // ใช้กับฟีเจอร์ที่ต้องเข้าสู่ระบบ (แจ้งของ/แชท/คำขอรับของ/โปรไฟล์/ของฉัน)
  // ถ้ายังไม่ล็อกอิน: เก็บ action ที่ค้างไว้ แล้วเปิดหน้า Login แบบ overlay
  // หลังล็อกอินสำเร็จ (completePending) จะกลับไปทำ action นั้นต่อทันที
  const pendingActionRef = useRef<(() => void) | null>(null);

  const promptLogin = (afterLogin?: () => void) => {
    if (user) return true;
    pendingActionRef.current = afterLogin ?? null;
    setGuestLoginOpen(true);
    return false;
  };

  const completePending = () => {
    const fn = pendingActionRef.current;
    pendingActionRef.current = null;
    if (fn) fn();
  };

  // หน้าที่ต้องเข้าสู่ระบบก่อน (แจ้งของ/แชท/profile/ของฉัน) — guest ต้องล็อกอินก่อนจึงเปลี่ยนหน้าได้
  const protectedPages: Page[] = ["report", "chat", "my-items", "profile"];

  const gotoPage = (page: Page) => {
    const applyNav = () => {
      setActivePage(page);
      setSelectedItem(null);
      setChatTarget(null);
    };
    if (protectedPages.includes(page) && !promptLogin(applyNav)) return;
    applyNav();
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // นับแชทที่ยังไม่ได้อ่าน (1 รายการต่อคู่สนทนา) สำหรับ badge บนแท็บแชท — realtime
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const q = query(
      collection(db, "chats"),
      where("participantIds", "array-contains", uid)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const senders = new Set<string>();
        snapshot.forEach((d) => {
          const data = d.data();
          if (data?.deletedBy?.includes?.(uid)) return;
          if ((data?.unread?.[uid] || 0) <= 0) return;
          const participants: string[] = Array.isArray(data?.participantIds)
            ? data.participantIds
            : [];
          const other = participants.find((p) => p !== uid);
          if (other) senders.add(other);
        });
        setChatUnreadCount(senders.size);
      },
      (error) => {
        console.error("Error counting chat unread:", error);
        setChatUnreadCount(0);
      }
    );
    return () => unsubscribe();
  }, [user?.uid]);

  // 1. ตรวจสอบสถานะการล็อกอินและสิทธิ์ Admin เวลารีเฟรชหน้าเว็บ
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // เจ้าหน้าที่ที่ถูกถอดสิทธิ์แล้วกดรีเฟรชแทนตกลง: ให้ไปหน้า Login ตรงๆ (ไม่หลุดไปโหมดผู้ใช้)
        if (localStorage.getItem("revokedPending") === "1") {
          await signOut(auth);
          setUser(null);
          setAdminOpen(false);
          setLoginRole(null);
          setAdminRole(null);
          setAdminPoint(null);
          setProfileName(null);
          localStorage.removeItem("revokedPending");
          localStorage.removeItem("adminOpen");
          localStorage.removeItem("loginRole");
          localStorage.removeItem("adminRole");
          showToast("สิทธิ์แอดมินของคุณถูกถอดออก กรุณาเข้าสู่ระบบใหม่", "error");
          setLoading(false);
          return;
        }

        let effectiveRole: "super_admin" | "admin" | null = null;
        try {
          const userDoc = await getDocFromServer(doc(db, "users", currentUser.uid));
          const userData = userDoc.exists() ? userDoc.data() : null;

          // บัญชีที่ถูกแบน: ออกจากระบบทันที ไม่ให้เข้าใช้งานแอปต่อไป
          if (userData?.banned === true) {
            await signOut(auth);
            setUser(null);
            setAdminOpen(false);
            setLoginRole(null);
            setAdminRole(null);
            setAdminPoint(null);
            setProfileName(null);
            localStorage.removeItem("adminOpen");
            localStorage.removeItem("loginRole");
            localStorage.removeItem("adminRole");
            showToast("บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อเจ้าหน้าที่", "error");
            setLoading(false);
            return;
          }

          if (userData?.name) {
            setProfileName(userData.name);
          }

          // สิทธิ์แอดมินอ่านจาก document (head = role super_admin | staff = role admin + adminAccounts)
          // เจ้าหน้าที่ที่ถูกถอดสิทธิ์ (ไม่มี adminAccounts) จะถูก downgrade เป็น user ทุกครั้งที่รีเฟรช
          // หมายเหตุ: หัวหน้าแอดมิน (อีเมล whitelist) ถือเป็น super_admin เสมอ
          // แม้ doc role จะยังเป็น 'admin' เก่า/ไม่มี doc (ตรงกับ isSuperAdmin ใน rules)
          const isHeadEmail = isHeadAdminEmail(currentUser.email);
          const docRole =
            userData?.role === "super_admin"
              ? "super_admin"
              : userData?.role === "admin"
                ? "admin"
                : null;
          let resolvedPoint: string | null = null;
          if (docRole === "admin" && currentUser.email) {
            // อ่านจาก server ตรงๆ กันแคชเก่า (ถ้าเจ้าหน้าที่โดนถอดสิทธิ์ adminAccounts จะถูกลบไปแล้ว)
            // normalize เป็น lowercase ให้ตรงกับ doc id (assignAdmin เก็บ id เป็น lowercase)
            const accSnap = await getDocFromServer(
              doc(db, "adminAccounts", currentUser.email.toLowerCase())
            );
            if (accSnap.exists()) {
              resolvedPoint = accSnap.data()?.pointName || null;
            }
          }
          effectiveRole = isHeadEmail
            ? "super_admin"
            : docRole === "admin" && !resolvedPoint
              ? null
              : docRole;

          setAdminRole(effectiveRole);
          setAdminPoint(effectiveRole === "admin" ? resolvedPoint : null);
          if (!effectiveRole) {
            localStorage.removeItem("adminRole");
          } else {
            localStorage.setItem("adminRole", effectiveRole);
          }
        } catch (error) {
          console.error("Error checking user role:", error);
        }

        // กำลังล็อกอินอยู่ (จากหน้า Login) → อย่าเพิ่งสลับไปหน้า main
        // ปล่อยให้หน้า Login จัดการเอง (สำเร็จ → onLogin / ไม่มีสิทธิ์ → onAdminDenied)
        // กันไม่ให้หน้า Login ถูก unmount ระหว่างเช็กสิทธิ์ ทำให้ popup แสดงได้
        if (loginAttemptInProgress.current) {
          setUser(null);
          setLoading(false);
          return;
        }

        // สิทธิ์แอดมินอ้างอิงจากโหมดล็อกอิน (session) ที่เลือกตอนเข้าสู่ระบบเท่านั้น
        // ไม่ใช้อ้างอิง role ในฐานข้อมูล เพื่อกันไม่ให้ Admin Button โผล่ตอนใช้หน้า user
        const isSavedAdminState =
          localStorage.getItem("adminOpen") === "true";
        const sessionRole =
          localStorage.getItem("loginRole") === "admin" ? "admin" : "user";

        setUser(currentUser);
        if (sessionRole === "admin" && effectiveRole) {
          setLoginRole("admin");
          if (isSavedAdminState) {
            setAdminOpen(true);
          }
        } else {
          setLoginRole("user");
          setAdminOpen(false);
          localStorage.removeItem("adminOpen");
        }
      } else {
        setUser(null);
        setAdminOpen(false);
        setLoginRole(null);
        setAdminRole(null);
        setAdminPoint(null);
        setProfileName(null);
        setActivePage("home");
        setSelectedItem(null);
        setChatTarget(null);
        setGuestLoginOpen(false);
        pendingActionRef.current = null;
        localStorage.removeItem("adminOpen");
        localStorage.removeItem("loginRole");
        localStorage.removeItem("revokedPending");
        loginAttemptInProgress.current = false;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [auth]);

  // 2.5 ไล่เจ้าหน้าที่/หัวหน้าออกจากหน้า Admin ทันทีที่สิทธิ์ถูกถอด (react ลบ adminAccounts/reset role)
  useEffect(() => {
    const uid = user?.uid;
    const email = (user?.email || "").toLowerCase();
    if (!uid) return;

    const isStaffAdmin = adminRole === "admin";

    const revoke = () => {
      // แสดง modal แจ้งถูกถอดสิทธิ์ — เจ้าหน้าที่ต้องกด "ตกลง" จึงจะถูกยิงไปหน้า Login (ล็อกเอาต์จริง)
      setRevokedModal(true);
      setAdminPoint(null);
      localStorage.setItem("revokedPending", "1");
      localStorage.removeItem("adminOpen");
      localStorage.removeItem("adminRole");
      localStorage.removeItem("loginRole");
    };

    const unsubs: Array<() => void> = [];

    // ถ้าอีเมลนี้เคยเป็นเจ้าหน้าที่ (มี adminAccounts) ให้เฝ้าดู:
    //  - doc หาย = ถูกถอดสิทธิ์ → ไล่ออกจากหน้าแอดมินทันที
    //  - pointName เปลี่ยน (หัวหน้า rename จุด) → อัปเดตจุดให้ session นี้ทันที (กันกรองผิดจุด)
    // เฉพาะเจ้าหน้าที่ (admin) ที่ subscribe — หัวหน้าแอดมินไม่มี adminAccounts/{email} จะได้ไม่โดน revoke ผิด
    if (email && isStaffAdmin) {
      const accUnsub = onSnapshot(
        doc(db, "adminAccounts", email),
        (snap) => {
          if (!snap.exists()) {
            if (
              isStaffAdmin &&
              localStorage.getItem("adminOpen") === "true"
            ) {
              revoke();
            }
            return;
          }
          const newPoint = (snap.data() as { pointName?: string })?.pointName;
          if (newPoint) {
            setAdminPoint((prev) => (prev !== newPoint ? newPoint : prev));
            if (localStorage.getItem("adminOpen") !== "true") {
              setAdminOpen(true);
              setAdminRole("admin");
              localStorage.setItem("adminOpen", "true");
              localStorage.setItem("adminRole", "admin");
            }
          }
        },
        (error) => console.error("Error watching admin account:", error)
      );
      unsubs.push(accUnsub);
    }

    // เฝ้าดู role ใน users/{uid}: ถ้าโดนเปลี่ยนกลับเป็น user (ถอดสิทธิ์) ให้รีโวคทันที
    // หัวหน้าแอดมิน (super_admin) ข้อยกเว้น: doc role อาจเป็น 'user'/'admin' เก่าจาก history
    // แต่สิทธิ์จริงคือ whitelist email → ไม่ควรโดนรีโวค (ตรงกับ isSuperAdmin ใน rules)
    const userUnsub = onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        const role = snap.exists() ? (snap.data() as { role?: string })?.role : undefined;
        if (
          adminRole !== "super_admin" &&
          localStorage.getItem("adminOpen") === "true" &&
          role &&
          role !== "admin" &&
          role !== "super_admin"
        ) {
          revoke();
        }
      },
      (error) => console.error("Error watching user role:", error)
    );
    unsubs.push(userUnsub);

    return () => unsubs.forEach((u) => u());
  }, [user, adminRole]);

  // 3. ฟังก์ชันออกจากระบบ (Logout)
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setActivePage("home");
      setSelectedItem(null);
      setLoginRole(null);
      setAdminRole(null);
      setAdminPoint(null);
      setAdminOpen(false);
      setRevokedModal(false);
      localStorage.removeItem("adminOpen");
      localStorage.removeItem("adminRole");
      localStorage.removeItem("revokedPending");
    } catch (error) {
      console.error("Logout failed:", error);
    }
    loginAttemptInProgress.current = false;
    localStorage.removeItem("loginRole");
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          backgroundColor: "var(--bg)",
          color: "var(--fg-muted)",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: "#7c5cfc",
              boxShadow: "0 0 12px rgba(124,92,252,0.8)",
              animation: "lafPulse 1.2s ease-in-out infinite",
            }}
          />
          กำลังโหลดข้อมูล...
        </span>
      </div>
    );
  }

  // Guest mode: หน้า Login แบบ overlay (มีปุ่มย้อนกลับไปท่องเว็บ)
  // เปิดเมื่อ guest กดใช้ฟีเจอร์ที่ต้องเข้าสู่ระบบ (promptLogin)
  const guestLoginOverlay = !user && guestLoginOpen ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1500,
        backgroundColor: "var(--bg)",
        overflow: "auto",
      }}
    >
      <button
        onClick={() => setGuestLoginOpen(false)}
        title="ย้อนกลับไปท่องเว็บ"
        style={{
          position: "fixed",
          top: 14,
          left: 14,
          zIndex: 1600,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "9px 14px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          color: "var(--fg-secondary)",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0, 0, 0, 0.35)",
        }}
      >
        <ArrowLeft size={15} />
        ย้อนกลับ
      </button>
      <Login
        onLoginStart={() => {
          loginAttemptInProgress.current = true;
        }}
        onLogin={(u) => {
          loginAttemptInProgress.current = false;
          setUser(u as unknown as User);
          setLoginRole(u.loginRole || "user");
          setAdminRole(u.adminRole || null);
          setAdminPoint(u.adminPoint || null);
          setGuestLoginOpen(false);
          localStorage.setItem("loginRole", u.loginRole || "user");
          completePending();
          if (u.adminRole) {
            localStorage.setItem("adminRole", u.adminRole);
          } else {
            localStorage.removeItem("adminRole");
          }
          if (u.loginRole === "admin") {
            setAdminOpen(true);
            localStorage.setItem("adminOpen", "true");
          }
        }}
        onAdminDenied={(email) => {
          loginAttemptInProgress.current = false;
          setAdminDeniedEmail(email);
        }}
      />
      {adminDeniedEmail !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(5, 4, 10, 0.75)",
            backdropFilter: "blur(8px)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setAdminDeniedEmail(null)}
        >
          <div
            style={{
              position: "relative",
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              padding: "30px 24px 24px",
              maxWidth: 400,
              width: "100%",
              textAlign: "center",
              boxShadow:
                "0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(239,68,68,0.15), 0 0 40px rgba(239,68,68,0.12)",
              animation: "slideUp 0.25s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setAdminDeniedEmail(null)}
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-subtle)",
                color: "var(--fg-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <X size={14} />
            </button>

            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                boxShadow:
                  "0 10px 28px rgba(239,68,68,0.45), inset 0 1px 0 rgba(255,255,255,0.2)",
              }}
            >
              <Lock size={26} color="#fff" />
            </div>

            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--fg)" }}>
              ไม่มีสิทธิ์เข้าถึง Admin Dashboard
            </div>

            <div
              style={{
                fontSize: 13,
                color: "var(--fg-muted)",
                marginTop: 10,
                lineHeight: 1.6,
              }}
            >
              <div style={{ margin: "0 0 10px" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 12px",
                    borderRadius: 999,
                    backgroundColor: "#2a1418",
                    border: "1px solid #4a1f28",
                    color: "var(--fg)",
                    fontWeight: 700,
                    fontSize: 12.5,
                  }}
                >
                  {adminDeniedEmail || "อีเมลนี้"}
                </span>
              </div>
              ไม่มีสิทธิ์เป็นผู้ดูแลระบบ
              <br />
              กรุณาเข้าสู่ระบบด้วยบัญชีบุคคลทั่วไป หรือติดต่อเจ้าหน้าที่เพื่อขอสิทธิ์
            </div>

            <button
              onClick={() => setAdminDeniedEmail(null)}
              style={{
                marginTop: 22,
                width: "100%",
                border: "none",
                borderRadius: 12,
                padding: "13px 0",
                background: "linear-gradient(135deg, #7c5cfc, #6a4eff)",
                color: "#fff",
                fontSize: 14.5,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 8px 24px rgba(124,92,252,0.4)",
              }}
            >
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}
      </div>
  ) : null;

  // แปลงข้อมูล user จาก Firebase ให้ตรงกับที่คอมโพเนนต์ต่างๆ เรียกใช้
  // (guest: ยังไม่ล็อกอิน → ส่ง object ว่างที่มี role เป็น user เพื่อให้ UI ใช้ได้แบบ guest-safe)
  const formattedUser: AppUser = user
    ? {
        ...user,
        name:
          profileName ||
          user.displayName ||
          user.email?.split("@")[0] ||
          "ผู้ใช้งาน",
        email: user.email || "",
        role: loginRole,
      }
    : { role: "user" as const };

  // เปิดโพสต์จากแจ้งเตือนผลคำขอรับของ
  const handleOpenPostFromNotif = async (postId: string) => {
    try {
      const snap = await getDocFromServer(doc(db, "posts", postId));
      if (snap.exists()) {
        setSelectedItem({
          id: snap.id,
          ...snap.data(),
          currentUser: formattedUser,
        } as unknown as PostItem);
      }
    } catch (error) {
      console.error("Error opening post from notification:", error);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* แถบเมนูด้านบน (ซ่อนเมื่อเปิดหน้า Admin เพื่อให้ Admin มีแถบของตัวเอง) */}
      {!adminOpen && (
      <TopNav
        user={formattedUser}
        activePage={activePage}
        isGuest={!user}
        onLogin={() => setGuestLoginOpen(true)}
        onChangePage={gotoPage}
        onOpenProfile={() => gotoPage("profile")}
        onLogout={() => setShowLogoutConfirm(true)}
        isAdmin={loginRole === "admin"}
        isSuperAdmin={adminRole === "super_admin"}
        adminPoint={adminRole === "admin" ? adminPoint : null}
        isAdminOpen={adminOpen}
        chatUnreadCount={chatUnreadCount}
        onOpenAdmin={(tab) => {
          setAdminTab(tab || "overview");
          setAdminOpen(true);
          localStorage.setItem("adminOpen", "true");
        }}
        onOpenPost={handleOpenPostFromNotif}
      />
      )}

      {/* เนื้อหาหลัก */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1180,
            margin: "0 auto",
            minHeight: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {selectedItem ? (
            <ItemDetail
              item={selectedItem}
              onBack={() => setSelectedItem(null)}
              currentUser={formattedUser}
              onRequireLogin={(fn) => {
                pendingActionRef.current = fn ?? null;
                setGuestLoginOpen(true);
              }}
              onStartChat={(post) => {
                const applyChat = () => {
                  setSelectedItem(null);
                  setActivePage("chat");
                  setChatTarget({
                    postId: post.id || "",
                    postTitle: post.title,
                    otherUserId: post.userId || post.uid || "anonymous",
                    otherName:
                      post.reporterName || post.reporter || "ผู้ใช้งาน",
                  });
                };
                if (!promptLogin(applyChat)) return;
                applyChat();
              }}
            />
          ) : (
            <>
              {activePage === "home" && (
                <Home
                  user={formattedUser}
                  onNavigateToReport={() => gotoPage("report")}
                  onOpenProfile={() => gotoPage("profile")}
                  onRequireLogin={(fn) => {
                    pendingActionRef.current = fn ?? null;
                    setGuestLoginOpen(true);
                  }}
                  onSelectPost={(item: PostItem) =>
                    setSelectedItem({ ...item, currentUser: formattedUser })
                  }
                />
              )}

              {activePage === "report" && user && (
                <ReportItem
                  user={formattedUser}
                  onSuccess={() => setActivePage("home")}
                  onCancel={() => setActivePage("home")}
                />
              )}

              {activePage === "chat" && user && (
                <Chat
                  currentUser={formattedUser}
                  initialChat={chatTarget}
                  onOpenProfile={() => setActivePage("profile")}
                />
              )}

              {activePage === "profile" && user && (
                <Profile
                  user={formattedUser}
                  onBack={() => setActivePage("home")}
                  onLogout={() => setShowLogoutConfirm(true)}
                  onNameUpdated={setProfileName}
                />
              )}

              {activePage === "my-items" && user && (
                <MyItems
                  user={formattedUser}
                  onLogout={() => setShowLogoutConfirm(true)}
                  onSelectItem={(item: PostItem) =>
                    setSelectedItem({ ...item, currentUser: formattedUser })
                  }
                  onOpenProfile={() => setActivePage("profile")}
                />
              )}
            </>
          )}
        </div>

        {/* หน้า Admin Dashboard */}
        {adminOpen && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 900,
              backgroundColor: "var(--bg)",
              overflow: "auto",
            }}
          >
            <Admin
              currentUser={formattedUser}
              onLogout={() => setShowLogoutConfirm(true)}
              initialTab={adminTab}
              adminRole={adminRole}
              adminPoint={adminRole === "admin" ? adminPoint : null}
            />
          </div>
        )}
      </div>

      {/* แถบเมนูด้านล่าง (มือถือเท่านั้น — ซ่อนเมื่อเปิด Admin) */}
      {!adminOpen && isMobile && (
        <BottomNav
          activePage={activePage}
          chatUnreadCount={chatUnreadCount}
          onChangePage={gotoPage}
        />
      )}

      {/* Pop-up ยืนยันออกจากระบบ */}
      <LogoutConfirmModal
        open={showLogoutConfirm}
        onConfirm={() => {
          setShowLogoutConfirm(false);
          handleLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {/* Pop-up แจ้งถูกล่ออกสิทธิ์ — ต้องกด "ตกลง" จึงจะกลับไปหน้าเข้าสู่ระบบ */}
      <RevokedModal
        open={revokedModal}
        onConfirm={() => {
          setRevokedModal(false);
          handleLogout();
        }}
      />

      {/* Guest mode: หน้า Login แบบ overlay เมื่อกดใช้ฟีเจอร์ที่ต้องเข้าสู่ระบบ */}
      {guestLoginOverlay}
    </div>
  );
}

export default App;