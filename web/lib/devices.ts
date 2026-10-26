"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useApi } from "./hooks";
import { useLive, useLiveEvent } from "./live";
import type { AgentStatus, Device } from "./types";

/** Devices from REST, merged with live WebSocket status/online state. */
export function useDevices() {
  const { data, reload, loading, error } = useApi<{ devices: Device[] }>("/api/devices");
  const { statuses, online } = useLive();
  useLiveEvent(["device_config"], () => void reload());
  const devices = useMemo(
    () =>
      (data?.devices ?? []).map((d) => ({
        ...d,
        isOnline: online[d.id] ?? d.isOnline,
        lastStatus: (statuses[d.id]?.status ?? d.lastStatus ?? null) as AgentStatus | null,
        statusAt: statuses[d.id]?.at ?? d.lastSeenAt ?? null,
      })),
    [data, statuses, online],
  );
  return { devices, reload, loading, error };
}

const KEY = "rec.selectedDevice";

/** The device the user is controlling (remembered per browser). */
export function useSelectedDevice(devices: Device[]) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setId(localStorage.getItem(KEY));
    } catch {}
  }, []);
  const active = devices.filter((d) => !d.revokedAt);
  const selected = active.find((d) => d.id === id) ?? active.find((d) => d.isOnline) ?? active[0] ?? null;
  const select = useCallback((v: string) => {
    setId(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {}
  }, []);
  return { selected, select, active };
}

export interface CommandResponse {
  command: { id: string; status: string; error: string | null };
  delivered: boolean;
  ack: { ok: boolean; error?: string; result?: any } | null;
}

export function sendCommand(deviceId: string, type: string, payload: Record<string, unknown> = {}) {
  return api.post<CommandResponse>(`/api/devices/${deviceId}/commands`, { type, payload, wait: true });
}
