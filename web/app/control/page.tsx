"use client";
import { Radio } from "lucide-react";
import { useState } from "react";
import { ControlDeck } from "@/components/control-deck";
import { Badge, Button, cx, Dot, Empty, Loading, PageHeader, Panel, Select, useFeedback } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDevices, useSelectedDevice } from "@/lib/devices";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { L } from "@/lib/labels";
import { useLiveEvent } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { AudioFile } from "@/lib/types";

const CMD_LABEL: Record<string, [string, string]> = {
  play: ["تشغيل", "Play"],
  stop: ["إيقاف", "Stop"],
  pause: ["إيقاف مؤقت", "Pause"],
  resume: ["استئناف", "Resume"],
  volume: ["ضبط الصوت", "Set volume"],
  volume_step: ["تغيير الصوت", "Volume step"],
  test_speakers: ["اختبار السماعات", "Speaker test"],
  adhan_test: ["اختبار الأذان", "Adhan test"],
  bt_reconnect: ["إعادة اتصال البلوتوث", "Bluetooth reconnect"],
  set_output: ["تغيير المخرج", "Change output"],
  sync: ["مزامنة", "Sync"],
};
const STATUS_TONE: Record<string, "ok" | "fault" | "neutral" | "petrol"> = { ACKED: "ok", FAILED: "fault", EXPIRED: "fault", SENT: "petrol", PENDING: "neutral" };
const STATUS_LABEL: Record<string, [string, string]> = {
  ACKED: ["نُفّذ", "Done"],
  FAILED: ["فشل", "Failed"],
  EXPIRED: ["انتهت المهلة", "Expired"],
  SENT: ["أُرسل", "Sent"],
  PENDING: ["بانتظار الجهاز", "Waiting"],
};

function Broadcast() {
  const { t, lang } = usePrefs();
  const { toast } = useFeedback();
  const { can } = useAuth();
  const { data } = useApi<{ files: AudioFile[] }>("/api/files");
  const [fileId, setFileId] = useState("");
  const [busy, setBusy] = useState(false);
  const files = (data?.files ?? []).filter((f) => f.category !== "ADHAN");
  const chosen = files.find((f) => f.id === fileId);
  const emergencyAllowed = can("SUPER_ADMIN") || (chosen && ["SAFETY", "ADMIN_ALERT"].includes(chosen.category));

  async function go(type: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api.post<{ results: { name: string; delivered?: boolean; error?: string }[] }>("/api/control/broadcast", { type, payload });
      const ok = r.results.filter((x) => x.delivered).length;
      const off = r.results.filter((x) => x.delivered === false).length;
      const err = r.results.find((x) => x.error);
      if (err) toast(`${err.name}: ${err.error}`, "fault");
      else toast(t(`أُرسل إلى ${ok} جهاز${off ? ` — ${off} غير متصل` : ""}`, `Sent to ${ok} device(s)${off ? ` — ${off} offline` : ""}`), off ? "neutral" : "ok");
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t("بث على جميع الأجهزة", "Broadcast to all devices")} description={t("نفس الإعلان في كل الممرات المتصلة بأجهزة مختلفة.", "Same announcement on every corridor, across all devices.")}>
      <div className="space-y-3">
        <Select value={fileId} onChange={(e) => setFileId(e.target.value)} aria-label={t("الملف", "File")}>
          <option value="">{t("اختيار ملف صوتي…", "Choose an audio file…")}</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title} — {L.category(f.category, lang)}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Radio className="size-4" />} disabled={!fileId} loading={busy} onClick={() => go("play", { fileId, priority: "ANNOUNCEMENT" })}>
            {t("بث كإعلان", "Broadcast")}
          </Button>
          {emergencyAllowed && (
            <Button variant="danger" disabled={!fileId || busy} onClick={() => go("play", { fileId, priority: "EMERGENCY" })}>
              {t("بث طوارئ", "Emergency broadcast")}
            </Button>
          )}
          <Button disabled={busy} onClick={() => go("stop", { clearQueue: true })}>
            {t("إيقاف الكل", "Stop all")}
          </Button>
        </div>
        <p className="text-xs text-ink-3">
          {t("رسائل الطوارئ تقطع الإعلانات والصوتيات العامة وتنتظر انتهاء الأذان إن كان يعمل.", "Emergency messages interrupt announcements and general audio, and wait for an adhan in progress to finish.")}
        </p>
      </div>
    </Panel>
  );
}

