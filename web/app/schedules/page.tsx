"use client";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { priorityTone } from "@/components/control-deck";
import { Badge, Button, cx, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select, Toggle, useFeedback, VolumeSlider } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDevices } from "@/lib/devices";
import { fmtDateTime, todayLocal } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CATEGORIES, L, PRAYERS, WEEKDAYS } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { AudioFile, Prayer, Schedule } from "@/lib/types";

type Form = Omit<Schedule, "id" | "devices" | "file" | "createdBy" | "nextRuns"> & { deviceIds: string[] };

const blank = (fileId = ""): Form => ({
  name: "",
  fileId,
  priority: "ANNOUNCEMENT",
  recurrence: "DAILY",
  daysOfWeek: [0, 1, 2, 3, 4],
  anchor: "FIXED_TIME",
  time: "07:00",
  anchorPrayer: "DHUHR",
  anchorOffsetMinutes: -10,
  startDate: todayLocal(),
  endDate: null,
  volume: null,
  isPaused: false,
  allDevices: true,
  deviceIds: [],
});

function describeWhen(s: Pick<Schedule, "recurrence" | "daysOfWeek" | "anchor" | "time" | "anchorPrayer" | "anchorOffsetMinutes" | "startDate">, lang: string) {
  const ar = lang === "ar";
  let when: string;
  if (s.anchor === "PRAYER" && s.anchorPrayer) {
    const p = L.prayer(s.anchorPrayer, lang);
    const m = Math.abs(s.anchorOffsetMinutes);
    when =
      s.anchorOffsetMinutes === 0
        ? ar ? `عند أذان ${p}` : `At ${p} adhan`
        : s.anchorOffsetMinutes < 0
          ? ar ? `قبل ${p} بـ ${m} دقيقة` : `${m} min before ${p}`
          : ar ? `بعد ${p} بـ ${m} دقيقة` : `${m} min after ${p}`;
  } else when = s.time ?? "";
  if (s.recurrence === "ONCE") return ar ? `مرة واحدة ${s.startDate} — ${when}` : `Once on ${s.startDate} — ${when}`;
  if (s.recurrence === "DAILY") return ar ? `يوميًا — ${when}` : `Daily — ${when}`;
  const days = s.daysOfWeek.length === 7 ? (ar ? "كل الأيام" : "Every day") : s.daysOfWeek.map((d) => L.weekday(d, lang)).join(ar ? "، " : ", ");
  return `${days} — ${when}`;
}

