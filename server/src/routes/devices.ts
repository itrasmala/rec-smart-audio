import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRole, ROLES } from "../auth.js";
import { prisma } from "../db.js";
import { notFound, unauthorized } from "../lib/errors.js";
import { parse, sendFileWithRange } from "../lib/http.js";
import { newDeviceToken, sha256 } from "../lib/security.js";
import { hub } from "../hub.js";
import { audit } from "../services/audit.js";
import { issueCommand } from "../services/commands.js";
import { bumpConfigRevision } from "../services/settings.js";
import { storagePath } from "../services/storage.js";

const OUTPUT = z.enum(["BLUETOOTH", "AUX", "USB", "HDMI", "OTHER", "UNKNOWN"]);
const MAC = z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, "عنوان MAC غير صالح (AA:BB:CC:DD:EE:FF)");

const deviceSelect = {
  id: true,
  name: true,
  description: true,
  location: true,
  tokenPrefix: true,
  revokedAt: true,
  os: true,
  hostname: true,
  agentVersion: true,
  outputType: true,
  outputDeviceName: true,
  speakerName: true,
  bluetoothMac: true,
  volume: true,
  maxVolume: true,
  isOnline: true,
  lastSeenAt: true,
  lastError: true,
  lastErrorAt: true,
  lastStatus: true,
  availableOutputs: true,
  configRevision: true,
  createdAt: true,
} as const;

/** Authenticate an agent by bearer token. Revoked tokens are rejected. */
export async function authenticateDevice(req: FastifyRequest) {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token || token.length > 200) throw unauthorized("رمز الجهاز مفقود");
  const device = await prisma.device.findUnique({ where: { tokenHash: sha256(token) } });
  if (!device || device.revokedAt) throw unauthorized("رمز الجهاز غير صالح أو ملغى");
  return device;
}

