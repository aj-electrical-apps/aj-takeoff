import { list, put } from "@vercel/blob";
import Anthropic from "@anthropic-ai/sdk";

// AI plan reading (Jonathan 2026-11-06: "try it on one drawing, and if I don't like it, how hard is it to get rid of").
// Claude reads each sheet once; what it reads is saved with the job online (team/ai/<job>/<sheet>.json) so every
// login searches it for free. It only runs when ANTHROPIC_API_KEY is set in Vercel and the Admin switch is on.
// To stop it: Admin > Company & settings > AI plan reading > Off, or delete ANTHROPIC_API_KEY in Vercel.
// Settings: team/admin/ai.json = { on, model, phrases: [key phrases to look for on every job] }
// Prices are dollars per million tokens (input, output).
export const MODELS = {
  "claude-opus-5-5": { name: "Opus 5.5 (reads best)", in: 4, out: 20, fallback: true },
  "claude-sonnet-5-5": { name: "Sonnet 5.5 (about half the cost)", in: 2, out: 10, fallback: true },
  "claude-haiku-5-5": { name: "Haiku 5.5 (cheapest, misses more)", in: 0.1, out: 0.5, fallback: false },
};
export const DEFAULT_MODEL = "claude-opus-5-5";
export const H = { "Cache-Control": "no-store" };
export const bad = (error, status = 400) => Response.json({ error }, { status, headers: H });
export const hasKey = () => !!String(process.env.ANTHROPIC_API_KEY || "").trim();
const CONF = "team/admin/ai.json";

export async function loadConf() {
  let c = {};
  try {
    const { blobs } = await list({ prefix: CONF });
    const b = blobs.find(x => x.pathname === CONF);
    if (b) { const r = await fetch(b.url + "?v=" + new Date(b.uploadedAt).getTime(), { cache: "no-store" }); if (r.ok) c = await r.json(); }
  } catch (e) {}
  return {
    on: c.on !== false,
    model: MODELS[c.model] ? c.model : DEFAULT_MODEL,
    phrases: Array.isArray(c.phrases) ? c.phrases.filter(p => typeof p === "string").slice(0, 60) : [],
    by: c.by || "", at: c.at || "",
  };
}
export const saveConf = c => put(CONF, JSON.stringify(c), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
// what the app needs to know: is there a key, is it on, which model
export async function status() { const c = await loadConf(); return { ...c, key: hasKey(), ready: hasKey() && c.on, models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, in: m.in, out: m.out })) }; }

export const costOf = (model, u) => {
  const m = MODELS[model] || MODELS[DEFAULT_MODEL]; u = u || {};
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  return Math.round((inTok * m.in + (u.output_tokens || 0) * m.out) / 1e6 * 10000) / 10000;
};

// One call to Claude that answers with JSON matching the schema. Streams (sheets can take a minute or two),
// opts into the server-side refusal fallback where the model has one, and says plainly what went wrong.
export async function askJson(model, { system, content, schema, maxTokens = 16000, effort = "low" }) {
  const client = new Anthropic({ maxRetries: 2, timeout: 280000 });
  const base = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content }], output_config: { effort, format: { type: "json_schema", schema } } };
  const run = fb => (fb ? client.beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }) : client.messages.stream(base)).finalMessage();
  let msg;
  try {
    try { msg = await run(MODELS[model] && MODELS[model].fallback); }
    catch (e) { if (e && e.status === 400 && /fallback|beta/i.test(String(e.message))) msg = await run(false); else throw e; }
  } catch (e) {
    const s = e && e.status;
    const why = s === 401 ? "The AI key in Vercel isn't right. Make a new key and paste it into ANTHROPIC_API_KEY again."
      : s === 402 || /credit|billing|balance/i.test(String(e && e.message)) ? "The Anthropic account is out of credit. Add credit at platform.claude.com > Billing."
      : s === 429 ? "The AI is busy (too many at once). Try again in a minute."
      : s === 529 || s === 503 ? "The AI is overloaded right now. Try again in a few minutes."
      : "The AI couldn't be reached" + (e && e.message ? ": " + String(e.message).slice(0, 200) : ".");
    throw Object.assign(new Error(why), { status: s === 401 ? 403 : /out of credit/.test(why) ? 402 : 502 });
  }
  const usage = msg.usage || {}, cost = costOf(msg.model || model, usage);
  if (msg.stop_reason === "refusal") throw Object.assign(new Error("The AI wouldn't read this one."), { status: 422, cost });
  const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  let out;
  try { out = JSON.parse(text); }
  catch (e) {
    if (msg.stop_reason === "max_tokens") throw Object.assign(new Error("This sheet has more words than the AI could write in one go."), { status: 422, cost });
    throw Object.assign(new Error("The AI's answer couldn't be read."), { status: 502, cost });
  }
  return { out, usage, cost, model: msg.model || model, cut: msg.stop_reason === "max_tokens" };
}
