/** Recreates the test database schema from the migration files before the suite runs. */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://rec:rec@localhost:5432/rec_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  const dir = path.resolve("prisma/migrations");
  for (const m of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
    await client.query(fs.readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
  }
  await client.end();
  fs.rmSync(".test-storage", { recursive: true, force: true });
}
