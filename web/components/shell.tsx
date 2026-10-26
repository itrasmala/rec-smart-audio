"use client";
import {
  CalendarClock,
  Cpu,
  Gauge,
  Library,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Sun,
  SunMoon,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { L } from "@/lib/labels";
import { useLive } from "@/lib/live";
import { usePrefs } from "@/lib/prefs";
import type { Role } from "@/lib/types";
import { cx, Dot, Loading } from "./ui";

function PrayerIcon(props: { className?: string }) {
  // crescent over a minaret line — the prayer-times entry
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15.5 3.5a5 5 0 1 0 4.5 7 4 4 0 0 1-4.5-7Z" />
      <path d="M6 21V11l3-3 3 3v10" />
      <path d="M3 21h18" />
    </svg>
  );
}

interface NavItem {
  href: string;
  ar: string;
  en: string;
  icon: LucideIcon | typeof PrayerIcon;
  roles: Role[];
}

const NAV: NavItem[] = [
  { href: "/", ar: "الرئيسية", en: "Overview", icon: Gauge, roles: [] },
  { href: "/control/", ar: "التحكم المباشر", en: "Live control", icon: SlidersHorizontal, roles: ["SUPER_ADMIN", "AUDIO_MANAGER"] },
  { href: "/prayers/", ar: "أوقات الصلاة", en: "Prayer times", icon: PrayerIcon, roles: [] },
  { href: "/library/", ar: "مكتبة الصوتيات", en: "Audio library", icon: Library, roles: ["SUPER_ADMIN", "AUDIO_MANAGER"] },
  { href: "/schedules/", ar: "جدولة الإعلانات", en: "Schedules", icon: CalendarClock, roles: ["SUPER_ADMIN", "AUDIO_MANAGER"] },
  { href: "/devices/", ar: "الأجهزة والسماعات", en: "Devices & speakers", icon: Cpu, roles: [] },
  { href: "/users/", ar: "المستخدمون والصلاحيات", en: "Users & roles", icon: Users, roles: ["SUPER_ADMIN"] },
  { href: "/logs/", ar: "سجل التشغيل", en: "Activity log", icon: ScrollText, roles: [] },
  { href: "/settings/", ar: "الإعدادات", en: "Settings", icon: Settings, roles: [] },
];

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="9" fill="var(--petrol)" />
      <path d="M11 16h4l6-5v18l-6-5h-4z" fill="#fff" />
      <path d="M25 15.5a6.5 6.5 0 0 1 0 9" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M28.5 12a11.5 11.5 0 0 1 0 16" stroke="var(--sodium)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() || "/";
  const { lang } = usePrefs();
  const { can } = useAuth();
  const norm = (p: string) => (p.endsWith("/") ? p : `${p}/`);
  return (
    <nav className="flex h-full flex-col bg-side text-side-ink">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <BrandMark className="size-9 shrink-0" />
        <div className="min-w-0 leading-tight">
          <div className="text-[15px] font-semibold text-white" dir="ltr">
            REC Smart Audio
          </div>
          <div className="truncate text-xs opacity-70">{lang === "ar" ? "رسملة الطاقة للمقاولات" : "Rasmala Energy Contracting"}</div>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.filter((n) => can(...n.roles)).map((n) => {
          const active = n.href === "/" ? pathname === "/" : norm(pathname).startsWith(n.href);
          const Icon = n.icon;
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] transition-colors",
                  active ? "bg-side-active font-medium text-white" : "hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className={cx("size-[18px] shrink-0", active && "text-sodium")} />
                {lang === "ar" ? n.ar : n.en}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="px-5 py-4 text-[11px] opacity-50" dir="ltr">
        v1.0.0
      </div>
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : SunMoon;
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-paper/90 px-4 backdrop-blur md:px-6">
      <button onClick={onMenu} className="-ms-1 rounded-md p-2 text-ink-2 hover:bg-surface-2 lg:hidden" aria-label={t("القائمة", "Menu")}>
        <Menu className="size-5" />
      </button>
      <div
        className="flex items-center gap-2 text-[13px] text-ink-3"
        title={connected ? t("التحديث المباشر يعمل", "Live updates connected") : t("إعادة الاتصال…", "Reconnecting…")}
      >
        <Dot tone={connected ? "ok" : "fault"} live={connected} />
        <span className="hidden sm:inline">{connected ? t("مباشر", "Live") : t("غير متصل — إعادة المحاولة", "Offline — retrying")}</span>
      </div>
      <div className="ms-auto flex items-center gap-1">
        <button
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          className="h-9 rounded-md px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2"
          aria-label="language"
        >
          {lang === "ar" ? "English" : "العربية"}
        </button>
        <button
          onClick={() => setTheme(nextTheme)}
          className="rounded-md p-2 text-ink-2 hover:bg-surface-2"
          title={theme === "system" ? t("حسب النظام", "System") : theme === "dark" ? t("ليلي", "Dark") : t("نهاري", "Light")}
          aria-label={t("تبديل المظهر", "Toggle theme")}
        >
          <ThemeIcon className="size-[18px]" />
        </button>
        {user && (
          <div className="ms-2 flex items-center gap-3 border-s border-line ps-3">
            <div className="hidden text-end leading-tight sm:block">
              <div className="text-[13px] font-medium">{user.displayName}</div>
              <div className="text-[11px] text-ink-3">{L.role(user.role, lang)}</div>
            </div>
            <button onClick={() => void logout()} className="rounded-md p-2 text-ink-2 hover:bg-surface-2" title={t("تسجيل الخروج", "Sign out")} aria-label={t("تسجيل الخروج", "Sign out")}>
              <LogOut className="size-[18px] rtl:-scale-x-100" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = usePrefs();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  if (pathname?.startsWith("/login") || pathname?.startsWith("/setup")) return <>{children}</>;
  if (loading || !user) return <Loading />;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden bg-side lg:block">
        <div className="sticky top-0 h-dvh">
        <Sidebar />
        </div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-[#0b141a]/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-[272px] max-w-[85vw]">
            <button onClick={() => setOpen(false)} className="absolute end-3 top-5 z-10 rounded p-1 text-white/70" aria-label={t("إغلاق", "Close")}>
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        <TopBar onMenu={() => setOpen(true)} />
        {user.mustChangePassword && (
          <div className="border-b border-sodium/40 bg-sodium-soft px-6 py-2.5 text-sm text-sodium-ink">
            {t("يجب تغيير كلمة المرور المؤقتة.", "Please change your temporary password.")}{" "}
            <Link href="/settings/" className="font-semibold underline">
              {t("تغيير كلمة المرور", "Change password")}
            </Link>
          </div>
        )}
        <main className="mx-auto max-w-[1320px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
