/**
 * Schedule occurrence expansion. Mirrors agent/rec_agent/recurrence.py — both are
 * covered by the same test vectors (test/recurrence.test.ts, agent/tests/test_recurrence.py).
 */
import { addDays, addMinutes, localDate, weekdayOf, zonedToUtc } from "../lib/time.js";
import type { PrayerName } from "./prayerCalc.js";

export interface ScheduleDef {
  id: string;
  recurrence: "ONCE" | "DAILY" | "WEEKLY";
  daysOfWeek: number[];
  anchor: "FIXED_TIME" | "PRAYER";
  time: string | null;
  anchorPrayer: PrayerName | null;
  anchorOffsetMinutes: number;
  startDate: string;
  endDate: string | null;
  isPaused: boolean;
}

export interface Occurrence {
  scheduleId: string;
  date: string;
  at: Date;
  key: string;
}

/** Returns prayer time for date (absolute) or null if unknown. */
export type PrayerLookup = (date: string, prayer: PrayerName) => Date | null;

export function occursOn(s: ScheduleDef, date: string): boolean {
  if (date < s.startDate) return false;
  if (s.endDate && date > s.endDate) return false;
  switch (s.recurrence) {
    case "ONCE":
      return date === s.startDate;
    case "DAILY":
      return true;
    case "WEEKLY":
      return s.daysOfWeek.includes(weekdayOf(date));
  }
}

export function occurrenceAt(s: ScheduleDef, date: string, tz: string, prayers: PrayerLookup): Date | null {
  if (s.anchor === "FIXED_TIME") {
    if (!s.time) return null;
    return zonedToUtc(date, s.time, tz);
  }
  if (!s.anchorPrayer) return null;
  const base = prayers(date, s.anchorPrayer);
  return base ? addMinutes(base, s.anchorOffsetMinutes) : null;
}

export function eventKey(s: ScheduleDef, date: string, at: Date, tz: string): string {
  // key uses the *occurrence date* + the schedule id; the local time is included so that
  // editing the time of a schedule creates a fresh occurrence instead of being swallowed.
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `sched:${s.id}:${date}T${t}`;
}

export function nextOccurrences(
  s: ScheduleDef,
  from: Date,
  count: number,
  tz: string,
  prayers: PrayerLookup,
  horizonDays = 400,
): Occurrence[] {
  const out: Occurrence[] = [];
  if (s.isPaused) return out;
  let date = localDate(addMinutes(from, -24 * 60), tz);
  if (date < s.startDate) date = s.startDate;
  for (let i = 0; i < horizonDays && out.length < count; i++, date = addDays(date, 1)) {
    if (s.endDate && date > s.endDate) break;
    if (!occursOn(s, date)) continue;
    const at = occurrenceAt(s, date, tz, prayers);
    if (!at || at.getTime() <= from.getTime()) continue;
    out.push({ scheduleId: s.id, date, at, key: eventKey(s, date, at, tz) });
  }
  return out;
}
