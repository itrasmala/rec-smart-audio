/**
 * Database connection.
 *
 *  - PostgreSQL (default, used by the Docker/cloud deployment): DATABASE_URL.
 *  - Built-in database (local mode, one Windows PC, nothing else to install): set DB_DIR.
 *    Uses PGlite — real PostgreSQL compiled to WebAssembly, running inside this process and
 *    storing its files in DB_DIR. Migrations are applied automatically at startup.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { config } from "./config.js";

export * from "./generated/prisma/client.js";

async function createClient(): Promise<PrismaClient> {
  if (config.dbDir) {
    const fs = await import("node:fs");
    const { PGlite } = await import("@electric-sql/pglite");
    const { PrismaPGlite } = await import("pglite-prisma-adapter");
    const { runMigrations } = await import("./migrate.js");
    fs.mkdirSync(config.dbDir, { recursive: true });
    const pg = await PGlite.create(config.dbDir);
    await runMigrations(pg);
    builtin = pg;
    return new PrismaClient({ adapter: new PrismaPGlite(pg) });
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
}

/** Set when the built-in database is used, so shutdown can close it cleanly. */
export let builtin: { close(): Promise<void> } | null = null;

/**
 * Apply pending migrations to PostgreSQL (the built-in database migrates itself on open).
 * Uses our own runner so the Prisma CLI is not needed at runtime.
 */
export async function applyMigrations(): Promise<string[]> {
  if (config.dbDir) return [];
  const { runMigrations } = await import("./migrate.js");
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    // serialize concurrent starts (e.g. two containers)
    await client.query("SELECT pg_advisory_lock(424243)");
    return await runMigrations({
      exec: (sql) => client.query(sql),
      query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] }),
    });
  } finally {
    await client.end().catch(() => {});
  }
}

export const prisma = await createClient();
