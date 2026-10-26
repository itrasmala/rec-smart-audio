import type { FastifyRequest } from "fastify";
import { prisma, Prisma } from "../db.js";
import { hub } from "../hub.js";

export async function audit(
  req: FastifyRequest | null,
  action: string,
  entityType?: string,
  entityId?: string | null,
  details?: Record<string, unknown>,
) {
  try {
    const row = await prisma.auditLog.create({
      data: {
        userId: req?.user?.id ?? null,
        username: req?.user?.username ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        details: (details ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: req?.ip ?? null,
      },
    });
    hub.broadcastBrowsers({ type: "audit", entry: row }, ["SUPER_ADMIN"]);
  } catch (err) {
    req?.log.error({ err }, "audit write failed");
  }
}
