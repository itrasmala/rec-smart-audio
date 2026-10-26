import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const BCRYPT_ROUNDS = 12;

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** Password policy: ≥ 10 chars, letters + digits. */
export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return "كلمة المرور يجب أن تكون 10 أحرف على الأقل";
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return "كلمة المرور يجب أن تحتوي على حروف وأرقام";
  if (pw.length > 200) return "كلمة المرور طويلة جدًا";
  return null;
}

/** Device tokens look like `rec_<prefix>_<secret>`; prefix is stored for identification. */
export function newDeviceToken(): { token: string; prefix: string; hash: string } {
  const prefix = crypto.randomBytes(4).toString("hex");
  const token = `rec_${prefix}_${randomToken(32)}`;
  return { token, prefix, hash: sha256(token) };
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
