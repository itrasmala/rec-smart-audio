"use client";
import { BellOff, FileUp, Pencil, PlayCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, cx, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select, Textarea, Toggle, useFeedback, VolumeSlider } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDevices } from "@/lib/devices";
import { fmtCalendarDate, fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { L, PRAYERS } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { AudioFile, Prayer, PrayerDay } from "@/lib/types";

interface PrayerConfig {
  prayer: Prayer;
  adhanEnabled: boolean;
  fileId: string | null;
  volume: number | null;
  offsetMinutes: number;
  fixedTime: string | null;
  file?: { id: string; title: string; durationSec: number } | null;
}
interface PrayerSettingsResp {
  settings: { country: string; city: string; latitude: number; longitude: number; timezone: string; method: string; madhab: string; ramadanIshaExtra: boolean };
  configs: PrayerConfig[];
  defaultAdhanVolume: number;
}
interface Override {
  id: string;
  date: string;
  prayer: Prayer;
  time: string;
  note: string | null;
}

const METHODS: [string, string, string][] = [
  ["UMM_AL_QURA", "أم القرى (مكة المكرمة)", "Umm al-Qura (Makkah)"],
  ["MUSLIM_WORLD_LEAGUE", "رابطة العالم الإسلامي", "Muslim World League"],
  ["EGYPTIAN", "الهيئة المصرية العامة للمساحة", "Egyptian General Authority"],
  ["KARACHI", "جامعة العلوم الإسلامية بكراتشي", "Karachi"],
  ["DUBAI", "دبي", "Dubai"],
  ["QATAR", "قطر", "Qatar"],
  ["KUWAIT", "الكويت", "Kuwait"],
];

function ConfigModal({ cfg, files, defaultVolume, onClose, onSaved }: { cfg: PrayerConfig; files: AudioFile[]; defaultVolume: number; onClose: () => void; onSaved: () => void }) {
  const { t } = usePrefs();
  const { toast } = useFeedback();
  const [f, setF] = useState({ ...cfg });
  const [customVol, setCustomVol] = useState(cfg.volume !== null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.put(`/api/prayers/config/${cfg.prayer}`, {
        adhanEnabled: f.adhanEnabled,
        fileId: f.fileId || null,
        volume: customVol ? f.volume ?? defaultVolume : null,
        offsetMinutes: Number(f.offsetMinutes) || 0,
        fixedTime: f.fixedTime || null,
      });
      toast(t("تم حفظ إعدادات الصلاة وإرسالها للأجهزة", "Saved and sent to devices"));
      onSaved();
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t(`إعدادات أذان ${L.prayer(cfg.prayer, "ar")}`, `${L.prayer(cfg.prayer, "en")} adhan settings`)}
      footer={
        <>
          <Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {t("حفظ", "Save")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t("تشغيل الأذان تلقائيًا لهذه الصلاة", "Play the adhan automatically")}</span>
          <Toggle checked={f.adhanEnabled} onChange={(v) => setF({ ...f, adhanEnabled: v })} />
        </label>
        <Field label={t("ملف الأذان", "Adhan file")} hint={!files.length ? t("ارفع ملف أذان من مكتبة الصوتيات بتصنيف «الأذان».", "Upload an adhan file in the library under the Adhan category.") : undefined}>
          {(id) => (
            <Select id={id} value={f.fileId ?? ""} onChange={(e) => setF({ ...f, fileId: e.target.value || null })}>
              <option value="">{t("— بدون ملف —", "— none —")}</option>
              {files.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <label className="mb-2 flex items-center justify-between gap-4">
            <span className="text-[13px] font-medium text-ink-2">{t("مستوى صوت خاص لهذه الصلاة", "Custom volume for this prayer")}</span>
            <Toggle checked={customVol} onChange={setCustomVol} />
          </label>
          {customVol ? (
            <VolumeSlider label={t("مستوى الصوت", "Volume")} value={f.volume ?? defaultVolume} onChange={(v) => setF({ ...f, volume: v })} />
          ) : (
            <p className="text-xs text-ink-3">{t(`يُستخدم مستوى الأذان الافتراضي (${defaultVolume}%)`, `Uses the default adhan volume (${defaultVolume}%)`)}</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("تأخير/تقديم بالدقائق", "Offset (minutes)")} hint={t("مثال: 2 يؤخر الأذان دقيقتين، و ‎-1 يقدّمه دقيقة", "e.g. 2 delays by two minutes, -1 advances by one")}>
            {(id) => <Input id={id} type="number" min={-60} max={60} dir="ltr" value={f.offsetMinutes} onChange={(e) => setF({ ...f, offsetMinutes: Number(e.target.value) })} />}
          </Field>
          <Field label={t("وقت ثابت يدوي (اختياري)", "Fixed time (optional)")} hint={t("يتجاوز الوقت المحسوب كل يوم", "Overrides the calculated time every day")}>
            {(id) => <Input id={id} type="time" dir="ltr" value={f.fixedTime ?? ""} onChange={(e) => setF({ ...f, fixedTime: e.target.value || null })} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TestAdhan({ configs }: { configs: PrayerConfig[] }) {
  const { t, lang } = usePrefs();
  const { toast } = useFeedback();
  const { devices } = useDevices();
  const [prayer, setPrayer] = useState<Prayer>("DHUHR");
  const [deviceId, setDeviceId] = useState("all");
  const [busy, setBusy] = useState(false);
  const hasFile = !!configs.find((c) => c.prayer === prayer)?.fileId;
  async function run() {
    setBusy(true);
    try {
      const r = await api.post<{ results: { delivered: boolean }[] }>("/api/prayers/test", { prayer, deviceId });
      const n = r.results.filter((x) => x.delivered).length;
      toast(n ? t(`بدأ اختبار الأذان على ${n} جهاز`, `Adhan test started on ${n} device(s)`) : t("لا توجد أجهزة متصلة", "No devices online"), n ? "ok" : "fault");
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={prayer} onChange={(e) => setPrayer(e.target.value as Prayer)} className="h-10 w-auto" aria-label={t("الصلاة", "Prayer")}>
        {PRAYERS.map((p) => (
          <option key={p} value={p}>
            {L.prayer(p, lang)}
          </option>
        ))}
      </Select>
      <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="h-10 w-auto" aria-label={t("الجهاز", "Device")}>
        <option value="all">{t("كل الأجهزة", "All devices")}</option>
        {devices.filter((d) => !d.revokedAt).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
      <Button variant="sodium" icon={<PlayCircle className="size-4" />} loading={busy} disabled={!hasFile} onClick={run} title={!hasFile ? t("حدّد ملف أذان لهذه الصلاة أولًا", "Set an adhan file first") : undefined}>
        {t("اختبار الأذان", "Test adhan")}
      </Button>
    </div>
  );
}

function OverridesPanel({ onChanged }: { onChanged: () => void }) {
  const { t, lang } = usePrefs();
  const { toast, confirm } = useFeedback();
  const { data, reload } = useApi<{ overrides: Override[] }>("/api/prayers/overrides");
  const [form, setForm] = useState({ date: "", prayer: "DHUHR" as Prayer, time: "", note: "" });
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<null | { count: number; maxAbsDiffMinutes: number; errors: string[]; diffs: { date: string; prayer: Prayer; time: string; computed: string | null; diffMinutes: number | null }[] }>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    try {
      await api.put("/api/prayers/overrides", { ...form, note: form.note || null });
      setForm({ ...form, time: "", note: "" });
      toast(t("تم حفظ التعديل", "Saved"));
      await reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "fault");
    }
  }
  async function remove(o: Override) {
    if (!(await confirm({ title: t("حذف التعديل؟", "Delete override?"), body: `${o.date} — ${L.prayer(o.prayer, lang)} ${o.time}`, danger: true, confirmLabel: t("حذف", "Delete") }))) return;
    await api.del(`/api/prayers/overrides/${o.id}`);
    await reload();
    onChanged();
  }
  async function check(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.post<any>("/api/prayers/overrides/import", { csv, dryRun });
      if (dryRun) setPreview(r);
      else {
        toast(t(`تم استيراد ${r.count} وقتًا من التقويم`, `Imported ${r.count} times`));
        setPreview(null);
        setCsv("");
        await reload();
        onChanged();
      }
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  async function loadFile(file: File) {
    setCsv(await file.text());
    setPreview(null);
  }

  const mismatches = preview?.diffs.filter((d) => d.diffMinutes) ?? [];
  return (
    <Panel
      title={t("مطابقة تقويم أم القرى", "Match the official Umm al-Qura calendar")}
      description={t("قارن الأوقات المحسوبة بالتقويم المعتمد قبل التشغيل الفعلي، وثبّت أي فرق لتاريخ محدد.", "Compare calculated times with the official calendar before go-live and pin any difference to its date.")}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("استيراد التقويم المعتمد (CSV)", "Import official calendar (CSV)")}</h3>
          <p className="text-xs text-ink-3">
            {t("صيغة كل سطر:", "One row per day:")} <code dir="ltr" className="rounded bg-surface-2 px-1">2026-10-25,04:37,11:37,14:52,17:18,18:48</code>
          </p>
          <Textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} dir="ltr" rows={5} placeholder="date,fajr,dhuhr,asr,maghrib,isha" />
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm hover:bg-surface-2">
              <FileUp className="size-4" />
              {t("اختيار ملف", "Choose file")}
              <input type="file" accept=".csv,.txt" className="sr-only" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
            </label>
            <Button disabled={!csv.trim()} loading={busy && !preview} onClick={() => check(true)}>
              {t("مقارنة بالأوقات المحسوبة", "Compare with calculated")}
            </Button>
          </div>
          {preview && (
            <div className="rounded-lg border border-line p-3 text-sm">
              <p>
                {t(`${preview.count} وقتًا — أكبر فرق: `, `${preview.count} times — largest difference: `)}
                <strong className={preview.maxAbsDiffMinutes > 1 ? "text-fault" : "text-ok"}>
                  {preview.maxAbsDiffMinutes} {t("دقيقة", "min")}
                </strong>
              </p>
              {mismatches.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-ink-2">
                  {mismatches.slice(0, 60).map((d) => (
                    <li key={d.date + d.prayer} className="tnum">
                      {d.date} {L.prayer(d.prayer, lang)}: {t("المعتمد", "official")} {d.time} / {t("المحسوب", "calc")} {d.computed} ({d.diffMinutes! > 0 ? "+" : ""}
                      {d.diffMinutes})
                    </li>
                  ))}
                </ul>
              )}
              {preview.errors.length > 0 && <p className="mt-2 text-xs text-fault">{preview.errors.slice(0, 3).join(" — ")}</p>}
              <Button className="mt-3" variant="primary" loading={busy} onClick={() => check(false)}>
                {t("اعتماد هذه الأوقات", "Use these times")}
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">{t("تعديل وقت ليوم محدد", "Adjust a single day")}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
            <Input type="date" dir="ltr" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label={t("التاريخ", "Date")} />
            <Select value={form.prayer} onChange={(e) => setForm({ ...form, prayer: e.target.value as Prayer })} aria-label={t("الصلاة", "Prayer")}>
              {PRAYERS.map((p) => (
                <option key={p} value={p}>
                  {L.prayer(p, lang)}
                </option>
              ))}
            </Select>
            <Input type="time" dir="ltr" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} aria-label={t("الوقت", "Time")} />
            <Button variant="primary" disabled={!form.date || !form.time} onClick={add}>
              {t("حفظ", "Save")}
            </Button>
          </div>
          {data?.overrides.length ? (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {data.overrides.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="tnum">
                    {o.date} — {L.prayer(o.prayer, lang)} <strong dir="ltr">{o.time}</strong>
                    {o.note && <span className="ms-2 text-xs text-ink-3">{o.note}</span>}
                  </span>
                  <button onClick={() => void remove(o)} className="rounded p-1 text-ink-3 hover:text-fault" aria-label={t("حذف", "Delete")}>
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">{t("لا توجد تعديلات قادمة — تُستخدم الأوقات المحسوبة.", "No upcoming adjustments — calculated times are used.")}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function LocationPanel({ s, onSaved }: { s: PrayerSettingsResp["settings"]; onSaved: () => void }) {
  const { t, lang } = usePrefs();
  const { toast } = useFeedback();
  const [f, setF] = useState(s);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(s), [s]);
  async function save() {
    setBusy(true);
    try {
      await api.put("/api/prayers/settings", { ...f, latitude: Number(f.latitude), longitude: Number(f.longitude) });
      toast(t("تم الحفظ وإعادة حساب الأوقات", "Saved — times recalculated"));
      onSaved();
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={t("الموقع وطريقة الحساب", "Location & method")} actions={<Button variant="primary" size="sm" loading={busy} onClick={save}>{t("حفظ", "Save")}</Button>}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("الدولة", "Country")}>{(id) => <Input id={id} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} />}</Field>
        <Field label={t("المدينة", "City")}>{(id) => <Input id={id} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
        <Field label={t("خط العرض", "Latitude")}>{(id) => <Input id={id} dir="ltr" type="number" step="0.0001" value={f.latitude} onChange={(e) => setF({ ...f, latitude: e.target.value as any })} />}</Field>
        <Field label={t("خط الطول", "Longitude")}>{(id) => <Input id={id} dir="ltr" type="number" step="0.0001" value={f.longitude} onChange={(e) => setF({ ...f, longitude: e.target.value as any })} />}</Field>
        <Field label={t("المنطقة الزمنية", "Time zone")}>{(id) => <Input id={id} dir="ltr" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />}</Field>
        <Field label={t("طريقة الحساب", "Method")}>
          {(id) => (
            <Select id={id} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {METHODS.map(([v, ar, en]) => (
                <option key={v} value={v}>
                  {lang === "ar" ? ar : en}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("حساب العصر", "Asr")}>
          {(id) => (
            <Select id={id} value={f.madhab} onChange={(e) => setF({ ...f, madhab: e.target.value })}>
              <option value="SHAFI">{t("الجمهور (الظل = المثل)", "Standard (Shafi)")}</option>
              <option value="HANAFI">{t("الحنفي (الظل = مثلين)", "Hanafi")}</option>
            </Select>
          )}
        </Field>
        <div className="flex items-end">
          <label className="flex h-10 items-center gap-3 text-sm">
            <Toggle checked={f.ramadanIshaExtra} onChange={(v) => setF({ ...f, ramadanIshaExtra: v })} />
            {t("العشاء +30 دقيقة في رمضان", "Isha +30 min in Ramadan")}
          </label>
        </div>
      </div>
    </Panel>
  );
}

export default function PrayersPage() {
  const { t, lang, locale } = usePrefs();
  const { can } = useAuth();
  const isAdmin = can("SUPER_ADMIN");
  const [days, setDays] = useState(7);
  const settings = useApi<PrayerSettingsResp>("/api/prayers/settings");
  const range = useApi<{ timezone: string; days: PrayerDay[] }>(`/api/prayers/range?days=${days}`, [days]);
  const files = useApi<{ files: AudioFile[] }>(isAdmin ? "/api/files?category=ADHAN" : null);
  const [editing, setEditing] = useState<PrayerConfig | null>(null);
  const reloadAll = () => {
    void settings.reload();
    void range.reload();
  };

  if (!settings.data || !range.data) return settings.error || range.error ? <ErrorNote error={settings.error ?? range.error} /> : <Loading />;
  const today = range.data.days[0];
  const tz = range.data.timezone;
  const cfg = (p: Prayer) => settings.data!.configs.find((c) => c.prayer === p)!;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("أوقات الصلاة", "Prayer times")}
        description={t(
          `${settings.data.settings.city}، ${settings.data.settings.country} — ${METHODS.find((m) => m[0] === settings.data!.settings.method)?.[lang === "ar" ? 1 : 2] ?? ""}`,
          `${settings.data.settings.city} — ${METHODS.find((m) => m[0] === settings.data!.settings.method)?.[2] ?? ""}`,
        )}
        actions={isAdmin ? <TestAdhan configs={settings.data.configs} /> : undefined}
      />

      <Panel title={t("جدول اليوم", "Today")} description={`${fmtCalendarDate(today.date, locale)} — ${today.hijri ?? ""}`} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-start text-[12.5px] text-ink-3">
                <th className="px-5 py-2.5 text-start font-medium">{t("الصلاة", "Prayer")}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t("وقت الأذان", "Adhan time")}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t("المحسوب", "Calculated")}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t("ملف الأذان", "Adhan file")}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t("الصوت", "Volume")}</th>
                <th className="px-3 py-2.5 text-start font-medium">{t("الحالة", "Status")}</th>
                {isAdmin && <th className="px-5 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {today.prayers.map((p) => {
                const c = cfg(p.prayer);
                return (
                  <tr key={p.key} className={cx(!p.adhanEnabled && "text-ink-3")}>
                    <td className="px-5 py-3 font-medium">{L.prayer(p.prayer, lang)}</td>
                    <td className="px-3 py-3">
                      <span className="tnum text-[15px] font-semibold" dir="ltr">
                        {p.localTime}
                      </span>
                      {p.source !== "auto" && (
                        <Badge tone="sodium" className="ms-2">
                          {p.source === "override" ? t("معدّل اليوم", "Adjusted") : t("ثابت", "Fixed")}
                        </Badge>
                      )}
                      {c.offsetMinutes !== 0 && p.source !== "override" && (
                        <span className="tnum ms-2 text-xs text-ink-3" dir="ltr">
                          {c.offsetMinutes > 0 ? "+" : ""}
                          {c.offsetMinutes}m
                        </span>
                      )}
                    </td>
                    <td className="tnum px-3 py-3 text-ink-3" dir="ltr">
                      {fmtTime(p.computed, "en-GB", tz)}
                    </td>
                    <td className="max-w-48 truncate px-3 py-3">{c.file?.title ?? <span className="text-fault">{t("غير محدد", "Not set")}</span>}</td>
                    <td className="tnum px-3 py-3">{c.volume ?? settings.data!.defaultAdhanVolume}%</td>
                    <td className="px-3 py-3">
                      {p.adhanEnabled ? (
                        <Badge tone="ok">{t("مفعّل", "On")}</Badge>
                      ) : (
                        <Badge tone="fault">
                          <BellOff className="size-3" />
                          {t("معطّل", "Off")}
                        </Badge>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-end">
                        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(c)}>
                          {t("تعديل", "Edit")}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={t("الجدول القادم", "Upcoming")}
        actions={
          <div className="flex rounded-lg border border-line p-0.5 text-[13px]">
            {[7, 30].map((n) => (
              <button key={n} onClick={() => setDays(n)} className={cx("rounded-md px-3 py-1", days === n ? "bg-petrol-soft font-medium text-petrol" : "text-ink-2")}>
                {n === 7 ? t("7 أيام", "7 days") : t("30 يومًا", "30 days")}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-[12.5px] text-ink-3">
                <th className="px-5 py-2.5 text-start font-medium">{t("التاريخ", "Date")}</th>
                {PRAYERS.map((p) => (
                  <th key={p} className="px-3 py-2.5 text-start font-medium">
                    {L.prayer(p, lang)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {range.data.days.map((d) => (
                <tr key={d.date}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{fmtCalendarDate(d.date, locale, { weekday: "short", day: "numeric", month: "short" })}</div>
                    <div className="text-xs text-ink-3">
                      {d.hijri}
                      {d.isRamadan && <span className="ms-1 text-sodium-ink">{t("· رمضان", "· Ramadan")}</span>}
                    </div>
                  </td>
                  {d.prayers.map((p) => (
                    <td key={p.key} className={cx("tnum px-3 py-2.5", p.source === "override" && "font-semibold text-sodium-ink", !p.adhanEnabled && "text-ink-3 line-through")} dir="ltr" style={{ textAlign: lang === "ar" ? "right" : "left" }}>
                      {p.localTime}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {isAdmin && <OverridesPanel onChanged={() => void range.reload()} />}
      {isAdmin && <LocationPanel s={settings.data.settings} onSaved={reloadAll} />}
      {!isAdmin && (
        <p className="text-sm text-ink-3">{t("تعديل إعدادات الأذان متاح لمدير النظام.", "Adhan settings can be changed by a Super Admin.")}</p>
      )}

      {editing && (
        <ConfigModal
          cfg={editing}
          files={files.data?.files ?? []}
          defaultVolume={settings.data.defaultAdhanVolume}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
          }}
        />
      )}
    </div>
  );
}
