import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { config } from "./config.js";

export * from "./generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: config.databaseUrl });
export const prisma = new PrismaClient({ adapter });
