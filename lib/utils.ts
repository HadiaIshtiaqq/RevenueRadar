import crypto from "crypto";

export function genId(): string { return crypto.randomUUID(); }

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function sanitizeInput(raw: string, maxLen = 200): string {
  return raw
    .replace(/[`"'\\]/g, "")
    .replace(/\n|\r/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\bignore\b.*\binstructions?\b/gi, "")
    .trim()
    .slice(0, maxLen);
}

export function tryParseJSON<T>(text: string): T | null {
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    return JSON.parse((m ? m[1] : text).trim()) as T;
  } catch { return null; }
}
