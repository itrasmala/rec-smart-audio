import fs from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { badRequest } from "./errors.js";

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path?.length ? ` (${first.path.join(".")})` : "";
    throw badRequest(`بيانات غير صالحة${where}: ${first?.message ?? ""}`, r.error.flatten());
  }
  return r.data;
}

/** Stream a file with HTTP Range support (needed for <audio> seeking on mobile Safari). */
export function sendFileWithRange(
  req: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
  size: number,
  mime: string,
  downloadName?: string,
) {
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", mime);
  reply.header("Cache-Control", "private, max-age=3600");
  if (downloadName) reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    let start = m[1] ? Number(m[1]) : NaN;
    let end = m[2] ? Number(m[2]) : NaN;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - end);
      end = size - 1;
    } else if (Number.isNaN(end) || end >= size) {
      end = size - 1;
    }
    if (start > end || start >= size) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${size}`);
    reply.header("Content-Length", end - start + 1);
    return reply.send(fs.createReadStream(filePath, { start, end }));
  }
  reply.header("Content-Length", size);
  return reply.send(fs.createReadStream(filePath));
}
