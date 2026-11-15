import { z } from "zod";
import { prisma } from "../db";
import { env, isMetaConfigured } from "../env";
import { Errors } from "../errors";
import { audit } from "../audit";
import { log } from "../log";
import { decrypt, decryptJson, encrypt, encryptJson, generateToken, sha256 } from "../crypto";
import { graph, GraphError } from "./graph";
import type { WorkspaceContext } from "../rbac/guard";
import { enforceLimit } from "../billing/usage";
import { appLink, queueEmail } from "../email/service";

export const WEBHOOK_FIELDS = ["feed", "messages", "messaging_postbacks", "message_reads"];
const REQUIRED_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_engagement", "pages_manage_metadata"];
const MESSAGING_SCOPES = ["pages_messaging"];
const OAUTH_STATE_TTL_MS = 10 * 60_000;

export function redirectUri() {
  return new URL("/api/meta/callback", env().APP_URL).toString();
}

/**
 * Begin OAuth. The state is random, bound to user + workspace, stored hashed with a short TTL,
 * and also set as a SameSite cookie by the route (double-submit). Never disabled.
 */
export async function beginConnect(ctx: WorkspaceContext) {
  if (!isMetaConfigured()) throw Errors.notConfigured("Meta app (META_APP_ID / META_APP_SECRET)");
  const connected = await prisma.connectedPage.count({ where: { workspaceId: ctx.workspace.id, status: { not: "DISCONNECTED" } } });
  await enforceLimit(ctx.workspace.id, "pages", connected + 1);
  const state = generateToken(24);
  await prisma.oAuthState.create({ data: { stateHash: sha256(state), userId: ctx.user.id, workspaceId: ctx.workspace.id, expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS) } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "meta.oauth_started", targetType: "Workspace", targetId: ctx.workspace.id });
  return { url: graph.oauthUrl(state, redirectUri()), state };
}

export type DiscoveredPage = { id: string; name: string; category?: string; pictureUrl?: string; tasks: string[]; alreadyConnected: boolean; connectedElsewhere: boolean };

/**
 * OAuth callback: validate state (DB + cookie), exchange code, long-lived token, discover Pages.
 * Page tokens are stored encrypted on the state row until the user picks which Pages to connect.
 */
export async function handleCallback(input: { code?: string; state?: string; cookieState?: string; error?: string; errorDescription?: string; userId: string }) {
  if (input.error) {
    throw Errors.badRequest(`Facebook returned an error: ${input.errorDescription ?? input.error}`);
  }
  if (!input.state || !input.code) throw Errors.badRequest("Missing OAuth parameters");
  if (!input.cookieState || input.cookieState !== input.state) {
    log.warn("oauth state cookie mismatch", { hasCookie: Boolean(input.cookieState) });
    throw Errors.badRequest("INVALID_OAUTH_STATE: the sign-in session expired or cookies were blocked. Please try connecting again from the same browser.");
  }
  const row = await prisma.oAuthState.findUnique({ where: { stateHash: sha256(input.state) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) throw Errors.badRequest("INVALID_OAUTH_STATE: this connection attempt has expired. Please start again.");
  if (row.userId !== input.userId) throw Errors.forbidden("This Facebook connection was started by a different user");
  const claimed = await prisma.oAuthState.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) throw Errors.badRequest("INVALID_OAUTH_STATE: already used");

  const short = await graph.exchangeCode(input.code, redirectUri());
  let userToken = short.access_token;
  try {
    userToken = (await graph.extendUserToken(short.access_token)).access_token;
  } catch (err) {
    log.warn("could not extend user token; continuing with short-lived token", { err: String(err) });
  }
  const [perms, pages] = await Promise.all([graph.permissions(userToken), graph.myPages(userToken)]);
  const granted = perms.data.filter((p) => p.status === "granted").map((p) => p.permission);
  const declined = perms.data.filter((p) => p.status === "declined").map((p) => p.permission);
  const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));

  const existing = await prisma.connectedPage.findMany({ where: { fbPageId: { in: pages.data.map((p) => p.id) }, status: { not: "DISCONNECTED" } }, select: { fbPageId: true, workspaceId: true } });
  const discovered: DiscoveredPage[] = pages.data.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    pictureUrl: p.picture?.data?.url,
    tasks: p.tasks ?? [],
    alreadyConnected: existing.some((e) => e.fbPageId === p.id && e.workspaceId === row.workspaceId),
    connectedElsewhere: existing.some((e) => e.fbPageId === p.id && e.workspaceId !== row.workspaceId),
  }));

  // Hold the page tokens (encrypted) for the selection step; a fresh selection token replaces the OAuth state.
  const selectionToken = generateToken(24);
  await prisma.oAuthState.create({
    data: {
      stateHash: sha256(selectionToken),
      provider: "meta-selection",
      userId: row.userId,
      workspaceId: row.workspaceId,
      payloadEnc: encryptJson({ pages: pages.data.map((p) => ({ id: p.id, name: p.name, token: p.access_token, category: p.category, pictureUrl: p.picture?.data?.url, tasks: p.tasks ?? [] })), granted, metaUserId: undefined }),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    },
  });
  await audit({ workspaceId: row.workspaceId, actorUserId: row.userId, action: "meta.oauth_completed", meta: { pagesFound: pages.data.length, granted, declined, missing } });
  return { workspaceId: row.workspaceId, selectionToken, pages: discovered, granted, missing, declined, messagingGranted: MESSAGING_SCOPES.every((s) => granted.includes(s)) };
}

