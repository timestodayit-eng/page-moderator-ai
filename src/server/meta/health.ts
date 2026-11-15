import { prisma } from "../db";
import { env } from "../env";
import { decrypt } from "../crypto";
import { graph, GraphError } from "./graph";
import { markPageTokenInvalid } from "./pages";
import { log } from "../log";

/** Periodic token / webhook health check for every connected Page. */
export async function checkPageHealth() {
  const pages = await prisma.connectedPage.findMany({ where: { status: { in: ["CONNECTED", "PERMISSION_MISSING"] } }, include: { credential: true } });
  let ok = 0;
  let bad = 0;
  for (const p of pages) {
    if (!p.credential) continue;
    try {
      const token = decrypt(p.credential.tokenEnc);
      const dbg = await graph.debugToken(token);
      if (!dbg.data.is_valid) throw new GraphError(401, 190, undefined, "OAuthException", "Token reported invalid by debug_token");
      const apps = await graph.subscribedApps(p.fbPageId, token);
      const mine = apps.data.find((a) => a.id === env().META_APP_ID);
      await prisma.connectedPage.update({
        where: { id: p.id },
        data: { webhookSubscribed: Boolean(mine?.subscribed_fields.includes("feed")), webhookFields: mine?.subscribed_fields ?? [], lastHealthCheckAt: new Date(), healthError: mine ? null : "App is not subscribed to this Page's webhooks", grantedScopes: dbg.data.scopes ?? p.grantedScopes },
      });
      if (dbg.data.expires_at) await prisma.metaCredential.update({ where: { pageId: p.id }, data: { expiresAt: dbg.data.expires_at ? new Date(dbg.data.expires_at * 1000) : null } });
      ok++;
    } catch (err) {
      bad++;
      if (err instanceof GraphError && (err.isAuthError || err.isPermissionError)) await markPageTokenInvalid(p.id, err.message);
      else await prisma.connectedPage.update({ where: { id: p.id }, data: { lastHealthCheckAt: new Date(), healthError: String(err).slice(0, 300) } });
      log.warn("page health check failed", { pageId: p.id, err: String(err) });
    }
  }
  return { checked: pages.length, ok, bad };
}
