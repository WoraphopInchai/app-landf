import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import type { VercelRequest } from "@vercel/node";
import { ApiHttpError } from "./http";

let app: admin.app.App | null = null;

function serviceAccount(): admin.ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new ApiHttpError(500, "FIREBASE_SERVICE_ACCOUNT ยังไม่ได้ตั้งค่าบน Vercel");
  const parsed = JSON.parse(raw) as Record<string, string>;
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

export function getApp(): admin.app.App {
  if (!app) {
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount()),
      projectId: serviceAccount().projectId,
    });
  }
  return app;
}

export function db(): Firestore {
  return getApp().firestore();
}

export async function authUid(req: VercelRequest): Promise<string> {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ApiHttpError(401, "กรุณาเข้าสู่ระบบก่อน");
  try {
    const decoded = await getApp().auth().verifyIdToken(token);
    return decoded.uid;
  } catch (err) {
    console.warn("[api] token verify failed:", (err as Error).message);
    throw new ApiHttpError(401, "กรุณาเข้าสู่ระบบก่อน");
  }
}