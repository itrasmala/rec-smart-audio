import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, ROLES } from "../auth.js";
import { prisma } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { parse, sendFileWithRange } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { bumpConfigRevision } from "../services/settings.js";
import { deleteStored, saveUpload, storagePath } from "../services/storage.js";

export const CATEGORY = z.enum(["ADHAN", "STAFF_ANNOUNCEMENT", "ADMIN_ALERT", "SAFETY", "GENERAL"]);

export default async function fileRoutes(app: FastifyInstance) {
  app.get("/api/files", { preHandler: requireRole(...ROLES.MANAGERS) }, async (req) => {
    const q = parse(
      z.object({ category: CATEGORY.optional(), search: z.string().max(100).optional() }),
      req.query,
    );
    const files = await prisma.audioFile.findMany({
      where: {
        ...(q.category ? { category: q.category } : {}),
        ...(q.search ? { title: { contains: q.search, mode: "insensitive" as const } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { displayName: true } },
        _count: { select: { schedules: true, prayerConfigs: true } },
      },
    });
    return { files };
  });

  app.post("/api/files", { preHandler: requireRole(...ROLES.MANAGERS) }, async (req) => {
    const part = await req.file();
    if (!part) throw badRequest("لم يتم إرفاق ملف");
    const fields = part.fields as Record<string, { value?: string } | undefined>;
    const category = CATEGORY.catch("GENERAL").parse(fields.category?.value ?? "GENERAL");
    if (category === "ADHAN" && req.user!.role !== "SUPER_ADMIN") {
      part.file.resume();
      throw forbidden("رفع ملفات الأذان متاح لمدير النظام فقط");
    }
    const originalName = part.filename.slice(0, 255);
    const title = (fields.title?.value?.trim() || originalName.replace(/\.[^.]+$/, "")).slice(0, 150);
    const saved = await saveUpload(part.file);
    const file = await prisma.audioFile.create({
      data: { ...saved, title, originalName, category, uploadedById: req.user!.id },
    });
    await audit(req, "file.upload", "AudioFile", file.id, { title, category, sizeBytes: file.sizeBytes });
    await bumpConfigRevision();
    return { file };
  });

  app.patch<{ Params: { id: string } }>("/api/files/:id", { preHandler: requireRole(...ROLES.MANAGERS) }, async (req) => {
    const body = parse(
      z.object({ title: z.string().trim().min(1).max(150).optional(), category: CATEGORY.optional() }),
      req.body,
    );
    const existing = await prisma.audioFile.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("الملف غير موجود");
    const touchesAdhan = existing.category === "ADHAN" || body.category === "ADHAN";
    if (touchesAdhan && req.user!.role !== "SUPER_ADMIN") throw forbidden("تعديل ملفات الأذان متاح لمدير النظام فقط");
    const file = await prisma.audioFile.update({ where: { id: existing.id }, data: body });
    await audit(req, "file.update", "AudioFile", file.id, body);
    await bumpConfigRevision();
    return { file };
  });

  app.delete<{ Params: { id: string } }>("/api/files/:id", { preHandler: requireRole(...ROLES.MANAGERS) }, async (req) => {
    const existing = await prisma.audioFile.findUnique({
      where: { id: req.params.id },
      include: { schedules: { select: { id: true, name: true } }, prayerConfigs: { select: { prayer: true } } },
    });
    if (!existing) throw notFound("الملف غير موجود");
    if (existing.category === "ADHAN" && req.user!.role !== "SUPER_ADMIN") throw forbidden("حذف ملفات الأذان متاح لمدير النظام فقط");
    if (existing.schedules.length || existing.prayerConfigs.length) {
      throw conflict("لا يمكن حذف الملف لأنه مستخدم في الجدولة أو إعدادات الأذان", {
        schedules: existing.schedules,
        prayers: existing.prayerConfigs.map((p) => p.prayer),
      });
    }
    await prisma.audioFile.delete({ where: { id: existing.id } });
    await deleteStored(existing.storageKey);
    await audit(req, "file.delete", "AudioFile", existing.id, { title: existing.title });
    await bumpConfigRevision();
    return { ok: true };
  });

  // Preview / stream for the dashboard (managers only)
  app.get<{ Params: { id: string } }>(
    "/api/files/:id/stream",
    { preHandler: requireRole(...ROLES.MANAGERS) },
    async (req, reply) => {
      const f = await prisma.audioFile.findUnique({ where: { id: req.params.id } });
      if (!f) throw notFound("الملف غير موجود");
      return sendFileWithRange(req, reply, storagePath(f.storageKey), f.sizeBytes, f.mimeType, `${f.title}.${f.format}`);
    },
  );
}
