import { z } from "zod";
import { NextResponse } from "next/server";
import { api, sessionCookieOptions } from "@/server/http";
import { acceptInvitation, previewInvitation } from "@/server/platform/team";
import { SESSION_COOKIE, createSession, validateSessionToken } from "@/server/auth/session";

export const GET = api({ auth: "none" }, async ({ req }) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  return previewInvitation(token);
});

const schema = z.object({ token: z.string().min(20).max(200), name: z.string().trim().min(2).max(80).optional(), password: z.string().min(10).max(200).optional() });

export const POST = api({ auth: "none", body: schema, rateLimit: { name: "invite-accept", limit: 10, windowSec: 900 } }, async ({ body, req, ip, userAgent }) => {
  const session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const result = await acceptInvitation(body.token, { userId: session?.user.id ?? null, name: body.name, password: body.password }, { ip, userAgent });
  const res = NextResponse.json(result);
  if (result.createdUser) {
    const { token, session: s } = await createSession(result.userId, { ip, userAgent });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(s.expiresAt));
  }
  return res;
});
