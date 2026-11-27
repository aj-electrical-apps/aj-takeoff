import { list, put } from "@vercel/blob";
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
// v207 (Jonathan 2026-11-25: "add it only in admin for now"): only Admin logins see it or spend on it
export const ADMIN_ONLY = "AI plan reading is only for Admin logins for now.";
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
    if (!has(who, "admin")) Object.assign(st, { ready: false, adminOnly: true });
    if (!job) return Response.json(st, { headers: H });
    if (!okId(job) && !/^[^/]{1,120}$/.test(job)) return bad("Which job?");
    if (!(await jobOk(who, job))) return bad("That job isn't shared with you.", 403);
    const sheets = await sheetsOf(job);
    if (u.searchParams.get("flags")) { if (!has(who, "admin")) return bad(ADMIN_ONLY, 403); return Response.json(await loadFlags(job), { headers: H }); }
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
      if (!has(who, "admin")) return bad(ADMIN_ONLY, 403);
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
    if (b.op === "review" || b.op === "decide") {
      if (!has(who, "admin")) return bad(ADMIN_ONLY, 403);
      if (!b.job || !(await jobOk(who, b.job))) return bad("That job isn't shared with you.", 403);
      if (b.op === "decide") return Response.json(await decide(who, b.job, String(b.id || ""), ["r", "y", "q", "n"].includes(b.d) ? b.d : null), { headers: H });
      const st = await status();
      if (!st.key) return bad("The AI isn't set up (no ANTHROPIC_API_KEY in Vercel).", 400);
      if (!st.on) return bad("The AI is turned off on the Admin page.", 400);
      return Response.json(await review(who, st, b.job, b.sheets), { headers: H });
    }
    return bad("Unknown request.");
  } catch (e) { return bad(e.message || "The AI didn't answer.", e.status || 500); }
}

/* ---------- v214 AI Reader coworker (Jonathan 2026-11-27: "co workers in the app ... others read everything and mark it up") ----------
   After the AI has read the sheets (aiscan), the Reader goes over the words of a group of sheets at once and flags what an
   electrical estimator must not miss. Flags are saved with the job (team/aiflags/<job>.json) and show as teal boxes until
   someone turns each one into a red note, yellow note or RFI, or skips it. Nothing counts until a person accepts it.
   { at, by, flags: [{ id, sheet, name, r: [x, y, w, h], t, cat, lvl, why, ask, at, by, model }], d: { <flagId>: { d: "r"|"y"|"q"|"n", by, at } }, runs: [...] } */
