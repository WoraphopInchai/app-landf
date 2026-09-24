import type { VercelRequest, VercelResponse } from "@vercel/node";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export interface ApiError {
  status: number;
  message: string;
}

export class ApiHttpError extends Error implements ApiError {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export function sendJson(
  res: VercelResponse,
  status: number,
  body: unknown
): void {
  res.status(status).setHeader("Content-Type", "application/json").setHeader("Vary", "Origin").setHeader("Access-Control-Allow-Origin", "*");
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  res.json(body);
}

export function ok(res: VercelResponse, body: unknown): void {
  sendJson(res, 200, body);
}

export function notFound(res: VercelResponse, message = "ไม่พบ endpoint"): void {
  sendJson(res, 404, { error: message });
}

export function fail(res: VercelResponse, err: unknown): void {
  if (err instanceof ApiHttpError) {
    sendJson(res, err.status, { error: err.message });
    return;
  }
  console.error("[api] error:", err);
  sendJson(res, 500, { error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
}

export function corsOk(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
}

export async function readJson(req: VercelRequest): Promise<Record<string, unknown>> {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body as Record<string, unknown>;
  return {};
}

export function handleRequest(
  fn: (req: VercelRequest, res: VercelResponse) => Promise<void>
): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method === "OPTIONS") return corsOk(res);
    try {
      await fn(req, res);
    } catch (err) {
      fail(res, err);
    }
  };
}