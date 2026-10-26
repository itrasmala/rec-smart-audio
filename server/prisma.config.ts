import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` (e.g. during `npm ci` / docker build) does not need a reachable database
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder" },
});
