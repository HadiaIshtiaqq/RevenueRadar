import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import db from "../db.js";

export type AuthRequest = Request & { userId: string };

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(crypto.scryptSync(pw, salt, 64).toString("hex")),
      Buffer.from(hash),
    );
  } catch { return false; }
}

export function getToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.query.token as string | undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getToken(req);
  if (!token) { res.status(401).json({ error: "Authentication required." }); return; }
  const row = db.prepare("SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')").get(token) as { user_id: string } | undefined;
  if (!row) { res.status(401).json({ error: "Invalid or expired token." }); return; }
  (req as AuthRequest).userId = row.user_id;
  next();
}
