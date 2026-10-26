export const ORG_TZ = "Asia/Riyadh";

export function fmtTime(iso: string | Date | null | undefined, locale: string, tz = ORG_TZ, seconds = false) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: false,
    timeZone: tz,
  }).format(new Date(iso));
}

export function fmtDate(iso: string | Date | null | undefined, locale: string, tz = ORG_TZ) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
}

export function fmtDateTime(iso: string | Date | null | undefined, locale: string, tz = ORG_TZ) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(new Date(iso));
}

/** "YYYY-MM-DD" (calendar date, no tz shift) → localized label */
export function fmtCalendarDate(d: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day, 12)));
}

export function fmtDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function todayLocal(tz = ORG_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function relative(iso: string | null | undefined, lang: string) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar" : "en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(-Math.round(diff), "second");
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}
