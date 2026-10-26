"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import type { Role, User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User }>("/api/auth/me");
      setUser(r.user);
      setNeedsSetup(false);
    } catch {
      setUser(null);
      const s = await api.get<{ needsSetup: boolean }>("/api/setup/status").catch(() => ({ needsSetup: false }));
      setNeedsSetup(s.needsSetup);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauth = () => {
      setUser(null);
      router.replace("/login/");
    };
    window.addEventListener("rec:unauthorized", onUnauth);
    return () => window.removeEventListener("rec:unauthorized", onUnauth);
  }, [router]);

  useEffect(() => {
    if (loading) return;
    const onLogin = pathname?.startsWith("/login");
    const onSetup = pathname?.startsWith("/setup");
    if (!user && needsSetup && !onSetup) router.replace("/setup/");
    else if (!user && !needsSetup && !onLogin) router.replace("/login/");
    else if (user && (onLogin || onSetup)) router.replace("/");
  }, [user, loading, needsSetup, pathname, router]);

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setUser(null);
    router.replace("/login/");
  }, [router]);

  const can = useCallback((...roles: Role[]) => !!user && (roles.length === 0 || roles.includes(user.role)), [user]);

  return <Ctx.Provider value={{ user, loading, refresh, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
