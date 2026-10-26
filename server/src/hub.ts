/**
 * Real-time hub: tracks connected browsers and agents, routes commands and broadcasts state.
 * Single-process by design (one server instance per deployment).
 */
import type { WebSocket } from "ws";
import type { Role } from "./generated/prisma/enums.js";
import type { SafeUser } from "./auth.js";

interface BrowserConn {
  ws: WebSocket;
  user: SafeUser;
  sessionId: string;
}

interface AckResult {
  ok: boolean;
  error?: string;
  result?: unknown;
}

type ConfigPusher = (deviceId: string) => Promise<void>;

class Hub {
  private browsers = new Set<BrowserConn>();
  private agents = new Map<string, WebSocket>();
  private ackWaiters = new Map<string, Set<(r: AckResult) => void>>();
  private pushTimer: NodeJS.Timeout | null = null;
  configPusher: ConfigPusher | null = null;
  /** Latest status per device, replayed to browsers when they connect. */
  readonly lastStatus = new Map<string, { status: unknown; at: string }>();

  // ---------- browsers ----------
  addBrowser(conn: BrowserConn) {
    this.browsers.add(conn);
    return () => this.browsers.delete(conn);
  }

  broadcastBrowsers(msg: unknown, roles?: Role[]) {
    const data = JSON.stringify(msg);
    for (const b of this.browsers) {
      if (roles && !roles.includes(b.user.role)) continue;
      if (b.ws.readyState === b.ws.OPEN) b.ws.send(data);
    }
  }

  /** Close browser sockets belonging to a user (e.g. after deactivation) or a session. */
  closeBrowsers(pred: (b: BrowserConn) => boolean) {
    for (const b of this.browsers) if (pred(b)) b.ws.close(4001, "session ended");
  }

  // ---------- agents ----------
  addAgent(deviceId: string, ws: WebSocket) {
    const prev = this.agents.get(deviceId);
    if (prev && prev !== ws) prev.close(4000, "replaced by a newer connection");
    this.agents.set(deviceId, ws);
  }

  removeAgent(deviceId: string, ws: WebSocket): boolean {
    if (this.agents.get(deviceId) === ws) {
      this.agents.delete(deviceId);
      return true;
    }
    return false;
  }

  isAgentOnline(deviceId: string): boolean {
    const ws = this.agents.get(deviceId);
    return !!ws && ws.readyState === ws.OPEN;
  }

  onlineAgentIds(): string[] {
    return [...this.agents.keys()].filter((id) => this.isAgentOnline(id));
  }

  sendToAgent(deviceId: string, msg: unknown): boolean {
    const ws = this.agents.get(deviceId);
    if (!ws || ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  disconnectAgent(deviceId: string, reason: string) {
    const ws = this.agents.get(deviceId);
    if (ws) ws.close(4003, reason);
    this.agents.delete(deviceId);
  }

  // ---------- command acks ----------
  waitForAck(commandId: string, timeoutMs: number): Promise<AckResult | null> {
    return new Promise((resolve) => {
      let set = this.ackWaiters.get(commandId);
      if (!set) this.ackWaiters.set(commandId, (set = new Set()));
      const done = (r: AckResult | null) => {
        clearTimeout(timer);
        set!.delete(cb);
        if (!set!.size) this.ackWaiters.delete(commandId);
        resolve(r);
      };
      const cb = (r: AckResult) => done(r);
      const timer = setTimeout(() => done(null), timeoutMs);
      set.add(cb);
    });
  }

  resolveAck(commandId: string, r: AckResult) {
    const set = this.ackWaiters.get(commandId);
    if (set) for (const cb of [...set]) cb(r);
  }

  // ---------- config push ----------
  /** Debounced: many edits in a burst produce one push. */
  schedulePushAll(delayMs = 400) {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushAll();
    }, delayMs);
    this.pushTimer.unref?.();
  }

  async pushAll() {
    if (!this.configPusher) return;
    for (const id of this.onlineAgentIds()) {
      await this.configPusher(id).catch(() => {});
    }
  }

  stats() {
    return { browsers: this.browsers.size, agents: this.onlineAgentIds().length };
  }

  shutdown() {
    for (const b of this.browsers) b.ws.close(1001, "server shutting down");
    for (const ws of this.agents.values()) ws.close(1012, "server restarting");
  }
}

export const hub = new Hub();
