import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { showToast } from "./lib/toast";

// ดึงค่า Config จากไฟล์ .env
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// เริ่มต้นใช้งาน Firebase
const app = initializeApp(firebaseConfig);

// ส่งออกฐานข้อมูล และระบบ Authenticate
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

// ฟังก์ชันล็อกอินด้วย Google
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: unknown) {
    const errCode =
      error instanceof Object && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (errCode === "auth/popup-closed-by-user") {
      console.log("ผู้ใช้ยกเลิกการล็อกอิน (ปิด Pop-up)");
      return null;
    }
    if (errCode === "auth/popup-blocked") {
      showToast("กรุณาอนุญาตให้เบราว์เซอร์เปิด Pop-up เพื่อเข้าสู่ระบบ", "error");
      return null;
    }
    console.error("Login Error:", error);
    return null;
  }
};

// ฟังก์ชันออกจากระบบ
export const logoutUser = async () => {
  try {
    await signOut(auth);
    return true;
  } catch (error) {
    console.error("Logout Error:", error);
    return false;
  }
};