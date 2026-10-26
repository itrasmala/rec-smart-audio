import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, ROLES } from "../auth.js";
import { prisma, type Schedule } from "../db.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/http.js";
import { isValidDate, isValidTime, localDate } from "../lib/time.js";
import { audit } from "../services/audit.js";
import { PRAYERS, type PrayerName } from "../services/prayerCalc.js";
import { getPrayerDays, getTimezone } from "../services/prayers.js";
import { nextOccurrences, type PrayerLookup, type ScheduleDef } from "../services/recurrence.js";
import { bumpConfigRevision } from "../services/settings.js";

const dateStr = z.string().refine(isValidDate, "تاريخ غير صالح");
const timeStr = z.string().refine(isValidTime, "وقت غير صالح");

const scheduleBody = z
  .object({
    name: z.string().trim().min(1).max(150),
    fileId: z.string().uuid(),
    priority: z.enum(["EMERGENCY", "ANNOUNCEMENT", "GENERAL"]).default("ANNOUNCEMENT"),
    recurrence: z.enum(["ONCE", "DAILY", "WEEKLY"]),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    anchor: z.enum(["FIXED_TIME", "PRAYER"]).default("FIXED_TIME"),
    time: timeStr.nullable().optional(),
    anchorPrayer: z.enum(PRAYERS).nullable().optional(),
    anchorOffsetMinutes: z.number().int().min(-180).max(180).default(0),
    startDate: dateStr,
    endDate: dateStr.nullable().optional(),
    volume: z.number().int().min(0).max(100).nullable().optional(),
    isPaused: z.boolean().default(false),
    allDevices: z.boolean().default(true),
    deviceIds: z.array(z.string().uuid()).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.anchor === "FIXED_TIME" && !v.time) ctx.addIssue({ code: "custom", path: ["time"], message: "حدد وقت التشغيل" });
    if (v.anchor === "PRAYER" && !v.anchorPrayer)
      ctx.addIssue({ code: "custom", path: ["anchorPrayer"], message: "حدد الصلاة المرجعية" });
    if (v.recurrence === "WEEKLY" && v.daysOfWeek.length === 0)
      ctx.addIssue({ code: "custom", path: ["daysOfWeek"], message: "اختر يومًا واحدًا على الأقل" });
    if (v.endDate && v.endDate < v.startDate)
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "تاريخ النهاية قبل تاريخ البداية" });
    if (!v.allDevices && v.deviceIds.length === 0)
      ctx.addIssue({ code: "custom", path: ["deviceIds"], message: "اختر جهازًا واحدًا على الأقل" });
  });

export function toDef(s: Schedule): ScheduleDef {
  return {
    id: s.id,
    recurrence: s.recurrence,
    daysOfWeek: s.daysOfWeek,
    anchor: s.anchor,
    time: s.time,
    anchorPrayer: s.anchorPrayer as PrayerName | null,
    anchorOffsetMinutes: s.anchorOffsetMinutes,
    startDate: s.startDate,
    endDate: s.endDate,
    isPaused: s.isPaused,
  };
}

async function prayerLookup(days = 40): Promise<PrayerLookup> {
  const pd = await getPrayerDays(null, days);
  const map = new Map<string, Date>();
  for (const d of pd) for (const p of d.prayers) map.set(`${d.date}:${p.prayer}`, new Date(p.at));
  return (date, prayer) => map.get(`${date}:${prayer}`) ?? null;
}

async function checkPermissions(role: string, body: z.infer<typeof scheduleBody>) {
  const file = await prisma.audioFile.findUnique({ where: { id: body.fileId } });
  if (!file) throw notFound("الملف الصوتي غير موجود");
  if (body.priority === "EMERGENCY" && role !== "SUPER_ADMIN") throw forbidden("جدولة الطوارئ متاحة لمدير النظام فقط");
  if (body.deviceIds.length) {
    const n = await prisma.device.count({ where: { id: { in: body.deviceIds } } });
    if (n !== body.deviceIds.length) throw badRequest("بعض الأجهزة المحددة غير موجودة");
  }
}

