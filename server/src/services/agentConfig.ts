/**
 * Builds the full configuration snapshot pushed to an Audio Agent.
 * The agent persists it locally and runs from it even when the server is unreachable.
 */
import { config } from "../config.js";
import { prisma } from "../db.js";
import { addDays, localDate } from "../lib/time.js";
import { computePrayerRange } from "./prayerCalc.js";
import { loadPrayerContext } from "./prayers.js";
import { getSystemSettings } from "./settings.js";

export const PRIORITY_RANK = { ADHAN: 1, EMERGENCY: 2, ANNOUNCEMENT: 3, GENERAL: 4 } as const;

export async function buildAgentConfig(deviceId: string) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new Error("device not found");
  const sys = await getSystemSettings();
  const now = new Date();

  const ctxAll = await loadPrayerContext();
  const tz = ctxAll.params.timezone;
  const from = addDays(localDate(now, tz), -1);
  const plan = computePrayerRange(from, config.prayerPlanDays + 1, ctxAll.params, ctxAll.configs, ctxAll.overrides);
  const futureOverrides = ctxAll.overrides.filter((o) => o.date >= from);

  const schedules = await prisma.schedule.findMany({
    where: { OR: [{ allDevices: true }, { devices: { some: { id: deviceId } } }] },
    orderBy: { createdAt: "asc" },
  });

  const files = await prisma.audioFile.findMany({
    select: { id: true, title: true, category: true, format: true, sizeBytes: true, durationSec: true, sha256: true },
  });

  // Files that must always be present locally (offline guarantee)
  const essential = new Set<string>();
  for (const c of ctxAll.configs) if (c.fileId) essential.add(c.fileId);
  for (const s of schedules) essential.add(s.fileId);

  return {
    type: "config" as const,
    revision: sys.configRevision,
    generatedAt: now.toISOString(),
    timezone: tz,
    device: {
      id: device.id,
      name: device.name,
      outputDeviceName: device.outputDeviceName,
      outputType: device.outputType,
      bluetoothMac: device.bluetoothMac,
      volume: device.volume,
      maxVolume: device.maxVolume,
    },
    policy: {
      defaultAdhanVolume: sys.defaultAdhanVolume,
      postAdhanBehavior: sys.postAdhanBehavior,
      postAdhanQuietMinutes: sys.postAdhanQuietMinutes,
      emergencyMayInterruptAdhan: sys.emergencyMayInterruptAdhan,
      adhanCatchUpMinutes: sys.adhanCatchUpMinutes,
      scheduleCatchUpMinutes: sys.scheduleCatchUpMinutes,
      queuedItemTtlMinutes: sys.queuedItemTtlMinutes,
      volumeStep: sys.volumeStep,
    },
    prayer: {
      params: ctxAll.params,
      configs: ctxAll.configs,
      overrides: futureOverrides,
      plan: plan.flatMap((d) =>
        d.prayers.map((p) => ({
          key: p.key,
          date: p.date,
          prayer: p.prayer,
          at: p.at,
          adhanEnabled: p.adhanEnabled,
          fileId: p.fileId,
          volume: p.volume,
        })),
      ),
      planUntil: plan[plan.length - 1]?.date ?? from,
    },
    schedules: schedules.map((s) => ({
      id: s.id,
      name: s.name,
      fileId: s.fileId,
      priority: s.priority,
      recurrence: s.recurrence,
      daysOfWeek: s.daysOfWeek,
      anchor: s.anchor,
      time: s.time,
      anchorPrayer: s.anchorPrayer,
      anchorOffsetMinutes: s.anchorOffsetMinutes,
      startDate: s.startDate,
      endDate: s.endDate,
      volume: s.volume,
      isPaused: s.isPaused,
    })),
    files: files.map((f) => ({ ...f, essential: essential.has(f.id) })),
  };
}

export type AgentConfig = Awaited<ReturnType<typeof buildAgentConfig>>;
