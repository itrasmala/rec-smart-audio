/**
 * Minimal migration runner used by the built-in (PGlite) database in local mode, where the
 * Prisma CLI is not needed. Applies prisma/migrations/<name>/migration.sql in order, once each.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SqlExec {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function migrationsDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/ or dist/ → ../prisma/migrations
  return path.resolve(here, "..", "prisma", "migrations");
}

export async function runMigrations(db: SqlExec, dir = migrationsDir()) {
  await db.exec(`CREATE TABLE IF NOT EXISTS "_rec_migrations" (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>(`SELECT name FROM "_rec_migrations"`)).rows.map((r) => r.name));
  const names = fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "migration.sql")))
    .sort();
  const done: string[] = [];
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    await db.exec("BEGIN");
    try {
      await db.exec(sql);
      await db.query(`INSERT INTO "_rec_migrations"(name) VALUES ($1)`, [name]);
      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw new Error(`migration ${name} failed: ${(err as Error).message}`);
    }
    done.push(name);
  }
  return done;
}
