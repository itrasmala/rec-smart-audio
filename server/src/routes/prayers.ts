import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, ROLES } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parse } from "../lib/http.js";
import { addDays, hijriDateLabel, isValidDate, isValidTime, localDate } from "../lib/time.js";
import { hub } from "../hub.js";
import { audit } from "../services/audit.js";
import { issueCommand } from "../services/commands.js";
import { PRAYERS, type PrayerName } from "../services/prayerCalc.js";
import { getPrayerDays, getTimezone, getTodayAndNext } from "../services/prayers.js";
import { bumpConfigRevision, getPrayerSettings, getSystemSettings } from "../services/settings.js";

const PRAYER = z.enum(PRAYERS);
const dateStr = z.string().refine(isValidDate, "تاريخ غير صالح (YYYY-MM-DD)");
const timeStr = z.string().refine(isValidTime, "وقت غير صالح (HH:mm)");

function validTz(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parses an official-calendar CSV: date,fajr,dhuhr,asr,maghrib,isha */
export function parseCalendarCsv(csv: string) {
  const rows: { date: string; prayer: PrayerName; time: string }[] = [];
  const errors: string[] = [];
  csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const cols = line.split(/[,;\t]/).map((c) => c.trim());
      if (i === 0 && !isValidDate(cols[0])) return; // header
      if (cols.length < 6) return void errors.push(`سطر ${i + 1}: عدد الأعمدة أقل من 6`);
      const [date, ...times] = cols;
      if (!isValidDate(date)) return void errors.push(`سطر ${i + 1}: تاريخ غير صالح "${date}"`);
      PRAYERS.forEach((p, idx) => {
        let t = times[idx];
        if (/^\d:\d\d$/.test(t)) t = `0${t}`;
        if (!isValidTime(t)) errors.push(`سطر ${i + 1}: وقت ${p} غير صالح "${times[idx]}"`);
        else rows.push({ date, prayer: p, time: t });
      });
    });
  return { rows, errors };
}

