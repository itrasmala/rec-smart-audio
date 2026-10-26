"use client";
import { AlertTriangle, Cpu } from "lucide-react";
import Link from "next/link";
import { ControlDeck, priorityTone } from "@/components/control-deck";
import { PrayerTrack } from "@/components/prayer-track";
import { Badge, cx, Dot, Empty, ErrorNote, Loading, Panel, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useDevices, useSelectedDevice } from "@/lib/devices";
import { fmtDateTime, relative } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { L } from "@/lib/labels";
import { useLive, useLiveEvent } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { PlaybackRow, PrayerDay, PrayerEntry } from "@/lib/types";

interface Dashboard {
  serverTime: string;
  orgName: string;
  prayers: { timezone: string; today: PrayerDay; tomorrow: PrayerDay; next: PrayerEntry | null; nextAdhan: PrayerEntry | null };
  lastPlayback: PlaybackRow | null;
  counts: { files: number; activeSchedules: number; users: number };
}

function Cell({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "fault" | "sodium" }) {
  return (
    <div className="min-w-0 bg-surface px-5 py-4">
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd className={cx("mt-1 truncate text-[15px] font-medium", tone === "fault" && "text-fault", tone === "sodium" && "text-sodium-ink")}>{children}</dd>
    </div>
  );
}

