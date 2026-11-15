import { env } from "../env";
import { log } from "../log";

/**
 * Thin, typed Meta Graph API client. Every call has a timeout, structured error, and never logs tokens.
 */
export class GraphError extends Error {
  constructor(
    public status: number,
    public code: number | undefined,
    public subcode: number | undefined,
    public type: string | undefined,
    message: string,
    public fbtraceId?: string,
  ) {
    super(message);
  }
  /** Token expired/revoked, or user de-authorised → Page must be reconnected. */
  get isAuthError() {
    return this.code === 190 || this.code === 102 || this.status === 401;
  }
  /** Missing permission → show reconnection with scopes. */
  get isPermissionError() {
    return this.code === 10 || this.code === 200 || (this.code !== undefined && this.code >= 200 && this.code <= 299);
  }
  get isRateLimit() {
    return this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613 || this.status === 429;
  }
  get isTransient() {
    return this.isRateLimit || this.status >= 500 || this.code === 1 || this.code === 2;
  }
}

export type GraphParams = Record<string, string | number | boolean | undefined>;

function base() {
  return `https://graph.facebook.com/${env().META_GRAPH_VERSION}`;
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, params: GraphParams, token?: string, body?: Record<string, unknown>): Promise<T> {
  const url = new URL(`${base()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  if (token) url.searchParams.set("access_token", token);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new GraphError(0, 1, undefined, "NetworkError", `Graph request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  if (!res.ok || (data && typeof data === "object" && "error" in (data as object))) {
    const e = (data as { error?: { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string } })?.error ?? {};
    log.warn("graph api error", { path: path.split("?")[0], status: res.status, code: e.code, subcode: e.error_subcode, type: e.type, ms: Date.now() - started });
    throw new GraphError(res.status, e.code, e.error_subcode, e.type, e.message ?? `Graph API error ${res.status}`, e.fbtrace_id);
  }
  return data as T;
}

export const graph = {
  get: <T>(path: string, params: GraphParams = {}, token?: string) => request<T>("GET", path, params, token),
  post: <T>(path: string, params: GraphParams = {}, token?: string, body?: Record<string, unknown>) => request<T>("POST", path, params, token, body),
  delete: <T>(path: string, params: GraphParams = {}, token?: string) => request<T>("DELETE", path, params, token),

  oauthUrl(state: string, redirectUri: string) {
    const u = new URL(`https://www.facebook.com/${env().META_GRAPH_VERSION}/dialog/oauth`);
    u.searchParams.set("client_id", env().META_APP_ID!);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", env().META_SCOPES);
    u.searchParams.set("response_type", "code");
    return u.toString();
  },
  exchangeCode(code: string, redirectUri: string) {
    return request<{ access_token: string; token_type: string; expires_in?: number }>("GET", "oauth/access_token", { client_id: env().META_APP_ID, client_secret: env().META_APP_SECRET, redirect_uri: redirectUri, code });
  },
  extendUserToken(shortToken: string) {
    return request<{ access_token: string; expires_in?: number }>("GET", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: env().META_APP_ID, client_secret: env().META_APP_SECRET, fb_exchange_token: shortToken });
  },
  debugToken(token: string) {
    return request<{ data: { app_id: string; is_valid: boolean; expires_at?: number; scopes?: string[]; user_id?: string; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>("GET", "debug_token", { input_token: token, access_token: `${env().META_APP_ID}|${env().META_APP_SECRET}` });
  },
  myPages(userToken: string) {
    return request<{ data: { id: string; name: string; access_token: string; category?: string; tasks?: string[]; picture?: { data: { url: string } } }[]; paging?: { next?: string } }>("GET", "me/accounts", { fields: "id,name,access_token,category,tasks,picture{url}", limit: 100 }, userToken);
  },
  permissions(userToken: string) {
    return request<{ data: { permission: string; status: "granted" | "declined" }[] }>("GET", "me/permissions", {}, userToken);
  },
  subscribePage(pageId: string, pageToken: string, fields: string[]) {
    return request<{ success: boolean }>("POST", `${pageId}/subscribed_apps`, { subscribed_fields: fields.join(",") }, pageToken);
  },
  unsubscribePage(pageId: string, pageToken: string) {
    return request<{ success: boolean }>("DELETE", `${pageId}/subscribed_apps`, {}, pageToken);
  },
  subscribedApps(pageId: string, pageToken: string) {
    return request<{ data: { id: string; name: string; subscribed_fields: string[] }[] }>("GET", `${pageId}/subscribed_apps`, {}, pageToken);
  },
  hideComment(commentId: string, pageToken: string, hidden: boolean) {
    return request<{ success: boolean }>("POST", commentId, { is_hidden: hidden }, pageToken);
  },
  replyToComment(commentId: string, pageToken: string, message: string) {
    return request<{ id: string }>("POST", `${commentId}/comments`, { message }, pageToken);
  },
  getComment(commentId: string, pageToken: string) {
    return request<{ id: string; message?: string; is_hidden?: boolean; from?: { id: string; name: string }; created_time: string; permalink_url?: string; parent?: { id: string }; comments?: { data: { id: string; from?: { id: string }; message?: string }[] } }>("GET", commentId, { fields: "id,message,is_hidden,from,created_time,permalink_url,parent,comments.limit(25){id,from,message}" }, pageToken);
  },
  sendMessage(pageId: string, pageToken: string, psid: string, text: string, tag?: string) {
    const body: Record<string, unknown> = { recipient: { id: psid }, message: { text }, messaging_type: tag ? "MESSAGE_TAG" : "RESPONSE" };
    if (tag) body.tag = tag;
    return request<{ recipient_id: string; message_id: string }>("POST", `${pageId}/messages`, {}, pageToken, body);
  },
  userProfile(psid: string, pageToken: string) {
    return request<{ first_name?: string; last_name?: string; name?: string; profile_pic?: string }>("GET", psid, { fields: "first_name,last_name,name,profile_pic" }, pageToken);
  },
};
