import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { fastRedis } from "@/server/queue/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    checks.database = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const t1 = Date.now();
  try {
    const r = fastRedis();
    if (r.status !== "ready") await new Promise<void>((resolve, reject) => { const to = setTimeout(() => reject(new Error(`redis ${r.status}`)), 1500); r.once("ready", () => { clearTimeout(to); resolve(); }); });
    await r.ping();
    checks.redis = { ok: true, latencyMs: Date.now() - t1 };
  } catch (e) {
    checks.redis = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const hb = await prisma.platformSetting.findUnique({ where: { key: "worker.heartbeat" } });
    const at = hb ? new Date((hb.value as { at: string }).at).getTime() : 0;
    checks.worker = { ok: Date.now() - at < 120_000, error: at ? undefined : "no heartbeat yet" };
  } catch {
    checks.worker = { ok: false, error: "unknown" };
  }
  const ok = checks.database.ok && checks.redis.ok;
  return NextResponse.json({ status: ok ? "ok" : "degraded", checks, version: process.env.APP_VERSION ?? "dev", time: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
