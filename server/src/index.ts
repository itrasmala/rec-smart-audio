import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app.js";
import { newDeviceToken } from "./lib/security.js";
import { config } from "./config.js";
import { applyMigrations, builtin, prisma } from "./db.js";
import { hub } from "./hub.js";
import { localDate } from "./lib/time.js";
import { expireCommands } from "./services/commands.js";
import { getTimezone } from "./services/prayers.js";
import { ensureDefaults } from "./services/settings.js";
import { ensureStorage } from "./services/storage.js";
import { buildAgentPackage } from "./routes/agentDist.js";
import { initSetupCode } from "./routes/setup.js";

/**
 * Local mode (server and speakers on the same PC): create the device for this PC once and hand
 * its token to the installer through a file, so nobody has to copy a command.
 */
async function pairLocalAgent(log: { info: (o: object, m: string) => void }) {
  const file = config.localAgentTokenFile;
  if (!file || fs.existsSync(file)) return;
  const tok = newDeviceToken();
  const device = await prisma.device.create({
    data: {
      name: "هذا الكمبيوتر",
      location: "الجهاز الموصول بالسماعات",
      outputType: "BLUETOOTH",
      tokenHash: tok.hash,
      tokenPrefix: tok.prefix,
    },
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, tok.token, { mode: 0o600 });
  log.info({ deviceId: device.id }, "local playback device created");
}

async function main() {
  const migrated = await applyMigrations();
  if (migrated.length) console.log(`database migrations applied: ${migrated.join(", ")}`);
  await ensureStorage();
  await ensureDefaults();
  const userCount = await prisma.user.count();

  const app = await buildApp();
  if (userCount === 0) initSetupCode(app.log);
  await pairLocalAgent(app.log).catch((err) => app.log.error({ err }, "local agent pairing failed"));
  await buildAgentPackage(app.log).catch((err) => app.log.warn({ err }, "could not build agent package"));

  // ---- background jobs ----
  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => void expireCommands().catch((err) => app.log.error({ err }, "expire commands")), 10_000));
  timers.push(
    setInterval(
      () =>
        void prisma.session
          .deleteMany({ where: { expiresAt: { lt: new Date() } } })
          .catch((err) => app.log.error({ err }, "session cleanup")),
      3600_000,
    ),
  );
  // When the local date rolls over, push a fresh 60-day plan to every agent.
  let lastDate = localDate(new Date(), await getTimezone());
  timers.push(
    setInterval(async () => {
      try {
        const today = localDate(new Date(), await getTimezone());
        if (today !== lastDate) {
          lastDate = today;
          app.log.info({ today }, "date rolled over — pushing fresh config to agents");
          await hub.pushAll();
        }
      } catch (err) {
        app.log.error({ err }, "date rollover");
      }
    }, 60_000),
  );

  const shutdown = async (sig: string) => {
    app.log.info({ sig }, "shutting down");
    timers.forEach(clearInterval);
    hub.shutdown();
    await app.close();
    await prisma.$disconnect();
    await builtin?.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
