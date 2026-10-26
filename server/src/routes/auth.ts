import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, createSession, requireRole, SESSION_COOKIE, toSafeUser } from "../auth.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { badRequest, HttpError, unauthorized } from "../lib/errors.js";
import { parse } from "../lib/http.js";
import { hashPassword, passwordProblems, sha256, verifyPassword } from "../lib/security.js";
import { hub } from "../hub.js";
import { audit } from "../services/audit.js";

// constant-time-ish dummy hash so unknown usernames take as long as wrong passwords
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password-0"));

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = parse(
        z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) }),
        req.body,
      );
      const username = body.username.toLowerCase();
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        await verifyPassword(body.password, await getDummyHash());
        await audit(req, "auth.login_failed", "User", null, { username });
        throw unauthorized("اسم المستخدم أو كلمة المرور غير صحيحة");
      }
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        throw new HttpError(423, `الحساب مقفل مؤقتًا بسبب محاولات فاشلة متكررة. حاول بعد ${mins} دقيقة`, "LOCKED");
      }
      const ok = await verifyPassword(body.password, user.passwordHash);
      if (!ok || !user.isActive) {
        const failed = user.failedLogins + 1;
        const lock = failed >= config.loginMaxAttempts;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLogins: lock ? 0 : failed,
            lockedUntil: lock ? new Date(Date.now() + config.loginLockMinutes * 60_000) : user.lockedUntil,
          },
        });
        await audit(req, lock ? "auth.account_locked" : "auth.login_failed", "User", user.id, { username });
        throw unauthorized(user.isActive ? "اسم المستخدم أو كلمة المرور غير صحيحة" : "الحساب معطّل");
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      await createSession(user.id, req, reply);
      req.user = toSafeUser(user);
      await audit(req, "auth.login", "User", user.id);
      return { user: toSafeUser(user) };
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
      if (s) {
        req.user = toSafeUser(s.user);
        await prisma.session.delete({ where: { id: s.id } });
        hub.closeBrowsers((b) => b.sessionId === s.id);
        await audit(req, "auth.logout", "User", s.userId);
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/api/auth/logout-all", { preHandler: requireRole() }, async (req, reply) => {
    await prisma.session.deleteMany({ where: { userId: req.user!.id } });
    hub.closeBrowsers((b) => b.user.id === req.user!.id);
    await audit(req, "auth.logout_all", "User", req.user!.id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    await authenticate(req);
    return { user: req.user };
  });

  app.post("/api/auth/change-password", { preHandler: requireRole() }, async (req) => {
    const body = parse(
      z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }),
      req.body,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest("كلمة المرور الحالية غير صحيحة");
    const problem = passwordProblems(body.newPassword);
    if (problem) throw badRequest(problem);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
    });
    // keep this session, end all others
    await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: req.sessionId } } });
    hub.closeBrowsers((b) => b.user.id === user.id && b.sessionId !== req.sessionId);
    await audit(req, "auth.password_changed", "User", user.id);
    return { ok: true };
  });
}
