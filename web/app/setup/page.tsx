"use client";
import { useState } from "react";
import { BrandMark } from "@/components/shell";
import { Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";

/** First-run: create the first Super Admin from the browser (needs the one-time setup code). */
export default function SetupPage() {
  const { t, lang, setLang } = usePrefs();
  const { refresh } = useAuth();
  const [f, setF] = useState({ setupCode: "", displayName: "", username: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = f.confirm.length > 0 && f.confirm !== f.password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/setup", { setupCode: f.setupCode, displayName: f.displayName, username: f.username, password: f.password });
      await refresh();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark className="size-10" />
          <div className="leading-tight">
            <div className="font-semibold" dir="ltr">
              REC Smart Audio
            </div>
            <div className="text-xs text-ink-3">{t("رسملة الطاقة للمقاولات", "Rasmala Energy Contracting")}</div>
          </div>
        </div>
        <h1 className="text-2xl font-semibold">{t("إعداد النظام لأول مرة", "First-time setup")}</h1>
        <p className="mt-1 text-sm text-ink-3">
          {t(
            "أنشئ حساب مدير النظام. رمز الإعداد ظهر لك في نهاية التثبيت (وموجود في سجل الخادم).",
            "Create the Super Admin account. The setup code was shown at the end of installation (and is in the server log).",
          )}
        </p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label={t("رمز الإعداد", "Setup code")}>
            {(id) => (
              <Input id={id} dir="ltr" autoComplete="off" placeholder="XXXX-XXXX" value={f.setupCode} onChange={(e) => setF({ ...f, setupCode: e.target.value })} required autoFocus className="font-mono tracking-widest uppercase" />
            )}
          </Field>
          <Field label={t("اسمك", "Your name")}>
            {(id) => <Input id={id} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} placeholder={t("مدير النظام", "System administrator")} required />}
          </Field>
          <Field label={t("اسم المستخدم (لاتيني)", "Username")} hint={t("مثال: admin", "e.g. admin")}>
            {(id) => <Input id={id} dir="ltr" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("كلمة المرور", "Password")} hint={t("10 أحرف على الأقل، حروف وأرقام", "10+ chars, letters and digits")}>
              {(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />}
            </Field>
            <Field label={t("تأكيد كلمة المرور", "Confirm password")} error={mismatch ? t("غير متطابقة", "Doesn't match") : null}>
              {(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />}
            </Field>
          </div>
          {error && <p className="rounded-lg bg-fault-soft px-3 py-2 text-sm text-fault">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={mismatch}>
            {t("إنشاء الحساب والدخول", "Create account and sign in")}
          </Button>
        </form>
        <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="mt-8 text-sm text-ink-3 hover:text-ink">
          {lang === "ar" ? "English" : "العربية"}
        </button>
      </div>
    </div>
  );
}
