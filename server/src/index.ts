import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { hub } from "./hub.js";
import { localDate } from "./lib/time.js";
import { expireCommands } from "./services/commands.js";
import { getTimezone } from "./services/prayers.js";
import { ensureDefaults } from "./services/settings.js";
import { ensureStorage } from "./services/storage.js";
import { buildAgentPackage } from "./routes/agentDist.js";
import { initSetupCode } from "./routes/setup.js";

async function main() {
  await ensureStorage();
  await ensureDefaults();
  const userCount = await prisma.user.count();

  const app = await buildApp();
  if (userCount === 0) initSetupCode(app.log);
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
