"use client";
import { CloudOff, ScrollText } from "lucide-react";
import { useState } from "react";
import { priorityTone } from "@/components/control-deck";
import { Badge, Button, cx, Empty, ErrorNote, Loading, PageHeader, Panel, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useDevices } from "@/lib/devices";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { L } from "@/lib/labels";
import { useLiveEvent } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { PlaybackRow } from "@/lib/types";

const STATUS_TONE: Record<string, "ok" | "fault" | "neutral" | "petrol" | "sodium"> = {
  COMPLETED: "ok",
  STARTED: "petrol",
  QUEUED: "neutral",
  INTERRUPTED: "sodium",
  FAILED: "fault",
  SKIPPED: "fault",
};

const AUDIT_LABELS: Record<string, [string, string]> = {
  "auth.login": ["تسجيل دخول", "Signed in"],
  "auth.logout": ["تسجيل خروج", "Signed out"],
  "auth.login_failed": ["محاولة دخول فاشلة", "Failed sign-in"],
  "auth.account_locked": ["قفل حساب بعد محاولات فاشلة", "Account locked"],
  "auth.password_changed": ["تغيير كلمة المرور", "Password changed"],
  "user.create": ["إنشاء مستخدم", "User created"],
  "user.update": ["تعديل مستخدم", "User updated"],
  "user.delete": ["حذف مستخدم", "User deleted"],
  "user.reset_password": ["إعادة تعيين كلمة مرور", "Password reset"],
  "file.upload": ["رفع ملف", "File uploaded"],
  "file.update": ["تعديل ملف", "File edited"],
  "file.delete": ["حذف ملف", "File deleted"],
  "schedule.create": ["إنشاء جدولة", "Schedule created"],
  "schedule.update": ["تعديل جدولة", "Schedule edited"],
  "schedule.pause": ["إيقاف جدولة مؤقتًا", "Schedule paused"],
  "schedule.resume": ["استئناف جدولة", "Schedule resumed"],
  "schedule.delete": ["حذف جدولة", "Schedule deleted"],
  "device.create": ["إضافة جهاز", "Device added"],
  "device.update": ["تعديل جهاز", "Device edited"],
  "device.revoke": ["إلغاء صلاحية جهاز", "Device revoked"],
  "device.rotate_token": ["رمز جهاز جديد", "Device token rotated"],
  "device.delete": ["حذف جهاز", "Device deleted"],
  "prayer.settings_update": ["تعديل موقع/طريقة الحساب", "Prayer location/method changed"],
  "prayer.config_update": ["تعديل إعدادات أذان", "Adhan settings changed"],
  "prayer.override_set": ["تعديل وقت صلاة ليوم", "Prayer time adjusted"],
  "prayer.override_delete": ["حذف تعديل وقت", "Adjustment removed"],
  "prayer.calendar_import": ["استيراد تقويم أم القرى", "Calendar imported"],
  "prayer.adhan_test": ["اختبار أذان", "Adhan test"],
  "settings.update": ["تعديل إعدادات النظام", "System settings changed"],
};

function auditLabel(action: string, lang: string) {
  const p = AUDIT_LABELS[action];
  if (p) return lang === "ar" ? p[0] : p[1];
  if (action.startsWith("control.broadcast.")) return (lang === "ar" ? "بث: " : "Broadcast: ") + action.split(".").pop();
  if (action.startsWith("control.")) return (lang === "ar" ? "أمر تحكم: " : "Control: ") + action.slice(8);
  return action;
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const { t } = usePrefs();
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-ink-3">
      <span className="tnum">{t(`${total} سجل`, `${total} entries`)}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("السابق", "Previous")}</Button>
        <span className="tnum">{page} / {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("التالي", "Next")}</Button>
      </div>
    </div>
  );
}