export const FLAG_CATS = ["scope", "alternate", "material", "device", "lighting", "equipment", "lowvolt", "general", "conflict", "question"];
const READER = `You are an experienced commercial electrical estimator's second set of eyes. You get the words an AI copied off a job's drawing sheets
(and spec pages if they were loaded as sheets), as numbered blocks like [s2n14]. Flag the blocks an estimator must not miss when pricing the electrical work:
- scope: work by others / by owner / not in contract (NIC) / owner furnished contractor installed (OFCI) / by EC / by division 26 vs 23 or 28,
- alternate: alternates, allowances, unit prices, add/deduct items, phasing,
- material: required materials or methods (conduit types, MC allowed or not, aluminum, minimum wire size, plenum rated, home run rules, separate neutrals, copper only),
- device: device requirements (GFCI, AFCI, tamper or weather resistant, hospital or spec grade, colors, mounting heights that change the device or box, USB, floor boxes),
- lighting: fixture schedule items, emergency or battery units, lighting controls, occupancy and daylight sensors, dimming, lighting control panels, programming,
- equipment: equipment connections, disconnects, VFDs, starters (and who furnishes them), generators, transfer switches, EV chargers, solar,
- lowvolt: fire alarm, data, security, access control, AV, nurse call, empty raceway systems,
- general: temporary power, permits, testing, commissioning, demolition, existing to remain or relocate, working hours, coordination that costs money,
- conflict: two sheets or a sheet and a spec say different things,
- question: something unclear or missing that needs an RFI.
Only flag things that change the price, the counts or what gets bought, or that a careful estimator would write down. Skip boilerplate code references,
sheet titles, plain room names, plain device tags and anything obvious. One flag per item; if the same thing is written on several sheets, flag it once and list
all its block numbers. Level: "red" = it changes price, counts or materials; "yellow" = good to know; "rfi" = needs a question to the architect or engineer.
"why" is one or two short plain-English sentences to the estimator saying what to do about it (like "Price tamper resistant receptacles everywhere, not standard.").
For "rfi" also write "ask": the question to send, polite and specific. Write at most 80 flags, the most important first.
Also write "summary": a short scope summary for the estimator, 4 to 12 lines, each with a heading (like "Our scope", "By others",
"Alternates", "Lighting", "Power and equipment", "Fire alarm and low voltage", "Watch out for") and one or two plain sentences,
with the block numbers it comes from so they can check it on the drawings. Only say what the blocks say; don't guess.
Also say whether this looks like a national account: a job for a national or regional chain, brand or franchise (stores, restaurants, banks,
hotels, pharmacies, auto parts, dollar stores and the like) that has its own prototype drawings, standards, national vendors or owner-furnished
packages. Give the brand name, why you think so, and the block numbers. And list every contact on the sheets that has an email address or phone
number (name, company, role, email, phone, block numbers), copying emails exactly as written.`;
const FLAG_SCHEMA = {
  type: "object",
  properties: {
    flags: { type: "array", items: { type: "object", properties: {
    refs: { type: "array", items: { type: "string" } },
    cat: { type: "string", enum: FLAG_CATS },
    lvl: { type: "string", enum: ["red", "yellow", "rfi"] },
    why: { type: "string" }, ask: { type: "string" },
  }, required: ["refs", "cat", "lvl", "why", "ask"], additionalProperties: false } },
    summary: { type: "array", items: { type: "object", properties: {
      head: { type: "string" }, text: { type: "string" }, refs: { type: "array", items: { type: "string" } },
    }, required: ["head", "text", "refs"], additionalProperties: false } },
    national: { type: "object", properties: {
      is: { type: "string", enum: ["yes", "no", "maybe"] }, brand: { type: "string" }, why: { type: "string" }, refs: { type: "array", items: { type: "string" } },
    }, required: ["is", "brand", "why", "refs"], additionalProperties: false },
    contacts: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, company: { type: "string" }, role: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, refs: { type: "array", items: { type: "string" } },
    }, required: ["name", "company", "role", "email", "phone", "refs"], additionalProperties: false } },
  },
  required: ["flags", "summary", "national", "contacts"], additionalProperties: false,
};
const flagKey = job => `team/aiflags/${jobKey(job)}.json`;
export async function loadFlags(job) {
  try {
    const { blobs } = await list({ prefix: flagKey(job) });
    const b = blobs.find(x => x.pathname === flagKey(job));
    if (b) { const r = await fetch(b.url + "?v=" + new Date(b.uploadedAt).getTime(), { cache: "no-store" }); if (r.ok) { const o = await r.json(); return { flags: [], d: {}, runs: [], sums: [], ...o }; } }
  } catch (e) {}
  return { flags: [], d: {}, runs: [], sums: [] };
}
const saveFlags = (job, o) => put(flagKey(job), JSON.stringify(o), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
const rid = () => Math.random().toString(36).slice(2, 10);
const MAX_CHARS = 320000; // about 80k tokens of drawing words in one go; the app sends bigger jobs in groups of sheets
export async function review(who, st, job, sheetIds) {
  const all = await sheetsOf(job), want = [...new Set((sheetIds || []).map(String))].slice(0, 200), got = [];
  for (let i = 0; i < want.length; i += 8) await Promise.all(want.slice(i, i + 8).map(async (id, k) => {
    const s = all.find(x => x.id === jobKey(id)); if (!s) return;
    try { const r = await fetch(s.url + "?v=" + s.at, { cache: "no-store" }); if (r.ok) got[i + k] = { id, ...(await r.json()) }; } catch (e) {}
  }));
  const reads = got.filter(Boolean);
  if (!reads.length) throw Object.assign(new Error("The AI hasn't read these sheets yet. Read them first."), { status: 400 });
  let text = "", n = 0;
  reads.forEach((s, i) => {
    text += `\n=== Sheet s${i}: ${s.name || "(not named)"}${s.title ? " · " + s.title : ""} ===\n`;
    (s.notes || []).forEach((b, j) => { if (b && b.t) { text += `[s${i}n${j}] (${b.k}) ${b.t}\n`; n++; } });
  });
  if (!n) throw Object.assign(new Error("The AI found no words on these sheets."), { status: 400 });
  if (text.length > MAX_CHARS) throw Object.assign(new Error("Too many words to check at once."), { status: 413 });
  const r = await askJson(st.model, { system: READER, content: [{ type: "text", text: `The job's sheets:\n${text}\n\n${(st.phrases || []).length ? `This company also always wants these flagged wherever they show up (their "key phrases"): ${st.phrases.join("; ")}.\n\n` : ""}Flag what the estimator must not miss.` }], schema: FLAG_SCHEMA, maxTokens: 32000 });
  const now = new Date().toISOString(), fresh = [];
  const refsOf = a => (a || []).map(x => /^\[?s(\d+)n(\d+)\]?$/.exec(String(x).trim())).filter(Boolean).map(m => ({ s: reads[+m[1]], b: reads[+m[1]] && (reads[+m[1]].notes || [])[+m[2]] })).filter(x => x.s && x.b);
  (r.out.flags || []).slice(0, 80).forEach(f => {
    const refs = refsOf(f.refs);
    if (!refs.length) return;
    const s = refs[0].s, here = refs.filter(x => x.s === s).map(x => x.b.r);
    const x0 = Math.min(...here.map(q => q[0])), y0 = Math.min(...here.map(q => q[1])), x1 = Math.max(...here.map(q => q[0] + q[2])), y1 = Math.max(...here.map(q => q[1] + q[3]));
    const also = [...new Set(refs.filter(x => x.s !== s).map(x => x.s.name || "another sheet"))];
    fresh.push({ id: rid(), sheet: s.id, name: String(s.name || "").slice(0, 120), r: [x0, y0, Math.max(8, x1 - x0), Math.max(8, y1 - y0)],
      t: refs.filter(x => x.s === s).map(x => x.b.t).join(" … ").slice(0, 600), also: also.slice(0, 8),
      cat: FLAG_CATS.includes(f.cat) ? f.cat : "general", lvl: ["red", "yellow", "rfi"].includes(f.lvl) ? f.lvl : "yellow",
      why: String(f.why || "").slice(0, 500), ask: f.lvl === "rfi" ? String(f.ask || "").slice(0, 800) : "", at: now, by: who.n || "Office", model: r.model });
  });
  const o = await loadFlags(job), sheets = new Set(reads.map(s => s.id)), dec = o.d || {};
  // a new run replaces the undecided flags on these sheets; flags someone already decided stay, and the same thing isn't flagged twice
  const keep = o.flags.filter(f => !sheets.has(f.sheet) || dec[f.id]);
  const same = (a, b) => a.sheet === b.sheet && a.t.toLowerCase() === b.t.toLowerCase();
  o.flags = [...keep, ...fresh.filter(f => !keep.some(k => same(k, f)))];
  // the scope summary from this group of sheets replaces the one from any earlier run on the same sheets
  const lines = (r.out.summary || []).slice(0, 16).map(l => ({ head: String(l.head || "").slice(0, 60), text: String(l.text || "").slice(0, 600),
    refs: refsOf(l.refs).slice(0, 6).map(x => ({ sheet: x.s.id, name: String(x.s.name || "").slice(0, 120), r: x.b.r, t: String(x.b.t).slice(0, 300) })) })).filter(l => l.text);
  o.sums = [...(o.sums || []).filter(g => !(g.sheets || []).some(id => sheets.has(id))), { sheets: [...sheets], at: now, by: who.n || "Office", lines }];
  // national account and contacts (Jonathan 2026-11-27: "is it a national account and if it is list the email so they can be copy and pasted")
  const refOf = a => refsOf(a).slice(0, 4).map(x => ({ sheet: x.s.id, name: String(x.s.name || "").slice(0, 120), r: x.b.r, t: String(x.b.t).slice(0, 300) }));
  const nat = r.out.national || {}, nOld = o.national && !(o.national.sheets || []).every(id => sheets.has(id)) ? o.national : null;
  const nNew = { is: ["yes", "no", "maybe"].includes(nat.is) ? nat.is : "no", brand: String(nat.brand || "").slice(0, 80), why: String(nat.why || "").slice(0, 400), refs: refOf(nat.refs), sheets: [...sheets] };
  const rank = { yes: 2, maybe: 1, no: 0 };
  o.national = nOld && rank[nOld.is] > rank[nNew.is] ? nOld : nNew;
  const EM = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, cs = (o.contacts || []).filter(c => !sheets.has(c.sheet));
  const addC = c => { const e = String(c.email || "").trim().toLowerCase(); if (e && cs.some(x => x.email.toLowerCase() === e)) return; if (!e && !c.phone) return;
    if (!e && cs.some(x => !x.email && x.phone === c.phone)) return; cs.push(c); };
  (r.out.contacts || []).slice(0, 60).forEach(c => { const rf = refOf(c.refs); const m = String(c.email || "").match(EM);
    addC({ name: String(c.name || "").slice(0, 80), company: String(c.company || "").slice(0, 80), role: String(c.role || "").slice(0, 60), email: m ? m[0] : "", phone: String(c.phone || "").slice(0, 40), sheet: rf[0] ? rf[0].sheet : reads[0].id, refs: rf }); });
  // any email the AI copied off a sheet but didn't list as a contact
  reads.forEach(sh => (sh.notes || []).forEach(b => (String(b.t || "").match(EM) || []).forEach(e => addC({ name: "", company: "", role: "", email: e, phone: "", sheet: sh.id, refs: [{ sheet: sh.id, name: String(sh.name || "").slice(0, 120), r: b.r, t: String(b.t).slice(0, 300) }] }))));
  o.contacts = cs.slice(0, 150);
  o.runs = [...(o.runs || []), { at: now, by: who.n || "Office", sheets: reads.length, flags: fresh.length, cost: r.cost, model: r.model }].slice(-50);
  o.at = now; o.by = who.n || "Office";
  await saveFlags(job, o);
  return { ...o, cost: r.cost, added: fresh.length };
}
export async function decide(who, job, id, d) {
  const o = await loadFlags(job);
  if (!o.flags.some(f => f.id === id)) throw Object.assign(new Error("That AI flag is gone. Open the AI Reader again."), { status: 404 });
  o.d = o.d || {};
  if (d) o.d[id] = { d, by: who.n || "Office", at: new Date().toISOString() }; else delete o.d[id];
  await saveFlags(job, o);
  return o;
}