type HeldPages = { pages: { id: string; name: string; token: string; category?: string; pictureUrl?: string; tasks: string[] }[]; granted: string[] };

/** Step 2: user picks Pages → store encrypted tokens, subscribe webhooks, verify. */
export async function connectSelectedPages(ctx: WorkspaceContext, selectionToken: string, pageIds: string[], meta: { ip?: string | null }) {
  const row = await prisma.oAuthState.findUnique({ where: { stateHash: sha256(selectionToken) } });
  if (!row || row.provider !== "meta-selection" || row.usedAt || row.expiresAt <= new Date()) throw Errors.badRequest("Page selection expired. Please reconnect with Facebook.");
  if (row.userId !== ctx.user.id || row.workspaceId !== ctx.workspace.id) throw Errors.forbidden("Selection belongs to another user or workspace");
  const held = decryptJson<HeldPages>(row.payloadEnc!);
  const chosen = held.pages.filter((p) => pageIds.includes(p.id));
  if (!chosen.length) throw Errors.badRequest("No Pages selected");

  const connected = await prisma.connectedPage.count({ where: { workspaceId: ctx.workspace.id, status: { not: "DISCONNECTED" } } });
  const newOnes = [];
  for (const p of chosen) {
    const exists = await prisma.connectedPage.findUnique({ where: { workspaceId_fbPageId: { workspaceId: ctx.workspace.id, fbPageId: p.id } } });
    if (!exists || exists.status === "DISCONNECTED") newOnes.push(p);
  }
  await enforceLimit(ctx.workspace.id, "pages", connected + newOnes.length);
  await prisma.oAuthState.update({ where: { id: row.id }, data: { usedAt: new Date(), payloadEnc: null } });

  const results: { id: string; fbPageId: string; name: string; status: string; webhookSubscribed: boolean; error?: string }[] = [];
  for (const p of chosen) {
    const elsewhere = await prisma.connectedPage.findFirst({ where: { fbPageId: p.id, workspaceId: { not: ctx.workspace.id }, status: { not: "DISCONNECTED" } } });
    if (elsewhere) {
      results.push({ id: "", fbPageId: p.id, name: p.name, status: "CONFLICT", webhookSubscribed: false, error: "This Page is already connected to another workspace" });
      continue;
    }
    const missing = REQUIRED_SCOPES.filter((s) => !held.granted.includes(s));
    const page = await prisma.$transaction(async (tx) => {
      const pg = await tx.connectedPage.upsert({
        where: { workspaceId_fbPageId: { workspaceId: ctx.workspace.id, fbPageId: p.id } },
        update: { name: p.name, category: p.category, pictureUrl: p.pictureUrl, status: missing.length ? "PERMISSION_MISSING" : "CONNECTED", grantedScopes: held.granted, missingScopes: missing, connectedById: ctx.user.id, connectedAt: new Date(), disconnectedAt: null, disconnectedById: null, healthError: null },
        create: { workspaceId: ctx.workspace.id, fbPageId: p.id, name: p.name, category: p.category, pictureUrl: p.pictureUrl, status: missing.length ? "PERMISSION_MISSING" : "CONNECTED", grantedScopes: held.granted, missingScopes: missing, connectedById: ctx.user.id },
      });
      await tx.metaCredential.upsert({
        where: { pageId: pg.id },
        update: { tokenEnc: encrypt(p.token), scopes: held.granted, revokedAt: null, workspaceId: ctx.workspace.id },
        create: { pageId: pg.id, workspaceId: ctx.workspace.id, tokenEnc: encrypt(p.token), scopes: held.granted },
      });
      await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "page.connected", targetType: "ConnectedPage", targetId: pg.id, ip: meta.ip, meta: { fbPageId: p.id, name: p.name, missing } }, tx);
      return pg;
    });
    // Webhook subscription is explicit and verified — never assumed from OAuth.
    let subscribed = false;
    let error: string | undefined;
    try {
      const fields = held.granted.includes("pages_messaging") ? WEBHOOK_FIELDS : ["feed"];
      await graph.subscribePage(p.id, p.token, fields);
      const check = await graph.subscribedApps(p.id, p.token);
      const mine = check.data.find((a) => a.id === env().META_APP_ID);
      subscribed = Boolean(mine && mine.subscribed_fields.includes("feed"));
      await prisma.connectedPage.update({ where: { id: page.id }, data: { webhookSubscribed: subscribed, webhookFields: mine?.subscribed_fields ?? [], lastHealthCheckAt: new Date(), healthError: subscribed ? null : "Webhook subscription could not be verified" } });
    } catch (err) {
      error = err instanceof GraphError ? `Webhook subscription failed: ${err.message}` : String(err);
      await prisma.connectedPage.update({ where: { id: page.id }, data: { webhookSubscribed: false, healthError: error, lastHealthCheckAt: new Date() } });
    }
    results.push({ id: page.id, fbPageId: p.id, name: p.name, status: page.status, webhookSubscribed: subscribed, error });
  }
  return { results };
}

