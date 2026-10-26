export type Role = "SUPER_ADMIN" | "AUDIO_MANAGER" | "VIEWER";
export type Prayer = "FAJR" | "DHUHR" | "ASR" | "MAGHRIB" | "ISHA";
export type Category = "ADHAN" | "STAFF_ANNOUNCEMENT" | "ADMIN_ALERT" | "SAFETY" | "GENERAL";
export type Priority = "ADHAN" | "EMERGENCY" | "ANNOUNCEMENT" | "GENERAL";
export type OutputType = "BLUETOOTH" | "AUX" | "USB" | "HDMI" | "OTHER" | "UNKNOWN";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
  lockedUntil?: string | null;
  createdAt?: string;
}

export interface AudioFile {
  id: string;
  title: string;
  originalName: string;
  category: Category;
  format: "mp3" | "wav";
  sizeBytes: number;
  durationSec: number;
  createdAt: string;
  uploadedBy?: { displayName: string } | null;
  _count?: { schedules: number; prayerConfigs: number };
}

export interface AgentStatus {
  state: "idle" | "playing" | "paused";
  current: null | {
    key: string;
    title: string;
    fileId: string | null;
    priority: Priority;
    source: string;
    prayer: Prayer | null;
    positionSec: number;
    durationSec: number;
    startedAt: string | null;
  };
  queue: { key: string; title: string; priority: Priority; source: string }[];
  volume: number;
  deviceVolume: number;
  quietUntil: string | null;
  output: { name: string | null; preferred: string | null; ok: boolean; error: string | null; backend: string };
  bluetooth: { mac: string | null; connected: boolean | null; reconnects: number; error: string | null };
  internet: boolean | null;
  serverConnected: boolean;
  serverClockSkewSec: number;
  configRevision: number;
  planUntil: string | null;
  usingFallbackPrayerTimes: boolean;
  cache: { files: number; bytes: number; missing: number; missingEssential: number; lastError: string | null };
  nextEvents: { key: string; title: string; at: string; priority: Priority }[];
  unsyncedEvents: number;
  uptimeSec: number;
  lastError: string | null;
  version: string;
  outputs?: string[];
}

export interface Device {
  id: string;
  name: string;
  description?: string | null;
  location?: string | null;
  tokenPrefix?: string;
  revokedAt?: string | null;
  os?: string | null;
  hostname?: string | null;
  agentVersion?: string | null;
  outputType: OutputType;
  outputDeviceName?: string | null;
  speakerName?: string | null;
  bluetoothMac?: string | null;
  volume: number;
  maxVolume: number;
  isOnline: boolean;
  lastSeenAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  lastStatus?: AgentStatus | null;
  availableOutputs?: string[] | null;
  configRevision?: number;
}

export interface PrayerEntry {
  date: string;
  prayer: Prayer;
  computed: string;
  at: string;
  localTime: string;
  source: "auto" | "fixed" | "override";
  adhanEnabled: boolean;
  fileId: string | null;
  volume: number | null;
  key: string;
}

export interface PrayerDay {
  date: string;
  sunrise: string;
  isRamadan: boolean;
  hijri?: string;
  prayers: PrayerEntry[];
}

export interface PlaybackRow {
  id: string;
  deviceId: string;
  eventKey: string;
  source: "ADHAN" | "SCHEDULE" | "MANUAL" | "TEST";
  priority: Priority;
  title: string;
  prayer: Prayer | null;
  status: "QUEUED" | "STARTED" | "COMPLETED" | "INTERRUPTED" | "FAILED" | "SKIPPED";
  error: string | null;
  offline: boolean;
  startedAt: string | null;
  endedAt: string | null;
  receivedAt: string;
  device?: { name: string };
}

export interface Schedule {
  id: string;
  name: string;
  fileId: string;
  priority: Exclude<Priority, "ADHAN">;
  recurrence: "ONCE" | "DAILY" | "WEEKLY";
  daysOfWeek: number[];
  anchor: "FIXED_TIME" | "PRAYER";
  time: string | null;
  anchorPrayer: Prayer | null;
  anchorOffsetMinutes: number;
  startDate: string;
  endDate: string | null;
  volume: number | null;
  isPaused: boolean;
  allDevices: boolean;
  devices: { id: string; name: string }[];
  file: { id: string; title: string; category: Category; durationSec: number };
  createdBy?: { displayName: string } | null;
  nextRuns: string[];
}

export interface SystemSettings {
  orgName: string;
  systemName: string;
  defaultAdhanVolume: number;
  postAdhanBehavior: "RESUME" | "RESTART" | "DISCARD";
  postAdhanQuietMinutes: number;
  emergencyMayInterruptAdhan: boolean;
  managerMaxVolume: number;
  volumeStep: number;
  adhanCatchUpMinutes: number;
  scheduleCatchUpMinutes: number;
  queuedItemTtlMinutes: number;
  commandTtlSeconds: number;
  configRevision: number;
}
