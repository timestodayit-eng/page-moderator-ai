import { vi } from "vitest";

/**
 * Fetch-level mocks for Meta Graph API and AI providers. Records every call so tests can assert on
 * duplicates. Attach with `installMocks()`; override specific behaviours per test.
 */
export type MockState = { graphCalls: { method: string; url: string; body?: string }[]; aiCalls: number; aiResponse: () => unknown; lastAnthropicRequest?: { headers: Record<string, string>; body: unknown }; graphFail?: (url: string) => Response | null; commentReplies: Record<string, { id: string; from: { id: string }; message: string }[]> };

export const mock: MockState = { graphCalls: [], aiCalls: 0, aiResponse: () => ({}), commentReplies: {} };

export function resetMocks() {
  mock.graphCalls = [];
  mock.aiCalls = 0;
  mock.graphFail = undefined;
  mock.commentReplies = {};
  mock.aiResponse = () => ({ language: "bn", category: "SPAM", sentiment: "neutral", confidence: 0.96, risk_score: 0.8, reasoning: "Promotional spam", recommended_action: "HIDE", intent: "spam", suggested_reply: null });
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function installMocks() {
  resetMocks();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    if (url.includes("graph.facebook.com")) {
      mock.graphCalls.push({ method, url: url.replace(/access_token=[^&]+/, "access_token=***"), body: typeof init?.body === "string" ? init.body : undefined });
      const failed = mock.graphFail?.(url);
      if (failed) return failed;
      const u = new URL(url);
      const path = u.pathname.split("/").slice(2).join("/");
      if (path.endsWith("/comments") && method === "POST") {
        const id = `reply_${mock.graphCalls.length}`;
        const parent = path.replace("/comments", "");
        (mock.commentReplies[parent] ??= []).push({ id, from: { id: "PAGE1" }, message: u.searchParams.get("message") ?? "" });
        return json({ id });
      }
      if (path.endsWith("/messages") && method === "POST") return json({ recipient_id: "psid", message_id: `m_${mock.graphCalls.length}` });
      if (path.endsWith("/subscribed_apps")) return method === "GET" ? json({ data: [{ id: "123456", name: "App", subscribed_fields: ["feed", "messages"] }] }) : json({ success: true });
      if (path === "debug_token") return json({ data: { app_id: "123456", is_valid: true, scopes: ["pages_show_list", "pages_manage_engagement"] } });
      if (path === "me/permissions") return json({ data: ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_engagement", "pages_manage_metadata", "pages_messaging"].map((p) => ({ permission: p, status: "granted" })) });
      if (path === "me/accounts") return json({ data: [{ id: "PAGE1", name: "Coastal Manpower", access_token: "EAAPAGE1TOKEN", category: "Business", tasks: ["MODERATE"] }, { id: "PAGE2", name: "Second Page", access_token: "EAAPAGE2TOKEN" }] });
      if (path === "oauth/access_token") return json({ access_token: "EAAUSERTOKEN", expires_in: 5000000 });
      if (u.searchParams.get("is_hidden") !== null && method === "POST") return json({ success: true });
      if (method === "GET" && u.searchParams.get("fields")?.includes("is_hidden")) return json({ id: path, message: "x", is_hidden: false, created_time: new Date().toISOString(), comments: { data: mock.commentReplies[path] ?? [] } });
      if (method === "GET" && u.searchParams.get("fields")?.includes("first_name")) return json({ name: "Test Customer", first_name: "Test" });
      return json({ success: true });
    }
    if (url.includes("api.openai.com") || url.includes("api.deepseek.com")) {
      mock.aiCalls++;
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
      const text = body.messages.at(-1)?.content ?? "";
      const out = mock.aiResponse();
      const sys = body.messages.find((m) => m.role === "system")?.content ?? "";
      const resp = typeof out === "function" ? (out as (t: string, sys: string) => unknown)(text, sys) : out;
      return json({ choices: [{ message: { content: JSON.stringify(resp) } }], usage: { prompt_tokens: 500, completion_tokens: 120 }, model: "gpt-4.1-mini" });
    }
    if (url.includes("api.anthropic.com")) {
      mock.aiCalls++;
      mock.lastAnthropicRequest = { headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body ?? "{}")) };
      const body = mock.lastAnthropicRequest.body as { system?: string; messages: { role: string; content: string }[] };
      const user = body.messages.find((m) => m.role === "user")?.content ?? "";
      const out = mock.aiResponse();
      const resp = typeof out === "function" ? (out as (t: string, sys: string) => unknown)(user, body.system ?? "") : out;
      // Anthropic returns the continuation after the "{" prefill — reproduce that quirk.
      const textOut = JSON.stringify(resp).slice(1);
      return json({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [{ type: "text", text: textOut }], usage: { input_tokens: 500, output_tokens: 120 } });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      mock.aiCalls++;
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(mock.aiResponse()) }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 120 } });
    }
    throw new Error(`Unexpected fetch in tests: ${url}`);
  });
}
