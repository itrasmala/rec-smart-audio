import { z } from "zod";
import type { SafeUser } from "../auth.js";
import { prisma, Prisma, type Command } from "../db.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { hub } from "../hub.js";
import { getSystemSettings } from "./settings.js";

const priority = z.enum(["EMERGENCY", "ANNOUNCEMENT", "GENERAL"]);
const volume = z.number().int().min(0).max(100);

export const commandSchemas = {
  play: z.object({
    fileId: z.string().uuid(),
    priority: priority.default("ANNOUNCEMENT"),
    volume: volume.optional(),
    interruptAdhan: z.boolean().optional(),
  }),
  stop: z.object({ includeAdhan: z.boolean().default(false), clearQueue: z.boolean().default(true) }),
  pause: z.object({}),
  resume: z.object({}),
  volume: z.object({ level: volume }),
  volume_step: z.object({ delta: z.number().int().min(-50).max(50) }),
  test_speakers: z.object({}),
  adhan_test: z.object({ prayer: z.enum(["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"]) }),
  bt_reconnect: z.object({}),
  set_output: z.object({ deviceName: z.string().max(300).nullable() }),
  sync: z.object({}),
} as const;

export type CommandType = keyof typeof commandSchemas;
export const COMMAND_TYPES = Object.keys(commandSchemas) as CommandType[];

const ADMIN_ONLY: CommandType[] = ["adhan_test", "bt_reconnect", "set_output"];

export function serializeCommand(c: Command) {
  return {
    type: "command",
    id: c.id,
    command: c.type,
    payload: c.payload,
    createdAt: c.createdAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
  };
}

/**
 * Validates role-based limits, persists the command, and delivers it if the agent is online.
 * Offline agents get it on reconnect if it hasn't expired.
 */
export async function issueCommand(
  deviceId: string,
  type: string,
  rawPayload: unknown,
  user: SafeUser,
  opts: { waitMs?: number } = {},
) {
  if (!(COMMAND_TYPES as string[]).includes(type)) throw badRequest(`نوع أمر غير معروف: ${type}`);
  const t = type as CommandType;
  const parsed = commandSchemas[t].safeParse(rawPayload ?? {});
  if (!parsed.success) throw badRequest("بيانات الأمر غير صالحة", parsed.error.flatten());
  const payload: Record<string, unknown> = { ...parsed.data };

  if (user.role === "VIEWER") throw forbidden();
  const isAdmin = user.role === "SUPER_ADMIN";
  if (ADMIN_ONLY.includes(t) && !isAdmin) throw forbidden("هذا الأمر متاح لمدير النظام فقط");

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound("الجهاز غير موجود");
  if (device.revokedAt) throw badRequest("صلاحية هذا الجهاز ملغاة");

  const sys = await getSystemSettings();
  const roleMax = isAdmin ? 100 : sys.managerMaxVolume;
  const maxVol = Math.min(device.maxVolume, roleMax);

  if (t === "play") {
    const file = await prisma.audioFile.findUnique({ where: { id: String(payload.fileId) } });
    if (!file) throw notFound("الملف الصوتي غير موجود");
    if (payload.priority === "EMERGENCY" && !isAdmin && file.category !== "SAFETY" && file.category !== "ADMIN_ALERT") {
      throw forbidden("تنبيهات الطوارئ لمدير النظام أو لملفات السلامة/التنبيهات الإدارية فقط");
    }
    if (payload.interruptAdhan && (!isAdmin || payload.priority !== "EMERGENCY")) {
      throw forbidden("مقاطعة الأذان مسموحة لمدير النظام وفي حالات الطوارئ فقط");
    }
    if (payload.interruptAdhan && !sys.emergencyMayInterruptAdhan) {
      throw forbidden("سياسة النظام لا تسمح بمقاطعة الأذان — فعّلها من الإعدادات أولًا");
    }
    if (payload.volume !== undefined) payload.volume = Math.min(Number(payload.volume), maxVol);
    payload.title = file.title;
    payload.sha256 = file.sha256;
    payload.format = file.format;
  }
  if (t === "stop" && payload.includeAdhan && !isAdmin) throw forbidden("إيقاف الأذان متاح لمدير النظام فقط");
  if (t === "volume") payload.level = Math.min(Number(payload.level), maxVol);
  if (t === "volume_step") {
    const current = (device.lastStatus as { volume?: number } | null)?.volume ?? device.volume;
    payload.level = Math.max(0, Math.min(maxVol, current + Number(payload.delta)));
  }
  payload.privileged = isAdmin;
  payload.maxVolume = maxVol;

  const cmd = await prisma.command.create({
    data: {
      deviceId,
      type: t,
      payload: payload as Prisma.InputJsonValue,
      createdById: user.id,
      expiresAt: new Date(Date.now() + sys.commandTtlSeconds * 1000),
    },
  });

  if (t === "volume" || t === "volume_step") {
    await prisma.device.update({ where: { id: deviceId }, data: { volume: Number(payload.level) } });
  }

  // register the ack waiter *before* sending so a fast agent reply cannot be missed
  const ackPromise = opts.waitMs ? hub.waitForAck(cmd.id, opts.waitMs) : null;
  const delivered = hub.sendToAgent(deviceId, serializeCommand(cmd));
  if (delivered) {
    await prisma.command.updateMany({ where: { id: cmd.id, status: "PENDING" }, data: { status: "SENT", sentAt: new Date() } });
  }
  const ack = delivered && ackPromise ? await ackPromise : null;
  const final = (await prisma.command.findUnique({ where: { id: cmd.id } })) ?? cmd;
  if (!ack) hub.broadcastBrowsers({ type: "command", command: final });
  return { command: final, delivered, ack };
}

/** Re-deliver unexpired pending commands after an agent reconnects. */
export async function redeliverPending(deviceId: string) {
  const pending = await prisma.command.findMany({
    where: { deviceId, status: { in: ["PENDING", "SENT"] }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  for (const c of pending) {
    if (hub.sendToAgent(deviceId, serializeCommand(c))) {
      await prisma.command.updateMany({
        where: { id: c.id, status: { in: ["PENDING", "SENT"] } },
        data: { status: "SENT", sentAt: new Date() },
      });
    }
  }
}

export async function handleAck(deviceId: string, commandId: string, ok: boolean, error?: string, result?: unknown) {
  const cmd = await prisma.command.findFirst({ where: { id: commandId, deviceId } });
  if (!cmd) return;
  const updated = await prisma.command.update({
    where: { id: cmd.id },
    data: { status: ok ? "ACKED" : "FAILED", ackedAt: new Date(), error: error?.slice(0, 1000) ?? null },
  });
  hub.resolveAck(commandId, { ok, error, result });
  hub.broadcastBrowsers({ type: "command", command: updated, result });
}

export async function expireCommands() {
  const expired = await prisma.command.findMany({
    where: { status: { in: ["PENDING", "SENT"] }, expiresAt: { lt: new Date() } },
    select: { id: true },
  });
  if (!expired.length) return 0;
  await prisma.command.updateMany({
    where: { id: { in: expired.map((e) => e.id) } },
    data: { status: "EXPIRED", error: "انتهت مهلة الأمر قبل تأكيد الجهاز" },
  });
  for (const e of expired) hub.resolveAck(e.id, { ok: false, error: "expired" });
  hub.broadcastBrowsers({ type: "commands_expired", ids: expired.map((e) => e.id) });
  return expired.length;
}
