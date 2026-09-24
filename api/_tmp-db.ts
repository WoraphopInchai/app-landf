import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const seen = Object.keys(process.env).filter((k) => k.includes("FIREBASE") || k.includes("GEMINI") || k.includes("CRON"));
  try {
    const { db } = await import("./_lib/firebase");
    const snap = await db().collection("posts").limit(1).get();
    res.status(200).setHeader("Access-Control-Allow-Origin", "*").json({
      envKeys: seen,
      postsRead: snap.size,
      ok: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).setHeader("Access-Control-Allow-Origin", "*").json({
      envKeys: seen,
      error: message,
    });
  }
}