export async function pageToken(pageId: string) {
  const cred = await prisma.metaCredential.findUnique({ where: { pageId } });
  if (!cred || cred.revokedAt) throw Errors.conflict("Page credentials are missing — reconnect the Page");
  return decrypt(cred.tokenEnc);
}

export async function markPageTokenInvalid(pageId: string, reason: string) {
  const page = await prisma.connectedPage.update({ where: { id: pageId }, data: { status: "TOKEN_INVALID", healthError: reason, lastHealthCheckAt: new Date() }, include: { workspace: { include: { memberships: { where: { role: { key: { in: ["owner", "admin"] } } }, include: { user: true } } } } } });
  await prisma.outboundAction.updateMany({ where: { pageId, status: "PENDING" }, data: { status: "CANCELLED", lastError: "page token invalid" } });
  await audit({ workspaceId: page.workspaceId, actorType: "SYSTEM", action: "page.token_invalid", targetType: "ConnectedPage", targetId: pageId, meta: { reason } });
  for (const m of page.workspace.memberships) {
    await queueEmail({ to: m.user.email, templateKey: "ops.permission_revoked", workspaceId: page.workspaceId, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, pageName: page.name, reason, ctaUrl: appLink(`/app/${page.workspace.slug}/pages`) } }).catch(() => {});
  }
}

const settingsSchema = z.object({
  categories: z
    .record(z.string(), z.object({ autoHide: z.boolean().default(false), threshold: z.number().min(0.5).max(1).default(0.9) }))
    .default({}),
  maxAutoHidesPerHour: z.number().int().min(1).max(500).default(30),
  autoReplyCategories: z.array(z.string()).default(["INQUIRY", "SALES_INQUIRY", "POSITIVE"]),
  maxAutoRepliesPerHour: z.number().int().min(1).max(500).default(30),
  replyMinConfidence: z.number().min(0.5).max(1).default(0.85),
  notifyOnIncidents: z.boolean().default(true),
});
export type PageSettings = z.infer<typeof settingsSchema>;
export const parsePageSettings = (raw: unknown): PageSettings => settingsSchema.parse(raw ?? {});

