// ช่องทางการเข้าสู่ระบบ 3 ช่องทาง (เก็บไว้ที่เดียว ใช้ร่วมกันทั้งโปรเจกต์)
// - student : นิสิตและบุคลากรมหาวิทยาลัย → ต้องเป็นอีเมล @up.ac.th เท่านั้น
// - general : บุคคลทั่วไป            → ใช้อีเมลได้ทุกแบบ ไม่มีเงื่อนไข
// - admin   : ผู้ดูแลระบบ            → ต้องมีสิทธิ์แอดมินจริง (ตรวจจาก users.role / adminAccounts)
export type LoginChannel = "student" | "general" | "admin";

// โดเมนอีเมลมหาวิทยาลัย ที่ใช้ได้กับช่องทางนิสิตและบุคลากรเท่านั้น
export const UP_EMAIL_DOMAIN = "@up.ac.th";

/**
 * ตรวจว่าอีเมลเป็นของมหาวิทยาลัยหรือไม่
 * ใช้ endsWith (ไม่ใช่ includes) เพื่อกันอีเมลปลอมแบบ name@up.ac.th.evil.com
 * และกันเคสที่ @up.ac.th เป็นแค่ส่วนหนึ่งของโดเมนอื่น
 */
export function isUpEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(UP_EMAIL_DOMAIN);
}
