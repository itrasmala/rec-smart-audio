import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, ROLES } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { parse } from "../lib/http.js";
import { hashPassword, passwordProblems } from "../lib/security.js";
import { hub } from "../hub.js";
import { audit } from "../services/audit.js";

const role = z.enum(["SUPER_ADMIN", "AUDIO_MANAGER", "VIEWER"]);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, "اسم المستخدم: 3-40 حرفًا لاتينيًا أو أرقام أو . _ -");

const publicSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
} as const;

async function assertNotLastAdmin(userId: string) {
  const admins = await prisma.user.count({ where: { role: "SUPER_ADMIN", isActive: true, NOT: { id: userId } } });
  if (admins === 0) throw conflict("لا يمكن تنفيذ العملية: يجب أن يبقى مدير نظام نشط واحد على الأقل");
}

export default async function userRoutes(app: FastifyInstance) {
  app.get("/api/users", { preHandler: requireRole(...ROLES.ADMIN) }, async () => {
    return { users: await prisma.user.findMany({ select: publicSelect, orderBy: { createdAt: "asc" } }) };
  });

  app.post("/api/users", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(
      z.object({
        username,
        displayName: z.string().trim().min(1).max(100),
        role,
        password: z.string().min(1).max(200),
        mustChangePassword: z.boolean().default(true),
      }),
      req.body,
    );
    const problem = passwordProblems(body.password);
    if (problem) throw badRequest(problem);
    if (await prisma.user.findUnique({ where: { username: body.username } })) throw conflict("اسم المستخدم مستخدم مسبقًا");
    const user = await prisma.user.create({
      data: {
        username: body.username,
        displayName: body.displayName,
        role: body.role,
        passwordHash: await hashPassword(body.password),
        mustChangePassword: body.mustChangePassword,
      },
      select: publicSelect,
    });
    await audit(req, "user.create", "User", user.id, { username: user.username, role: user.role });
    return { user };
  });

  app.patch<{ Params: { id: string } }>("/api/users/:id", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1).max(100).optional(),
        role: role.optional(),
        isActive: z.boolean().optional(),
        unlock: z.boolean().optional(),
      }),
      req.body,
    );
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("المستخدم غير موجود");
    const demoting = existing.role === "SUPER_ADMIN" && ((body.role && body.role !== "SUPER_ADMIN") || body.isActive === false);
    if (demoting) await assertNotLastAdmin(existing.id);
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        displayName: body.displayName,
        role: body.role,
        isActive: body.isActive,
        ...(body.unlock ? { lockedUntil: null, failedLogins: 0 } : {}),
      },
      select: publicSelect,
    });
    if (body.isActive === false || (body.role && body.role !== existing.role)) {
      // role/active changes take effect immediately: end sessions
      await prisma.session.deleteMany({ where: { userId: user.id } });
      hub.closeBrowsers((b) => b.user.id === user.id);
    }
    await audit(req, "user.update", "User", user.id, body);
    return { user };
  });

  app.post<{ Params: { id: string } }>(
    "/api/users/:id/reset-password",
    { preHandler: requireRole(...ROLES.ADMIN) },
    async (req) => {
      const body = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
      const problem = passwordProblems(body.password);
      if (problem) throw badRequest(problem);
      const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound("المستخدم غير موجود");
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: await hashPassword(body.password), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
      });
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      hub.closeBrowsers((b) => b.user.id === existing.id);
      await audit(req, "user.reset_password", "User", existing.id);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/users/:id", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    if (req.params.id === req.user!.id) throw badRequest("لا يمكنك حذف حسابك الحالي");
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("المستخدم غير موجود");
    if (existing.role === "SUPER_ADMIN") await assertNotLastAdmin(existing.id);
    hub.closeBrowsers((b) => b.user.id === existing.id);
    await prisma.user.delete({ where: { id: existing.id } });
    await audit(req, "user.delete", "User", existing.id, { username: existing.username });
    return { ok: true };
  });
}
