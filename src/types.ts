// ประเภทข้อมูลกลางที่ใช้ร่วมกันภายในแอป
// แก้ไขไฟล์เดียวที่นี่ แล้ว import ไปใช้ทั้งโปรเจกต์
import type { User } from "firebase/auth";

// ข้อมูลผู้ใช้ที่ผ่านการ format จาก App แล้ว
// (ยอมรับ null เพราะ firebase/auth.User มี field บางตัวเป็น null ได้)
export interface AppUser {
  uid?: string;
  id?: string;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
  avatar?: string | null;
  photoURL?: string | null;
  phoneNumber?: string | null;
  role?: "super_admin" | "admin" | "user" | null;
  loginRole?: "admin" | "user";
  // ตำแหน่งของแอดมิน ณ ขณะล็อกอิน (super = หัวหน้า, admin = เจ้าหน้าที่ประจำจุด)
  adminRole?: "super_admin" | "admin" | null;
  // ชื่อจุดคืนของเจ้าหน้าที่ประจำจุด (เฉพาะ admin)
  adminPoint?: string | null;
}

// ผลลัพธ์จากการล็อกอิน (ประกอบด้วยข้อมูล Firebase User)
export type LoginResult = AppUser & { loginRole: "admin" | "user" };

// ค่าเวลาที่มาจาก Firestore (Timestamp/date/string/etc.)
export type FirestoreTimeLike =
  | { toDate?: () => Date }
  | Date
  | string
  | number
  | null;

// โพสต์ของหาย/ของพบ
export interface PostItem {
  id?: string;
  itemType?: "lost" | "found";
  type?: "lost" | "found";
  title: string;
  category?: string;
  faculty?: string;
  building?: string;
  locationName?: string;
  location?: string;
  desc?: string;
  imageUrl?: string | null;
  image?: string | null;
  status?: string;
  securityZone?: string;
  depositLocation?: string;
  reservationClaimId?: string;
  inProgressAt?: FirestoreTimeLike;
  createdAt?: FirestoreTimeLike;
  resolvedAt?: FirestoreTimeLike;
  date?: FirestoreTimeLike;
  time?: string;
  refCode?: string;
  reporterName?: string;
  reporter?: string;
  reporterPhone?: string;
  userId?: string;
  uid?: string;
  currentUser?: AppUser | null;
  matches?: Array<{
    matchedPostId: string;
    matchedTitle: string;
    similarityScore: number;
    reason?: string;
    confirmed?: boolean;
    rejected?: boolean;
  }>;
  nearMatches?: Array<{
    matchedPostId: string;
    matchedTitle: string;
    similarityScore: number;
    reason?: string;
    confirmed?: boolean;
    rejected?: boolean;
  }>;
  aiData?: Record<string, unknown> | null;
}

// เป้าหมายห้องแชทที่เลือกจากหน้า ItemDetail / Home
export interface ChatTarget {
  postId: string;
  postTitle: string;
  otherUserId: string;
  otherName: string;
}

export type { User };