export default async function scheduleRoutes(app: FastifyInstance) {
  app.get("/api/schedules", { preHandler: requireRole(...ROLES.MANAGERS) }, async () => {
    const [schedules, tz, lookup] = await Promise.all([
      prisma.schedule.findMany({
        orderBy: [{ isPaused: "asc" }, { createdAt: "desc" }],
        include: {
          file: { select: { id: true, title: true, category: true, durationSec: true } },
          devices: { select: { id: true, name: true } },
          createdBy: { select: { displayName: true } },
        },
      }),
      getTimezone(),
      prayerLookup(),
    ]);
    const now = new Date();
    return {
      timezone: tz,
      today: localDate(now, tz),
      schedules: schedules.map((s) => ({
        ...s,
        nextRuns: nextOccurrences(toDef(s), now, 3, tz, lookup, 40).map((o) => o.at.toISOString()),
      })),
    };
  });

  app.post("/api/schedules", { preHandler: requireRole(...ROLES.MANAGERS) }, async (req) => {
    const body = parse(scheduleBody, req.body);
    await checkPermissions(req.user!.role, body);
    const { deviceIds, ...data } = body;
    const s = await prisma.schedule.create({
      data: {
        ...data,
        time: data.anchor === "FIXED_TIME" ? data.time : null,
        anchorPrayer: data.anchor === "PRAYER" ? data.anchorPrayer : null,
        daysOfWeek: data.recurrence === "WEEKLY" ? [...new Set(data.daysOfWeek)].sort() : [],
        createdById: req.user!.id,
        devices: data.allDevices ? undefined : { connect: deviceIds.map((id) => ({ id })) },
      },
    });
    await audit(req, "schedule.create", "Schedule", s.id, { name: s.name });
    await bumpConfigRevision();
    return { schedule: s };
  });

  app.put<{ Params: { id: string } }>("/api/schedules/:id", { preHandler: requireRole(...ROLES.MANAGERS) }, async (req) => {
    const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("الجدولة غير موجودة");
    if (existing.priority === "EMERGENCY" && req.user!.role !== "SUPER_ADMIN") throw forbidden();
    const body = parse(scheduleBody, req.body);
    await checkPermissions(req.user!.role, body);
    const { deviceIds, ...data } = body;
    const s = await prisma.schedule.update({
      where: { id: existing.id },
      data: {
        ...data,
        time: data.anchor === "FIXED_TIME" ? data.time : null,
        anchorPrayer: data.anchor === "PRAYER" ? data.anchorPrayer : null,
        daysOfWeek: data.recurrence === "WEEKLY" ? [...new Set(data.daysOfWeek)].sort() : [],
        devices: { set: data.allDevices ? [] : deviceIds.map((id) => ({ id })) },
      },
    });
    await audit(req, "schedule.update", "Schedule", s.id, { name: s.name });
    await bumpConfigRevision();
    return { schedule: s };
  });

  app.patch<{ Params: { id: string } }>(
    "/api/schedules/:id/pause",
    { preHandler: requireRole(...ROLES.MANAGERS) },
    async (req) => {
      const body = parse(z.object({ isPaused: z.boolean() }), req.body);
      const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound("الجدولة غير موجودة");
      if (existing.priority === "EMERGENCY" && req.user!.role !== "SUPER_ADMIN") throw forbidden();
      const s = await prisma.schedule.update({ where: { id: existing.id }, data: { isPaused: body.isPaused } });
      await audit(req, body.isPaused ? "schedule.pause" : "schedule.resume", "Schedule", s.id, { name: s.name });
      await bumpConfigRevision();
      return { schedule: s };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/schedules/:id",
    { preHandler: requireRole(...ROLES.MANAGERS) },
    async (req) => {
      const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound("الجدولة غير موجودة");
      if (existing.priority === "EMERGENCY" && req.user!.role !== "SUPER_ADMIN") throw forbidden();
      await prisma.schedule.delete({ where: { id: existing.id } });
      await audit(req, "schedule.delete", "Schedule", existing.id, { name: existing.name });
      await bumpConfigRevision();
      return { ok: true };
    },
  );
}
