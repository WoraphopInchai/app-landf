import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as admin from "firebase-admin";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res
    .status(200)
    .setHeader("Access-Control-Allow-Origin", "*")
    .json({ ok: true, adminImported: typeof admin.initializeApp === "function" });
}