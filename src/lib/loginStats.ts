// สถิติสาธารณะสำหรับหน้า Login (เก็บใน doc `stats/login` ใน Firestore)
// - อ่าน: ได้แม้ยังไม่ล็อกอิน (Rules อนุญาต public read) เพื่อแสดงบนหน้า Login
// - เขียน: ระบบคำนวณจากข้อมูลจริง (posts/users) ตอนผู้ใช้ล็อกอินอยู่ แล้วบันทึกให้ทันสมัย
import { collection, getDocs, doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { isHeadAdminEmail } from "./admins";

export interface LoginStats {
  totalPosts: number;
  resolvedPosts: number;
  totalUsers: number;
}

export const emptyLoginStats = (): LoginStats => ({
  totalPosts: 0,
  resolvedPosts: 0,
  totalUsers: 0,
});

// อ่านสถิติจาก doc (อ่านได้โดยไม่ต้องล็อกอิน)
export async function readLoginStats(): Promise<LoginStats> {
  try {
    const snap = await getDoc(doc(db, "stats", "login"));
    if (!snap.exists()) return emptyLoginStats();
    const d = snap.data();
    return {
      totalPosts: Number(d.totalPosts) || 0,
      resolvedPosts: Number(d.resolvedPosts) || 0,
      totalUsers: Number(d.totalUsers) || 0,
    };
  } catch (error) {
    console.error("Error reading login stats:", error);
    return emptyLoginStats();
  }
}

// คำนวณสถิติจริงจาก Firestore แล้วบันทึกลง doc (เฉพาะหัวหน้าแอดมินเท่านั้นที่ทำได้)
// — เจ้าหน้าที่ประจำจุดอ่าน users ทั้ง collection ไม่ได้ (rules จำกัด user read เฉพาะ head/ตัวเอง)
//   และอ่าน posts ทั้งระบบไม่ได้ (ต้องกรอง depositLocation) → จึงไม่ refresh สถิติเพื่อกัน error/cache เก่า
// ผู้ใช้ทั่วไปอ่านค่าเดิม (Rules ห้ามเขียน stats/login ให้ผู้ที่ไม่ใช่แอดมิน)
export async function refreshLoginStats(): Promise<LoginStats> {
  const uid = auth.currentUser?.uid;
  if (!uid) return readLoginStats();

  try {
    // เฉพาะ super_admin เท่านั้น (whitelist email นับเป็น super เสมอ แม้ doc role จะเก่า/ไม่ครบ)
    const isSuperByEmail = !!auth.currentUser?.email && isHeadAdminEmail(auth.currentUser.email);
    const me = await getDoc(doc(db, "users", uid));
    const role = me.exists() ? me.data()?.role : undefined;
    if (!isSuperByEmail && role !== "super_admin") {
      return readLoginStats();
    }
  } catch (error) {
    console.error("Error checking admin role:", error);
    return readLoginStats();
  }

  try {
    const [postsSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "posts")),
      getDocs(collection(db, "users")),
    ]);

    let resolved = 0;
    postsSnap.forEach((docSnap) => {
      const status = docSnap.data().status;
      if (status === "resolved") {
        resolved++;
      }
    });

    const stats: LoginStats = {
      totalPosts: postsSnap.size,
      resolvedPosts: resolved,
      totalUsers: usersSnap.size,
    };

    // ถ้าค่าไม่เปลี่ยน ไม่ต้องเขียนซ้ำ (ลดจำนวนการเขียนโดยไม่จำเป็น)
    const current = await readLoginStats();
    const changed =
      current.totalPosts !== stats.totalPosts ||
      current.resolvedPosts !== stats.resolvedPosts ||
      current.totalUsers !== stats.totalUsers;

    if (changed) {
      await setDoc(doc(db, "stats", "login"), {
        ...stats,
        updatedAt: new Date().toISOString(),
      });
    }

    return stats;
  } catch (error) {
    console.error("Error refreshing login stats:", error);
    return readLoginStats();
  }
}