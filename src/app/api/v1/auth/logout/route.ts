import { NextResponse } from "next/server";
import { api, sessionCookieOptions } from "@/server/http";
import { logout } from "@/server/auth/service";
import { SESSION_COOKIE } from "@/server/auth/session";

export const POST = api({}, async ({ user, sessionId, ip, userAgent }) => {
  await logout(sessionId!, user!.id, { ip, userAgent });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  res.cookies.set("pm_ws", "", { path: "/", maxAge: 0 });
  return res;
});
