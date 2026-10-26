import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hijriMonth, localTime, weekdayOf, zonedToUtc } from "../src/lib/time.js";
import { parseCalendarCsv } from "../src/routes/prayers.js";
import { computePrayerDay, type CalcParams } from "../src/services/prayerCalc.js";
import { eventKey, occurrenceAt, occursOn, type ScheduleDef } from "../src/services/recurrence.js";
import { detectFormat } from "../src/services/storage.js";

const RIYADH: CalcParams = {
  latitude: 24.7136,
  longitude: 46.6753,
  timezone: "Asia/Riyadh",
  method: "UMM_AL_QURA",
  madhab: "SHAFI",
  ramadanIshaExtra: true,
};

describe("time helpers", () => {
  it("converts Riyadh wall time to UTC", () => {
    expect(zonedToUtc("2026-10-25", "07:00", "Asia/Riyadh").toISOString()).toBe("2026-10-25T04:00:00.000Z");
  });
  it("handles DST zones", () => {
    expect(zonedToUtc("2026-07-01", "12:00", "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedToUtc("2026-01-01", "12:00", "Europe/London").toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
  it("weekday (0 = Sunday)", () => {
    expect(weekdayOf("2026-10-25")).toBe(0);
    expect(weekdayOf("2026-10-30")).toBe(5);
  });
  it("Umm al-Qura hijri month", () => {
    expect(hijriMonth("2026-03-01")).toBe(9); // Ramadan 1447
    expect(hijriMonth("2026-10-25")).not.toBe(9);
  });
});

describe("prayer times (Umm al-Qura, Riyadh)", () => {
  const ref = JSON.parse(
    fs.readFileSync(path.resolve("../agent/tests/fixtures/riyadh_reference_oct2026.json"), "utf8"),
  ) as { rows: string[][] };

  it.each(ref.rows)("matches the published timetable on %s (±1 min)", (date, ...expected) => {
    const day = computePrayerDay(date, RIYADH, [], []);
    day.prayers.forEach((p, i) => {
      const [gh, gm] = p.localTime.split(":").map(Number);
      const [eh, em] = expected[i].split(":").map(Number);
      expect(Math.abs(gh * 60 + gm - (eh * 60 + em))).toBeLessThanOrEqual(1);
    });
  });

  it("Isha is Maghrib + 120 min in Ramadan, + 90 otherwise", () => {
    const r = computePrayerDay("2026-03-01", RIYADH, [], []);
    const diff = (d: typeof r) =>
      (Date.parse(d.prayers[4].at) - Date.parse(d.prayers[3].at)) / 60000;
    expect(r.isRamadan).toBe(true);
    expect(diff(r)).toBe(120);
    expect(diff(computePrayerDay("2026-04-15", RIYADH, [], []))).toBe(90);
    expect(diff(computePrayerDay("2026-03-01", { ...RIYADH, ramadanIshaExtra: false }, [], []))).toBe(90);
  });

  it("precedence: date override > fixed time > computed, offsets applied", () => {
    const d = computePrayerDay(
      "2026-10-25",
      RIYADH,
      [
        { prayer: "FAJR", adhanEnabled: true, fileId: null, volume: null, offsetMinutes: 2, fixedTime: null },
        { prayer: "DHUHR", adhanEnabled: true, fileId: null, volume: null, offsetMinutes: 0, fixedTime: "12:00" },
        { prayer: "MAGHRIB", adhanEnabled: true, fileId: null, volume: null, offsetMinutes: 5, fixedTime: null },
      ],
      [{ date: "2026-10-25", prayer: "MAGHRIB", time: "17:20" }],
    );
    const t = Object.fromEntries(d.prayers.map((p) => [p.prayer, [p.localTime, p.source]]));
    expect(t.FAJR).toEqual(["04:39", "auto"]);
    expect(t.DHUHR).toEqual(["12:00", "fixed"]);
    expect(t.MAGHRIB).toEqual(["17:20", "override"]); // override is absolute, offset ignored
    expect(d.prayers[0].key).toBe("adhan:2026-10-25:FAJR");
  });
});

describe("recurrence — shared vectors with the agent", () => {
  const v = JSON.parse(fs.readFileSync(path.resolve("../shared/test-vectors/recurrence.json"), "utf8"));
  const lookup = (d: string, p: string) => (v.prayers[`${d}:${p}`] ? new Date(v.prayers[`${d}:${p}`]) : null);
  for (const c of v.cases as { schedule: ScheduleDef; expect: Record<string, [string, string] | null> }[]) {
    it(c.schedule.id, () => {
      for (const [date, exp] of Object.entries(c.expect)) {
        const at = occursOn(c.schedule, date) ? occurrenceAt(c.schedule, date, v.timezone, lookup) : null;
        if (exp === null) expect(at, `${date}`).toBeNull();
        else {
          expect(at?.toISOString().slice(0, 19)).toBe(exp[0].slice(0, 19));
          expect(eventKey(c.schedule, date, at!, v.timezone)).toBe(exp[1]);
        }
      }
    });
  }
});

describe("official calendar CSV import", () => {
  it("parses rows, header and short hours", () => {
    const { rows, errors } = parseCalendarCsv("date,fajr,dhuhr,asr,maghrib,isha\n2026-10-25,4:37,11:37,14:52,17:18,18:48\n2026-10-26,04:38,11:37,14:52,17:17,25:00");
    expect(errors).toHaveLength(1);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual({ date: "2026-10-25", prayer: "FAJR", time: "04:37" });
  });
});

describe("audio format sniffing", () => {
  it("detects by content, not extension", () => {
    expect(detectFormat(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBe("wav");
    expect(detectFormat(Buffer.from("ID3\x04\0"))).toBe("mp3");
    expect(detectFormat(Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBe("mp3");
    expect(detectFormat(Buffer.from("<?php echo 1;"))).toBeNull();
    expect(detectFormat(Buffer.from("%PDF-1.7"))).toBeNull();
  });
  it("localTime formats in tz", () => {
    expect(localTime(new Date("2026-10-25T08:37:00Z"), "Asia/Riyadh")).toBe("11:37");
  });
});
