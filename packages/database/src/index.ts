import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient } from "@prisma/client";

export function createDb(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ datasourceUrl: url });
}
