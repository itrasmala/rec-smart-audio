import "dotenv/config";
import path from "node:path";

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, def: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : def;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  nodeEnv,
  isProd: nodeEnv === "production",
  host: process.env.HOST ?? "0.0.0.0",
  port: int(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://rec:rec@localhost:5432/rec_audio",
  /** Local mode: use the built-in database stored in this folder instead of PostgreSQL. */
  dbDir: process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : null,
  /** Local mode: create a device for this PC on first start and write its token here (for the installer). */
  localAgentTokenFile: process.env.LOCAL_AGENT_TOKEN_FILE ? path.resolve(process.env.LOCAL_AGENT_TOKEN_FILE) : null,
  storageDir: path.resolve(process.env.STORAGE_DIR ?? "./data/audio"),
  webDir: path.resolve(process.env.WEB_DIR ?? "../web/out"),
  /** Agent sources, packaged at startup for the one-line installer. */
  agentDir: path.resolve(process.env.AGENT_DIR ?? "../agent"),
  /** e.g. https://audio.rasmala.com — used for Origin checks. Empty = same-host check only. */
  publicOrigin: (process.env.PUBLIC_ORIGIN ?? "").replace(/\/$/, ""),
  cookieSecure: bool(process.env.COOKIE_SECURE, nodeEnv === "production"),
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 12),
  trustProxy: bool(process.env.TRUST_PROXY, true),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 60),
  logLevel: process.env.LOG_LEVEL ?? (nodeEnv === "production" ? "info" : "debug"),
  prayerPlanDays: int(process.env.PRAYER_PLAN_DAYS, 60),
  loginMaxAttempts: int(process.env.LOGIN_MAX_ATTEMPTS, 5),
  loginLockMinutes: int(process.env.LOGIN_LOCK_MINUTES, 15),
};

export type AppConfig = typeof config;
