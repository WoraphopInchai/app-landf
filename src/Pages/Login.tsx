import { useState, useCallback } from "react";
import {
  GraduationCap,
  Shield,
  ShieldCheck,
  Users,
  Sun,
  Moon,
  Loader2,
  LayoutDashboard,
  Search,
  Lock,
} from "lucide-react";
import { signInWithGoogle, auth } from "../firebase";
import { doc, getDocFromServer, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { signOut } from "firebase/auth";
import type { LoginResult } from "../types";
import { useTheme } from "../theme";
import ToastContainer from "../components/Toast";
import { showToast } from "../lib/toast";

interface LoginProps {
  onLogin?: (user: LoginResult) => void;
  onAdminDenied?: (email: string) => void;
  onLoginStart?: () => void;
}

import { isHeadAdminEmail } from "../lib/admins";

/* =========================================================
   ไอคอนโลโก้ Google ตัวจริง
   ========================================================= */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
      <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
      <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
      <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
    </svg>
  );
}

export default function Login({ onLogin, onAdminDenied, onLoginStart }: LoginProps) {
  const [loginType, setLoginType] = useState<"user" | "admin">("user");
  const [loading, setLoading] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const handleLogin = useCallback(async () => {
    if (loading) return;

    try {
      setLoading(true);
      onLoginStart?.();
      const user = await signInWithGoogle();

      if (user) {
        // ระดับสิทธิ์จริงของบัญชีนี้ (super_admin / admin / user)
        // - อีเมลใน ADMIN_EMAILS = หัวหน้าแอดมิน (super_admin) เสมอ
        // - มี adminAccounts/{email} = เจ้าหน้าที่ประจำจุด (admin)
        // - อย่างอื่น = ผู้ใช้ทั่วไป (user)
        const email = (user.email || "").toLowerCase();
        const isSuper = isHeadAdminEmail(email);
        let isStaff = false;
        let staffPointName = "";
        if (email && !isSuper) {
          // อ่านแบบ best-effort: ถ้า rules บล็อกการอ่าน adminAccounts (ยังไม่ deploy กฎใหม่)
          // ให้ถือว่า "ไม่ใช่เจ้าหน้าที่" แล้วล็อกอินต่อไปได้ ไม่ให้ login ค้าง
          // ใช้ getDocFromServer เพื่อกันการอ่านค่าจาก local cache เก่า
          // (ไม่งั้นเจ้าหน้าที่ที่โดนถอดสิทธิ์แล้วยังคงล็อกอินแอดมินได้เพราะมีข้อมูลเก่าในแคช)
          try {
            const accSnap = await getDocFromServer(doc(db, "adminAccounts", email));
            if (accSnap.exists()) {
              isStaff = true;
              staffPointName = accSnap.data()?.pointName || "";
              // เก็บ uid + เวลาล็อกอินของเจ้าหน้าที่ไว้ (หัวหน้าใช้ยืนยันตัวตน/แจ้งเตือนเวลาสับเปลี่ยน)
              await updateDoc(doc(db, "adminAccounts", email), {
                uid: user.uid,
                lastLoginAt: new Date().toISOString(),
              }).catch(() => {});
            }
          } catch (error) {
            console.warn("Cannot read adminAccounts (maybe rules not deployed yet):", error);
          }
        }
        const adminRole = isSuper ? "super_admin" : isStaff ? "admin" : null;

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDocFromServer(userRef);
        const existing = userSnap.exists() ? userSnap.data() : null;

        // บัญชีที่ถูกแบน: ห้ามเข้าใช้ระบบทันที (ทั้งผู้ใช้และแอดมิน)
        if (existing?.banned === true) {
          await signOut(auth);
          showToast("บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อเจ้าหน้าที่", "error");
          setLoading(false);
          return;
        }

        // เขียนแบบ best-effort: ถ้า rules ไม่อนุญาตให้บันทึก role (ยังไม่ deploy กฎใหม่)
        // ให้ log ไว้แล้วล็อกอินต่อได้ กัน login ค้าง
        try {
          await setDoc(
            userRef,
            {
              name: user.displayName || existing?.name || "",
              email: user.email || existing?.email || "",
              role: adminRole || "user",
              banned: existing?.banned ?? false,
              createdAt: existing?.createdAt || new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (error) {
          console.warn("Cannot save user profile (maybe rules not deployed yet):", error);
        }

        // ต้องมีสิทธิ์แอดมินจริง (หัวหน้า หรือ เจ้าหน้าที่ประจำจุด) ถึงจะเข้าสู่ระบบโหมดแอดมินได้
        if (loginType === "admin" && !adminRole) {
          await signOut(auth);
          onAdminDenied?.(user.email || "");
          setLoading(false);
          return;
        }

        console.log("เข้าสู่ระบบสำเร็จ:", user.displayName, `(${loginType})`);
        if (onLogin)
          onLogin({ ...user, loginRole: loginType, adminRole, adminPoint: staffPointName || null });
      }
    } catch (error) {
      console.error("เกิดข้อผิดพลาด:", error);
      showToast("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setLoading(false);
    }
  }, [loading, loginType, onLogin, onAdminDenied, onLoginStart]);

  const isAdmin = loginType === "admin";

  return (
    <div className="lf-login-page">
      <style>{`
        /* ==================== พื้นหลังรวมทั้งหน้า ==================== */
        .lf-login-page {
          position: relative;
          min-height: 100vh;
          background: var(--bg);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          overflow: hidden;
        }

        /* จุดกริดพื้นหลังแบบจาง ๆ */
        .lf-login-dots {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: radial-gradient(rgba(124,92,252,0.22) 1px, transparent 1px);
          background-size: 30px 30px;
          opacity: 0.35;
        }

        /* ==================== การ์ด Split-Screen ==================== */
        .lf-card {
          position: relative;
          width: 100%;
          max-width: 940px;
          min-height: 545px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1.05fr 1fr;
          border-radius: 24px;
          overflow: hidden;
          background: var(--bg-card);
          border: 1px solid var(--border);
          box-shadow: 0 40px 90px -30px rgba(0, 0, 0, 0.6), 0 0 70px rgba(124,92,252,0.08);
          animation: lfCardIn 0.55s cubic-bezier(0.16, 1, 0.3, 1) both;
          transition: border-color 0.5s ease;
        }
        .lf-card--admin {
          border-color: rgba(100, 116, 139, 0.4);
          box-shadow: 0 40px 90px -30px rgba(0, 0, 0, 0.65), 0 0 70px rgba(14,165,233,0.1);
        }

        /* ==================== ฝั่งซ้าย: Hero Banner ==================== */
        .lf-banner {
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          color: #fff;
          padding: 44px 40px 48px;
          background: var(--bg);
          overflow: hidden;
          z-index: 1;
        }

        /* พื้นหลัง 2 ชั้น (ม่วง / สเลท) ซ้อนกัน แล้ว crossfade ตาม state */
        .lf-banner-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
          transition: opacity 0.5s ease;
        }
        .lf-banner-bg--user {
          opacity: 1;
          background:
            radial-gradient(120% 120% at 0% 0%, rgba(139,92,246,0.5) 0%, transparent 50%),
            radial-gradient(130% 110% at 100% 100%, rgba(37,99,235,0.45) 0%, transparent 55%),
            linear-gradient(155deg, #6d28d9 0%, #5b21b6 45%, #4c1d95 100%);
        }
        .lf-banner-bg--admin {
          opacity: 0;
          background:
            radial-gradient(100% 100% at 100% 0%, rgba(56,189,248,0.22) 0%, transparent 55%),
            radial-gradient(110% 120% at 0% 100%, rgba(148,163,184,0.16) 0%, transparent 55%),
            linear-gradient(155deg, #1e293b 0%, #16213a 55%, #0f172a 100%);
        }
        .lf-banner--admin .lf-banner-bg--user { opacity: 0; }
        .lf-banner--admin .lf-banner-bg--admin { opacity: 1; }

        /* ลายจุดจาง ๆ */
        .lf-banner-dots {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px);
          background-size: 22px 22px;
          opacity: 0.4;
        }

        /* == Tech/Security Pattern + Glow สำหรับโหมด Admin == */
        .lf-banner-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.6s ease;
          background-image:
            linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px);
          background-size: 34px 34px;
          mask-image: radial-gradient(90% 90% at 50% 40%, #000 30%, transparent 100%);
          -webkit-mask-image: radial-gradient(90% 90% at 50% 40%, #000 30%, transparent 100%);
        }
        .lf-banner-scan {
          position: absolute;
          left: 0;
          right: 0;
          height: 90px;
          background: linear-gradient(180deg, transparent, rgba(56,189,248,0.13), transparent);
          animation: lfScan 5.5s linear infinite;
          opacity: 0;
          transition: opacity 0.6s ease;
          pointer-events: none;
        }
        .lf-banner--admin .lf-banner-grid { opacity: 1; }
        .lf-banner--admin .lf-banner-scan { opacity: 1; }

        /* วงกลมสีเรืองแสง (ทั้ง 2 โหมด) */
        .lf-banner-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(50px);
          pointer-events: none;
          animation: lfDrift 14s ease-in-out infinite alternate;
          transition: opacity 0.5s ease;
        }
        .lf-banner--admin .lf-banner-orb {
          opacity: 0.55;
        }

        .lf-banner-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          flex: 1;
        }

        /* ป้ายโลโก้ */
        .lf-banner-school {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          align-self: flex-start;
          background: rgba(255,255,255,0.14);
          border: 1px solid rgba(255,255,255,0.28);
          border-radius: 999px;
          padding: 7px 16px 7px 8px;
          backdrop-filter: blur(8px);
        }
        .lf-banner-school-icon {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #fff;
          color: #4f3bd6;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 13px;
          transition: background 0.5s ease, color 0.5s ease;
        }
        .lf-banner--admin .lf-banner-school-icon {
          background: #0f172a;
          color: #38bdf8;
        }
        .lf-banner-school-label {
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.01em;
          line-height: 1.4;
        }

        /* ข้อความหลัก */
        .lf-banner-title {
          margin-top: 34px;
          font-size: 38px;
          font-weight: 800;
          line-height: 1.12;
          letter-spacing: -0.03em;
          color: #fff;
        }
        .lf-banner-title-brand {
          display: block;
          margin-top: 8px;
          background: linear-gradient(120deg, #fff 20%, #c7d2fe 60%, #a5b4fc 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          transition: background 0.5s ease;
        }
        .lf-banner--admin .lf-banner-title-brand {
          background: linear-gradient(120deg, #fff 15%, #7dd3fc 55%, #38bdf8 100%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .lf-banner-desc {
          margin-top: 14px;
          color: rgba(255,255,255,0.82);
          font-size: 14px;
          line-height: 1.7;
          max-width: 340px;
        }

        /* == พื้นหลังเคลื่อนไหวสำหรับโหมดปกติ (ม่วง) ==
           Aurora หมุนช้า ๆ + Blob ลอย ละมุนเหมือนฝั่ง Admin */
        .lf-banner-aurora {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 430px;
          height: 430px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          pointer-events: none;
          filter: blur(58px);
          opacity: 0.65;
          transition: opacity 0.5s ease;
          background: conic-gradient(
            from 0deg,
            rgba(168, 85, 247, 0.55) 0deg,
            rgba(59, 130, 246, 0.4) 120deg,
            rgba(236, 72, 153, 0.45) 240deg,
            rgba(168, 85, 247, 0.55) 360deg
          );
          animation: lfAuroraSpin 14s linear infinite;
        }
        .lf-user-blob {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          filter: blur(46px);
          opacity: 0.9;
          transition: opacity 0.5s ease;
          animation: lfBlobFloat 8s ease-in-out infinite alternate;
        }
        .lf-banner--admin .lf-banner-aurora { opacity: 0; }
        .lf-banner--admin .lf-user-blob { opacity: 0; }

        /* การ์ด Feature Highlights (Glassmorphism) */
        .lf-feature-cards {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: auto;
          padding-top: 26px;
        }
        .lf-feature-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 13px 15px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.10);
          border: 1px solid rgba(255, 255, 255, 0.20);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
          animation: lfStatePop 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .lf-feature-card-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .lf-feature-card-value {
          font-size: 15.5px;
          font-weight: 800;
          color: #fff;
          line-height: 1.2;
          letter-spacing: -0.01em;
        }
        .lf-feature-card-label {
          margin-top: 3px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.78);
          line-height: 1.4;
          font-weight: 500;
        }

        /* ==================== ฝั่งขวา: พื้นที่ฟอร์ม ==================== */
        .lf-form {
          position: relative;
          z-index: 2;
          background: var(--bg-card);
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 48px 44px;
        }
        .lf-form::before {
          content: '';
          position: absolute;
          top: 0;
          right: 0;
          width: 180px;
          height: 180px;
          background: radial-gradient(circle, rgba(124,92,252,0.12) 0%, transparent 70%);
          pointer-events: none;
          transition: background 0.5s ease;
        }
        .lf-card--admin .lf-form::before {
          background: radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 70%);
        }
        .lf-form::after {
          content: '';
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          height: 3px;
          background: linear-gradient(90deg, transparent 0%, rgba(124,92,252,0.55) 40%, rgba(37,99,235,0.45) 100%);
          pointer-events: none;
          opacity: 0.8;
          transition: background 0.5s ease, opacity 0.5s ease;
        }
        .lf-card--admin .lf-form::after {
          background: linear-gradient(90deg, transparent 0%, rgba(56,189,248,0.6) 45%, rgba(148,163,184,0.35) 100%);
        }

        .lf-form-inner {
          width: 100%;
          max-width: 360px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
        }

        .lf-form-head {
          margin-bottom: 26px;
        }
        .lf-form-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 10px;
          transition: color 0.5s ease;
        }
        .lf-card--admin .lf-form-eyebrow {
          color: #38bdf8;
        }
        .lf-form-title {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--fg);
          line-height: 1.3;
        }
        .lf-form-sub {
          margin-top: 8px;
          color: var(--fg-muted);
          font-size: 13.5px;
          line-height: 1.65;
        }

        /* ตัวเลือกประเภทผู้ใช้ (Tab) */
        .lf-tabs {
          display: flex;
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 4px;
          margin-bottom: 20px;
          position: relative;
        }
        .lf-tab-indicator {
          position: absolute;
          top: 4px;
          bottom: 4px;
          width: calc(50% - 4px);
          border-radius: 9px;
          background: linear-gradient(135deg, #7c5cfc, #6a4eff);
          box-shadow: 0 4px 16px rgba(124,92,252,0.4);
          transition: left 0.28s cubic-bezier(0.16, 1, 0.3, 1), background 0.5s ease, box-shadow 0.5s ease;
          z-index: 0;
        }
        .lf-tab-indicator--admin {
          background: linear-gradient(135deg, #475569, #1e293b);
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.6);
        }
        .lf-tab {
          flex: 1;
          position: relative;
          z-index: 1;
          padding: 11px 0;
          border: none;
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          font-size: 13px;
          font-weight: 700;
          color: var(--fg-muted);
          transition: color 0.2s ease;
        }
        .lf-tab.active {
          color: #fff;
        }

        /* ปุ่มเข้าสู่ระบบด้วย Google */
        .lf-google {
          position: relative;
          width: 100%;
          padding: 14px;
          border: 1px solid var(--border-strong);
          border-radius: 12px;
          background: var(--bg-card);
          color: var(--fg);
          font-size: 14.5px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          transition: all 0.4s ease;
          overflow: hidden;
        }
        .lf-google::after {
          content: '';
          position: absolute;
          top: 0;
          left: -80%;
          width: 50%;
          height: 100%;
          background: linear-gradient(120deg, transparent, rgba(255,255,255,0.16), transparent);
          transform: skewX(-20deg);
          transition: left 0.6s ease;
          pointer-events: none;
        }
        .lf-google:hover:not(:disabled) {
          border-color: var(--accent);
          box-shadow: 0 6px 24px rgba(124,92,252,0.22);
          transform: translateY(-1px);
        }
        .lf-google:hover:not(:disabled)::after {
          left: 130%;
        }
        .lf-google:active:not(:disabled) {
          transform: translateY(0);
        }
        .lf-google:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        /* โหมด Admin: ปุ่มโทนสเลทเข้ม ฟ้าเทคนิค */
        .lf-google--admin {
          border: 1px solid rgba(148, 163, 184, 0.5);
          background: linear-gradient(180deg, #1e293b, #0f172a);
          color: #f1f5f9;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
        }
        .lf-google--admin:hover:not(:disabled) {
          border-color: rgba(56, 189, 248, 0.65);
          box-shadow: 0 6px 26px rgba(14, 165, 233, 0.32);
        }

        .lf-google-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--fg-faint);
          font-size: 11.5px;
          margin: 18px 0;
        }
        .lf-google-divider::before,
        .lf-google-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        .lf-form-foot {
          margin-top: 18px;
          display: flex;
          align-items: center;
          gap: 7px;
          justify-content: center;
          font-size: 11.5px;
          color: var(--fg-faint);
          line-height: 1.6;
          text-align: center;
        }
        .lf-form-foot-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          flex-shrink: 0;
          animation: lfPulse 2.5s ease-in-out infinite;
        }
        .lf-card--admin .lf-form-foot-dot {
          background: #38bdf8;
        }

        /* ปุ่มสลับธีม */
        .lf-theme-toggle {
          position: absolute;
          top: 20px;
          right: 20px;
          width: 40px;
          height: 40px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--bg-card);
          color: var(--fg-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 10;
          transition: all 0.2s ease;
          box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        }
        .lf-theme-toggle:hover {
          border-color: var(--accent);
          color: var(--fg-accent);
          transform: scale(1.06);
        }

        /* ==================== แอนิเมชัน ==================== */
        @keyframes lfCardIn {
          from { opacity: 0; transform: translateY(16px) scale(0.99); }
          to { opacity: 1; transform: none; }
        }
        @keyframes lfStateIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes lfStatePop {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: none; }
        }
        @keyframes lfDrift {
          from { transform: translate(0, 0) scale(1); }
          to { transform: translate(18px, -14px) scale(1.08); }
        }
        @keyframes lfAuroraSpin {
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @keyframes lfBlobFloat {
          from { transform: translate(0, 0) scale(1); }
          to { transform: translate(26px, -20px) scale(1.15); }
        }
        @keyframes lfScan {
          0% { top: -15%; }
          100% { top: 110%; }
        }
        @keyframes lfPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        .lf-state-in {
          animation: lfStateIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        /* ==================== Responsive: มือถือ/จอเล็ก ==================== */
        @media (max-width: 760px) {
          .lf-card {
            grid-template-columns: 1fr;
            border-radius: 20px;
          }
          .lf-banner {
            padding: 32px 28px 40px;
            justify-content: flex-start;
            min-height: auto;
          }
          .lf-banner-title { font-size: 30px; margin-top: 26px; }
          .lf-form { padding: 36px 24px 32px; }
          .lf-form-title { font-size: 22px; }
        }
      `}</style>

      <div className="lf-login-dots" />

      {/* ปุ่มสลับธีม */}
      <button
        className="lf-theme-toggle"
        onClick={toggleTheme}
        title={theme === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className={`lf-card ${isAdmin ? "lf-card--admin" : ""}`}>
        {/* ============ ฝั่งซ้าย: Hero Banner (เปลี่ยนธีมตาม state) ============ */}
        <aside className={`lf-banner ${isAdmin ? "lf-banner--admin" : ""}`}>
          {/* พื้นหลังซ้อน 2 ชั้น crossfade */}
          <div className="lf-banner-bg lf-banner-bg--user" />
          <div className="lf-banner-bg lf-banner-bg--admin" />
          <div className="lf-banner-dots" />
          {/* Tech/Security Pattern สำหรับโหมด Admin */}
          <div className="lf-banner-grid" />
          <div className="lf-banner-scan" />
          <div
            className="lf-banner-orb"
            style={{ width: 260, height: 260, top: -70, right: -40, background: "radial-gradient(circle, rgba(255,255,255,0.28) 0%, transparent 70%)" }}
          />
          <div
            className="lf-banner-orb"
            style={{ width: 220, height: 220, bottom: 40, left: -60, background: "radial-gradient(circle, rgba(37,99,235,0.45) 0%, transparent 70%)", animationDelay: "-7s" }}
          />
          {/* พื้นหลังเคลื่อนไหวเฉพาะโหมดปกติ (ม่วง): Aurora + Blob ลอย */}
          <div className="lf-banner-aurora" />
          <div
            className="lf-user-blob"
            style={{ width: 190, height: 190, top: "16%", left: -46, background: "radial-gradient(circle, rgba(168,85,247,0.5) 0%, transparent 70%)", animationDelay: "-2s" }}
          />
          <div
            className="lf-user-blob"
            style={{ width: 150, height: 150, bottom: 96, right: -26, background: "radial-gradient(circle, rgba(59,130,246,0.45) 0%, transparent 70%)", animationDelay: "-5s" }}
          />

          <div className="lf-banner-content lf-state-in" key={isAdmin ? "admin" : "user"}>
            <div className="lf-banner-school">
              <div className="lf-banner-school-icon">
                {isAdmin ? <ShieldCheck size={16} /> : <GraduationCap size={16} />}
              </div>
              <span className="lf-banner-school-label">
                {isAdmin ? "University of Phayao · Admin Portal" : "University of Phayao"}
              </span>
            </div>

            <h1 className="lf-banner-title">
              {isAdmin ? "ระบบจัดการข้อมูลของหาย" : "ศูนย์รวมแจ้ง"}
              <span className="lf-banner-title-brand">
                {isAdmin ? "Admin Portal" : "ระบบแจ้งของหาย"}
              </span>
            </h1>

            <p className="lf-banner-desc">
              {isAdmin
                ? "สำหรับเจ้าหน้าที่และผู้ดูแลระบบเท่านั้น เพื่อตรวจสอบคำขอรับของและดูแลข้อมูลทั้งหมดอย่างปลอดภัย"
                : "พื้นที่ส่วนกลางสำหรับนิสิตและบุคลากร มหาวิทยาลัยพะเยา"}
            </p>

            {/* Feature Highlights (Glassmorphism - เปลี่ยนตาม state, 2 กล่อง) */}
            {isAdmin ? (
              <div className="lf-feature-cards">
                <div className="lf-feature-card">
                  <div
                    className="lf-feature-card-icon"
                    style={{ background: "linear-gradient(135deg, #0ea5e9, #0369a1)", boxShadow: "0 6px 16px rgba(14,165,233,0.35)" }}
                  >
                    <ShieldCheck size={18} color="#fff" />
                  </div>
                  <div>
                    <div className="lf-feature-card-value">Admin Access Only</div>
                    <div className="lf-feature-card-label">สิทธิ์เข้าถึงเฉพาะเจ้าหน้าที่ที่ได้รับอนุญาต</div>
                  </div>
                </div>
                <div className="lf-feature-card" style={{ animationDelay: "0.08s" }}>
                  <div
                    className="lf-feature-card-icon"
                    style={{ background: "linear-gradient(135deg, #10b981, #047857)", boxShadow: "0 6px 16px rgba(16,185,129,0.35)" }}
                  >
                    <Lock size={18} color="#fff" />
                  </div>
                  <div>
                    <div className="lf-feature-card-value">Security Verified</div>
                    <div className="lf-feature-card-label">บันทึกประวัติและตรวจสอบข้อมูลอย่างปลอดภัย</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="lf-feature-cards">
                <div className="lf-feature-card">
                  <div
                    className="lf-feature-card-icon"
                    style={{ background: "linear-gradient(135deg, #f97316, #c2410c)", boxShadow: "0 6px 16px rgba(249,115,22,0.35)" }}
                  >
                    <Search size={18} color="#fff" />
                  </div>
                  <div>
                    <div className="lf-feature-card-value">ค้นหาสิ่งของง่ายดาย</div>
                    <div className="lf-feature-card-label">ค้นหาตามสถานที่และหมวดหมู่ภายใน ม.พะเยา</div>
                  </div>
                </div>
                <div className="lf-feature-card" style={{ animationDelay: "0.08s" }}>
                  <div
                    className="lf-feature-card-icon"
                    style={{ background: "linear-gradient(135deg, #0ea5e9, #0369a1)", boxShadow: "0 6px 16px rgba(14,165,233,0.35)" }}
                  >
                    <GraduationCap size={18} color="#fff" />
                  </div>
                  <div>
                    <div className="lf-feature-card-value">ปลอดภัยด้วย UP Account</div>
                    <div className="lf-feature-card-label">เข้าใช้งานผ่าน Google มหาวิทยาลัยพะเยา</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ============ ฝั่งขวา: ฟอร์ม (ธีมตาม state) ============ */}
        <section className="lf-form">
          <div className="lf-form-inner">
            <div className="lf-form-head lf-state-in" key={`form-${isAdmin ? "admin" : "user"}`}>
              <div className="lf-form-eyebrow">
                {isAdmin ? <ShieldCheck size={13} /> : <LayoutDashboard size={13} />}
                {isAdmin ? "Admin Portal" : "ยินดีต้อนรับ"}
              </div>
              <h2 className="lf-form-title">
                {isAdmin ? "เข้าสู่ระบบผู้ดูแลระบบ" : "เข้าสู่ระบบ"}
              </h2>
              <p className="lf-form-sub">
                {isAdmin
                  ? "ยืนยันตัวตนด้วยบัญชี Google ที่ได้รับสิทธิ์ผู้ดูแล เพื่อจัดการข้อมูลและตรวจสอบคำขอรับของ"
                  : "เลือกประเภทผู้ใช้และเข้าสู่ระบบ เพื่อเริ่มใช้งานระบบแจ้งของหาย"}
              </p>
            </div>

            {/* ตัวเลือกประเภทผู้ใช้ */}
            <div className="lf-tabs">
              <div
                className={`lf-tab-indicator ${isAdmin ? "lf-tab-indicator--admin" : ""}`}
                style={{ left: isAdmin ? "calc(50% + 0px)" : "0px" }}
              />
              <button
                type="button"
                className={`lf-tab ${!isAdmin ? "active" : ""}`}
                onClick={() => setLoginType("user")}
              >
                <Users size={14} />
                บุคคลทั่วไป
              </button>
              <button
                type="button"
                className={`lf-tab ${isAdmin ? "active" : ""}`}
                onClick={() => setLoginType("admin")}
              >
                <Shield size={14} />
                Admin
              </button>
            </div>

            <div className="lf-google-divider">เข้าสู่ระบบต่อด้วย Google</div>

            {/* ปุ่มเข้าสู่ระบบด้วย Google (ธีมตาม state) */}
            <button
              type="button"
              className={`lf-google ${isAdmin ? "lf-google--admin" : ""}`}
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                  กำลังเชื่อมต่อ...
                </>
              ) : (
                <>
                  <GoogleIcon />
                  {isAdmin ? "เข้าสู่ระบบ Admin ด้วย Google" : "เข้าสู่ระบบด้วย Google"}
                </>
              )}
            </button>

            <div className="lf-form-foot">
              <span className="lf-form-foot-dot" />
              <span>
                {isAdmin
                  ? "เฉพาะบัญชีที่ได้รับสิทธิ์ผู้ดูแลระบบเท่านั้น"
                  : "การเข้าสู่ระบบใช้บัญชี Google เพื่อยืนยันตัวตนเท่านั้น"}
              </span>
            </div>
          </div>
        </section>
      </div>

      <ToastContainer />
    </div>
  );
}