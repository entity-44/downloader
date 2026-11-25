import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { getConfig } from "./config";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function create() {
  const adapter = new PrismaBetterSqlite3({ url: getConfig().databaseUrl });
  return new PrismaClient({ adapter });
}

/** Lazily-created singleton (survives dev hot reloads). */
export function db(): PrismaClient {
  globalForPrisma.__prisma ??= create();
  return globalForPrisma.__prisma;
}

export async function disconnectDb() {
  await globalForPrisma.__prisma?.$disconnect();
  globalForPrisma.__prisma = undefined;
}
