"use client";
/**
 * UI preferences: language (ar default, en available) and theme (light / dark / system).
 * Translation uses inline pairs: t("نص عربي", "English text") — every string ships in both
 * languages next to each other, so adding English never leaves a screen half-translated.
 * To add a third language, extend `Lang` and switch `t` to a keyed dictionary.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ar" | "en";
export type Theme = "light" | "dark" | "system";

interface Prefs {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  t: (ar: string, en: string) => string;
  dir: "rtl" | "ltr";
  locale: string;
}

const Ctx = createContext<Prefs | null>(null);

function read<T extends string>(key: string, def: T): T {
  try {
    return (localStorage.getItem(key) as T) || def;
  } catch {
    return def;
  }
}

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Inline script (runs before paint) to avoid a light/dark flash. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem('rec.theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');var l=localStorage.getItem('rec.lang');if(l==='en'){document.documentElement.lang='en';document.documentElement.dir='ltr';}}catch(e){}})();`;

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    setLangState(read<Lang>("rec.lang", "ar"));
    setThemeState(read<Theme>("rec.theme", "system"));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme("system");
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [theme]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("rec.lang", l);
    } catch {}
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem("rec.theme", t);
    } catch {}
  }, []);

  const value = useMemo<Prefs>(
    () => ({
      lang,
      theme,
      setLang,
      setTheme,
      t: (ar, en) => (lang === "ar" ? ar : en),
      dir: lang === "ar" ? "rtl" : "ltr",
      locale: lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB",
    }),
    [lang, theme, setLang, setTheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error("PrefsProvider missing");
  return v;
}

export function useT() {
  return usePrefs().t;
}
