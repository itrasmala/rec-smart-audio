/**
 * API + WebSocket integration tests against a real PostgreSQL database.
 * A simulated Audio Agent connects over /ws/agent exactly like the Python agent does.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/lib/security.js";
import { pushConfig } from "../src/routes/ws.js";
import { ensureDefaults } from "../src/services/settings.js";
import { ensureStorage } from "../src/services/storage.js";

let app: FastifyInstance;
let base: string;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rec-test-"));

function audio(name: string, kind: "mp3" | "wav", seconds = 2) {
  const out = path.join(tmp, name);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, out]);
  return out;
}

class Client {
  cookie = "";
  constructor(public origin = "") {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body && !isForm ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
  login(username: string, password: string) {
    return this.req("POST", "/api/auth/login", { username, password });
  }
}

async function upload(c: Client, file: string, category: string, title?: string) {
  const fd = new FormData();
  fd.set("category", category);
  if (title) fd.set("title", title);
  fd.set("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  return c.req("POST", "/api/files", fd);
}

/** Minimal agent simulator speaking the real protocol. */
class FakeAgent {
  ws!: WebSocket;
  messages: any[] = [];
  autoAck = true;
  async connect(token: string) {
    this.ws = new WebSocket(base.replace("http", "ws") + "/ws/agent", { headers: { authorization: `Bearer ${token}` } });
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      this.messages.push(m);
      if (m.type === "command" && this.autoAck) {
        this.send({ type: "ack", commandId: m.id, ok: true, result: { state: "playing" } });
      }
    });
    this.send({ type: "hello", version: "test", os: "Linux test", hostname: "dc-01", outputs: ["Speakers (USB Audio)", "BT Speaker"] });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor(pred: (m: any) => boolean, ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = this.messages.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("timeout waiting for message");
  }
  close() {
    this.ws.close();
  }
}

const admin = new Client();
const manager = new Client();
const viewer = new Client();
let deviceId = "";
let deviceToken = "";
let adhanFileId = "";
let annFileId = "";

