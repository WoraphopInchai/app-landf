// อีเมลหัวหน้าแอดมิน (super_admin) — แหล่งเดียวสำหรับทั้งเว็บ
// ต้องตรงกับ firestore.rules (isSuperAdmin function) และ rules array ด้านล่าง
const HEAD_ADMIN_EMAILS = [
  "admin@up.ac.th",
  "lostfound.admin@up.ac.th",
  "kaw44588@gmail.com",
  "aonnn4554@gmail.com",
  "aonn4554@gmail.com",
];

const HEAD_ADMIN_EMAILS_NORMALIZED = HEAD_ADMIN_EMAILS.map((e) => e.toLowerCase());

export function isHeadAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return HEAD_ADMIN_EMAILS_NORMALIZED.includes(email.trim().toLowerCase());
}

export { HEAD_ADMIN_EMAILS, HEAD_ADMIN_EMAILS_NORMALIZED };