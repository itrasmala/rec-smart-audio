/**
 * Self-hosted Audio Agent distribution, so a playback machine can be installed with ONE command
 * copied from the dashboard — no GitHub access, no manual download, works for private repos.
 *
 *   GET /agent/install.ps1        Windows bootstrap (PowerShell)
 *   GET /agent/install.sh         Linux bootstrap (bash)
 *   GET /agent/rec-agent.tar.gz   agent package (built from AGENT_DIR at startup)
 *
 * These are public on purpose: they contain no secrets. The device token is passed by the
 * person running the command and never appears in a URL.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { notFound } from "../lib/errors.js";

const run = promisify(execFile);

const INCLUDE = ["rec_agent", "requirements.txt", "config.example.toml", "README.md", "install"];

let pkg: { file: string; sha256: string; size: number; version: string } | null = null;

export async function buildAgentPackage(log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  const src = config.agentDir;
  if (!fs.existsSync(path.join(src, "rec_agent", "__init__.py"))) {
    log.warn({ src }, "agent sources not found — one-line agent install is disabled (set AGENT_DIR)");
    return;
  }
  const outDir = path.join(config.storageDir, "_agent-dist");
  await fsp.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, "rec-agent.tar.gz");
  const tmp = `${file}.tmp`;
  const items = INCLUDE.filter((i) => fs.existsSync(path.join(src, i)));
  await run("tar", [
    "-czf",
    tmp,
    "--exclude=__pycache__",
    "--exclude=*.pyc",
    "--exclude=config.toml",
    "-C",
    src,
    ...items,
  ]);
  await fsp.rename(tmp, file);
  const buf = await fsp.readFile(file);
  const init = await fsp.readFile(path.join(src, "rec_agent", "__init__.py"), "utf8");
  pkg = {
    file,
    size: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    version: /__version__\s*=\s*"([^"]+)"/.exec(init)?.[1] ?? "unknown",
  };
  log.info({ version: pkg.version, size: pkg.size }, "agent package ready for one-line install");
}

function script(name: string) {
  return path.join(config.agentDir, "install", name);
}

export default async function agentDistRoutes(app: FastifyInstance) {
  app.get("/agent/info", async () => {
    if (!pkg) throw notFound("حزمة جهاز التشغيل غير متاحة على هذا الخادم");
    return { version: pkg.version, sha256: pkg.sha256, size: pkg.size };
  });

  app.get("/agent/rec-agent.tar.gz", async (_req, reply) => {
    if (!pkg) throw notFound("حزمة جهاز التشغيل غير متاحة على هذا الخادم");
    reply.header("Content-Type", "application/gzip");
    reply.header("Content-Disposition", 'attachment; filename="rec-agent.tar.gz"');
    reply.header("X-Content-SHA256", pkg.sha256);
    reply.header("Cache-Control", "no-cache");
    return reply.send(fs.createReadStream(pkg.file));
  });

  app.get("/agent/install.ps1", async (_req, reply) => {
    const f = script("windows/bootstrap.ps1");
    if (!fs.existsSync(f)) throw notFound();
    // PowerShell 5.1 needs a BOM or explicit charset to read Arabic text correctly
    reply.header("Content-Type", "text/plain; charset=utf-8");
    reply.header("Cache-Control", "no-cache");
    // the file keeps a BOM for `-File` use; strip it for `irm | scriptblock` use
    return reply.send((await fsp.readFile(f, "utf8")).replace(/^\uFEFF/, ""));
  });

  app.get("/agent/install.sh", async (_req, reply) => {
    const f = script("linux/bootstrap.sh");
    if (!fs.existsSync(f)) throw notFound();
    reply.header("Content-Type", "text/x-shellscript; charset=utf-8");
    reply.header("Cache-Control", "no-cache");
    return reply.send(await fsp.readFile(f));
  });
}
