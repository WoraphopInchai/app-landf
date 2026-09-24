import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../firebase";

export const isCurrentUserBanned = async (): Promise<boolean> => {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() && snap.data().banned === true;
  } catch {
    return false;
  }
};