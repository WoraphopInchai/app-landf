import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res
    .status(200)
    .setHeader("Access-Control-Allow-Origin", "*")
    .json({ ok: true, node: process.version, env: "pure-probe" });
}