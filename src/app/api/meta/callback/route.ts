import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validateSessionToken } from "@/server/auth/session";
import { handleCallback } from "@/server/meta/pages";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";

/** Facebook redirects here. We validate and bounce the user back into the app with a selection token. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const wsSlug = req.cookies.get("pm_oauth_ws")?.value ?? "";
  const back = (q: Record<string, string>) => {
    const u = new URL(`/app/${wsSlug}/pages`, env().APP_URL);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    const res = NextResponse.redirect(u);
    res.cookies.set("pm_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  };
  try {
    const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return back({ error: "Please sign in and try connecting again." });
    const result = await handleCallback({ code: sp.get("code") ?? undefined, state: sp.get("state") ?? undefined, cookieState: req.cookies.get("pm_oauth_state")?.value, error: sp.get("error") ?? undefined, errorDescription: sp.get("error_description") ?? undefined, userId: session.user.id });
    const res = back({ select: result.selectionToken });
    return res;
  } catch (err) {
    log.warn("meta callback failed", { err: err instanceof Error ? err.message : String(err) });
    return back({ error: err instanceof AppError ? err.message : "Facebook connection failed. Please try again." });
  }
}
