"use client";
/** Live updates over WebSocket (/ws). Reconnects automatically with backoff. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import type { AgentStatus } from "./types";

type Listener = (msg: any) => void;

interface LiveCtx {
  connected: boolean;
  statuses: Record<string, { status: AgentStatus; at: string }>;
  online: Record<string, boolean>;
  subscribe: (fn: Listener) => () => void;
}

const Ctx = createContext<LiveCtx | null>(null);

function wsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const { protocol, host, hostname } = window.location;
  // `next dev` (port 3000) does not proxy WebSockets: talk to the API server directly
  if (process.env.NODE_ENV === "development") return `ws://${hostname}:4000/ws`;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [statuses, setStatuses] = useState<LiveCtx["statuses"]>({});
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        setConnected(true);
        retry = 1000;
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25000);
      };
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "device_status") {
          setStatuses((s) => ({ ...s, [msg.deviceId]: { status: msg.status, at: msg.at } }));
          setOnline((o) => ({ ...o, [msg.deviceId]: true }));
        } else if (msg.type === "device_online") {
          setOnline((o) => ({ ...o, [msg.deviceId]: msg.online }));
        }
        listeners.current.forEach((fn) => fn(msg));
      };
      ws.onclose = () => {
        setConnected(false);
        clearInterval(ping);
        if (stopped) return;
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      ws?.close();
    };
  }, [user]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return <Ctx.Provider value={{ connected, statuses, online, subscribe }}>{children}</Ctx.Provider>;
}

export function useLive() {
  const v = useContext(Ctx);
  if (!v) throw new Error("LiveProvider missing");
  return v;
}

/** Subscribe to live messages of given types. */
export function useLiveEvent(types: string[], fn: Listener) {
  const { subscribe } = useLive();
  const ref = useRef(fn);
  ref.current = fn;
  const key = types.join(",");
  useEffect(() => subscribe((m) => key.split(",").includes(m.type) && ref.current(m)), [subscribe, key]);
}
