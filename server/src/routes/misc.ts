import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, ROLES } from "../auth.js";
import { prisma, type Prisma } from "../db.js";
import { parse } from "../lib/http.js";
import { hub } from "../hub.js";
import { hijriDateLabel } from "../lib/time.js";
import { audit } from "../services/audit.js";
import { getTodayAndNext } from "../services/prayers.js";
import { bumpConfigRevision, getSystemSettings } from "../services/settings.js";

const PAGE = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(200).default(50) };

export default async function miscRoutes(app: FastifyInstance) {
  // ---------- playback log (all roles) ----------
  app.get("/api/logs/playback", { preHandler: requireRole() }, async (req) => {
    const q = parse(
      z.object({
        ...PAGE,
        deviceId: z.string().uuid().optional(),
        source: z.enum(["ADHAN", "SCHEDULE", "MANUAL", "TEST"]).optional(),
        status: z.enum(["QUEUED", "STARTED", "COMPLETED", "INTERRUPTED", "FAILED", "SKIPPED"]).optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }),
      req.query,
    );
    const where: Prisma.PlaybackLogWhereInput = {
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? { receivedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.playbackLog.count({ where }),
      prisma.playbackLog.findMany({
        where,
        orderBy: [{ startedAt: { sort: "desc", nulls: "last" } }, { receivedAt: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { device: { select: { name: true } } },
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows };
  });

  // ---------- audit log (admin) ----------
  app.get("/api/logs/audit", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const q = parse(
      z.object({ ...PAGE, action: z.string().max(60).optional(), userId: z.string().uuid().optional() }),
      req.query,
    );
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows };
  });

  // ---------- system settings ----------
  app.get("/api/settings", { preHandler: requireRole() }, async () => ({ settings: await getSystemSettings() }));

  app.put("/api/settings", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(
      z.object({
        orgName: z.string().trim().min(1).max(150),
        systemName: z.string().trim().min(1).max(100),
        defaultAdhanVolume: z.number().int().min(0).max(100),
        postAdhanBehavior: z.enum(["RESUME", "RESTART", "DISCARD"]),
        postAdhanQuietMinutes: z.number().int().min(0).max(60),
        emergencyMayInterruptAdhan: z.boolean(),
        managerMaxVolume: z.number().int().min(0).max(100),
        volumeStep: z.number().int().min(1).max(25),
        adhanCatchUpMinutes: z.number().int().min(0).max(30),
        scheduleCatchUpMinutes: z.number().int().min(0).max(60),
        queuedItemTtlMinutes: z.number().int().min(1).max(240),
        commandTtlSeconds: z.number().int().min(10).max(600),
      }),
      req.body,
    );
    const settings = await prisma.systemSettings.update({ where: { id: 1 }, data: body });
    await audit(req, "settings.update", "SystemSettings", "1", body);
    await bumpConfigRevision();
    hub.broadcastBrowsers({ type: "settings", settings });
    return { settings };
  });

  // ---------- dashboard summary ----------
  app.get("/api/dashboard", { preHandler: requireRole() }, async () => {
    const [devices, prayers, lastPlayback, counts, sys] = await Promise.all([
      prisma.device.findMany({
        where: { revokedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          location: true,
          outputType: true,
          speakerName: true,
          outputDeviceName: true,
          volume: true,
          maxVolume: true,
          lastSeenAt: true,
          lastError: true,
          lastErrorAt: true,
          lastStatus: true,
          agentVersion: true,
          os: true,
        },
      }),
      getTodayAndNext(),
      prisma.playbackLog.findFirst({
        where: { startedAt: { not: null } },
        orderBy: { startedAt: "desc" },
        include: { device: { select: { name: true } } },
      }),
      Promise.all([
        prisma.audioFile.count(),
        prisma.schedule.count({ where: { isPaused: false } }),
        prisma.user.count({ where: { isActive: true } }),
      ]),
      getSystemSettings(),
    ]);
    return {
      serverTime: new Date().toISOString(),
      orgName: sys.orgName,
      systemName: sys.systemName,
      configRevision: sys.configRevision,
      devices: devices.map((d) => ({ ...d, isOnline: hub.isAgentOnline(d.id) })),
      prayers: { ...prayers, hijri: hijriDateLabel(prayers.today.date) },
      lastPlayback,
      counts: { files: counts[0], activeSchedules: counts[1], users: counts[2] },
    };
  });

  // public health endpoint (no secrets)
  app.get("/api/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString(), ...hub.stats() };
  });
}