export async function updatePageConfig(ctx: WorkspaceContext, pageId: string, patch: { moderationMode?: "SHADOW" | "APPROVAL" | "AUTO"; autoHideEnabled?: boolean; killSwitch?: boolean; replyMode?: "OFF" | "SUGGEST" | "APPROVAL" | "LIMITED_AUTO"; moderationAgentId?: string | null; replyAgentId?: string | null; messengerAgentId?: string | null; settings?: unknown }, meta: { ip?: string | null }) {
  const page = await prisma.connectedPage.findFirst({ where: { id: pageId, workspaceId: ctx.workspace.id } });
  if (!page) throw Errors.notFound("Page");
  const data: Record<string, unknown> = {};
  if (patch.moderationMode) data.moderationMode = patch.moderationMode;
  if (patch.replyMode) data.replyMode = patch.replyMode;
  if (patch.killSwitch !== undefined) data.killSwitch = patch.killSwitch;
  for (const k of ["moderationAgentId", "replyAgentId", "messengerAgentId"] as const) {
    if (patch[k] !== undefined) {
      if (patch[k]) {
        const agent = await prisma.agent.findFirst({ where: { id: patch[k]!, workspaceId: ctx.workspace.id } });
        if (!agent) throw Errors.notFound("Agent");
      }
      data[k] = patch[k];
    }
  }
  if (patch.settings !== undefined) data.settings = parsePageSettings(patch.settings);
  if (patch.autoHideEnabled !== undefined) {
    // Explicit activation by someone holding pages.automation; recorded who/when.
    if (!ctx.permissions.has("pages.automation")) throw Errors.forbidden("Missing permission: pages.automation");
    data.autoHideEnabled = patch.autoHideEnabled;
    data.autoHideEnabledById = patch.autoHideEnabled ? ctx.user.id : null;
    data.autoHideEnabledAt = patch.autoHideEnabled ? new Date() : null;
  }
  if ((patch.moderationMode === "AUTO" || patch.replyMode === "LIMITED_AUTO") && !ctx.permissions.has("pages.automation")) throw Errors.forbidden("Missing permission: pages.automation");
  await prisma.$transaction(async (tx) => {
    await tx.connectedPage.update({ where: { id: pageId }, data });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "page.config_updated", targetType: "ConnectedPage", targetId: pageId, ip: meta.ip, meta: { patch: data } }, tx);
  });
}

/**
 * Disconnect: stop automation, cancel pending actions, remove webhook subscription (best effort), delete
 * credentials, keep history. Only the given Page is affected.
 */
export async function disconnectPage(ctx: WorkspaceContext, pageId: string, meta: { ip?: string | null }) {
  const page = await prisma.connectedPage.findFirst({ where: { id: pageId, workspaceId: ctx.workspace.id }, include: { credential: true } });
  if (!page) throw Errors.notFound("Page");
  if (page.status === "DISCONNECTED") return { alreadyDisconnected: true };
  let webhookRemoved = false;
  if (page.credential && !page.credential.revokedAt) {
    try {
      await graph.unsubscribePage(page.fbPageId, decrypt(page.credential.tokenEnc));
      webhookRemoved = true;
    } catch (err) {
      log.warn("webhook unsubscribe failed during disconnect", { pageId, err: String(err) });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.connectedPage.update({ where: { id: pageId }, data: { status: "DISCONNECTED", disconnectedAt: new Date(), disconnectedById: ctx.user.id, autoHideEnabled: false, moderationMode: "SHADOW", replyMode: "OFF", webhookSubscribed: false, webhookFields: [] } });
    await tx.metaCredential.deleteMany({ where: { pageId } });
    const cancelled = await tx.outboundAction.updateMany({ where: { pageId, status: { in: ["PENDING", "CLAIMED"] } }, data: { status: "CANCELLED", lastError: "page disconnected" } });
    await tx.moderationDecision.updateMany({ where: { reviewStatus: "PENDING", comment: { pageId } }, data: { reviewStatus: "NOT_REQUIRED", reviewNote: "Page disconnected" } });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "page.disconnected", targetType: "ConnectedPage", targetId: pageId, ip: meta.ip, meta: { fbPageId: page.fbPageId, name: page.name, webhookRemoved, cancelledActions: cancelled.count } }, tx);
    const owners = await tx.membership.findMany({ where: { workspaceId: ctx.workspace.id, role: { key: { in: ["owner", "admin"] } } }, include: { user: true } });
    for (const m of owners) {
      await queueEmail({ to: m.user.email, templateKey: "ops.page_disconnected", workspaceId: ctx.workspace.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, pageName: page.name, workspaceName: ctx.workspace.name, actor: ctx.user.name, ctaUrl: appLink(`/app/${ctx.workspace.slug}/pages`) }, createdById: ctx.user.id }, tx);
    }
  });
  return { alreadyDisconnected: false, webhookRemoved };
}

export async function listPages(workspaceId: string) {
  const pages = await prisma.connectedPage.findMany({ where: { workspaceId }, orderBy: [{ status: "asc" }, { connectedAt: "desc" }], include: { _count: { select: { comments: true, conversations: true } } } });
  return pages.map((p) => ({ ...p, settings: parsePageSettings(p.settings), hasCredential: undefined }));
}