export default async function deviceRoutes(app: FastifyInstance) {
  app.get("/api/devices", { preHandler: requireRole() }, async () => {
    const devices = await prisma.device.findMany({ select: deviceSelect, orderBy: { createdAt: "asc" } });
    return { devices: devices.map((d) => ({ ...d, isOnline: hub.isAgentOnline(d.id) })) };
  });

  app.post("/api/devices", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(300).optional(),
        location: z.string().trim().max(150).optional(),
        outputType: OUTPUT.default("UNKNOWN"),
      }),
      req.body,
    );
    const tok = newDeviceToken();
    const device = await prisma.device.create({
      data: { ...body, tokenHash: tok.hash, tokenPrefix: tok.prefix },
      select: deviceSelect,
    });
    await audit(req, "device.create", "Device", device.id, { name: device.name });
    // the plaintext token is returned exactly once
    return { device, token: tok.token };
  });

  app.patch<{ Params: { id: string } }>("/api/devices/:id", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(300).nullable().optional(),
        location: z.string().trim().max(150).nullable().optional(),
        outputType: OUTPUT.optional(),
        outputDeviceName: z.string().max(300).nullable().optional(),
        bluetoothMac: MAC.nullable().optional(),
        volume: z.number().int().min(0).max(100).optional(),
        maxVolume: z.number().int().min(0).max(100).optional(),
      }),
      req.body,
    );
    const existing = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("الجهاز غير موجود");
    const maxVolume = body.maxVolume ?? existing.maxVolume;
    const device = await prisma.device.update({
      where: { id: existing.id },
      data: {
        ...body,
        bluetoothMac: body.bluetoothMac === undefined ? undefined : body.bluetoothMac?.toUpperCase() ?? null,
        volume: Math.min(body.volume ?? existing.volume, maxVolume),
      },
      select: deviceSelect,
    });
    await audit(req, "device.update", "Device", device.id, body);
    await bumpConfigRevision();
    return { device: { ...device, isOnline: hub.isAgentOnline(device.id) } };
  });

  app.post<{ Params: { id: string } }>(
    "/api/devices/:id/rotate-token",
    { preHandler: requireRole(...ROLES.ADMIN) },
    async (req) => {
      const existing = await prisma.device.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound("الجهاز غير موجود");
      const tok = newDeviceToken();
      await prisma.device.update({
        where: { id: existing.id },
        data: { tokenHash: tok.hash, tokenPrefix: tok.prefix, revokedAt: null },
      });
      hub.disconnectAgent(existing.id, "token rotated");
      await audit(req, "device.rotate_token", "Device", existing.id, { name: existing.name });
      return { token: tok.token };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/devices/:id/revoke",
    { preHandler: requireRole(...ROLES.ADMIN) },
    async (req) => {
      const existing = await prisma.device.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound("الجهاز غير موجود");
      await prisma.device.update({ where: { id: existing.id }, data: { revokedAt: new Date(), isOnline: false } });
      hub.disconnectAgent(existing.id, "device revoked");
      hub.broadcastBrowsers({ type: "device_online", deviceId: existing.id, online: false });
      await audit(req, "device.revoke", "Device", existing.id, { name: existing.name });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/devices/:id", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const existing = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("الجهاز غير موجود");
    hub.disconnectAgent(existing.id, "device deleted");
    await prisma.device.delete({ where: { id: existing.id } });
    await audit(req, "device.delete", "Device", existing.id, { name: existing.name });
    return { ok: true };
  });

  // ---------- control ----------
  app.post<{ Params: { id: string } }>(
    "/api/devices/:id/commands",
    { preHandler: requireRole(...ROLES.MANAGERS), config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req) => {
      const body = parse(
        z.object({ type: z.string().max(40), payload: z.record(z.string(), z.unknown()).default({}), wait: z.boolean().default(true) }),
        req.body,
      );
      const { command, delivered, ack } = await issueCommand(req.params.id, body.type, body.payload, req.user!, {
        waitMs: body.wait ? 8000 : 0,
      });
      await audit(req, `control.${body.type}`, "Device", req.params.id, { commandId: command.id, ...body.payload });
      return { command, delivered, ack };
    },
  );

  /** Send the same command to every active device. */
  app.post("/api/control/broadcast", { preHandler: requireRole(...ROLES.MANAGERS) }, async (req) => {
    const body = parse(
      z.object({ type: z.string().max(40), payload: z.record(z.string(), z.unknown()).default({}) }),
      req.body,
    );
    const devices = await prisma.device.findMany({ where: { revokedAt: null }, select: { id: true, name: true } });
    const results = [];
    for (const d of devices) {
      try {
        const r = await issueCommand(d.id, body.type, body.payload, req.user!);
        results.push({ deviceId: d.id, name: d.name, commandId: r.command.id, delivered: r.delivered });
      } catch (err) {
        results.push({ deviceId: d.id, name: d.name, error: (err as Error).message });
      }
    }
    await audit(req, `control.broadcast.${body.type}`, "Device", null, { devices: devices.length, ...body.payload });
    return { results };
  });

  app.get<{ Params: { id: string } }>(
    "/api/devices/:id/commands",
    { preHandler: requireRole(...ROLES.MANAGERS) },
    async (req) => {
      const commands = await prisma.command.findMany({
        where: { deviceId: req.params.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { createdBy: { select: { displayName: true } } },
      });
      return { commands };
    },
  );

  // ---------- agent file download (device token) ----------
  app.get<{ Params: { id: string } }>(
    "/api/agent/files/:id",
    { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const device = await authenticateDevice(req);
      const f = await prisma.audioFile.findUnique({ where: { id: req.params.id } });
      if (!f) throw notFound("الملف غير موجود");
      req.log.debug({ device: device.id, file: f.id }, "agent file download");
      reply.header("X-Content-SHA256", f.sha256);
      return sendFileWithRange(req, reply, storagePath(f.storageKey), f.sizeBytes, f.mimeType);
    },
  );
}
