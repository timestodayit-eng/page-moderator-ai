import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { User } from "@/generated/prisma/client";
import { AppError, Errors } from "./errors";
import { AiError } from "./ai/gateway";
import { env } from "./env";
import { log } from "./log";
import { rateLimit } from "./ratelimit";
import { SESSION_COOKIE, validateSessionToken } from "./auth/session";
import { resolveWorkspaceContext, requirePermission, requirePlatformAdmin, type WorkspaceContext } from "./rbac/guard";
import type { PermissionKey } from "./rbac/permissions";

export type RouteCtx<B = unknown> = {
  req: NextRequest;
  params: Record<string, string>;
  ip: string | null;
  userAgent: string | null;
  user: User | null;
  sessionId: string | null;
  ws: WorkspaceContext | null;
  body: B;
};

type Options<B> = {
  auth?: "none" | "user" | "platform" | "platform-support";
  workspace?: boolean;
  permission?: PermissionKey | PermissionKey[];
  body?: ZodType<B>;
  rateLimit?: { name: string; limit: number; windowSec: number; by?: "ip" | "user" };
  csrf?: boolean; // default true for mutating methods with cookie auth
};

export function clientIp(req: NextRequest): string | null {
  if (env().TRUST_PROXY) {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return req.headers.get("x-real-ip");
  }
  return req.headers.get("x-real-ip") ?? null;
}

/** CSRF defence: SameSite=Lax cookies + strict Origin check + JSON content-type on mutations. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  const appOrigin = new URL(env().APP_URL).origin;
  if (!origin) throw Errors.forbidden("Missing Origin header");
  let o: string;
  try {
    o = new URL(origin).origin;
  } catch {
    throw Errors.forbidden("Invalid Origin header");
  }
  if (o !== appOrigin) throw Errors.forbidden("Cross-origin request blocked");
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    const res = NextResponse.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status });
    if (err.code === "RATE_LIMITED") res.headers.set("Retry-After", String((err.details as { retryAfter: number }).retryAfter));
    return res;
  }
  if (err instanceof AiError) {
    const status = err.code === "NOT_CONFIGURED" || err.code === "PROVIDER" || err.code === "TIMEOUT" ? 503 : err.code === "BUDGET" || err.code === "INACTIVE" ? 402 : err.code === "RATE_LIMIT" ? 429 : 502;
    return NextResponse.json({ error: { code: `AI_${err.code}`, message: err.message } }, { status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid input", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 422 },
    );
  }
  log.error("unhandled api error", { err });
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
}

export function api<B = unknown>(opts: Options<B>, handler: (ctx: RouteCtx<B>) => Promise<unknown>) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string>> }) => {
    try {
      const params = (await segment?.params) ?? {};
      const ip = clientIp(req);
      const userAgent = req.headers.get("user-agent");
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const authMode = opts.auth ?? "user";

      if (mutating && opts.csrf !== false) assertSameOrigin(req);

      let user: User | null = null;
      let sessionId: string | null = null;
      if (authMode !== "none") {
        const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
        if (!session) throw Errors.unauthorized();
        user = session.user;
        sessionId = session.id;
        if (authMode === "platform") requirePlatformAdmin(user);
        if (authMode === "platform-support") requirePlatformAdmin(user, true);
      }

      if (opts.rateLimit) {
        const who = opts.rateLimit.by === "user" && user ? user.id : ip ?? "unknown";
        const r = await rateLimit(`${opts.rateLimit.name}:${who}`, opts.rateLimit.limit, opts.rateLimit.windowSec);
        if (!r.allowed) throw Errors.rateLimited(r.retryAfter);
      } else if (mutating && user) {
        const r = await rateLimit(`api:${user.id}`, 300, 60);
        if (!r.allowed) throw Errors.rateLimited(r.retryAfter);
      }

      let ws: WorkspaceContext | null = null;
      if (opts.workspace || opts.permission) {
        if (!user) throw Errors.unauthorized();
        const ref = req.headers.get("x-workspace-id") ?? req.nextUrl.searchParams.get("workspace") ?? req.cookies.get("pm_ws")?.value;
        if (!ref) throw Errors.badRequest("Workspace not specified");
        ws = await resolveWorkspaceContext(user, ref);
        if (opts.permission) requirePermission(ws, ...(Array.isArray(opts.permission) ? opts.permission : [opts.permission]));
      }

      let body = undefined as B;
      if (opts.body) {
        if (mutating && !(req.headers.get("content-type") ?? "").includes("application/json"))
          throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected application/json");
        const raw = await req.json().catch(() => {
          throw Errors.badRequest("Malformed JSON body");
        });
        body = opts.body.parse(raw);
      }

      const result = await handler({ req, params, ip, userAgent, user, sessionId, ws, body });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function paginate(req: NextRequest, defaults = { pageSize: 25 }) {
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? defaults.pageSize) || defaults.pageSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().SECURE_COOKIES || env().APP_URL.startsWith("https://"),
    path: "/",
    ...(expires ? { expires } : {}),
  };
}

/** JSON-safe serialiser (BigInt → number). */
export function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
}
