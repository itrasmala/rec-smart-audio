/**
 * First-run setup from the browser: create the first Super Admin without any command line.
 *
 * Protected by a one-time setup code so that nobody else can claim a freshly installed server:
 *   - install.sh generates it and prints it next to the URL (env SETUP_CODE), or
 *   - if SETUP_CODE is not set, the server generates one at startup and prints it in its log.
 * Once any user exists, setup is permanently closed.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSession, toSafeUser } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden } from "../lib/errors.js";
import { parse } from "../lib/http.js";
import { hashPassword, passwordProblems } from "../lib/security.js";
import { audit } from "../services/audit.js";

let setupCode: string | null = null;

export function initSetupCode(log: { warn: (msg: string) => void }) {
  const fromEnv = (process.env.SETUP_CODE ?? "").trim();
  // human-friendly: no 0/O/1/I confusion
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  setupCode =
    fromEnv ||
    Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length])
      .join("")
      .replace(/(.{4})(.{4})/, "$1-$2");
  if (!fromEnv) {
    log.warn("════════════════════════════════════════════════════════════");
    log.warn(` رمز الإعداد الأول (Setup code): ${setupCode}`);
    log.warn(" افتح لوحة التحكم في المتصفح وأدخل هذا الرمز لإنشاء حساب مدير النظام");
    log.warn("════════════════════════════════════════════════════════════");
  }
}

const norm = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

function codeMatches(input: string) {
  if (!setupCode) return false;
  const a = Buffer.from(norm(input));
  const b = Buffer.from(norm(setupCode));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function setupRoutes(app: FastifyInstance) {
  app.get("/api/setup/status", async () => ({ needsSetup: (await prisma.user.count()) === 0 }));

  app.post("/api/setup", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(
      z.object({
        setupCode: z.string().min(1).max(40),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9._-]{3,40}$/, "اسم المستخدم: 3-40 حرفًا لاتينيًا أو أرقام أو . _ -"),
        displayName: z.string().trim().min(1).max(100),
        password: z.string().min(1).max(200),
      }),
      req.body,
    );
    if ((await prisma.user.count()) > 0) throw conflict("تم إعداد النظام مسبقًا — سجّل الدخول");
    if (!codeMatches(body.setupCode)) {
      await audit(req, "setup.bad_code");
      throw forbidden("رمز الإعداد غير صحيح");
    }
    const problem = passwordProblems(body.password);
    if (problem) throw badRequest(problem);
    const passwordHash = await hashPassword(body.password);

    // serialize concurrent attempts: only the first one can create the admin
    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
      if ((await tx.user.count()) > 0) return null;
      return tx.user.create({
        data: { username: body.username, displayName: body.displayName, passwordHash, role: "SUPER_ADMIN" },
      });
    });
    if (!user) throw conflict("تم إعداد النظام مسبقًا — سجّل الدخول");

    setupCode = null; // one-time
    await createSession(user.id, req, reply);
    req.user = toSafeUser(user);
    await audit(req, "setup.completed", "User", user.id, { username: user.username });
    return { user: toSafeUser(user) };
  });
}
