import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { beginConnect } from "@/server/meta/pages";

/** Starts Facebook OAuth. Sets a SameSite=Lax state cookie (double-submit) and redirects to Facebook. */
export const POST = api({ permission: "pages.manage" }, async ({ ws }) => {
  const { url, state } = await beginConnect(ws!);
  const res = NextResponse.json({ url });
  res.cookies.set("pm_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: url.startsWith("https") && process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  res.cookies.set("pm_oauth_ws", ws!.workspace.slug, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
});
