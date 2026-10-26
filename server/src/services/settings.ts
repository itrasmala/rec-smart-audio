import { prisma } from "../db.js";
import { hub } from "../hub.js";
import { PRAYERS } from "./prayerCalc.js";

export async function ensureDefaults() {
  await prisma.systemSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await prisma.prayerSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  for (const prayer of PRAYERS) {
    await prisma.prayerConfig.upsert({ where: { prayer }, update: {}, create: { prayer } });
  }
}

export async function getSystemSettings() {
  return (await prisma.systemSettings.findUnique({ where: { id: 1 } })) ?? prisma.systemSettings.create({ data: { id: 1 } });
}

export async function getPrayerSettings() {
  return (await prisma.prayerSettings.findUnique({ where: { id: 1 } })) ?? prisma.prayerSettings.create({ data: { id: 1 } });
}

/**
 * Bump the agent-config revision and push the new config to every connected agent.
 * Call after any change that affects playback (prayers, schedules, files, devices, settings).
 */
export async function bumpConfigRevision(): Promise<number> {
  const s = await prisma.systemSettings.update({ where: { id: 1 }, data: { configRevision: { increment: 1 } } });
  hub.schedulePushAll();
  return s.configRevision;
}
