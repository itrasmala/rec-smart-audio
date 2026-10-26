"use client";
import { Pause, Play, Square, Volume1, Volume2, Waves } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { CommandResponse, sendCommand } from "@/lib/devices";
import { fmtDuration } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import { CATEGORIES, L } from "@/lib/labels";
import { usePrefs } from "@/lib/prefs";
import type { AgentStatus, AudioFile, Device, SystemSettings } from "@/lib/types";
import { Badge, Button, cx, Select, useFeedback, VolumeSlider } from "./ui";

export function priorityTone(p?: string) {
  return p === "ADHAN" ? "sodium" : p === "EMERGENCY" ? "fault" : p === "ANNOUNCEMENT" ? "petrol" : "neutral";
}

/** Position extrapolated between status messages so the progress bar moves smoothly. */
function usePosition(status: AgentStatus | null | undefined, at: string | null | undefined) {
  const now = useNow(500);
  if (!status?.current) return 0;
  if (status.state !== "playing" || !at) return status.current.positionSec;
  const p = status.current.positionSec + (now - new Date(at).getTime()) / 1000;
  return Math.min(p, status.current.durationSec || p);
}

export function NowPlaying({ status, at, compact }: { status: AgentStatus | null | undefined; at?: string | null; compact?: boolean }) {
  const { t, lang } = usePrefs();
  const pos = usePosition(status, at);
  const cur = status?.current;
  if (!cur) {
    return (
      <div className={cx("flex items-center gap-3 text-ink-3", compact ? "" : "py-2")}>
        <Waves className="size-5" />
        <span className="text-sm">{t("لا يوجد تشغيل الآن", "Nothing playing")}</span>
      </div>
    );
  }
  const pct = cur.durationSec ? Math.min(100, (pos / cur.durationSec) * 100) : 0;
  const isAdhan = cur.priority === "ADHAN";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={priorityTone(cur.priority)}>{L.priority(cur.priority, lang)}</Badge>
        {status?.state === "paused" && <Badge>{t("متوقف مؤقتًا", "Paused")}</Badge>}
        <span className="text-xs text-ink-3">{L.source(cur.source, lang)}</span>
      </div>
      <p className={cx("mt-2 font-semibold leading-snug", compact ? "text-base" : "text-lg")}>{cur.title}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)}>
        <div className={cx("h-full rounded-full transition-[width] duration-500", isAdhan ? "bg-sodium" : "bg-petrol")} style={{ width: `${pct}%` }} />
      </div>
      <div className="tnum mt-1.5 flex justify-between text-xs text-ink-3">
        <span>{fmtDuration(pos)}</span>
        <span>{fmtDuration(cur.durationSec)}</span>
      </div>
    </div>
  );
}

export function describeResult(r: CommandResponse, t: (a: string, e: string) => string): [string, "ok" | "fault" | "neutral"] {
  if (!r.delivered) return [t("الجهاز غير متصل الآن — سيُنفَّذ الأمر إذا عاد الاتصال خلال مهلة الأمر.", "Device is offline — the command runs if it reconnects before it expires."), "neutral"];
  if (!r.ack) return [t("أُرسل الأمر ولم يصل تأكيد الجهاز بعد.", "Sent; waiting for the device to confirm."), "neutral"];
  if (!r.ack.ok) return [r.ack.error || t("رفض الجهاز الأمر", "The device rejected the command"), "fault"];
  const state = r.ack.result?.state;
  const reason = r.ack.result?.reason;
  if (state === "queued") {
    if (reason === "adhan_in_progress") return [t("في الانتظار: سيعمل بعد انتهاء الأذان.", "Queued: plays after the adhan ends."), "neutral"];
    if (reason === "quiet_period") return [t("في الانتظار: فترة الهدوء بعد الأذان.", "Queued: post-adhan quiet period."), "neutral"];
    return [t("في الانتظار: سيعمل بعد الصوت الحالي.", "Queued: plays after the current audio."), "neutral"];
  }
  return [t("تم التنفيذ على الجهاز.", "Done on the device."), "ok"];
}

