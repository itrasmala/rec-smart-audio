import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { HttpError } from "./lib/errors.js";
import authRoutes from "./routes/auth.js";
import deviceRoutes from "./routes/devices.js";
import fileRoutes from "./routes/files.js";
import miscRoutes from "./routes/misc.js";
import prayerRoutes from "./routes/prayers.js";
import scheduleRoutes from "./routes/schedules.js";
import agentDistRoutes from "./routes/agentDist.js";
import setupRoutes from "./routes/setup.js";
import userRoutes from "./routes/users.js";
import wsRoutes from "./routes/ws.js";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
            ...(config.isProd ? {} : { transport: { target: "pino-pretty", options: { translateTime: "SYS:standard" } } }),
          },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Next.js static export bootstraps with small inline scripts
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    hsts: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(websocket, { options: { maxPayload: 2 * 1024 * 1024 } });

  // CSRF defence-in-depth (cookies are already SameSite=Strict): reject cross-origin state changes.
  app.addHook("onRequest", async (req, reply) => {
    if (!STATE_CHANGING.has(req.method) || !req.url.startsWith("/api/")) return;
    const origin = req.headers.origin;
    if (!origin) return; // non-browser clients
    const allowed = new Set<string>();
    if (config.publicOrigin) allowed.add(config.publicOrigin);
    allowed.add(`${req.protocol}://${req.headers.host}`);
    if (!allowed.has(origin)) {
      return reply.code(403).send({ error: { code: "BAD_ORIGIN", message: "طلب من مصدر غير مسموح" } });
    }
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "طلبات كثيرة — حاول بعد قليل" } });
    }
    if ((err as FastifyError).code === "FST_REQ_FILE_TOO_LARGE") {
      return reply
        .code(413)
        .send({ error: { code: "TOO_LARGE", message: `حجم الملف يتجاوز الحد المسموح (${config.maxUploadMb}MB)` } });
    }
    if (status < 500) {
      return reply.code(status).send({ error: { code: (err as FastifyError).code ?? "BAD_REQUEST", message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "خطأ داخلي في الخادم" } });
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(fileRoutes);
  await app.register(prayerRoutes);
  await app.register(scheduleRoutes);
  await app.register(deviceRoutes);
  await app.register(miscRoutes);
  await app.register(wsRoutes);
  await app.register(setupRoutes);
  await app.register(agentDistRoutes);

  // ---- dashboard (Next.js static export) ----
  const webRoot = config.webDir;
  const hasWeb = fs.existsSync(path.join(webRoot, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: true, // resolve files per request (a rebuilt dashboard is served without restart)
      index: ["index.html"],
      redirect: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`)) {
          res.header("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.header("Cache-Control", "no-cache");
        }
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/ws") || req.url.startsWith("/agent/")) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "المسار غير موجود" } });
    }
    if (hasWeb && req.method === "GET") {
      // try "<path>/index.html" (trailingSlash export) before 404 page
      const clean = decodeURIComponent(req.url.split("?")[0]).replace(/\/+$/, "");
      const candidate = path.normalize(path.join(webRoot, clean, "index.html"));
      if (candidate.startsWith(webRoot) && fs.existsSync(candidate)) {
        return reply.type("text/html").header("Cache-Control", "no-cache").send(fs.createReadStream(candidate));
      }
      const notFoundPage = path.join(webRoot, "404.html");
      if (fs.existsSync(notFoundPage)) return reply.code(404).type("text/html").send(fs.createReadStream(notFoundPage));
    }
    return reply.code(404).send("Not found");
  });

  return app;
}