function CommandHistory({ deviceId }: { deviceId: string }) {
  const { t, lang, locale } = usePrefs();
  const { data, reload } = useApi<{ commands: any[] }>(`/api/devices/${deviceId}/commands`, [deviceId]);
  useLiveEvent(["command", "commands_expired"], () => void reload());
  const pick = (p?: [string, string]) => (p ? (lang === "ar" ? p[0] : p[1]) : "");
  return (
    <Panel title={t("آخر الأوامر", "Recent commands")} bodyClassName="p-0">
      {!data?.commands.length ? (
        <Empty title={t("لم تُرسل أوامر بعد", "No commands yet")} />
      ) : (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {data.commands.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {pick(CMD_LABEL[c.type]) || c.type}
                  {c.payload?.title ? <span className="font-normal text-ink-3"> — {c.payload.title}</span> : null}
                </p>
                <p className="text-xs text-ink-3">
                  {c.createdBy?.displayName ?? "—"} · {fmtDateTime(c.createdAt, locale)}
                  {c.error && <span className="block text-fault">{c.error}</span>}
                </p>
              </div>
              <Badge tone={STATUS_TONE[c.status]}>{pick(STATUS_LABEL[c.status])}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function ControlPage() {
  const { t, lang } = usePrefs();
  const { devices, loading } = useDevices();
  const { selected, select, active } = useSelectedDevice(devices);
  if (loading && !devices.length) return <Loading />;

  return (
    <div>
      <PageHeader
        title={t("التحكم المباشر", "Live control")}
        description={t("شغّل وأوقف الصوتيات واضبط مستوى الصوت على سماعات المؤسسة — من داخل الشركة أو خارجها.", "Play, stop and set the volume on the building speakers — from inside or outside the company.")}
      />
      {!active.length ? (
        <Panel>
          <Empty title={t("لا توجد أجهزة تشغيل", "No playback devices")} body={t("أضف جهازًا من صفحة الأجهزة والسماعات.", "Add one on the Devices page.")} />
        </Panel>
      ) : (
        <>
          {active.length > 1 && (
            <div className="mb-5 flex flex-wrap gap-2" role="tablist">
              {active.map((d) => (
                <button
                  key={d.id}
                  role="tab"
                  aria-selected={selected?.id === d.id}
                  onClick={() => select(d.id)}
                  className={cx(
                    "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm",
                    selected?.id === d.id ? "border-petrol bg-petrol-soft font-medium text-petrol" : "border-line bg-surface hover:bg-surface-2",
                  )}
                >
                  <Dot tone={d.isOnline ? "ok" : "fault"} />
                  {d.name}
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              <Panel
                title={selected.name}
                description={[selected.location, selected.lastStatus?.output?.name ?? L.output(selected.outputType, lang)].filter(Boolean).join(" — ")}
                actions={
                  <Badge tone={selected.isOnline ? "ok" : "fault"}>
                    <Dot tone={selected.isOnline ? "ok" : "fault"} />
                    {selected.isOnline ? t("متصل", "Online") : t("غير متصل", "Offline")}
                  </Badge>
                }
              >
                <ControlDeck device={selected} status={selected.lastStatus ?? null} statusAt={(selected as any).statusAt} />
              </Panel>
              <div className="space-y-6">
                {active.length > 1 && <Broadcast />}
                <CommandHistory deviceId={selected.id} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