export default async function prayerRoutes(app: FastifyInstance) {
  app.get("/api/prayers/today", { preHandler: requireRole() }, async () => {
    const r = await getTodayAndNext();
    return { ...r, hijri: hijriDateLabel(r.today.date), serverTime: new Date().toISOString() };
  });

  app.get("/api/prayers/range", { preHandler: requireRole() }, async (req) => {
    const q = parse(
      z.object({ from: dateStr.optional(), days: z.coerce.number().int().min(1).max(62).default(7) }),
      req.query,
    );
    const days = await getPrayerDays(q.from ?? null, q.days);
    return { timezone: await getTimezone(), days: days.map((d) => ({ ...d, hijri: hijriDateLabel(d.date) })) };
  });

  app.get("/api/prayers/settings", { preHandler: requireRole() }, async () => {
    const [settings, configs, sys] = await Promise.all([
      getPrayerSettings(),
      prisma.prayerConfig.findMany({ include: { file: { select: { id: true, title: true, durationSec: true } } } }),
      getSystemSettings(),
    ]);
    configs.sort((a, b) => PRAYERS.indexOf(a.prayer) - PRAYERS.indexOf(b.prayer));
    return { settings, configs, defaultAdhanVolume: sys.defaultAdhanVolume };
  });

  app.put("/api/prayers/settings", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(
      z.object({
        country: z.string().trim().min(1).max(100),
        city: z.string().trim().min(1).max(100),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        timezone: z.string().refine(validTz, "منطقة زمنية غير معروفة"),
        method: z.enum(["UMM_AL_QURA", "MUSLIM_WORLD_LEAGUE", "EGYPTIAN", "KARACHI", "DUBAI", "QATAR", "KUWAIT"]),
        madhab: z.enum(["SHAFI", "HANAFI"]),
        ramadanIshaExtra: z.boolean(),
      }),
      req.body,
    );
    const settings = await prisma.prayerSettings.update({ where: { id: 1 }, data: body });
    await audit(req, "prayer.settings_update", "PrayerSettings", "1", body);
    await bumpConfigRevision();
    return { settings };
  });

  app.put<{ Params: { prayer: string } }>(
    "/api/prayers/config/:prayer",
    { preHandler: requireRole(...ROLES.ADMIN) },
    async (req) => {
      const prayer = parse(PRAYER, req.params.prayer);
      const body = parse(
        z.object({
          adhanEnabled: z.boolean(),
          fileId: z.string().uuid().nullable(),
          volume: z.number().int().min(0).max(100).nullable(),
          offsetMinutes: z.number().int().min(-60).max(60),
          fixedTime: timeStr.nullable(),
        }),
        req.body,
      );
      if (body.fileId) {
        const f = await prisma.audioFile.findUnique({ where: { id: body.fileId } });
        if (!f) throw notFound("ملف الأذان غير موجود");
        if (f.category !== "ADHAN") throw badRequest("يجب اختيار ملف من تصنيف الأذان");
      }
      const cfg = await prisma.prayerConfig.update({ where: { prayer }, data: body });
      await audit(req, "prayer.config_update", "PrayerConfig", prayer, body);
      await bumpConfigRevision();
      return { config: cfg };
    },
  );

  app.get("/api/prayers/overrides", { preHandler: requireRole() }, async (req) => {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query);
    const tz = await getTimezone();
    const from = q.from ?? localDate(new Date(), tz);
    const to = q.to ?? addDays(from, 366);
    const overrides = await prisma.prayerOverride.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: "asc" }, { prayer: "asc" }],
    });
    return { overrides };
  });

  app.put("/api/prayers/overrides", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(
      z.object({ date: dateStr, prayer: PRAYER, time: timeStr, note: z.string().max(200).nullable().optional() }),
      req.body,
    );
    const override = await prisma.prayerOverride.upsert({
      where: { date_prayer: { date: body.date, prayer: body.prayer } },
      update: { time: body.time, note: body.note ?? null },
      create: { date: body.date, prayer: body.prayer, time: body.time, note: body.note ?? null },
    });
    await audit(req, "prayer.override_set", "PrayerOverride", override.id, body);
    await bumpConfigRevision();
    return { override };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/prayers/overrides/:id",
    { preHandler: requireRole(...ROLES.ADMIN) },
    async (req) => {
      const o = await prisma.prayerOverride.findUnique({ where: { id: req.params.id } });
      if (!o) throw notFound();
      await prisma.prayerOverride.delete({ where: { id: o.id } });
      await audit(req, "prayer.override_delete", "PrayerOverride", o.id, { date: o.date, prayer: o.prayer });
      await bumpConfigRevision();
      return { ok: true };
    },
  );

  /** Import an official Umm al-Qura calendar as per-date overrides. dryRun returns the diff only. */
  app.post("/api/prayers/overrides/import", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(z.object({ csv: z.string().min(1).max(200_000), dryRun: z.boolean().default(true) }), req.body);
    const { rows, errors } = parseCalendarCsv(body.csv);
    if (!rows.length) throw badRequest("لم يتم العثور على صفوف صالحة في الملف", { errors });
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    const days = await getPrayerDays(dates[0], Math.min(400, daysBetween(dates[0], dates[dates.length - 1]) + 1));
    const tz = await getTimezone();
    const diffs = rows.map((r) => {
      const day = days.find((d) => d.date === r.date);
      const entry = day?.prayers.find((p) => p.prayer === r.prayer);
      const computedLocal = entry
        ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
            new Date(entry.computed),
          )
        : null;
      return { ...r, computed: computedLocal, diffMinutes: computedLocal ? minutesDiff(r.time, computedLocal) : null };
    });
    if (!body.dryRun) {
      await prisma.$transaction(
        rows.map((r) =>
          prisma.prayerOverride.upsert({
            where: { date_prayer: { date: r.date, prayer: r.prayer } },
            update: { time: r.time, note: "تقويم أم القرى (استيراد)" },
            create: { ...r, note: "تقويم أم القرى (استيراد)" },
          }),
        ),
      );
      await audit(req, "prayer.calendar_import", "PrayerOverride", null, { rows: rows.length, from: dates[0], to: dates.at(-1) });
      await bumpConfigRevision();
    }
    const maxAbs = Math.max(0, ...diffs.map((d) => Math.abs(d.diffMinutes ?? 0)));
    return { imported: !body.dryRun, count: rows.length, errors, maxAbsDiffMinutes: maxAbs, diffs };
  });

  app.post("/api/prayers/test", { preHandler: requireRole(...ROLES.ADMIN) }, async (req) => {
    const body = parse(z.object({ prayer: PRAYER, deviceId: z.string().uuid().or(z.literal("all")) }), req.body);
    const ids =
      body.deviceId === "all"
        ? (await prisma.device.findMany({ where: { revokedAt: null }, select: { id: true } })).map((d) => d.id)
        : [body.deviceId];
    const results = [];
    for (const id of ids) {
      const r = await issueCommand(id, "adhan_test", { prayer: body.prayer }, req.user!);
      results.push({ deviceId: id, commandId: r.command.id, delivered: r.delivered });
    }
    await audit(req, "prayer.adhan_test", "Prayer", body.prayer, { devices: ids.length });
    return { results, online: hub.onlineAgentIds().length };
  });
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function minutesDiff(a: string, b: string) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return ah * 60 + am - (bh * 60 + bm);
}
