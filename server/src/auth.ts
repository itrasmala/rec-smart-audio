import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { prisma, type Role, type User } from "./db.js";
import { forbidden, unauthorized } from "./lib/errors.js";
import { randomToken, sha256 } from "./lib/security.js";

export const SESSION_COOKIE = config.cookieSecure ? "__Host-rec_session" : "rec_session";

export type SafeUser = Pick<User, "id" | "username" | "displayName" | "role" | "isActive" | "mustChangePassword">;

declare module "fastify" {
  interface FastifyRequest {
    user?: SafeUser;
    sessionId?: string;
  }
}

export function toSafeUser(u: User): SafeUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
  };
}

export async function createSession(userId: string, req: FastifyRequest, reply: FastifyReply) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
      expiresAt,
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the session cookie into a user. Sliding expiry (renewed when > 1h used). */
export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now() || !s.user.isActive) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  const now = Date.now();
  if (now - s.lastSeenAt.getTime() > 60_000) {
    const renew = s.expiresAt.getTime() - now < (config.sessionTtlHours * 3600_000) / 2;
    await prisma.session
      .update({
        where: { id: s.id },
        data: {
          lastSeenAt: new Date(),
          ...(renew ? { expiresAt: new Date(now + config.sessionTtlHours * 3600_000) } : {}),
        },
      })
      .catch(() => {});
  }
  return { sessionId: s.id, user: toSafeUser(s.user) };
}

export async function authenticate(req: FastifyRequest) {
  const token = req.cookies?.[SESSION_COOKIE];
  const res = await resolveSession(token);
  if (!res) throw unauthorized();
  req.user = res.user;
  req.sessionId = res.sessionId;
}

/** preHandler factory: requires a session and one of the given roles (none = any role). */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    await authenticate(req);
    if (roles.length && !roles.includes(req.user!.role)) throw forbidden();
  };
}

export const ROLES = {
  ADMIN: ["SUPER_ADMIN"] as Role[],
  MANAGERS: ["SUPER_ADMIN", "AUDIO_MANAGER"] as Role[],
  ALL: [] as Role[],
};
