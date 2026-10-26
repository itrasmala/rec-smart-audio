/** Fresh database for every run, created with the same migration runner production uses. */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { runMigrations } from "../src/migrate.js";

export default async function setup() {
  fs.rmSync(".test-storage", { recursive: true, force: true });
  if (process.env.TEST_DB === "builtin") {
    fs.rmSync(".test-builtin-db", { recursive: true, force: true });
    return; // the built-in database migrates itself on first open
  }
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://rec:rec@localhost:5432/rec_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await runMigrations(
    { exec: (sql) => client.query(sql), query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows }) },
    path.resolve("prisma/migrations"),
  );
  await client.end();
}
