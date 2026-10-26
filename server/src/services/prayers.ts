import { prisma } from "../db.js";
import { addDays, localDate } from "../lib/time.js";
import {
  computePrayerRange,
  nextPrayer,
  type CalcParams,
  type OverrideCfg,
  type PrayerCfg,
  type PrayerDay,
  type PrayerName,
} from "./prayerCalc.js";
import { getPrayerSettings } from "./settings.js";

export interface PrayerContext {
  params: CalcParams;
  configs: PrayerCfg[];
  overrides: OverrideCfg[];
}

export async function loadPrayerContext(fromDate?: string, toDate?: string): Promise<PrayerContext> {
  const s = await getPrayerSettings();
  const configs = await prisma.prayerConfig.findMany();
  const overrides = await prisma.prayerOverride.findMany({
    where: { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } },
  });
  return {
    params: {
      latitude: s.latitude,
      longitude: s.longitude,
      timezone: s.timezone,
      method: s.method,
      madhab: s.madhab,
      ramadanIshaExtra: s.ramadanIshaExtra,
    },
    configs: configs.map((c) => ({
      prayer: c.prayer as PrayerName,
      adhanEnabled: c.adhanEnabled,
      fileId: c.fileId,
      volume: c.volume,
      offsetMinutes: c.offsetMinutes,
      fixedTime: c.fixedTime,
    })),
    overrides: overrides.map((o) => ({ date: o.date, prayer: o.prayer as PrayerName, time: o.time })),
  };
}

export async function getTimezone(): Promise<string> {
  return (await getPrayerSettings()).timezone;
}

export async function getPrayerDays(fromDate: string | null, days: number): Promise<PrayerDay[]> {
  const tz = await getTimezone();
  const from = fromDate ?? localDate(new Date(), tz);
  const ctx = await loadPrayerContext(from, addDays(from, days));
  return computePrayerRange(from, days, ctx.params, ctx.configs, ctx.overrides);
}

export async function getTodayAndNext(now = new Date()) {
  const tz = await getTimezone();
  const today = localDate(now, tz);
  const days = await getPrayerDays(today, 2);
  return { timezone: tz, today: days[0], tomorrow: days[1], next: nextPrayer(days, now), nextAdhan: nextPrayer(days, now, true) };
}