export default function DashboardPage() {
  const { t, lang, locale } = usePrefs();
  const { can } = useAuth();
  const { connected } = useLive();
  const { data, error, loading, reload, setData } = useApi<Dashboard>("/api/dashboard");
  const { devices } = useDevices();
  const { selected, select, active } = useSelectedDevice(devices);
  useLiveEvent(["playback"], (m) => {
    if (m.entry?.status === "STARTED" || m.entry?.status === "COMPLETED") setData((d) => (d ? { ...d, lastPlayback: m.entry } : d));
  });
  useLiveEvent(["settings"], () => void reload());

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  // after the last prayer of the day, roll over to tomorrow's track
  const allPassed = data.prayers.today.prayers.every((p) => new Date(p.at).getTime() < Date.now());
  const trackDay = allPassed ? data.prayers.tomorrow : data.prayers.today;
  const st = selected?.lastStatus ?? null;
  const onlineCount = active.filter((d) => d.isOnline).length;
  const outputOk = st?.output?.ok;
  const last = data.lastPlayback;

  return (
    <div className="space-y-6">
      <PrayerTrack today={trackDay} next={data.prayers.next} tz={data.prayers.timezone} hijri={(data.prayers as any).hijri} />

      {active.length === 0 ? (
        <Panel>
          <Empty
            icon={<Cpu className="size-8" />}
            title={t("لا يوجد جهاز تشغيل بعد", "No playback device yet")}
            body={t("أضف جهاز التشغيل الموجود في الداتا سنتر ليبدأ تشغيل الأذان والإعلانات على السماعات.", "Add the playback machine in the data center so it can start playing the adhan and announcements.")}
            action={can("SUPER_ADMIN") ? <Link href="/devices/" className="font-medium text-petrol underline">{t("إضافة جهاز", "Add a device")}</Link> : undefined}
          />
        </Panel>
      ) : (
        <>
          {/* instrument panel */}
          <section className="rounded-[10px] border border-line bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <h2 className="text-[15px] font-semibold">{t("حالة النظام", "System status")}</h2>
              {active.length > 1 && (
                <Select value={selected?.id} onChange={(e) => select(e.target.value)} className="h-9 w-auto min-w-48" aria-label={t("الجهاز", "Device")}>
                  {active.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.isOnline ? "" : `(${t("غير متصل", "offline")})`}
                    </option>
                  ))}
                </Select>
              )}
            </header>
            <dl className="grid gap-px overflow-hidden rounded-b-[10px] bg-line sm:grid-cols-2 lg:grid-cols-3 sm:[&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
              <Cell label={t("حالة النظام", "System")} tone={selected?.isOnline && connected ? undefined : "fault"}>
                <span className="inline-flex items-center gap-2">
                  <Dot tone={selected?.isOnline ? "ok" : "fault"} />
                  {selected?.isOnline ? t("متصل", "Online") : t("غير متصل", "Offline")}
                  <span className="text-[13px] font-normal text-ink-3">
                    ({onlineCount}/{active.length} {t("أجهزة", "devices")})
                  </span>
                </span>
              </Cell>
              <Cell label={t("حالة السماعات", "Speakers")} tone={outputOk === false ? "fault" : undefined}>
                {st ? (outputOk ? t("تعمل", "Working") : st.output?.error || t("خلل في مخرج الصوت", "Output fault")) : "—"}
              </Cell>
              <Cell label={t("الجهاز المستخدم حاليًا", "Active device")}>
                {selected?.name}
                <span className="block truncate text-[13px] font-normal text-ink-3">
                  {st?.output?.name ?? selected?.speakerName ?? L.output(selected?.outputType ?? "UNKNOWN", lang)}
                </span>
              </Cell>
              <Cell label={t("الصوت الجاري تشغيله", "Now playing")} tone={st?.current?.priority === "ADHAN" ? "sodium" : undefined}>
                {st?.current ? (
                  <span className="inline-flex items-center gap-2">
                    {st.state === "playing" && <Dot tone={st.current.priority === "ADHAN" ? "sodium" : "petrol"} live />}
                    {st.current.title}
                  </span>
                ) : (
                  <span className="text-ink-3">{t("لا شيء", "Nothing")}</span>
                )}
              </Cell>
              <Cell label={t("مستوى الصوت الحالي", "Current volume")}>
                <span className="tnum">{st?.volume ?? selected?.volume ?? "—"}%</span>
              </Cell>
              <Cell label={t("الصلاة القادمة", "Next prayer")}>
                {data.prayers.next ? `${L.prayer(data.prayers.next.prayer, lang)} — ${data.prayers.next.localTime}` : "—"}
              </Cell>
              <Cell label={t("آخر عملية تشغيل", "Last playback")}>
                {last ? (
                  <>
                    {last.title}
                    <span className="block text-[13px] font-normal text-ink-3">
                      {L.status(last.status, lang)} · {fmtDateTime(last.startedAt, locale)}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </Cell>
              <Cell label={t("الاتصال بالإنترنت", "Internet")} tone={st?.internet === false ? "fault" : undefined}>
                {st?.internet == null ? "—" : st.internet ? t("متصل", "Connected") : t("منقطع — يعمل محليًا", "Down — running locally")}
              </Cell>
              <Cell label={t("آخر اتصال للجهاز", "Device last seen")}>{relative(selected?.lastSeenAt ?? null, lang)}</Cell>
            </dl>
          </section>

          {(st?.lastError || selected?.lastError) && (
            <div className="flex items-start gap-3 rounded-[10px] border border-fault/30 bg-fault-soft px-5 py-3 text-sm text-fault">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{st?.lastError ?? selected?.lastError}</span>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            {can("SUPER_ADMIN", "AUDIO_MANAGER") && selected ? (
              <Panel title={t("التحكم السريع", "Quick control")} description={selected.name}>
                <ControlDeck device={selected} status={st} statusAt={(selected as any).statusAt} />
              </Panel>
            ) : null}
            <Panel title={t("الأحداث القادمة على الجهاز", "Upcoming on this device")} bodyClassName="p-0">
              {st?.nextEvents?.length ? (
                <ul className="divide-y divide-line">
                  {st.nextEvents.map((e) => (
                    <li key={e.key} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.title}</p>
                        <Badge tone={priorityTone(e.priority)} className="mt-1">
                          {L.priority(e.priority, lang)}
                        </Badge>
                      </div>
                      <span className="tnum shrink-0 text-sm text-ink-2">{fmtDateTime(e.at, locale)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title={t("لا توجد أحداث قادمة", "Nothing scheduled")} body={t("تظهر هنا أوقات الأذان والإعلانات المجدولة كما يراها الجهاز.", "Adhan times and scheduled announcements appear here as the device sees them.")} />
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
