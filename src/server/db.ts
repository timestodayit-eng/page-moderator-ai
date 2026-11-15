import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  // Prisma stores DateTime as timestamp(3) in UTC; pinning the session timezone keeps raw SQL (NOW(), date_trunc)
  // consistent regardless of the server's locale (the VPS may run in Asia/Dhaka).
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: Number(process.env.DB_POOL_MAX ?? 10), options: "-c timezone=UTC" });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const prisma = globalForPrisma.prisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
