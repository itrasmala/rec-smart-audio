-- REC Smart Audio — initial schema

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'AUDIO_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AudioCategory" AS ENUM ('ADHAN', 'STAFF_ANNOUNCEMENT', 'ADMIN_ALERT', 'SAFETY', 'GENERAL');

-- CreateEnum
CREATE TYPE "Prayer" AS ENUM ('FAJR', 'DHUHR', 'ASR', 'MAGHRIB', 'ISHA');

-- CreateEnum
CREATE TYPE "AudioPriority" AS ENUM ('ADHAN', 'EMERGENCY', 'ANNOUNCEMENT', 'GENERAL');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "ScheduleAnchor" AS ENUM ('FIXED_TIME', 'PRAYER');

-- CreateEnum
CREATE TYPE "OutputType" AS ENUM ('BLUETOOTH', 'AUX', 'USB', 'HDMI', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'SENT', 'ACKED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PlaybackSource" AS ENUM ('ADHAN', 'SCHEDULE', 'MANUAL', 'TEST');

-- CreateEnum
CREATE TYPE "PlaybackStatus" AS ENUM ('QUEUED', 'STARTED', 'COMPLETED', 'INTERRUPTED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PostAdhanBehavior" AS ENUM ('RESUME', 'RESTART', 'DISCARD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioFile" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "category" "AudioCategory" NOT NULL DEFAULT 'GENERAL',
    "format" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "country" TEXT NOT NULL DEFAULT 'المملكة العربية السعودية',
    "city" TEXT NOT NULL DEFAULT 'الرياض',
    "latitude" DOUBLE PRECISION NOT NULL DEFAULT 24.7136,
    "longitude" DOUBLE PRECISION NOT NULL DEFAULT 46.6753,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "method" TEXT NOT NULL DEFAULT 'UMM_AL_QURA',
    "madhab" TEXT NOT NULL DEFAULT 'SHAFI',
    "ramadanIshaExtra" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrayerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerConfig" (
    "prayer" "Prayer" NOT NULL,
    "adhanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fileId" TEXT,
    "volume" INTEGER,
    "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "fixedTime" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrayerConfig_pkey" PRIMARY KEY ("prayer")
);

-- CreateTable
CREATE TABLE "PrayerOverride" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "prayer" "Prayer" NOT NULL,
    "time" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrayerOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "orgName" TEXT NOT NULL DEFAULT 'رسملة الطاقة للمقاولات',
    "systemName" TEXT NOT NULL DEFAULT 'REC Smart Audio',
    "defaultAdhanVolume" INTEGER NOT NULL DEFAULT 85,
    "postAdhanBehavior" "PostAdhanBehavior" NOT NULL DEFAULT 'DISCARD',
    "postAdhanQuietMinutes" INTEGER NOT NULL DEFAULT 0,
    "emergencyMayInterruptAdhan" BOOLEAN NOT NULL DEFAULT false,
    "managerMaxVolume" INTEGER NOT NULL DEFAULT 80,
    "volumeStep" INTEGER NOT NULL DEFAULT 5,
    "adhanCatchUpMinutes" INTEGER NOT NULL DEFAULT 3,
    "scheduleCatchUpMinutes" INTEGER NOT NULL DEFAULT 5,
    "queuedItemTtlMinutes" INTEGER NOT NULL DEFAULT 15,
    "commandTtlSeconds" INTEGER NOT NULL DEFAULT 45,
    "configRevision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "os" TEXT,
    "hostname" TEXT,
    "agentVersion" TEXT,
    "outputType" "OutputType" NOT NULL DEFAULT 'UNKNOWN',
    "outputDeviceName" TEXT,
    "speakerName" TEXT,
    "bluetoothMac" TEXT,
    "volume" INTEGER NOT NULL DEFAULT 60,
    "maxVolume" INTEGER NOT NULL DEFAULT 100,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastStatus" JSONB,
    "availableOutputs" JSONB,
    "configRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "priority" "AudioPriority" NOT NULL DEFAULT 'ANNOUNCEMENT',
    "recurrence" "Recurrence" NOT NULL DEFAULT 'DAILY',
    "daysOfWeek" INTEGER[],
    "anchor" "ScheduleAnchor" NOT NULL DEFAULT 'FIXED_TIME',
    "time" TEXT,
    "anchorPrayer" "Prayer",
    "anchorOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "volume" INTEGER,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "allDevices" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Command" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "source" "PlaybackSource" NOT NULL,
    "priority" "AudioPriority" NOT NULL,
    "fileId" TEXT,
    "title" TEXT NOT NULL,
    "prayer" "Prayer",
    "scheduleId" TEXT,
    "commandId" TEXT,
    "status" "PlaybackStatus" NOT NULL,
    "error" TEXT,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ScheduleDevices" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ScheduleDevices_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioFile_storageKey_key" ON "AudioFile"("storageKey");

-- CreateIndex
CREATE INDEX "AudioFile_category_idx" ON "AudioFile"("category");

-- CreateIndex
CREATE UNIQUE INDEX "PrayerOverride_date_prayer_key" ON "PrayerOverride"("date", "prayer");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Schedule_fileId_idx" ON "Schedule"("fileId");

-- CreateIndex
CREATE INDEX "Command_deviceId_status_idx" ON "Command"("deviceId", "status");

-- CreateIndex
CREATE INDEX "PlaybackLog_startedAt_idx" ON "PlaybackLog"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackLog_deviceId_eventKey_key" ON "PlaybackLog"("deviceId", "eventKey");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "_ScheduleDevices_B_index" ON "_ScheduleDevices"("B");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioFile" ADD CONSTRAINT "AudioFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerConfig" ADD CONSTRAINT "PrayerConfig_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "AudioFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "AudioFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Command" ADD CONSTRAINT "Command_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Command" ADD CONSTRAINT "Command_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackLog" ADD CONSTRAINT "PlaybackLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ScheduleDevices" ADD CONSTRAINT "_ScheduleDevices_A_fkey" FOREIGN KEY ("A") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ScheduleDevices" ADD CONSTRAINT "_ScheduleDevices_B_fkey" FOREIGN KEY ("B") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
