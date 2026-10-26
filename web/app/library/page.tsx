"use client";
import { CalendarPlus, Music4, Pause, Pencil, Play, Search, Trash2, UploadCloud, Volume2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { describeResult } from "@/components/control-deck";
import { Badge, Button, cx, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select, useFeedback } from "@/components/ui";
import { api, ApiError, uploadWithProgress } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sendCommand, useDevices } from "@/lib/devices";
import { fmtBytes, fmtDate, fmtDuration } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { CATEGORIES, L } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { AudioFile, Category } from "@/lib/types";

const CAT_TONE: Record<Category, "sodium" | "petrol" | "fault" | "neutral" | "ok"> = {
  ADHAN: "sodium",
  STAFF_ANNOUNCEMENT: "petrol",
  ADMIN_ALERT: "petrol",
  SAFETY: "fault",
  GENERAL: "neutral",
};

function Uploader({ onDone }: { onDone: () => void }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const { toast } = useFeedback();
  const [category, setCategory] = useState<Category>("STAFF_ANNOUNCEMENT");
  const [title, setTitle] = useState("");
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cats = CATEGORIES.filter((c) => c !== "ADHAN" || can("SUPER_ADMIN"));

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    let ok = 0;
    for (const f of list) {
      if (!/\.(mp3|wav)$/i.test(f.name)) {
        toast(t(`${f.name}: يُسمح بملفات MP3 و WAV فقط`, `${f.name}: only MP3 and WAV are allowed`), "fault");
        continue;
      }
      const fd = new FormData();
      fd.set("category", category);
      if (title && list.length === 1) fd.set("title", title);
      fd.set("file", f);
      setProgress({ name: f.name, pct: 0 });
      try {
        await uploadWithProgress("/api/files", fd, (pct) => setProgress({ name: f.name, pct }));
        ok++;
      } catch (e) {
        toast(`${f.name}: ${(e as ApiError).message}`, "fault");
      }
    }
    setProgress(null);
    setTitle("");
    if (ok) {
      toast(t(`تم رفع ${ok} ملف — سيُنزَّل تلقائيًا إلى أجهزة التشغيل`, `Uploaded ${ok} file(s) — devices will download automatically`));
      onDone();
    }
  }

  return (
    <Panel title={t("رفع ملف صوتي", "Upload audio")}>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void upload(e.dataTransfer.files);
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          className={cx(
            "flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
            drag ? "border-petrol bg-petrol-soft" : "border-line hover:border-ink-3",
          )}
        >
          <UploadCloud className="size-7 text-ink-3" />
          {progress ? (
            <div className="w-full max-w-xs">
              <p className="truncate text-sm">{progress.name}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-petrol transition-[width]" style={{ width: `${progress.pct}%` }} />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">{t("اسحب الملفات هنا أو اضغط للاختيار", "Drop files here or click to choose")}</p>
              <p className="text-xs text-ink-3">{t("MP3 أو WAV — حتى 60 ميجابايت للملف", "MP3 or WAV — up to 60 MB each")}</p>
            </>
          )}
          <input ref={input} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" multiple className="sr-only" onChange={(e) => e.target.files && void upload(e.target.files)} />
        </div>
        <div className="space-y-4">
          <Field label={t("التصنيف", "Category")}>
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {cats.map((c) => (
                  <option key={c} value={c}>
                    {L.category(c, lang)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("الاسم (اختياري)", "Title (optional)")} hint={t("يُستخدم اسم الملف إن تُرك فارغًا", "Defaults to the file name")}>
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Panel>
  );
}

function EditModal({ file, onClose, onSaved }: { file: AudioFile; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const { toast } = useFeedback();
  const [title, setTitle] = useState(file.title);
  const [category, setCategory] = useState(file.category);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/files/${file.id}`, { title, category });
      toast(t("تم حفظ التعديل", "Saved"));
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
      title={t("تعديل الملف", "Edit file")}
      footer={
        <>
          <Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!title.trim()}>
            {t("حفظ", "Save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("الاسم", "Title")}>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label={t("التصنيف", "Category")}>
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.filter((c) => c !== "ADHAN" || can("SUPER_ADMIN")).map((c) => (
                <option key={c} value={c}>
                  {L.category(c, lang)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-xs text-ink-3" dir="ltr">
          {file.originalName}
        </p>
      </div>
    </Modal>
  );
}

function PlayModal({ file, onClose }: { file: AudioFile; onClose: () => void }) {
  const { t } = usePrefs();
  const { can } = useAuth();
  const { toast } = useFeedback();
  const { devices } = useDevices();
  const active = devices.filter((d) => !d.revokedAt);
  const [deviceId, setDeviceId] = useState<string>("");
  const [priority, setPriority] = useState("ANNOUNCEMENT");
  const [busy, setBusy] = useState(false);
  const target = deviceId || active.find((d) => d.isOnline)?.id || active[0]?.id || "";
  const emergencyOk = can("SUPER_ADMIN") || ["SAFETY", "ADMIN_ALERT"].includes(file.category);
  async function play() {
    setBusy(true);
    try {
      if (target === "all") {
        await api.post("/api/control/broadcast", { type: "play", payload: { fileId: file.id, priority } });
        toast(t("أُرسل إلى جميع الأجهزة", "Sent to all devices"));
      } else {
        const [msg, tone] = describeResult(await sendCommand(target, "play", { fileId: file.id, priority }), t);
        toast(msg, tone);
      }
      onClose();
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
      title={t("تشغيل على السماعات", "Play on speakers")}
      footer={
        <>
          <Button onClick={onClose}>{t("إلغاء", "Cancel")}</Button>
          <Button variant="primary" icon={<Volume2 className="size-4" />} loading={busy} disabled={!target} onClick={play}>
            {t("تشغيل الآن", "Play now")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="font-medium">{file.title}</p>
        <Field label={t("الجهاز", "Device")}>
          {(id) => (
            <Select id={id} value={target} onChange={(e) => setDeviceId(e.target.value)}>
              {active.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.isOnline ? "" : `(${t("غير متصل", "offline")})`}
                </option>
              ))}
              {active.length > 1 && <option value="all">{t("كل الأجهزة", "All devices")}</option>}
            </Select>
          )}
        </Field>
        <Field label={t("الأولوية", "Priority")}>
          {(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="ANNOUNCEMENT">{t("إعلان — يقطع الصوتيات العامة", "Announcement — interrupts general audio")}</option>
              <option value="GENERAL">{t("صوت عام — ينتظر دوره", "General — waits its turn")}</option>
              {emergencyOk && <option value="EMERGENCY">{t("طوارئ — يقطع كل شيء عدا الأذان", "Emergency — interrupts all but the adhan")}</option>}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

export default function LibraryPage() {
  const { t, lang, locale } = usePrefs();
  const { can } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload } = useApi<{ files: AudioFile[] }>("/api/files");
  const [cat, setCat] = useState<Category | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<AudioFile | null>(null);
  const [playing, setPlaying] = useState<AudioFile | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const files = useMemo(
    () => (data?.files ?? []).filter((f) => (cat === "ALL" || f.category === cat) && (!q || f.title.toLowerCase().includes(q.toLowerCase()))),
    [data, cat, q],
  );
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of data?.files ?? []) m[f.category] = (m[f.category] ?? 0) + 1;
    return m;
  }, [data]);

  function preview(f: AudioFile) {
    const a = audio.current!;
    if (previewId === f.id && !a.paused) {
      a.pause();
      setPreviewId(null);
      return;
    }
    a.src = `/api/files/${f.id}/stream`;
    void a.play();
    setPreviewId(f.id);
  }

  async function remove(f: AudioFile) {
    if (!(await confirm({ title: t("حذف الملف؟", "Delete file?"), body: t(`سيُحذف «${f.title}» من المكتبة ومن أجهزة التشغيل.`, `“${f.title}” will be removed from the library and from playback devices.`), danger: true, confirmLabel: t("حذف", "Delete") }))) return;
    try {
      await api.del(`/api/files/${f.id}`);
      toast(t("تم حذف الملف", "File deleted"));
      void reload();
    } catch (e) {
      const err = e as ApiError;
      const d = err.details as { schedules?: { name: string }[]; prayers?: string[] } | undefined;
      const where = [...(d?.schedules?.map((s) => s.name) ?? []), ...(d?.prayers?.map((p) => L.prayer(p as any, lang)) ?? [])].join("، ");
      toast(where ? `${err.message}: ${where}` : err.message, "fault");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("مكتبة الصوتيات", "Audio library")} description={t("الملفات المرفوعة تُنسخ تلقائيًا إلى أجهزة التشغيل لتعمل حتى دون إنترنت.", "Uploaded files are copied to the playback devices automatically, so they work without internet.")} />
      <Uploader onDone={() => void reload()} />

      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {(["ALL", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cx("rounded-full px-3 py-1 text-[13px]", cat === c ? "bg-petrol-soft font-medium text-petrol" : "text-ink-2 hover:bg-surface-2")}
            >
              {c === "ALL" ? t("الكل", "All") : L.category(c, lang)}
              <span className="tnum ms-1.5 text-ink-3">{c === "ALL" ? data?.files.length ?? 0 : counts[c] ?? 0}</span>
            </button>
          ))}
          <div className="relative ms-auto w-full sm:w-60">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("بحث بالاسم", "Search by title")} className="h-9 ps-9" />
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-5">
            <ErrorNote error={error} />
          </div>
        ) : !files.length ? (
          <Empty icon={<Music4 className="size-8" />} title={t("لا توجد ملفات هنا", "No files here")} body={t("ارفع ملف MP3 أو WAV ليظهر في هذه القائمة.", "Upload an MP3 or WAV file to see it here.")} />
        ) : (
          <ul className="divide-y divide-line">
            {files.map((f) => {
              const adhanLocked = f.category === "ADHAN" && !can("SUPER_ADMIN");
              const used = (f._count?.schedules ?? 0) + (f._count?.prayerConfigs ?? 0);
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <button
                    onClick={() => preview(f)}
                    className={cx("flex size-10 shrink-0 items-center justify-center rounded-full border", previewId === f.id ? "border-petrol bg-petrol text-white" : "border-line text-ink-2 hover:bg-surface-2")}
                    aria-label={t("معاينة", "Preview")}
                    title={t("معاينة في المتصفح", "Preview in browser")}
                  >
                    {previewId === f.id ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </button>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-medium">{f.title}</p>
                    <p className="tnum flex flex-wrap gap-x-3 text-xs text-ink-3">
                      <bdi dir="ltr">{fmtDuration(f.durationSec)}</bdi>
                      <bdi dir="ltr">
                        {f.format.toUpperCase()} {fmtBytes(f.sizeBytes)}
                      </bdi>
                      <bdi>{fmtDate(f.createdAt, locale)}</bdi>
                      {f.uploadedBy && <bdi>{f.uploadedBy.displayName}</bdi>}
                    </p>
                  </div>
                  <div className="w-36 shrink-0">
                    <Badge tone={CAT_TONE[f.category]}>{L.category(f.category, lang)}</Badge>
                  </div>
                  <span className="hidden w-24 shrink-0 text-xs text-ink-3 md:block">{used > 0 ? t(`مستخدم في ${used}`, `used in ${used}`) : ""}</span>
                  <div className="flex items-center justify-end gap-1 md:w-[300px]">
                    {f.category !== "ADHAN" && (
                      <>
                        <Button size="sm" variant="ghost" icon={<Volume2 className="size-4" />} onClick={() => setPlaying(f)}>
                          {t("تشغيل", "Play")}
                        </Button>
                        <Link href={`/schedules/?fileId=${f.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-ink-2 hover:bg-surface-2">
                          <CalendarPlus className="size-4" />
                          {t("جدولة", "Schedule")}
                        </Link>
                      </>
                    )}
                    {!adhanLocked && (
                      <>
                        <button onClick={() => setEditing(f)} className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={t("تعديل", "Edit")}>
                          <Pencil className="size-4" />
                        </button>
                        <button onClick={() => void remove(f)} className="rounded-lg p-2 text-ink-3 hover:bg-fault-soft hover:text-fault" aria-label={t("حذف", "Delete")}>
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <audio ref={audio} onEnded={() => setPreviewId(null)} className="hidden" preload="none" />
      {editing && <EditModal file={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {playing && <PlayModal file={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
