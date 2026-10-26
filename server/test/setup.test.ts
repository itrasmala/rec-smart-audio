/** First-run browser setup + one-line agent installer endpoints. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { buildAgentPackage } from "../src/routes/agentDist.js";
import { initSetupCode } from "../src/routes/setup.js";
import { ensureDefaults } from "../src/services/settings.js";
import { ensureStorage } from "../src/services/storage.js";

let app: FastifyInstance;
let base: string;
const silent = { warn: () => {}, info: () => {} };

async function post(url: string, body: unknown) {
  const res = await fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") };
}

beforeAll(async () => {
  await ensureStorage();
  await ensureDefaults();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  process.env.SETUP_CODE = "TEST-2345";
  initSetupCode(silent);
  await buildAgentPackage(silent);
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany({ where: { username: "firstadmin" } });
  delete process.env.SETUP_CODE;
  await app.close();
});

describe("first-run setup", () => {
  const admin = { username: "firstadmin", displayName: "مدير", password: "Password123" };

  it("reports that setup is needed on an empty system", async () => {
    expect(await (await fetch(base + "/api/setup/status")).json()).toEqual({ needsSetup: true });
  });

  it("rejects a wrong setup code", async () => {
    const r = await post("/api/setup", { ...admin, setupCode: "WRONG-0000" });
    expect(r.status).toBe(403);
    expect(await prisma.user.count()).toBe(0);
  });

  it("enforces the password policy", async () => {
    expect((await post("/api/setup", { ...admin, setupCode: "TEST-2345", password: "short" })).status).toBe(400);
  });

  it("creates the first super admin and signs in (code is case/dash-insensitive)", async () => {
    const r = await post("/api/setup", { ...admin, setupCode: "test2345" });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe("SUPER_ADMIN");
    expect(r.cookie).toMatch(/HttpOnly/i);
    const me = await fetch(base + "/api/auth/me", { headers: { cookie: r.cookie!.split(";")[0] } });
    expect((await me.json()).user.username).toBe("firstadmin");
  });

  it("is closed for good once a user exists", async () => {
    expect(await (await fetch(base + "/api/setup/status")).json()).toEqual({ needsSetup: false });
    const r = await post("/api/setup", { ...admin, username: "second", setupCode: "TEST-2345" });
    expect(r.status).toBe(409);
    expect(await prisma.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(1);
  });
});

describe("one-line agent installer", () => {
  it("serves the bootstrap scripts without a BOM", async () => {
    const ps = await fetch(base + "/agent/install.ps1");
    expect(ps.status).toBe(200);
    const text = await ps.text();
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).toContain("[Parameter(Mandatory = $true)][string]$Token");
    const sh = await fetch(base + "/agent/install.sh");
    expect(await sh.text()).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("serves a complete agent package without tests, caches or secrets", async () => {
    const res = await fetch(base + "/agent/rec-agent.tar.gz");
    expect(res.status).toBe(200);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rec-pkg-"));
    const file = path.join(tmp, "p.tgz");
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const list = execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).split("\n");
    for (const f of ["rec_agent/__main__.py", "rec_agent/agent.py", "requirements.txt", "config.example.toml", "install/windows/install.ps1", "install/linux/install.sh"]) {
      expect(list, f).toContain(f);
    }
    expect(list.some((f) => f.includes("__pycache__") || f.startsWith("tests/") || f.endsWith("config.toml") && !f.endsWith("example.toml"))).toBe(false);
    const info = await (await fetch(base + "/agent/info")).json();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