function PlaybackLog() {
  const { t, lang, locale } = usePrefs();
  const { devices } = useDevices();
  const [page, setPage] = useState(1);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const qs = new URLSearchParams({ page: String(page), pageSize: "50", ...(source && { source }), ...(status && { status }), ...(deviceId && { deviceId }) });
  const { data, error, loading, reload } = useApi<{ total: number; rows: PlaybackRow[] }>(`/api/logs/playback?${qs}`, [qs.toString()]);
  useLiveEvent(["playback"], () => page === 1 && void reload());

  return (
    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
        <Select className="h-9 w-auto" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} aria-label={t("المصدر", "Source")}>
          <option value="">{t("كل المصادر", "All sources")}</option>
          {["ADHAN", "SCHEDULE", "MANUAL", "TEST"].map((s) => <option key={s} value={s}>{L.source(s, lang)}</option>)}
        </Select>
        <Select className="h-9 w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={t("الحالة", "Status")}>
          <option value="">{t("كل الحالات", "All statuses")}</option>
          {["COMPLETED", "STARTED", "INTERRUPTED", "FAILED", "SKIPPED", "QUEUED"].map((s) => <option key={s} value={s}>{L.status(s, lang)}</option>)}
        </Select>
        {devices.length > 1 && (
          <Select className="h-9 w-auto" value={deviceId} onChange={(e) => { setDeviceId(e.target.value); setPage(1); }} aria-label={t("الجهاز", "Device")}>
            <option value="">{t("كل الأجهزة", "All devices")}</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        )}
      </div>
      {loading && !data ? <Loading /> : error ? <div className="p-5"><ErrorNote error={error} /></div> : !data?.rows.length ? (
        <Empty icon={<ScrollText className="size-8" />} title={t("لا توجد سجلات تشغيل", "No playback yet")} body={t("يظهر هنا كل أذان وإعلان شُغّل، مع حالته ووقته.", "Every adhan and announcement played shows up here with its outcome.")} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-[12.5px] text-ink-3">
                  <th className="px-5 py-2.5 text-start font-medium">{t("الوقت", "Time")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("الصوت", "Audio")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("المصدر", "Source")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("الجهاز", "Device")}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{t("المدة", "Duration")}</th>
                  <th className="px-5 py-2.5 text-start font-medium">{t("النتيجة", "Result")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="tnum whitespace-nowrap px-5 py-2.5">{fmtDateTime(r.startedAt ?? r.endedAt ?? r.receivedAt, locale)}</td>
                    <td className="max-w-64 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Badge tone={priorityTone(r.priority)}>{L.priority(r.priority, lang)}</Badge>
                        <span className="truncate">{r.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{L.source(r.source, lang)}</td>
                    <td className="px-3 py-2.5 text-ink-2">{r.device?.name}</td>
                    <td className="tnum px-3 py-2.5 text-ink-2">{r.startedAt && r.endedAt ? fmtDuration((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) : "—"}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <Badge tone={STATUS_TONE[r.status]}>{L.status(r.status, lang)}</Badge>
                        {r.offline && <span title={t("نُفّذ أثناء انقطاع الاتصال ثم زُومن", "Ran while offline, synced later")}><CloudOff className="size-3.5 text-ink-3" /></span>}
                      </div>
                      {r.error && <p className="mt-0.5 max-w-72 text-xs text-ink-3">{r.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} size={50} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function AuditLog() {
  const { t, lang, locale } = usePrefs();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<{ total: number; rows: any[] }>(`/api/logs/audit?page=${page}&pageSize=50`, [page]);
  return (
    <Panel bodyClassName="p-0">
      {loading && !data ? <Loading /> : error ? <div className="p-5"><ErrorNote error={error} /></div> : (
        <>
          <ul className="divide-y divide-line">
            {data?.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className={cx("font-medium", r.action.includes("failed") || r.action.includes("locked") ? "text-fault" : "")}>{auditLabel(r.action, lang)}</span>
                  <span className="ms-2 text-ink-3">{r.username ?? t("نظام", "system")}</span>
                  {r.details?.title && <span className="ms-2 text-ink-2">— {r.details.title}</span>}
                  {r.details?.name && <span className="ms-2 text-ink-2">— {r.details.name}</span>}
                </div>
                <span className="tnum shrink-0 text-xs text-ink-3">{fmtDateTime(r.createdAt, locale)} <span dir="ltr">{r.ip}</span></span>
              </li>
            ))}
          </ul>
          <Pager page={page} total={data?.total ?? 0} size={50} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

export default function LogsPage() {
  const { t } = usePrefs();
  const { can } = useAuth();
  const [tab, setTab] = useState<"playback" | "audit">("playback");
  return (
    <div className="space-y-5">
      <PageHeader title={t("سجل التشغيل", "Activity log")} description={t("ما شُغّل على السماعات، ومن قام بأي عملية في النظام.", "What played on the speakers, and who did what in the system.")} />
      {can("SUPER_ADMIN") && (
        <div className="flex rounded-lg border border-line bg-surface p-0.5 text-sm w-fit" role="tablist">
          <button role="tab" aria-selected={tab === "playback"} onClick={() => setTab("playback")} className={cx("rounded-md px-4 py-1.5", tab === "playback" ? "bg-petrol-soft font-medium text-petrol" : "text-ink-2")}>{t("سجل التشغيل الصوتي", "Playback")}</button>
          <button role="tab" aria-selected={tab === "audit"} onClick={() => setTab("audit")} className={cx("rounded-md px-4 py-1.5", tab === "audit" ? "bg-petrol-soft font-medium text-petrol" : "text-ink-2")}>{t("عمليات المستخدمين", "User actions")}</button>
        </div>
      )}
      {tab === "playback" ? <PlaybackLog /> : <AuditLog />}
    </div>
  );
}
