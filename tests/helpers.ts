import { execSync } from "node:child_process";
import { prisma } from "@/server/db";
import { seed } from "../prisma/seed";
import { hashPassword } from "@/server/auth/password";
import { createWorkspace } from "@/server/platform/workspaces";
import { createSession } from "@/server/auth/session";
import { NextRequest } from "next/server";
import { fastRedis } from "@/server/queue/redis";
import { _resetMemoryLimiter } from "@/server/ratelimit";

let migrated = false;

/** Reset the test database: apply migrations (via the WASM engine) and truncate all tables, then seed. */
export async function resetDb() {
  if (!migrated) {
    execSync("npx tsx scripts/prisma-wasm-migrate.ts deploy", { stdio: "pipe", env: { ...process.env } });
    migrated = true;
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await seed();
  await clearRateLimits();
}

/** Rate-limit buckets live in Redis; clear them so one test file cannot throttle the next. */
export async function clearRateLimits() {
  _resetMemoryLimiter();
  try {
    const r = fastRedis();
    if (r.status !== "ready") await new Promise<void>((res) => r.once("ready", () => res()));
    const keys = await r.keys("rl:*");
    if (keys.length) await r.del(...keys);
  } catch {
    /* redis unavailable → memory limiter already cleared */
  }
}

export async function makeUser(email: string, opts: { platformRole?: "NONE" | "SUPER_ADMIN" | "SUPPORT"; password?: string; verified?: boolean } = {}) {
  return prisma.user.create({
    data: { email, name: email.split("@")[0], passwordHash: await hashPassword(opts.password ?? "Password-12345"), platformRole: opts.platformRole ?? "NONE", emailVerifiedAt: opts.verified === false ? null : new Date() },
  });
}

export async function makeWorkspace(name: string, ownerId: string, type: "INTERNAL" | "CUSTOMER" = "CUSTOMER") {
  return prisma.$transaction((tx) => createWorkspace({ name, ownerUserId: ownerId, type, billingExempt: type === "INTERNAL", planKey: type === "INTERNAL" ? "enterprise" : "growth" }, tx));
}

export async function sessionFor(userId: string) {
  const { token } = await createSession(userId, { ip: "127.0.0.1", userAgent: "vitest" });
  return token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: NextRequest, ctx: any) => Promise<Response>;

/** Invoke a Next.js route handler directly with a synthetic request. */
export async function call(handler: Handler, opts: { method?: string; url?: string; body?: unknown; rawBody?: string; token?: string; workspace?: string; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const url = new URL(opts.url ?? "/api/test", "http://localhost:3000");
  const headers = new Headers({ origin: "http://localhost:3000", ...(opts.headers ?? {}) });
  const cookies: string[] = [];
  if (opts.token) cookies.push(`pm_session=${opts.token}`);
  if (opts.workspace) headers.set("x-workspace-id", opts.workspace);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const req = new NextRequest(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as Record<string, unknown> & { error?: { code: string; message: string } }, headers: res.headers };
}

export async function lastEmail(templateKey?: string) {
  return prisma.emailDelivery.findFirst({ where: templateKey ? { templateKey } : {}, orderBy: { createdAt: "desc" } });
}
