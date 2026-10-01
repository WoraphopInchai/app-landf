import type { AppUser } from "../types";

/**
 * Role ของผู้มาขอรับของ
 * - "student" = นิสิตและบุคลากรมหาวิทยาลัย (ยืนยันอีเมล @up.ac.th ตอนล็อกอิน)
 * - "public"  = บุคคลทั่วไป (ทุกอีเมล)
 *
 * ค่านี้ผูกกับฟิลด์ claimType ใน Firestore เดิม เพื่อให้ข้อมูลเก่าที่แอดมินอ่านอยู่แล้วยังถูกต้อง
 */
export type ClaimRole = "student" | "public";

/** ป้าย Role ที่ส่งไปให้แอดมินเห็น */
export const CLAIM_ROLE_LABEL: Record<ClaimRole, string> = {
  student: "นิสิตและบุคลากร",
  public: "บุคคลทั่วไป",
};

/**
 * ดึง Role จาก session ที่ล็อกอินอยู่ (ไม่ให้ผู้ใช้เลือกเองตอนกดขอรับของ)
 * - บัญชีแอดมินไม่มี accountType → ถือเป็นบุคคลทั่วไป
 * - ผู้ใช้เก่าที่ล็อกอินก่อนมีฟีเจอร์นี้ (accountType = null) → ถือเป็นบุคคลทั่วไป
 */
export function resolveClaimRole(
  user?: Pick<AppUser, "accountType" | "role"> | null
): ClaimRole {
  if (user?.accountType === "student") return "student";
  return "public";
}

/** ชื่อ-นามสกุลจาก session (ใช้เป็นค่าเริ่มต้น/ค่าอัตโนมัติ) */
export function sessionName(
  user?: Pick<AppUser, "name" | "displayName" | "email"> | null
): string {
  return user?.name || user?.displayName || user?.email?.split("@")[0] || "";
}

/** อีเมลจาก session (ใช้ยืนยันตัวตน ห้ามให้ผู้ใช้แก้เอง) */
export function sessionEmail(
  user?: Pick<AppUser, "email"> | null
): string {
  return (user?.email || "").trim();
}

/**
 * แปลงวันที่เป็นค่าที่ใช้กับ <input type="datetime-local"> ได้
 * ต้องใช้เวลาท้องถิ่น (ไม่ใช่ toISOString ที่คืนค่าเป็น UTC) ไม่งั้นช่วงเวลาที่เลือกได้จะเพี้ยนไป 7 ชั่วโมง
 */
export function toLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
