import { z } from "zod";
import { NextResponse } from "next/server";
import { api, sessionCookieOptions } from "@/server/http";
import { login } from "@/server/auth/service";
import { SESSION_COOKIE } from "@/server/auth/session";
import { listUserWorkspaces } from "@/server/platform/workspaces";

const schema = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

export const POST = api({ auth: "none", body: schema }, async ({ body, ip, userAgent }) => {
  const { token, session, user } = await login(body, { ip, userAgent });
  const workspaces = await listUserWorkspaces(user.id);
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole, emailVerified: Boolean(user.emailVerifiedAt) },
    workspaces,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
  return res;
});
