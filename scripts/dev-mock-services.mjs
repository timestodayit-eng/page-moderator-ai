/**
 * Local mock of the OpenAI chat API and the Meta Graph API for end-to-end smoke tests WITHOUT real credentials.
 *   node scripts/dev-mock-services.mjs            (listens on :4010)
 * Then set in .env:  OPENAI_BASE_URL=http://localhost:4010/v1  META_GRAPH_BASE_URL=http://localhost:4010  OPENAI_API_KEY=sk-mock
 * The mock classifies by simple heuristics so you can see the whole pipeline (webhook → worker → review queue → hide).
 */
import http from "node:http";

const log = [];
function classify(text) {
  const t = text.toLowerCase();
  if (/(guarantee|inbox me|pay now|bit\.ly|\.xyz|100%)/.test(t)) return { language: "en", category: "SCAM", sentiment: "negative", confidence: 0.95, risk_score: 0.85, reasoning: "Fraudulent guaranteed-visa offer with a link.", recommended_action: "HIDE", suggested_reply: null };
  if (/(বাটপার|ঠকবাজ|প্রতারক|ধান্দাবাজ|সর্বনাশ|সব শেষ|fraud|thokbaj|dalal|চোর)/.test(t)) return { language: "bn", category: "DEFAMATION", sentiment: "negative", confidence: 0.94, risk_score: 0.7, reasoning: "Accuses the business of cheating / ruining lives without a specific issue.", recommended_action: "HIDE", suggested_reply: null, negative_vibe: true, slang_detected: true };
  if (/(শালা|কুত্তা|madarchod|bokachoda|তোর মায়েরে)/.test(t)) return { language: "bn", category: "ABUSE", sentiment: "negative", confidence: 0.96, risk_score: 0.8, reasoning: "Vulgar slang directed at the business.", recommended_action: "HIDE", suggested_reply: null, negative_vibe: true, slang_detected: true };
  if (/(দূরে থাকেন|কেউ যাবেন না|🙄|sobai jane)/.test(t)) return { language: "bn", category: "NEGATIVE", sentiment: "negative", confidence: 0.9, risk_score: 0.4, reasoning: "Creates a negative impression with no resolvable issue.", recommended_action: "HIDE", suggested_reply: null, negative_vibe: true };
  if (/(সন্তুষ্ট নই|not happy|complaint|ঘুরাচ্ছেন)/.test(t)) return { language: "bn", category: "COMPLAINT", sentiment: "negative", confidence: 0.9, risk_score: 0.2, reasoning: "Specific dissatisfaction with the service.", recommended_action: "REVIEW", suggested_reply: "আপনার অভিজ্ঞতার জন্য আমরা দুঃখিত। অনুগ্রহ করে আমাদের ইনবক্সে আপনার রেফারেন্স নম্বর জানান, আমরা দ্রুত সমাধান করব।" };
  if (/(জানতে চাই|কত|koto|price|salary|details)/.test(t)) return { language: "bn", category: "INQUIRY", sentiment: "neutral", confidence: 0.92, risk_score: 0, reasoning: "Asks for service details.", recommended_action: "REPLY", suggested_reply: "ধন্যবাদ! বিস্তারিত জানতে আমাদের অফিসে কল করুন অথবা ইনবক্স করুন।" };
  return { language: "en", category: "NEUTRAL", sentiment: "neutral", confidence: 0.8, risk_score: 0, reasoning: "General remark.", recommended_action: "KEEP", suggested_reply: null };
}
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    log.push(`${req.method} ${req.url}`);
    const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    // Reviewer rulings in the system prompt: the real model matches by meaning; the mock matches when the new
    // comment shares at least half of a ruling's words (good enough to exercise the pipeline end-to-end).
    const matchRuling = (sys, comment) => {
      const words = (t) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 1));
      const cw = words(comment);
      for (const line of sys.split("\n")) {
        const m = line.match(/^- (\S+) \| (ALWAYS HIDE|NEVER HIDE) \| [^|]+ \| "([\s\S]*?)"(?: \(reviewer note|$)/);
        if (!m) continue;
        const rw = words(m[3]);
        let shared = 0;
        for (const w of rw) if (cw.has(w)) shared++;
        if (rw.size && shared / rw.size >= 0.5) return { id: m[1], decision: m[2] === "ALWAYS HIDE" ? "HIDE" : "KEEP" };
      }
      return null;
    };
    const answer = (sys, text) => {
      const m = text.match(/"""([\s\S]*?)"""/);
      if (!m) return { reply: "ধন্যবাদ! আমরা শীঘ্রই আপনার সাথে যোগাযোগ করব।", confidence: 0.85, escalate: false, reason: "mock" };
      const out = classify(m[1]);
      const ruling = matchRuling(sys, m[1]);
      if (ruling) { out.precedent_match = ruling.id; out.recommended_action = ruling.decision === "HIDE" ? "HIDE" : "KEEP"; out.reasoning += ` Matches ruling ${ruling.id}.`; }
      else out.precedent_match = null;
      return out;
    };
    if (req.url.startsWith("/v1/chat/completions")) {
      const msgs = JSON.parse(body).messages;
      const sys = msgs.filter((x) => x.role === "system").map((x) => x.content).join("\n");
      const out = answer(sys, msgs[msgs.length - 1].content);
      return json({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 600, completion_tokens: 90 }, model: "gpt-4.1-mini" });
    }
    if (req.url.startsWith("/v1/messages")) {
      // Anthropic Messages API mock (BYOK Claude keys). Honour the "{" prefill convention.
      const b = JSON.parse(body);
      if (!req.headers["x-api-key"]) return json({ type: "error", error: { type: "authentication_error", message: "missing x-api-key" } }, 401);
      const user = (b.messages || []).find((x) => x.role === "user")?.content ?? "";
      const out = answer(b.system ?? "", user);
      return json({ id: "msg_mock", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: JSON.stringify(out).slice(1) }], usage: { input_tokens: 600, output_tokens: 90 } });
    }
    if (req.url === "/__log") return json(log);
    // Graph API mock
    const u = new URL(req.url, "http://x");
    if (u.pathname.endsWith("/comments") && req.method === "POST") return json({ id: `reply_${Date.now()}` });
    if (u.pathname.endsWith("/subscribed_apps")) return json(req.method === "GET" ? { data: [{ id: "123456", name: "Mock", subscribed_fields: ["feed", "messages"] }] } : { success: true });
    if (u.pathname.includes("debug_token")) return json({ data: { app_id: "123456", is_valid: true, scopes: ["pages_manage_engagement"] } });
    if (u.searchParams.get("fields")?.includes("is_hidden")) return json({ id: u.pathname.split("/").pop(), is_hidden: false, created_time: new Date().toISOString(), comments: { data: [] } });
    return json({ success: true });
  });
}).listen(4010, () => console.log("mock services on http://localhost:4010"));