export function ControlDeck({ device, status, statusAt }: { device: Device; status: AgentStatus | null; statusAt?: string | null }) {
  const { t, lang } = usePrefs();
  const { can } = useAuth();
  const { toast } = useFeedback();
  const isAdmin = can("SUPER_ADMIN");
  const { data: filesData } = useApi<{ files: AudioFile[] }>("/api/files");
  const { data: settingsData } = useApi<{ settings: SystemSettings }>("/api/settings");
  const [fileId, setFileId] = useState("");
  const [priority, setPriority] = useState<"ANNOUNCEMENT" | "GENERAL" | "EMERGENCY">("ANNOUNCEMENT");
  const [busy, setBusy] = useState<string | null>(null);
  const roleMax = isAdmin ? 100 : settingsData?.settings.managerMaxVolume ?? 80;
  const maxVol = Math.min(device.maxVolume, roleMax);
  const liveVol = status?.volume ?? device.volume;
  const [vol, setVol] = useState(liveVol);
  const step = settingsData?.settings.volumeStep ?? 5;
  useEffect(() => setVol(liveVol), [liveVol]);

  const files = useMemo(() => (filesData?.files ?? []).filter((f) => f.category !== "ADHAN"), [filesData]);
  const chosen = files.find((f) => f.id === fileId);
  const canEmergency = isAdmin || (chosen && ["SAFETY", "ADMIN_ALERT"].includes(chosen.category));
  useEffect(() => {
    if (priority === "EMERGENCY" && !canEmergency) setPriority("ANNOUNCEMENT");
  }, [canEmergency, priority]);

  const playing = status?.current;
  const adhanNow = playing?.priority === "ADHAN";
  const offline = !device.isOnline;

  async function run(type: string, payload: Record<string, unknown> = {}, label = type) {
    setBusy(label);
    try {
      const r = await sendCommand(device.id, type, payload);
      const [msg, tone] = describeResult(r, t);
      toast(msg, tone);
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface-2/50 p-4">
        <NowPlaying status={status} at={statusAt} />
        {!!status?.queue?.length && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-2 text-xs font-medium text-ink-3">{t("في الانتظار", "Up next")}</p>
            <ol className="space-y-1.5">
              {status.queue.map((q) => (
                <li key={q.key} className="flex items-center gap-2 text-sm">
                  <Badge tone={priorityTone(q.priority)}>{L.priority(q.priority, lang)}</Badge>
                  <span className="truncate">{q.title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* choose & play */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Select value={fileId} onChange={(e) => setFileId(e.target.value)} aria-label={t("اختيار ملف صوتي", "Choose audio file")}>
          <option value="">{t("اختيار ملف صوتي…", "Choose an audio file…")}</option>
          {CATEGORIES.filter((c) => c !== "ADHAN").map((c) => {
            const list = files.filter((f) => f.category === c);
            return list.length ? (
              <optgroup key={c} label={L.category(c, lang)}>
                {list.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title} ({fmtDuration(f.durationSec)})
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} aria-label={t("الأولوية", "Priority")} className="sm:w-40">
          <option value="ANNOUNCEMENT">{t("إعلان", "Announcement")}</option>
          <option value="GENERAL">{t("صوت عام", "General")}</option>
          {canEmergency && <option value="EMERGENCY">{t("طوارئ", "Emergency")}</option>}
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<Play className="size-4" />}
          disabled={!fileId || !!busy}
          loading={busy === "play"}
          onClick={() => run("play", { fileId, priority }, "play")}
        >
          {t("تشغيل", "Play")}
        </Button>
        {status?.state === "paused" ? (
          <Button icon={<Play className="size-4" />} loading={busy === "resume"} disabled={!!busy} onClick={() => run("resume", {}, "resume")}>
            {t("استئناف", "Resume")}
          </Button>
        ) : (
          <Button
            icon={<Pause className="size-4" />}
            loading={busy === "pause"}
            disabled={!playing || (adhanNow && !isAdmin) || !!busy}
            onClick={() => run("pause", {}, "pause")}
          >
            {t("إيقاف مؤقت", "Pause")}
          </Button>
        )}
        <Button
          icon={<Square className="size-4" />}
          loading={busy === "stop"}
          disabled={(!playing && !status?.queue?.length) || (adhanNow && !isAdmin) || !!busy}
          onClick={() => run("stop", { includeAdhan: adhanNow && isAdmin, clearQueue: true }, "stop")}
          title={adhanNow && !isAdmin ? t("لا يمكن إيقاف الأذان إلا من مدير النظام", "Only a Super Admin can stop the adhan") : undefined}
        >
          {adhanNow ? t("إيقاف الأذان", "Stop adhan") : t("إيقاف", "Stop")}
        </Button>
        <Button icon={<Waves className="size-4" />} loading={busy === "test"} disabled={!!busy} onClick={() => run("test_speakers", {}, "test")}>
          {t("اختبار السماعات", "Test speakers")}
        </Button>
      </div>

      {/* volume */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink-2">{t("مستوى الصوت", "Volume")}</span>
          {maxVol < 100 && (
            <span className="text-xs text-ink-3">
              {t("الحد المسموح", "Limit")} <bdi dir="ltr">{maxVol}%</bdi>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" aria-label={t("خفض الصوت", "Volume down")} disabled={!!busy} onClick={() => run("volume_step", { delta: -step }, "vdown")}>
            <Volume1 className="size-4" />
          </Button>
          <div className="flex-1">
            <VolumeSlider label={t("مستوى الصوت", "Volume")} value={vol} max={maxVol} onChange={setVol} onCommit={(v) => v !== liveVol && run("volume", { level: v }, "vol")} />
          </div>
          <Button size="sm" variant="ghost" aria-label={t("رفع الصوت", "Volume up")} disabled={!!busy || liveVol >= maxVol} onClick={() => run("volume_step", { delta: step }, "vup")}>
            <Volume2 className="size-4" />
          </Button>
        </div>
      </div>

      {offline && (
        <p className="rounded-lg bg-fault-soft px-3 py-2 text-sm text-fault">
          {t("جهاز التشغيل غير متصل بالخادم. الأذان والجداول المخزنة تعمل محليًا، لكن الأوامر المباشرة لن تصل حتى يعود الاتصال.", "The playback device is offline. Stored adhan and schedules keep running locally, but live commands wait until it reconnects.")}
        </p>
      )}
    </div>
  );
}
