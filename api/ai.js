import { list } from "@vercel/blob";
import { whoIs, has } from "../lib/session.js";
import { jobOk, jobKey } from "../lib/team-store.js";
import { MODELS, H, bad, status, loadConf, saveConf, askJson } from "../lib/ai.js";

// AI plan reading: settings, what's been read on a job, and "find what I mean".
// GET              -> { key, on, ready, model, models, phrases }
// GET ?job=<id>    -> the same + sheets: [{ id, at, url }]  (every sheet the AI has read on this job)
// GET ?job=<id>&sheet=<id> -> what the AI read on that sheet: { name, at, by, model, sz, w, h, title, notes: [{ t, k, r }], cost }
// POST { op: "set", on, model, phrases }  admins turn it on/off and pick the model; office people can change the key phrases
// POST { op: "ask", q }  -> { phrases: [...] }  other ways the same thing is written on drawings (about a penny)
const who0 = { id: "open", n: "Office", r: "admin", p: "admin" };
const okId = id => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
async function sheetsOf(job) {
  const out = []; let cursor;
  do { const r = await list({ prefix: `team/ai/${jobKey(job)}/`, limit: 1000, cursor }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  return out.map(b => ({ id: (/\/([\w-]+)\.json$/.exec(b.pathname) || [])[1], at: new Date(b.uploadedAt).getTime(), url: b.url })).filter(x => x.id);
}

export async function GET(request) {
  try {
    const who = await whoIs(request) || who0, u = new URL(request.url), job = u.searchParams.get("job"), sheet = u.searchParams.get("sheet");
    const st = await status();
    if (!job) return Response.json(st, { headers: H });
    if (!okId(job) && !/^[^/]{1,120}$/.test(job)) return bad("Which job?");
    if (!(await jobOk(who, job))) return bad("That job isn't shared with you.", 403);
    const sheets = await sheetsOf(job);
    if (sheet) {
      const s = sheets.find(x => x.id === jobKey(sheet)); if (!s) return bad("The AI hasn't read that sheet.", 404);
      const r = await fetch(s.url + "?v=" + s.at, { cache: "no-store" }); if (!r.ok) return bad("Couldn't open what the AI read.", 502);
      return Response.json({ ...(await r.json()), id: s.id, at: s.at }, { headers: H });
    }
    return Response.json({ ...st, sheets: sheets.map(({ id, at }) => ({ id, at })) }, { headers: H });
  } catch (e) { return bad(e.message || "Couldn't check the AI.", 500); }
}

export async function POST(request) {
  try {
    const who = await whoIs(request) || who0, b = await request.json().catch(() => ({}));
    if (b.op === "set") {
      const c = await loadConf(), admin = has(who, "admin");
      if (("on" in b || "model" in b) && !admin) return bad("Only an admin can turn the AI on or off.", 403);
      if ("on" in b) c.on = !!b.on;
      if ("model" in b) { if (!MODELS[b.model]) return bad("Pick one of the listed AI models."); c.model = b.model; }
      if (Array.isArray(b.phrases)) c.phrases = [...new Set(b.phrases.map(p => String(p || "").replace(/\s+/g, " ").trim().slice(0, 80)).filter(Boolean))].slice(0, 60);
      await saveConf({ on: c.on, model: c.model, phrases: c.phrases, by: who.n || "Office", at: new Date().toISOString() });
      return Response.json(await status(), { headers: H });
    }
    if (b.op === "ask") {
      const st = await status();
      if (!st.key) return bad("The AI isn't set up (no ANTHROPIC_API_KEY in Vercel).", 400);
      if (!st.on) return bad("The AI is turned off on the Admin page.", 400);
      const q = String(b.q || "").replace(/\s+/g, " ").trim().slice(0, 120); if (!q) return bad("What should it look for?");
      const r = await askJson(st.model, {
        system: "You help an electrical estimator search the text of construction drawings (electrical, lighting, power, fire alarm, low voltage, mechanical and architectural sheets).",
        content: [{ type: "text", text: `They searched for: "${q}"\n\nList up to 15 short phrases (1 to 4 words each) that are how the same thing is likely written on drawings: the phrase itself, abbreviations, spelled-out forms, singular and plural, and common alternate wordings or tags used on electrical drawings. Only phrases that mean the same thing, nothing broader.` }],
        schema: { type: "object", properties: { phrases: { type: "array", items: { type: "string" } } }, required: ["phrases"], additionalProperties: false },
        maxTokens: 4000,
      });
      const phrases = [...new Set([q, ...(r.out.phrases || []).map(p => String(p).trim()).filter(p => p && p.length <= 60)])].slice(0, 16);
      return Response.json({ phrases, cost: r.cost }, { headers: H });
    }
    return bad("Unknown request.");
  } catch (e) { return bad(e.message || "The AI didn't answer.", e.status || 500); }
}
