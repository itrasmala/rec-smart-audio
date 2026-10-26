import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { resolveSession, SESSION_COOKIE } from "../auth.js";
import { prisma, Prisma } from "../db.js";
import { hub } from "../hub.js";
import { buildAgentConfig } from "../services/agentConfig.js";
import { handleAck, redeliverPending } from "../services/commands.js";
import { authenticateDevice } from "./devices.js";
import type { Device } from "../db.js";

declare module "fastify" {
  interface FastifyRequest {
    device?: Device;
    wsSession?: Awaited<ReturnType<typeof resolveSession>>;
  }
}

const PING_MS = 20_000;

const eventSchema = z.object({
  eventKey: z.string().min(1).max(200),
  source: z.enum(["ADHAN", "SCHEDULE", "MANUAL", "TEST"]),
  priority: z.enum(["ADHAN", "EMERGENCY", "ANNOUNCEMENT", "GENERAL"]),
  fileId: z.string().max(64).nullable().optional(),
  title: z.string().max(300),
  prayer: z.enum(["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"]).nullable().optional(),
  scheduleId: z.string().max(64).nullable().optional(),
  commandId: z.string().max(64).nullable().optional(),
  status: z.enum(["QUEUED", "STARTED", "COMPLETED", "INTERRUPTED", "FAILED", "SKIPPED"]),
  error: z.string().max(1000).nullable().optional(),
  offline: z.boolean().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  endedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

function heartbeat(ws: WebSocket, onDead: () => void) {
  let alive = true;
  ws.on("pong", () => (alive = true));
  const t = setInterval(() => {
    if (!alive) {
      clearInterval(t);
      ws.terminate();
      onDead();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {
      /* closed */
    }
  }, PING_MS);
  ws.on("close", () => clearInterval(t));
}

export async function pushConfig(deviceId: string) {
  const cfg = await buildAgentConfig(deviceId);
  hub.sendToAgent(deviceId, cfg);
}

export default async function wsRoutes(app: FastifyInstance) {
  hub.configPusher = pushConfig;

  // ---------------- browser live updates ----------------
  app.get(
    "/ws",
    {
      websocket: true,
      // authenticate before the upgrade: unauthenticated clients get HTTP 401, no socket
      preValidation: async (req, reply) => {
        req.wsSession = await resolveSession(req.cookies?.[SESSION_COOKIE]).catch(() => null);
        if (!req.wsSession) return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "unauthorized" } });
      },
    },
    (socket, req) => {
    const session = req.wsSession!;
    const remove = hub.addBrowser({ ws: socket, user: session.user, sessionId: session.sessionId });
    heartbeat(socket, remove);
    socket.on("close", remove);
    socket.on("message", (raw) => {
      // browsers only send keep-alive pings; commands go through the REST API (audited, RBAC)
      if (String(raw) === "ping") socket.send(JSON.stringify({ type: "pong", t: Date.now() }));
    });
    socket.send(JSON.stringify({ type: "hello", user: session.user, serverTime: new Date().toISOString() }));
    // replay the latest known state so a freshly opened dashboard is current immediately
    for (const [deviceId, s] of hub.lastStatus) {
      if (hub.isAgentOnline(deviceId)) socket.send(JSON.stringify({ type: "device_status", deviceId, ...s }));
    }
  });

  // ---------------- audio agents ----------------
  app.get(
    "/ws/agent",
    {
      websocket: true,
      preValidation: async (req) => {
        req.device = await authenticateDevice(req); // throws 401 before upgrade
      },
    },
    (socket, req) => {
    const device = req.device!;
    const deviceId = device.id;
    const log = req.log.child({ deviceId, device: device.name });
    hub.addAgent(deviceId, socket);
    log.info("agent connected");

    let lastStatusWrite = 0;
    let lastErrorSeen = device.lastError;

    const markOffline = async () => {
      if (hub.removeAgent(deviceId, socket)) {
        await prisma.device.update({ where: { id: deviceId }, data: { isOnline: false } }).catch(() => {});
        hub.broadcastBrowsers({ type: "device_online", deviceId, online: false, at: new Date().toISOString() });
        log.info("agent disconnected");
      }
    };
    heartbeat(socket, () => void markOffline());
    socket.on("close", () => void markOffline());

    // Handlers are attached synchronously (no message lost) and processed strictly in order.
    let chain: Promise<void> = prisma.device
      .update({ where: { id: deviceId }, data: { isOnline: true, lastSeenAt: new Date() } })
      .then(() => hub.broadcastBrowsers({ type: "device_online", deviceId, online: true, at: new Date().toISOString() }))
      .catch((err) => log.error({ err }, "mark online failed"));

    socket.on("message", (raw) => {
      chain = chain.then(() => handleMessage(raw));
    });

    const handleMessage = async (raw: unknown) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        switch (msg.type) {
          case "hello": {
            const outputs = Array.isArray(msg.outputs) ? msg.outputs.slice(0, 50).map(String) : undefined;
            await prisma.device.update({
              where: { id: deviceId },
              data: {
                os: String(msg.os ?? "").slice(0, 100) || null,
                hostname: String(msg.hostname ?? "").slice(0, 100) || null,
                agentVersion: String(msg.version ?? "").slice(0, 30) || null,
                ...(outputs ? { availableOutputs: outputs } : {}),
                lastSeenAt: new Date(),
              },
            });
            socket.send(
              JSON.stringify({ type: "welcome", deviceId, name: device.name, serverTime: new Date().toISOString() }),
            );
            await pushConfig(deviceId);
            await redeliverPending(deviceId);
            break;
          }
          case "status": {
            const now = Date.now();
            const status = msg as Record<string, unknown>;
            const err = typeof status.lastError === "string" ? status.lastError.slice(0, 1000) : null;
            const errorChanged = err !== lastErrorSeen;
            const out = (status.output ?? {}) as { name?: string };
            if (now - lastStatusWrite > 5000 || errorChanged) {
              lastStatusWrite = now;
              await prisma.device.update({
                where: { id: deviceId },
                data: {
                  lastStatus: status as Prisma.InputJsonValue,
                  lastSeenAt: new Date(),
                  speakerName: out.name ? String(out.name).slice(0, 300) : undefined,
                  ...(errorChanged && err ? { lastError: err, lastErrorAt: new Date() } : {}),
                  ...(Array.isArray(status.outputs) ? { availableOutputs: status.outputs.slice(0, 50).map(String) } : {}),
                },
              });
              lastErrorSeen = err;
            }
            const at = new Date().toISOString();
            hub.lastStatus.set(deviceId, { status, at });
            hub.broadcastBrowsers({ type: "device_status", deviceId, status, at });
            break;
          }
          case "ack": {
            await handleAck(
              deviceId,
              String(msg.commandId),
              Boolean(msg.ok),
              msg.error ? String(msg.error) : undefined,
              msg.result,
            );
            break;
          }
          case "events": {
            const list = Array.isArray(msg.events) ? msg.events.slice(0, 500) : [];
            const acked: string[] = [];
            for (const raw of list) {
              const parsed = eventSchema.safeParse(raw);
              if (!parsed.success) continue;
              const e = parsed.data;
              const data = {
                source: e.source,
                priority: e.priority,
                fileId: e.fileId ?? null,
                title: e.title,
                prayer: e.prayer ?? null,
                scheduleId: e.scheduleId ?? null,
                commandId: e.commandId ?? null,
                status: e.status,
                error: e.error ?? null,
                offline: e.offline ?? false,
                startedAt: e.startedAt ? new Date(e.startedAt) : null,
                endedAt: e.endedAt ? new Date(e.endedAt) : null,
              };
              const row = await prisma.playbackLog.upsert({
                where: { deviceId_eventKey: { deviceId, eventKey: e.eventKey } },
                create: { deviceId, eventKey: e.eventKey, ...data },
                update: data,
              });
              acked.push(e.eventKey);
              hub.broadcastBrowsers({ type: "playback", entry: { ...row, device: { name: device.name } } });
            }
            socket.send(JSON.stringify({ type: "events_ack", keys: acked }));
            break;
          }
          case "config_applied": {
            const rev = Number(msg.revision);
            if (Number.isFinite(rev)) {
              await prisma.device.update({ where: { id: deviceId }, data: { configRevision: rev } });
              hub.broadcastBrowsers({ type: "device_config", deviceId, revision: rev });
            }
            break;
          }
          case "request_config": {
            await pushConfig(deviceId);
            break;
          }
          default:
            break;
        }
      } catch (err) {
        log.error({ err, type: msg.type }, "agent message handling failed");
      }
    };
  });
}
