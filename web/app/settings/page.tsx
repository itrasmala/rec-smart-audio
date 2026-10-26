"use client";
import { useEffect, useState } from "react";
import { Button, cx, Field, Input, Loading, PageHeader, Panel, Toggle, useFeedback, VolumeSlider } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { usePrefs, type Theme } from "@/lib/prefs";
import type { SystemSettings } from "@/lib/types";

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex w-fit rounded-lg border border-line p-0.5 text-sm">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cx("rounded-md px-3.5 py-1.5", value === v ? "bg-petrol-soft font-medium text-petrol" : "text-ink-2")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function PasswordPanel() {
  const { t } = usePrefs();
  const { toast } = useFeedback();
  const { refresh, logout } = useAuth();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const mismatch = f.confirm.length > 0 && f.confirm !== f.newPassword;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword: f.currentPassword, newPassword: f.newPassword });
      toast(t("تم تغيير كلمة المرور وإنهاء جلساتك الأخرى", "Password changed; your other sessions were ended"));
      setF({ currentPassword: "", newPassword: "", confirm: "" });
      await refresh();
    } catch (err) {
      toast((err as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }
  async function logoutAll() {
    await api.post("/api/auth/logout-all");
    await logout();
  }
  return (
    <Panel title={t("الأمان", "Security")}>
      <form onSubmit={save} className="grid max-w-xl gap-4">
        <Field label={t("كلمة المرور الحالية", "Current password")}>{(id) => <Input id={id} type="password" dir="ltr" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("كلمة المرور الجديدة", "New password")} hint={t("10 أحرف على الأقل، حروف وأرقام", "At least 10 chars, letters and digits")}>{(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} required />}</Field>
          <Field label={t("تأكيد كلمة المرور", "Confirm password")} error={mismatch ? t("غير متطابقة", "Doesn't match") : null}>{(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />}</Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={busy} disabled={mismatch || !f.newPassword}>{t("تغيير كلمة المرور", "Change password")}</Button>
          <Button type="button" variant="ghost" onClick={() => void logoutAll()}>{t("تسجيل الخروج من كل الأجهزة", "Sign out everywhere")}</Button>
        </div>
      </form>
    </Panel>
  );
}

function SystemPanel() {
  const { t } = usePrefs();
  const { toast } = useFeedback();
  const { data, reload } = useApi<{ settings: SystemSettings }>("/api/settings");
  const [f, setF] = useState<SystemSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(data?.settings ?? null), [data]);
  if (!f) return <Loading />;
  const set = (p: Partial<SystemSettings>) => setF({ ...f, ...p });
  const num = (k: keyof SystemSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: Number(e.target.value) } as Partial<SystemSettings>);

  async function save() {
    setBusy(true);
    try {
      const { configRevision: _r, ...body } = f!;
      delete (body as any).id;
      delete (body as any).updatedAt;
      await api.put("/api/settings", body);
      toast(t("تم حفظ الإعدادات وإرسالها لأجهزة التشغيل", "Saved and sent to playback devices"));
      void reload();
    } catch (e) {
      toast((e as Error).message, "fault");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t("سياسات التشغيل", "Playback policy")} description={t("تُطبَّق على جميع أجهزة التشغيل.", "Applies to all playback devices.")} actions={<Button variant="primary" size="sm" loading={busy} onClick={save}>{t("حفظ", "Save")}</Button>}>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <div className="space-y-5">
          <h3 className="text-sm font-semibold">{t("الأذان", "Adhan")}</h3>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">{t("مستوى صوت الأذان الافتراضي", "Default adhan volume")}</p>
            <VolumeSlider label={t("الصوت", "Volume")} value={f.defaultAdhanVolume} onChange={(v) => set({ defaultAdhanVolume: v })} />
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">{t("بعد انتهاء الأذان، الصوت الذي قُطع:", "After the adhan, interrupted audio:")}</p>
            <Seg
              value={f.postAdhanBehavior}
              onChange={(v) => set({ postAdhanBehavior: v })}
              options={[
                ["DISCARD", t("لا يُستأنف", "Is dropped")],
                ["RESUME", t("يُستأنف من موضعه", "Resumes")],
                ["RESTART", t("يُعاد من البداية", "Restarts")],
              ]}
            />
          </div>
          <Field label={t("فترة هدوء بعد الأذان (دقائق)", "Quiet period after adhan (minutes)")} hint={t("لا تُشغَّل الإعلانات والصوتيات العامة خلالها — تنتظر في الطابور. 0 لتعطيلها.", "Announcements and general audio wait during it. 0 to disable.")}>
            {(id) => <Input id={id} type="number" dir="ltr" min={0} max={60} value={f.postAdhanQuietMinutes} onChange={num("postAdhanQuietMinutes")} className="w-32" />}
          </Field>
          <Field label={t("تعويض الأذان بعد انقطاع الجهاز (دقائق)", "Adhan catch-up after device outage (minutes)")} hint={t("إن عاد الجهاز للعمل بعد دخول الوقت بأقل من هذه المدة يُشغَّل الأذان، وإلا يُسجَّل «لم يُشغَّل».", "If the device comes back within this time after the prayer starts, the adhan plays; otherwise it is logged as skipped.")}>
            {(id) => <Input id={id} type="number" dir="ltr" min={0} max={30} value={f.adhanCatchUpMinutes} onChange={num("adhanCatchUpMinutes")} className="w-32" />}
          </Field>
        </div>

        <div className="space-y-5">
          <h3 className="text-sm font-semibold">{t("الطوارئ والصلاحيات", "Emergencies & limits")}</h3>
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">{t("السماح للطوارئ بمقاطعة الأذان", "Let emergencies interrupt the adhan")}</span>
              <span className="block text-xs text-ink-3">{t("الحالة الاستثنائية: فقط عندما يرسل مدير النظام تنبيه طوارئ ويختار المقاطعة صراحةً. خلاف ذلك ينتظر التنبيه انتهاء الأذان ثم يعمل فورًا.", "Exceptional case: only when a Super Admin sends an emergency and explicitly chooses to interrupt. Otherwise the alert waits for the adhan to end, then plays immediately.")}</span>
            </span>
            <Toggle checked={f.emergencyMayInterruptAdhan} onChange={(v) => set({ emergencyMayInterruptAdhan: v })} />
          </label>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">{t("أقصى مستوى صوت لمسؤول الصوتيات", "Maximum volume for Audio Managers")}</p>
            <VolumeSlider label={t("الحد", "Limit")} value={f.managerMaxVolume} onChange={(v) => set({ managerMaxVolume: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("خطوة رفع/خفض الصوت", "Volume step")}>{(id) => <Input id={id} type="number" dir="ltr" min={1} max={25} value={f.volumeStep} onChange={num("volumeStep")} />}</Field>
            <Field label={t("تعويض الجداول (دقائق)", "Schedule catch-up (min)")}>{(id) => <Input id={id} type="number" dir="ltr" min={0} max={60} value={f.scheduleCatchUpMinutes} onChange={num("scheduleCatchUpMinutes")} />}</Field>
            <Field label={t("صلاحية الصوت المنتظر (دقائق)", "Queued audio expires after (min)")}>{(id) => <Input id={id} type="number" dir="ltr" min={1} max={240} value={f.queuedItemTtlMinutes} onChange={num("queuedItemTtlMinutes")} />}</Field>
            <Field label={t("مهلة الأوامر المباشرة (ثوانٍ)", "Live command timeout (s)")}>{(id) => <Input id={id} type="number" dir="ltr" min={10} max={600} value={f.commandTtlSeconds} onChange={num("commandTtlSeconds")} />}</Field>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <h3 className="text-sm font-semibold">{t("الهوية", "Identity")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("اسم المؤسسة", "Organization")}>{(id) => <Input id={id} value={f.orgName} onChange={(e) => set({ orgName: e.target.value })} />}</Field>
            <Field label={t("اسم النظام", "System name")}>{(id) => <Input id={id} value={f.systemName} onChange={(e) => set({ systemName: e.target.value })} />}</Field>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const { can } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader title={t("الإعدادات", "Settings")} />
      <Panel title={t("العرض", "Display")}>
        <div className="flex flex-wrap gap-x-12 gap-y-5">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">{t("اللغة", "Language")}</p>
            <Seg value={lang} onChange={setLang} options={[["ar", "العربية"], ["en", "English"]]} />
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">{t("المظهر", "Theme")}</p>
            <Seg<Theme> value={theme} onChange={setTheme} options={[["light", t("نهاري", "Light")], ["dark", t("ليلي", "Dark")], ["system", t("حسب الجهاز", "System")]]} />
          </div>
        </div>
      </Panel>
      {can("SUPER_ADMIN") && <SystemPanel />}
      <PasswordPanel />
    </div>
  );
}
