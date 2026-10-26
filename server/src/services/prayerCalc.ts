/**
 * Pure prayer-time computation (no DB). Umm al-Qura by default.
 *
 * Effective time precedence for each prayer on a date:
 *   1. PrayerOverride for that exact date  (manual correction vs. official calendar)
 *   2. PrayerConfig.fixedTime              (fixed daily time)
 *   3. Astronomical computation
 * then PrayerConfig.offsetMinutes is added (except for date overrides, which are absolute).
 */
import { CalculationMethod, Coordinates, Madhab, PrayerTimes, Rounding } from "adhan";
import { addDays, addMinutes, hijriMonth, localTime, zonedToUtc } from "../lib/time.js";

export const PRAYERS = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"] as const;
export type PrayerName = (typeof PRAYERS)[number];

export interface CalcParams {
  latitude: number;
  longitude: number;
  timezone: string;
  method: string; // UMM_AL_QURA (others supported for flexibility)
  madhab: string; // SHAFI | HANAFI
  ramadanIshaExtra: boolean;
}

export interface PrayerCfg {
  prayer: PrayerName;
  adhanEnabled: boolean;
  fileId: string | null;
  volume: number | null;
  offsetMinutes: number;
  fixedTime: string | null;
}

export interface OverrideCfg {
  date: string;
  prayer: PrayerName;
  time: string;
}

export interface PrayerEntry {
  date: string;
  prayer: PrayerName;
  computed: string; // ISO — astronomical
  at: string; // ISO — effective (what will play)
  localTime: string; // HH:mm effective, local tz
  source: "auto" | "fixed" | "override";
  adhanEnabled: boolean;
  fileId: string | null;
  volume: number | null;
  key: string; // adhan:YYYY-MM-DD:PRAYER
}

export interface PrayerDay {
  date: string;
  sunrise: string;
  isRamadan: boolean;
  prayers: PrayerEntry[];
}

function methodParams(method: string) {
  switch (method) {
    case "MUSLIM_WORLD_LEAGUE":
      return CalculationMethod.MuslimWorldLeague();
    case "EGYPTIAN":
      return CalculationMethod.Egyptian();
    case "KARACHI":
      return CalculationMethod.Karachi();
    case "DUBAI":
      return CalculationMethod.Dubai();
    case "QATAR":
      return CalculationMethod.Qatar();
    case "KUWAIT":
      return CalculationMethod.Kuwait();
    case "UMM_AL_QURA":
    default:
      return CalculationMethod.UmmAlQura();
  }
}

export function computeAstronomical(dateStr: string, p: CalcParams) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const params = methodParams(p.method);
  params.madhab = p.madhab === "HANAFI" ? Madhab.Hanafi : Madhab.Shafi;
  params.rounding = Rounding.Nearest;
  const isRamadan = hijriMonth(dateStr) === 9;
  if (p.method === "UMM_AL_QURA" && isRamadan && p.ramadanIshaExtra) {
    params.ishaInterval = 120;
  }
  // adhan reads y/m/d via local getters; build the date in host-local time.
  const t = new PrayerTimes(new Coordinates(p.latitude, p.longitude), new Date(y, m - 1, d), params);
  return {
    isRamadan,
    sunrise: t.sunrise,
    times: { FAJR: t.fajr, DHUHR: t.dhuhr, ASR: t.asr, MAGHRIB: t.maghrib, ISHA: t.isha } as Record<PrayerName, Date>,
  };
}

export function computePrayerDay(
  dateStr: string,
  p: CalcParams,
  configs: PrayerCfg[],
  overrides: OverrideCfg[],
): PrayerDay {
  const astro = computeAstronomical(dateStr, p);
  const cfgMap = new Map(configs.map((c) => [c.prayer, c]));
  const prayers = PRAYERS.map((prayer): PrayerEntry => {
    const cfg = cfgMap.get(prayer) ?? {
      prayer,
      adhanEnabled: true,
      fileId: null,
      volume: null,
      offsetMinutes: 0,
      fixedTime: null,
    };
    const computed = astro.times[prayer];
    const ov = overrides.find((o) => o.date === dateStr && o.prayer === prayer);
    let at: Date;
    let source: PrayerEntry["source"];
    if (ov) {
      at = zonedToUtc(dateStr, ov.time, p.timezone);
      source = "override";
    } else if (cfg.fixedTime) {
      at = addMinutes(zonedToUtc(dateStr, cfg.fixedTime, p.timezone), cfg.offsetMinutes);
      source = "fixed";
    } else {
      at = addMinutes(computed, cfg.offsetMinutes);
      source = "auto";
    }
    return {
      date: dateStr,
      prayer,
      computed: computed.toISOString(),
      at: at.toISOString(),
      localTime: localTime(at, p.timezone),
      source,
      adhanEnabled: cfg.adhanEnabled,
      fileId: cfg.fileId,
      volume: cfg.volume,
      key: `adhan:${dateStr}:${prayer}`,
    };
  });
  return { date: dateStr, sunrise: astro.sunrise.toISOString(), isRamadan: astro.isRamadan, prayers };
}

export function computePrayerRange(
  fromDate: string,
  days: number,
  p: CalcParams,
  configs: PrayerCfg[],
  overrides: OverrideCfg[],
): PrayerDay[] {
  const out: PrayerDay[] = [];
  for (let i = 0; i < days; i++) out.push(computePrayerDay(addDays(fromDate, i), p, configs, overrides));
  return out;
}

/** First enabled-or-not prayer strictly after `now`, searching today and tomorrow. */
export function nextPrayer(days: PrayerDay[], now: Date, onlyEnabled = false): PrayerEntry | null {
  for (const d of days) {
    for (const e of d.prayers) {
      if (new Date(e.at).getTime() > now.getTime() && (!onlyEnabled || e.adhanEnabled)) return e;
    }
  }
  return null;
}
