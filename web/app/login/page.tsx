"use client";
import { useState } from "react";
import { BrandMark } from "@/components/shell";
import { Button, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";

export default function LoginPage() {
  const { t, lang, setLang } = usePrefs();
  const { refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { username, password });
      await refresh();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <div className="relative hidden overflow-hidden bg-side lg:block">
        {/* sound-wave rings: the PA system radiating through the building */}
        <svg viewBox="0 0 600 600" className="absolute -bottom-40 -start-40 size-[900px] opacity-[0.16]" aria-hidden>
          {[80, 140, 200, 260, 320, 380].map((r, i) => (
            <circle key={r} cx="300" cy="300" r={r} fill="none" stroke={i === 2 ? "var(--sodium)" : "#c9d4da"} strokeWidth={i === 2 ? 3 : 1.5} />
          ))}
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12 text-side-ink">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10" />
            <span className="text-lg font-semibold text-white" dir="ltr">
              REC Smart Audio
            </span>
          </div>
          <div className="max-w-md">
            <p className="text-3xl font-semibold leading-snug text-white">
              {t("الأذان والإعلانات في كل ممرات المبنى، من أي مكان.", "Adhan and announcements across every corridor — from anywhere.")}
            </p>
            <p className="mt-4 text-sm leading-7 opacity-75">
              {t(
                "نظام الإذاعة الداخلية لمؤسسة رسملة الطاقة للمقاولات. يستمر الأذان في وقته حتى لو انقطع الإنترنت.",
                "The internal PA system of Rasmala Energy Contracting. The adhan keeps playing on time even when the internet is down.",
              )}
            </p>
          </div>
          <div className="text-xs opacity-50">{t("رسملة الطاقة للمقاولات", "Rasmala Energy Contracting")}</div>
        </div>
      </div>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-10" />
            <div className="leading-tight">
              <div className="font-semibold" dir="ltr">
                REC Smart Audio
              </div>
              <div className="text-xs text-ink-3">{t("رسملة الطاقة للمقاولات", "Rasmala Energy Contracting")}</div>
            </div>
          </div>
          <h1 className="text-2xl font-semibold">{t("تسجيل الدخول", "Sign in")}</h1>
          <p className="mt-1 text-sm text-ink-3">{t("استخدم حسابك في لوحة التحكم.", "Use your control-panel account.")}</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label={t("اسم المستخدم", "Username")}>
              {(id) => (
                <Input id={id} autoComplete="username" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
              )}
            </Field>
            <Field label={t("كلمة المرور", "Password")}>
              {(id) => (
                <Input id={id} type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required />
              )}
            </Field>
            {error && <p className="rounded-lg bg-fault-soft px-3 py-2 text-sm text-fault">{error}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              {t("دخول", "Sign in")}
            </Button>
          </form>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="mt-8 text-sm text-ink-3 hover:text-ink">
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </div>
      </div>
    </div>
  );
}