function ScheduleModal({ initial, id, onClose, onSaved }: { initial: Form; id?: string; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const { toast } = useFeedback();
  const { devices } = useDevices();
  const { data: filesData } = useApi<{ files: AudioFile[] }>("/api/files");
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const files = (filesData?.files ?? []).filter((x) => x.category !== "ADHAN");
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  async function save() {
    setBusy(true);
    setErr(null);
    const body = { ...f, name: f.name || files.find((x) => x.id === f.fileId)?.title || "" };
    try {
      if (id) await api.put(`/api/schedules/${id}`, body);
      else await api.post("/api/schedules", body);
      toast(id ? t("تم تحديث الجدولة", "Schedule updated") : t("تمت إضافة الجدولة وإرسالها للأجهزة", "Schedule added and sent to devices"));
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={id ? t("تعديل الجدولة", "Edit schedule") : t("جدولة جديدة", "New schedule")}
      footer={
        <>
          <Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!f.fileId}>
            {id ? t("حفظ التعديلات", "Save changes") : t("إضافة الجدولة", "Add schedule")}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={t("الملف الصوتي", "Audio file")}>
          {(i) => (
            <Select id={i} value={f.fileId} onChange={(e) => set({ fileId: e.target.value })}>
              <option value="">{t("اختر ملفًا…", "Choose a file…")}</option>
              {CATEGORIES.filter((c) => c !== "ADHAN").map((c) => {
                const list = files.filter((x) => x.category === c);
                return list.length ? (
                  <optgroup key={c} label={L.category(c, lang)}>
                    {list.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </Select>
          )}
        </Field>
        <Field label={t("اسم الجدولة", "Name")} hint={t("يُستخدم اسم الملف إن تُرك فارغًا", "Defaults to the file title")}>
          {(i) => <Input id={i} value={f.name} onChange={(e) => set({ name: e.target.value })} />}
        </Field>

        <Field label={t("التكرار", "Repeat")}>
          {(i) => (
            <Select id={i} value={f.recurrence} onChange={(e) => set({ recurrence: e.target.value as Form["recurrence"] })}>
              <option value="DAILY">{t("يوميًا", "Daily")}</option>
              <option value="WEEKLY">{t("أيام محددة من الأسبوع", "Specific weekdays")}</option>
              <option value="ONCE">{t("مرة واحدة", "Once")}</option>
            </Select>
          )}
        </Field>
        <Field label={t("الأولوية", "Priority")}>
          {(i) => (
            <Select id={i} value={f.priority} onChange={(e) => set({ priority: e.target.value as Form["priority"] })}>
              <option value="ANNOUNCEMENT">{t("إعلان إداري", "Announcement")}</option>
              <option value="GENERAL">{t("صوتيات عامة", "General")}</option>
              {can("SUPER_ADMIN") && <option value="EMERGENCY">{t("تنبيه طارئ", "Emergency")}</option>}
            </Select>
          )}
        </Field>

        {f.recurrence === "WEEKLY" && (
          <div className="md:col-span-2">
            <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t("الأيام", "Days")}</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((_, d) => {
                const on = f.daysOfWeek.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ daysOfWeek: on ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d].sort() })}
                    className={cx("h-9 rounded-lg border px-3 text-sm", on ? "border-petrol bg-petrol-soft font-medium text-petrol" : "border-line hover:bg-surface-2")}
                  >
                    {L.weekday(d, lang)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="md:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t("وقت التشغيل", "When")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-line p-0.5 text-[13px]">
              {(["FIXED_TIME", "PRAYER"] as const).map((a) => (
                <button key={a} type="button" onClick={() => set({ anchor: a })} className={cx("rounded-md px-3 py-1.5", f.anchor === a ? "bg-petrol-soft font-medium text-petrol" : "text-ink-2")}>
                  {a === "FIXED_TIME" ? t("ساعة محددة", "Clock time") : t("نسبةً لوقت صلاة", "Relative to a prayer")}
                </button>
              ))}
            </div>
            {f.anchor === "FIXED_TIME" ? (
              <Input type="time" dir="ltr" value={f.time ?? ""} onChange={(e) => set({ time: e.target.value })} className="w-36" aria-label={t("الوقت", "Time")} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="number" dir="ltr" min={0} max={180} value={Math.abs(f.anchorOffsetMinutes)} onChange={(e) => set({ anchorOffsetMinutes: (f.anchorOffsetMinutes < 0 ? -1 : 1) * Number(e.target.value) })} className="w-20" aria-label={t("دقائق", "Minutes")} />
                <span className="text-sm">{t("دقيقة", "min")}</span>
                <Select value={f.anchorOffsetMinutes < 0 ? "before" : "after"} onChange={(e) => set({ anchorOffsetMinutes: (e.target.value === "before" ? -1 : 1) * Math.abs(f.anchorOffsetMinutes) })} className="w-24">
                  <option value="before">{t("قبل", "before")}</option>
                  <option value="after">{t("بعد", "after")}</option>
                </Select>
                <Select value={f.anchorPrayer ?? "DHUHR"} onChange={(e) => set({ anchorPrayer: e.target.value as Prayer })} className="w-28">
                  {PRAYERS.map((p) => (
                    <option key={p} value={p}>
                      {L.prayer(p, lang)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </div>

        <Field label={f.recurrence === "ONCE" ? t("التاريخ", "Date") : t("تاريخ البداية", "Start date")}>
          {(i) => <Input id={i} type="date" dir="ltr" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />}
        </Field>
        {f.recurrence !== "ONCE" && (
          <Field label={t("تاريخ النهاية (اختياري)", "End date (optional)")}>
            {(i) => <Input id={i} type="date" dir="ltr" value={f.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />}
          </Field>
        )}

        <div>
          <label className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink-2">{t("مستوى صوت خاص", "Custom volume")}</span>
            <Toggle checked={f.volume !== null} onChange={(v) => set({ volume: v ? 70 : null })} />
          </label>
          {f.volume !== null ? <VolumeSlider label={t("الصوت", "Volume")} value={f.volume} onChange={(v) => set({ volume: v })} /> : <p className="text-xs text-ink-3">{t("يستخدم مستوى صوت الجهاز", "Uses the device volume")}</p>}
        </div>

        <div>
          <label className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink-2">{t("كل أجهزة التشغيل", "All playback devices")}</span>
            <Toggle checked={f.allDevices} onChange={(v) => set({ allDevices: v })} />
          </label>
          {!f.allDevices && (
            <div className="flex flex-wrap gap-1.5">
              {devices.filter((d) => !d.revokedAt).map((d) => {
                const on = f.deviceIds.includes(d.id);
                return (
                  <button key={d.id} type="button" aria-pressed={on} onClick={() => set({ deviceIds: on ? f.deviceIds.filter((x) => x !== d.id) : [...f.deviceIds, d.id] })} className={cx("rounded-lg border px-3 py-1.5 text-sm", on ? "border-petrol bg-petrol-soft text-petrol" : "border-line")}>
                    {d.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {err && <p className="mt-4 rounded-lg bg-fault-soft px-3 py-2 text-sm text-fault">{err}</p>}
    </Modal>
  );
}

export default function SchedulesPage() {
  const { t, lang, locale } = usePrefs();
  const { can } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload } = useApi<{ schedules: Schedule[]; today: string }>("/api/schedules");
  const [modal, setModal] = useState<{ form: Form; id?: string } | null>(null);

  // prefill from the library ("Schedule" button): /schedules/?fileId=...
  useEffect(() => {
    const fileId = new URLSearchParams(window.location.search).get("fileId");
    if (fileId) {
      setModal({ form: blank(fileId) });
      window.history.replaceState(null, "", "/schedules/");
    }
  }, []);

  async function togglePause(s: Schedule) {
    try {
      await api.patch(`/api/schedules/${s.id}/pause`, { isPaused: !s.isPaused });
      toast(s.isPaused ? t("استؤنفت الجدولة", "Schedule resumed") : t("أوقفت الجدولة مؤقتًا", "Schedule paused"));
      void reload();
    } catch (e) {
      toast((e as Error).message, "fault");
    }
  }
  async function remove(s: Schedule) {
    if (!(await confirm({ title: t("حذف الجدولة؟", "Delete schedule?"), body: s.name, danger: true, confirmLabel: t("حذف", "Delete") }))) return;
    try {
      await api.del(`/api/schedules/${s.id}`);
      toast(t("تم حذف الجدولة", "Schedule deleted"));
      void reload();
    } catch (e) {
      toast((e as Error).message, "fault");
    }
  }
  const edit = (s: Schedule) =>
    setModal({
      id: s.id,
      form: { ...s, deviceIds: s.devices.map((d) => d.id), anchorPrayer: s.anchorPrayer ?? "DHUHR" },
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("جدولة الإعلانات", "Announcement schedules")}
        description={t("تُخزَّن الجداول على أجهزة التشغيل وتُنفَّذ في وقتها حتى لو انقطع الإنترنت. الأذان يقطع أي إعلان جارٍ تلقائيًا.", "Schedules are stored on the playback devices and run on time even without internet. The adhan automatically interrupts any running announcement.")}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setModal({ form: blank() })}>
            {t("جدولة جديدة", "New schedule")}
          </Button>
        }
      />
      <Panel bodyClassName="p-0">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-5">
            <ErrorNote error={error} />
          </div>
        ) : !data?.schedules.length ? (
          <Empty
            icon={<CalendarClock className="size-8" />}
            title={t("لا توجد جداول بعد", "No schedules yet")}
            body={t("مثال: رسالة ترحيبية يوميًا 7:00 صباحًا، ورسالة نهاية الدوام 4:00 مساءً.", "For example: a welcome message daily at 7:00 and an end-of-day message at 16:00.")}
            action={<Button variant="primary" onClick={() => setModal({ form: blank() })}>{t("إضافة جدولة", "Add a schedule")}</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.schedules.map((s) => {
              const ended = !!s.endDate && s.endDate < data.today;
              const locked = s.priority === "EMERGENCY" && !can("SUPER_ADMIN");
              return (
                <li key={s.id} className={cx("flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4", (s.isPaused || ended) && "opacity-65")}>
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{s.name}</p>
                      <Badge tone={priorityTone(s.priority)}>{L.priority(s.priority, lang)}</Badge>
                      {s.isPaused && <Badge>{t("متوقفة مؤقتًا", "Paused")}</Badge>}
                      {ended && <Badge>{t("انتهت", "Ended")}</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-2">{describeWhen(s, lang)}</p>
                    <p className="text-xs text-ink-3">
                      {s.file.title}
                      {s.endDate && ` — ${t("حتى", "until")} ${s.endDate}`}
                      {!s.allDevices && ` — ${s.devices.map((d) => d.name).join("، ")}`}
                    </p>
                  </div>
                  <div className="min-w-36 text-sm">
                    <p className="text-xs text-ink-3">{t("التشغيل القادم", "Next run")}</p>
                    <p className="tnum font-medium">{s.nextRuns[0] ? fmtDateTime(s.nextRuns[0], locale) : "—"}</p>
                  </div>
                  {!locked && (
                    <div className="flex items-center gap-1">
                      <label className="me-2 flex items-center gap-2 text-[13px] text-ink-2">
                        <Toggle checked={!s.isPaused} onChange={() => void togglePause(s)} label={t("تفعيل", "Active")} />
                        <span className="hidden sm:inline">{s.isPaused ? t("متوقفة", "Paused") : t("مفعّلة", "Active")}</span>
                      </label>
                      <button onClick={() => edit(s)} className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={t("تعديل", "Edit")}>
                        <Pencil className="size-4" />
                      </button>
                      <button onClick={() => void remove(s)} className="rounded-lg p-2 text-ink-3 hover:bg-fault-soft hover:text-fault" aria-label={t("حذف", "Delete")}>
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {modal && <ScheduleModal initial={modal.form} id={modal.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); void reload(); }} />}
    </div>
  );
}