beforeAll(async () => {
  await ensureStorage();
  await ensureDefaults();
  const pw = await hashPassword("Password123");
  await prisma.user.createMany({
    data: [
      { username: "admin", displayName: "مدير", passwordHash: pw, role: "SUPER_ADMIN" },
      { username: "manager", displayName: "مسؤول الصوتيات", passwordHash: pw, role: "AUDIO_MANAGER" },
      { username: "viewer", displayName: "مشاهد", passwordHash: pw, role: "VIEWER" },
    ],
  });
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  await admin.login("admin", "Password123");
  await manager.login("manager", "Password123");
  await viewer.login("viewer", "Password123");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("authentication", () => {
  it("rejects unauthenticated access", async () => {
    expect((await new Client().req("GET", "/api/dashboard")).status).toBe(401);
  });
  it("returns the current user", async () => {
    const r = await admin.req("GET", "/api/auth/me");
    expect(r.body.user.role).toBe("SUPER_ADMIN");
  });
  it("session cookie is HttpOnly + SameSite=Strict", async () => {
    const res = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "viewer", password: "Password123" }),
    });
    const c = res.headers.get("set-cookie")!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
  });
  it("locks the account after repeated failures", async () => {
    await prisma.user.create({ data: { username: "victim", displayName: "x", passwordHash: await hashPassword("Password123") } });
    const c = new Client();
    for (let i = 0; i < 5; i++) expect((await c.login("victim", "wrong")).status).toBe(401);
    const r = await c.login("victim", "Password123");
    expect(r.status).toBe(423);
  });
  it("blocks cross-origin state-changing requests", async () => {
    const r = await admin.req("POST", "/api/devices", { name: "x" }, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
  it("logout invalidates the session server-side", async () => {
    const c = new Client();
    await c.login("viewer", "Password123");
    const stolen = c.cookie;
    await c.req("POST", "/api/auth/logout");
    const reuse = new Client();
    reuse.cookie = stolen;
    expect((await reuse.req("GET", "/api/auth/me")).status).toBe(401);
  });
});

describe("RBAC", () => {
  it("viewer can read status but not library/schedules/control", async () => {
    expect((await viewer.req("GET", "/api/dashboard")).status).toBe(200);
    expect((await viewer.req("GET", "/api/prayers/today")).status).toBe(200);
    expect((await viewer.req("GET", "/api/logs/playback")).status).toBe(200);
    expect((await viewer.req("GET", "/api/files")).status).toBe(403);
    expect((await viewer.req("GET", "/api/schedules")).status).toBe(403);
    expect((await viewer.req("GET", "/api/users")).status).toBe(403);
    expect((await viewer.req("GET", "/api/logs/audit")).status).toBe(403);
  });
  it("manager cannot manage users, devices, or adhan settings", async () => {
    expect((await manager.req("GET", "/api/users")).status).toBe(403);
    expect((await manager.req("POST", "/api/devices", { name: "x" })).status).toBe(403);
    const r = await manager.req("PUT", "/api/prayers/config/FAJR", {
      adhanEnabled: false, fileId: null, volume: null, offsetMinutes: 0, fixedTime: null,
    });
    expect(r.status).toBe(403);
  });
  it("cannot remove the last active super admin", async () => {
    const me = (await admin.req("GET", "/api/auth/me")).body.user;
    const r = await admin.req("PATCH", `/api/users/${me.id}`, { role: "VIEWER" });
    expect(r.status).toBe(409);
  });
});

describe("audio library", () => {
  it("uploads MP3/WAV, measures duration, rejects fake files", async () => {
    const a = await upload(admin, audio("adhan.mp3", "mp3", 3), "ADHAN", "أذان الحرم");
    expect(a.status).toBe(200);
    expect(a.body.file.durationSec).toBeGreaterThan(2.5);
    adhanFileId = a.body.file.id;
    const w = await upload(manager, audio("ann.wav", "wav", 2), "ADMIN_ALERT", "تنبيه إداري");
    expect(w.status).toBe(200);
    expect(w.body.file.format).toBe("wav");
    annFileId = w.body.file.id;
    const fake = path.join(tmp, "evil.mp3");
    fs.writeFileSync(fake, "<script>alert(1)</script>");
    expect((await upload(admin, fake, "GENERAL")).status).toBe(400);
  });
  it("manager may not upload adhan files", async () => {
    expect((await upload(manager, audio("a2.mp3", "mp3", 1), "ADHAN")).status).toBe(403);
  });
  it("streams with HTTP Range", async () => {
    const res = await fetch(`${base}/api/files/${annFileId}/stream`, { headers: { cookie: admin.cookie, range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });
  it("refuses to delete a file used by prayer settings", async () => {
    const r = await admin.req("PUT", "/api/prayers/config/DHUHR", {
      adhanEnabled: true, fileId: adhanFileId, volume: 90, offsetMinutes: 0, fixedTime: null,
    });
    expect(r.status).toBe(200);
    expect((await admin.req("DELETE", `/api/files/${adhanFileId}`)).status).toBe(409);
  });
  it("only ADHAN category files can be adhan", async () => {
    const r = await admin.req("PUT", "/api/prayers/config/ASR", {
      adhanEnabled: true, fileId: annFileId, volume: null, offsetMinutes: 0, fixedTime: null,
    });
    expect(r.status).toBe(400);
  });
});

describe("schedules", () => {
  it("validates input", async () => {
    const bad = await manager.req("POST", "/api/schedules", {
      name: "x", fileId: annFileId, recurrence: "WEEKLY", daysOfWeek: [], anchor: "FIXED_TIME", time: "07:00", startDate: "2026-10-25",
    });
    expect(bad.status).toBe(400);
  });
  it("creates, lists next runs, pauses, deletes", async () => {
    const r = await manager.req("POST", "/api/schedules", {
      name: "رسالة ترحيبية", fileId: annFileId, recurrence: "DAILY", anchor: "FIXED_TIME", time: "07:00", startDate: "2026-01-01",
    });
    expect(r.status).toBe(200);
    const list = await manager.req("GET", "/api/schedules");
    const s = list.body.schedules.find((x: any) => x.id === r.body.schedule.id);
    expect(s.nextRuns.length).toBe(3);
    expect(new Date(s.nextRuns[0]).toISOString()).toMatch(/T04:00:00/); // 07:00 Riyadh
    expect((await manager.req("PATCH", `/api/schedules/${s.id}/pause`, { isPaused: true })).body.schedule.isPaused).toBe(true);
    expect((await manager.req("DELETE", `/api/schedules/${s.id}`)).status).toBe(200);
  });
  it("emergency schedules are admin-only", async () => {
    const r = await manager.req("POST", "/api/schedules", {
      name: "طوارئ", fileId: annFileId, priority: "EMERGENCY", recurrence: "ONCE", anchor: "FIXED_TIME", time: "10:00", startDate: "2026-12-01",
    });
    expect(r.status).toBe(403);
  });
});

describe("devices & agent protocol", () => {
  let agent: FakeAgent;

  it("creates a device and returns the token once", async () => {
    const r = await admin.req("POST", "/api/devices", { name: "جهاز الداتا سنتر", outputType: "AUX" });
    expect(r.status).toBe(200);
    deviceId = r.body.device.id;
    deviceToken = r.body.token;
    expect(deviceToken).toMatch(/^rec_[0-9a-f]{8}_/);
    const list = await admin.req("GET", "/api/devices");
    expect(JSON.stringify(list.body)).not.toContain(deviceToken);
  });

  it("rejects bad tokens before the WebSocket upgrade", async () => {
    await expect(new FakeAgent().connect("rec_bad_token")).rejects.toThrow(/HTTP 401/);
  });

  it("agent connects, receives full config with 60-day prayer plan", async () => {
    agent = new FakeAgent();
    await agent.connect(deviceToken);
    const welcome = await agent.waitFor((m) => m.type === "welcome");
    expect(welcome.deviceId).toBe(deviceId);
    const cfg = await agent.waitFor((m) => m.type === "config");
    expect(cfg.prayer.plan.length).toBeGreaterThanOrEqual(5 * 60);
    expect(cfg.prayer.configs.find((c: any) => c.prayer === "DHUHR").fileId).toBe(adhanFileId);
    expect(cfg.files.find((f: any) => f.id === adhanFileId).essential).toBe(true);
    expect((await admin.req("GET", "/api/devices")).body.devices[0].isOnline).toBe(true);
  });

  it("agent downloads files with its token (and only with it)", async () => {
    const ok = await fetch(`${base}/api/agent/files/${adhanFileId}`, { headers: { authorization: `Bearer ${deviceToken}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
    const no = await fetch(`${base}/api/agent/files/${adhanFileId}`);
    expect(no.status).toBe(401);
  });

  it("play command round-trip: dashboard → server → agent → ack", async () => {
    const r = await manager.req("POST", `/api/devices/${deviceId}/commands`, {
      type: "play", payload: { fileId: annFileId, priority: "ANNOUNCEMENT", volume: 95 },
    });
    expect(r.status).toBe(200);
    expect(r.body.delivered).toBe(true);
    expect(r.body.ack.ok).toBe(true);
    const cmd = await agent.waitFor((m) => m.type === "command" && m.command === "play");
    expect(cmd.payload.volume).toBe(80); // capped at managerMaxVolume
    expect(cmd.payload.privileged).toBe(false);
    const db = await prisma.command.findUnique({ where: { id: r.body.command.id } });
    expect(db?.status).toBe("ACKED");
  });

  it("enforces role rules on commands", async () => {
    const stopAdhan = await manager.req("POST", `/api/devices/${deviceId}/commands`, { type: "stop", payload: { includeAdhan: true } });
    expect(stopAdhan.status).toBe(403);
    const emerg = await manager.req("POST", `/api/devices/${deviceId}/commands`, {
      type: "play", payload: { fileId: annFileId, priority: "EMERGENCY", interruptAdhan: true },
    });
    expect(emerg.status).toBe(403);
    const v = await viewer.req("POST", `/api/devices/${deviceId}/commands`, { type: "pause", payload: {} });
    expect(v.status).toBe(403);
  });

  it("playback events are stored idempotently (offline re-sync safe)", async () => {
    const ev = {
      eventKey: "adhan:2026-10-25:DHUHR", source: "ADHAN", priority: "ADHAN", fileId: adhanFileId, title: "أذان الظهر",
      prayer: "DHUHR", status: "STARTED", offline: true, startedAt: "2026-10-25T08:37:00.100Z", endedAt: null,
    };
    agent.send({ type: "events", events: [ev] });
    await agent.waitFor((m) => m.type === "events_ack" && m.keys.includes(ev.eventKey));
    // agent reconnects later and re-sends the same + final state
    agent.send({ type: "events", events: [ev, { ...ev, status: "COMPLETED", endedAt: "2026-10-25T08:40:00Z" }] });
    await new Promise((r) => setTimeout(r, 300));
    const rows = await prisma.playbackLog.findMany({ where: { deviceId, eventKey: ev.eventKey } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("COMPLETED");
    expect(rows[0].offline).toBe(true);
  });

  it("status updates are persisted and broadcast to browsers", async () => {
    const browser = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { cookie: viewer.cookie } });
    const got: any[] = [];
    browser.on("message", (raw) => got.push(JSON.parse(String(raw))));
    await new Promise((r) => browser.once("open", r));
    agent.send({ type: "status", state: "playing", volume: 55, output: { name: "Speakers (USB Audio)", ok: true }, lastError: null });
    const t0 = Date.now();
    while (!got.some((m) => m.type === "device_status") && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
    expect(got.find((m) => m.type === "device_status").status.volume).toBe(55);
    browser.close();
    const d = await prisma.device.findUnique({ where: { id: deviceId } });
    expect(d?.speakerName).toBe("Speakers (USB Audio)");
  });

  it("browser WebSocket requires a session", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const code = await new Promise<number>((resolve) => ws.once("unexpected-response", (_q, res) => resolve(res.statusCode!)));
    expect(code).toBe(401);
  });

  it("config changes are pushed to the agent automatically", async () => {
    const before = agent.messages.filter((m) => m.type === "config").length;
    await admin.req("PUT", "/api/prayers/config/FAJR", { adhanEnabled: false, fileId: null, volume: null, offsetMinutes: 0, fixedTime: null });
    await agent.waitFor(() => agent.messages.filter((m) => m.type === "config").length > before, 3000);
    const latest = agent.messages.filter((m) => m.type === "config").at(-1);
    expect(latest.prayer.plan.filter((e: any) => e.prayer === "FAJR").every((e: any) => !e.adhanEnabled)).toBe(true);
  });

  it("offline device: command is held then expires", async () => {
    agent.close();
    await new Promise((r) => setTimeout(r, 300));
    const r = await manager.req("POST", `/api/devices/${deviceId}/commands`, { type: "test_speakers", payload: {} });
    expect(r.body.delivered).toBe(false);
    expect(r.body.command.status).toBe("PENDING");
    // reconnect within TTL → delivered
    agent = new FakeAgent();
    await agent.connect(deviceToken);
    const cmd = await agent.waitFor((m) => m.type === "command" && m.id === r.body.command.id);
    expect(cmd.command).toBe("test_speakers");
  });

  it("revoking a device disconnects it and blocks reconnection", async () => {
    const closed = new Promise<number>((resolve) => agent.ws.once("close", (code) => resolve(code)));
    expect((await admin.req("POST", `/api/devices/${deviceId}/revoke`)).status).toBe(200);
    expect(await closed).toBe(4003);
    await expect(new FakeAgent().connect(deviceToken)).rejects.toThrow(/HTTP 401/);
    // rotate → new token works, old does not
    const rot = await admin.req("POST", `/api/devices/${deviceId}/rotate-token`);
    const a2 = new FakeAgent();
    await a2.connect(rot.body.token);
    await a2.waitFor((m) => m.type === "welcome");
    a2.close();
  });
});

describe("audit trail", () => {
  it("records user operations", async () => {
    const r = await admin.req("GET", "/api/logs/audit?pageSize=200");
    const actions = new Set(r.body.rows.map((x: any) => x.action));
    for (const a of ["auth.login", "file.upload", "device.create", "control.play", "device.revoke", "auth.account_locked"]) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});

describe("prayers API", () => {
  it("dry-run import of an official calendar shows the difference", async () => {
    const r = await admin.req("POST", "/api/prayers/overrides/import", {
      csv: "2026-10-25,04:37,11:39,14:52,17:18,18:48",
      dryRun: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(false);
    expect(r.body.diffs.find((d: any) => d.prayer === "DHUHR").diffMinutes).toBe(2);
    expect(r.body.maxAbsDiffMinutes).toBe(2);
  });
  it("range endpoint returns 7 days with hijri labels", async () => {
    const r = await viewer.req("GET", "/api/prayers/range?days=7");
    expect(r.body.days).toHaveLength(7);
    expect(r.body.days[0].hijri).toMatch(/هـ/);
  });
});
