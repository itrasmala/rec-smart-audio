import type { Category, OutputType, Prayer, Priority, Role } from "./types";

type Pair = [string, string];
const pick = (p: Pair, lang: string) => (lang === "ar" ? p[0] : p[1]);

export const PRAYERS: Prayer[] = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"];

const prayer: Record<Prayer, Pair> = {
  FAJR: ["الفجر", "Fajr"],
  DHUHR: ["الظهر", "Dhuhr"],
  ASR: ["العصر", "Asr"],
  MAGHRIB: ["المغرب", "Maghrib"],
  ISHA: ["العشاء", "Isha"],
};
const category: Record<Category, Pair> = {
  ADHAN: ["الأذان", "Adhan"],
  STAFF_ANNOUNCEMENT: ["إعلانات الموظفين", "Staff announcements"],
  ADMIN_ALERT: ["تنبيهات إدارية", "Admin alerts"],
  SAFETY: ["رسائل السلامة", "Safety messages"],
  GENERAL: ["صوتيات عامة", "General audio"],
};
const priority: Record<Priority, Pair> = {
  ADHAN: ["أذان", "Adhan"],
  EMERGENCY: ["طوارئ", "Emergency"],
  ANNOUNCEMENT: ["إعلان", "Announcement"],
  GENERAL: ["عام", "General"],
};
const role: Record<Role, Pair> = {
  SUPER_ADMIN: ["مدير النظام", "Super Admin"],
  AUDIO_MANAGER: ["مسؤول الصوتيات", "Audio Manager"],
  VIEWER: ["مشاهد", "Viewer"],
};
const output: Record<OutputType, Pair> = {
  BLUETOOTH: ["بلوتوث", "Bluetooth"],
  AUX: ["سلكي AUX", "AUX (wired)"],
  USB: ["USB Audio", "USB Audio"],
  HDMI: ["HDMI", "HDMI"],
  OTHER: ["أخرى", "Other"],
  UNKNOWN: ["غير محدد", "Not set"],
};
const source: Record<string, Pair> = {
  ADHAN: ["أذان تلقائي", "Automatic adhan"],
  SCHEDULE: ["جدولة", "Schedule"],
  MANUAL: ["تشغيل يدوي", "Manual"],
  TEST: ["اختبار", "Test"],
};
const status: Record<string, Pair> = {
  QUEUED: ["في الانتظار", "Queued"],
  STARTED: ["قيد التشغيل", "Playing"],
  COMPLETED: ["اكتمل", "Completed"],
  INTERRUPTED: ["توقف", "Interrupted"],
  FAILED: ["فشل", "Failed"],
  SKIPPED: ["لم يُشغَّل", "Skipped"],
};
export const WEEKDAYS: Pair[] = [
  ["الأحد", "Sun"],
  ["الإثنين", "Mon"],
  ["الثلاثاء", "Tue"],
  ["الأربعاء", "Wed"],
  ["الخميس", "Thu"],
  ["الجمعة", "Fri"],
  ["السبت", "Sat"],
];

export const L = {
  prayer: (p: Prayer, lang: string) => pick(prayer[p], lang),
  category: (c: Category, lang: string) => pick(category[c], lang),
  priority: (p: Priority, lang: string) => pick(priority[p], lang),
  role: (r: Role, lang: string) => pick(role[r], lang),
  output: (o: OutputType, lang: string) => pick(output[o] ?? output.UNKNOWN, lang),
  source: (s: string, lang: string) => pick(source[s] ?? [s, s], lang),
  status: (s: string, lang: string) => pick(status[s] ?? [s, s], lang),
  weekday: (d: number, lang: string) => pick(WEEKDAYS[d], lang),
};

export const CATEGORIES: Category[] = ["ADHAN", "STAFF_ANNOUNCEMENT", "ADMIN_ALERT", "SAFETY", "GENERAL"];
