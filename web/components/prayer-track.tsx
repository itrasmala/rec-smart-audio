"use client";
import { BellOff } from "lucide-react";
import { fmtTime, ORG_TZ } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { L } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { PrayerDay, PrayerEntry } from "@/lib/types";
import { cx } from "./ui";

function minutesOfDay(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const [h, m] = p.split(":").map(Number);
  return h * 60 + m;
}

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(r)}`;
}

/**
 * The day as a single track: five prayers placed at their real time of day, a live "now" marker,
 * and the next adhan called out with its countdown. Time flows in reading direction (RTL in Arabic).
 */
export function PrayerTrack({ today, next, tz = ORG_TZ, hijri }: { today: PrayerDay; next: PrayerEntry | null; tz?: string; hijri?: string }) {
  const { t, lang, locale } = usePrefs();
  const now = useNow(1000);
  const nowMin = minutesOfDay(new Date(now).toISOString(), tz) + new Date(now).getSeconds() / 60;
  // window: one hour before Fajr → one hour after Isha
  const start = Math.max(0, minutesOfDay(today.prayers[0].at, tz) - 60);
  const end = Math.min(1440, minutesOfDay(today.prayers[4].at, tz) + 60);
  const frac = (min: number) => Math.min(1, Math.max(0, (min - start) / (end - start)));
  const pos = (min: number) => `${frac(min) * 100}%`;
  const nowVisible = nowMin >= start && nowMin <= end;
  const remaining = next ? new Date(next.at).getTime() - now : 0;
  const sunrise = minutesOfDay(today.sunrise, tz);

  return (
    <section className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-5 pb-2 pt-5 md:px-7 md:pt-6">
        <div>
          <p className="text-[13px] text-ink-3">{t("الأذان القادم", "Next adhan")}</p>
          {next ? (
            <div className="mt-1 flex items-baseline gap-x-4 gap-y-1 flex-wrap">
              <span className="text-[34px] font-semibold leading-none md:text-[40px]">{L.prayer(next.prayer, lang)}</span>
              <span className="tnum text-[34px] font-light leading-none text-sodium-ink md:text-[40px]" dir="ltr">
                {countdown(remaining)}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-xl">—</p>
          )}
          {next && (
            <p className="mt-2 text-sm text-ink-3">
              {t("عند", "at")} <span className="tnum font-medium text-ink">{fmtTime(next.at, locale, tz)}</span>
              {!next.adhanEnabled && <span className="ms-2 text-fault">{t("(الأذان معطّل لهذه الصلاة)", "(adhan disabled)")}</span>}
              {next.source !== "auto" && (
                <span className="ms-2">{next.source === "override" ? t("· وقت معدّل لهذا اليوم", "· adjusted for today") : t("· وقت ثابت", "· fixed time")}</span>
              )}
            </p>
          )}
        </div>
        <div className="text-end text-[13px] text-ink-3">
          <div className="tnum text-xl font-medium text-ink" dir="ltr">
            {fmtTime(new Date(now), locale, tz, true)}
          </div>
          <div>{hijri}</div>
          {today.isRamadan && <div className="text-sodium-ink">{t("رمضان — العشاء بعد المغرب بساعتين", "Ramadan — Isha 2h after Maghrib")}</div>}
        </div>
      </div>

      {/* compact list on phones */}
      <ol className="grid grid-cols-5 gap-1 px-3 pb-5 pt-4 sm:hidden">
        {today.prayers.map((p) => {
          const isNext = next?.key === p.key;
          return (
            <li key={p.key} className={cx("rounded-lg py-2 text-center", isNext ? "bg-sodium-soft" : "")}>
              <div className={cx("text-[12px]", isNext ? "font-semibold" : "text-ink-3")}>{L.prayer(p.prayer, lang)}</div>
              <div className={cx("tnum text-[14px] font-medium", isNext && "text-sodium-ink")} dir="ltr">
                {p.localTime}
              </div>
              {!p.adhanEnabled && <BellOff className="mx-auto mt-0.5 size-3 text-fault" />}
            </li>
          );
        })}
      </ol>

      {/* track */}
      <div className="hidden px-7 pb-6 pt-8 sm:block md:px-10">
        <div className="relative h-[86px]">
          {/* night / day band */}
          <div className="absolute inset-x-0 top-[34px] h-[6px] rounded-full bg-surface-2" />
          <div
            className="absolute top-[34px] h-[6px] rounded-full bg-petrol-soft"
            style={{ insetInlineStart: pos(sunrise), width: `${(frac(minutesOfDay(today.prayers[3].at, tz)) - frac(sunrise)) * 100}%` }}
          />
          {/* elapsed */}
          <div className="absolute top-[34px] h-[6px] rounded-full bg-ink/15" style={{ insetInlineStart: 0, width: pos(nowMin) }} />
          {today.prayers.map((p) => {
            const m = minutesOfDay(p.at, tz);
            const isNext = next?.key === p.key;
            const past = new Date(p.at).getTime() < now;
            return (
              // zero-width anchor at the logical position; child centred on it with physical left/translate
              <div key={p.key} className="absolute top-0 w-0" style={{ insetInlineStart: pos(m) }}>
              <div className="absolute left-0 flex -translate-x-1/2 flex-col items-center whitespace-nowrap">
                <span className={cx("text-[12px] leading-none", isNext ? "font-semibold text-ink" : past ? "text-ink-3" : "text-ink-2")}>
                  {L.prayer(p.prayer, lang)}
                </span>
                <span
                  className={cx(
                    "mt-[9px] block rounded-full border-2",
                    isNext ? "size-[18px] -mt-0 border-sodium bg-sodium" : past ? "size-3 border-ink-3 bg-surface" : "size-3 border-petrol bg-surface",
                  )}
                  style={isNext ? { marginTop: 6 } : undefined}
                />
                <span className={cx("tnum mt-2 text-[12px] leading-none", isNext ? "font-semibold text-sodium-ink" : "text-ink-3")} dir="ltr">
                  {p.localTime}
                </span>
                {!p.adhanEnabled && <BellOff className="mt-1 size-3 text-fault" aria-label={t("الأذان معطّل", "Adhan off")} />}
              </div>
              </div>
            );
          })}
          {/* now marker */}
          {nowVisible && <div className="absolute top-[20px] w-0" style={{ insetInlineStart: pos(nowMin) }} aria-hidden>
            <div className="absolute left-0 h-[20px] w-[2px] -translate-x-1/2 rounded bg-ink" />
          </div>}
        </div>
      </div>
    </section>
  );
}
