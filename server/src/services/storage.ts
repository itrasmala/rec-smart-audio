import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { parseFile } from "music-metadata";
import { config } from "../config.js";
import { badRequest } from "../lib/errors.js";

export type AudioFormat = "mp3" | "wav";

export function detectFormat(head: Buffer): AudioFormat | null {
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (head.length >= 3 && head.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

export const MIME: Record<AudioFormat, string> = { mp3: "audio/mpeg", wav: "audio/wav" };

export async function ensureStorage() {
  await fsp.mkdir(path.join(config.storageDir, "tmp"), { recursive: true });
}

export function storagePath(key: string) {
  // keys are generated server-side (uuid.ext); guard anyway
  if (!/^[a-f0-9-]{36}\.(mp3|wav)$/.test(key)) throw badRequest("invalid storage key");
  return path.join(config.storageDir, key);
}

/** Persist an uploaded stream: validate content, hash, probe duration. */
export async function saveUpload(stream: Readable) {
  await ensureStorage();
  const id = crypto.randomUUID();
  const tmp = path.join(config.storageDir, "tmp", `${id}.part`);
  const hash = crypto.createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);
  stream.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
    if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
  });
  try {
    await pipeline(stream, fs.createWriteStream(tmp, { mode: 0o640 }));
    if ((stream as unknown as { truncated?: boolean }).truncated) {
      throw badRequest(`حجم الملف يتجاوز الحد المسموح (${config.maxUploadMb}MB)`);
    }
    if (size === 0) throw badRequest("الملف فارغ");
    const format = detectFormat(head);
    if (!format) throw badRequest("صيغة الملف غير مدعومة — يُسمح فقط بملفات MP3 و WAV");
    let durationSec = 0;
    try {
      const meta = await parseFile(tmp, { duration: true });
      durationSec = meta.format.duration ?? 0;
    } catch {
      throw badRequest("تعذّر قراءة الملف الصوتي — قد يكون تالفًا");
    }
    if (!durationSec || durationSec <= 0) throw badRequest("تعذّر تحديد مدة الملف الصوتي");
    const storageKey = `${id}.${format}`;
    await fsp.rename(tmp, path.join(config.storageDir, storageKey));
    return { storageKey, format, mimeType: MIME[format], sizeBytes: size, sha256: hash.digest("hex"), durationSec };
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

export async function deleteStored(key: string) {
  await fsp.rm(storagePath(key), { force: true });
}
