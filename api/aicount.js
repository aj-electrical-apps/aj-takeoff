import { list, put } from "@vercel/blob";
import { whoIs } from "../lib/session.js";
import { jobOk, jobKey } from "../lib/team-store.js";
import { H, bad, status, askJson, canAi, AI_WHO } from "../lib/ai.js";

/* ---------- v217 AI Counter coworker (Jonathan 2026-11-27: "lets build the take off count tool ... keep it separate from the read one
   in case i dont like it"). Kept apart from the AI Reader on purpose: own file, own saved data (team/aicount/<job>/<sheet>.json),
   own button in the app. To remove it: delete this file and the "AI Counter" block in index.html.
   The app cuts a sheet into a grid of tiles; Claude puts a point on every electrical device symbol it sees and names it.
   Nothing counts until a person picks which count type each kind is and taps Add.
   POST { job, sheet, name, w, h, tiles: [{ x, y, w, h, iw, ih, data }], types: [{ id, name }] }
     -> { name, at, by, model, cost, legend, marks: [{ id, x, y, kind, tag, type }], d: {} }
   POST { op: "decide", job, sheet, ids: [...], d: "y" | "n" | null }   y = added as a count, n = dropped
   GET ?job=<id>               -> { sheets: [{ id, at }] }
   GET ?job=<id>&sheet=<id>    -> the saved count for that sheet */
const SYSTEM = `You help an electrical estimator count devices on construction drawings. You get one drawing sheet cut into numbered tiles
that overlap a little. Find every electrical device SYMBOL drawn on the plan (not in the legend, schedules, details, title block or notes):
receptacles (duplex, quad, GFCI, weatherproof, dedicated, floor boxes, USB), switches (single pole, 3-way, 4-way, dimmer, occupancy sensor),
light fixtures (by their type tag, like A, B2, F5, EM), exit signs, emergency lights, junction boxes, disconnects, data and phone outlets,
fire alarm devices (smoke, heat, horn strobe, strobe, pull station), panels and equipment connections.
For each symbol give the tile it is on and its center point in that tile's own pixels (x across from the left, y down from the top),
a short plain kind name used the same way every time (like "Duplex receptacle", "GFCI receptacle", "Single pole switch", "Light type A",
"Exit sign", "Smoke detector"), and the tag or label written beside it if any (like A, F5, WP, GFI, "a").
Use the legend on the sheet, if there is one, to know what each symbol means. If the job's own count types are listed, use the matching
one's name as the kind and its id as "type"; otherwise leave "type" empty. A symbol in the overlap of two tiles goes in only one of them.
Don't guess: leave out anything you can't tell is an electrical device. Also give "legend": one line per symbol meaning you read off the legend.`;
const SCHEMA = {
  type: "object",
  properties: {
    legend: { type: "array", items: { type: "string" } },
    marks: { type: "array", items: { type: "object", properties: {
      tile: { type: "integer" }, x: { type: "integer" }, y: { type: "integer" },
      kind: { type: "string" }, tag: { type: "string" }, type: { type: "string" },
    }, required: ["tile", "x", "y", "kind", "tag", "type"], additionalProperties: false } },
  },
  required: ["legend", "marks"], additionalProperties: false,
};
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const key = (job, sheet) => `team/aicount/${jobKey(job)}/${jobKey(sheet)}.json`;
const save = (job, sheet, o) => put(key(job, sheet), JSON.stringify(o), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
async function sheetsOf(job) {
  const out = []; let cursor;
  do { const r = await list({ prefix: `team/aicount/${jobKey(job)}/`, limit: 1000, cursor }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  return out.map(b => ({ id: (/\/([\w-]+)\.json$/.exec(b.pathname) || [])[1], at: new Date(b.uploadedAt).getTime(), url: b.url })).filter(x => x.id);
}
async function load(job, sheet) {
  const s = (await sheetsOf(job)).find(x => x.id === jobKey(sheet)); if (!s) return null;
  const r = await fetch(s.url + "?v=" + s.at, { cache: "no-store" }); return r.ok ? { ...(await r.json()), at: s.at } : null;
}
const rid = () => Math.random().toString(36).slice(2, 10);
const who0 = { id: "open", n: "Office", r: "admin", p: "admin" };

export async function GET(request) {
  try {
    const who = await whoIs(request) || who0, u = new URL(request.url), job = u.searchParams.get("job"), sheet = u.searchParams.get("sheet");
    if (!canAi(who)) return bad(AI_WHO, 403);
    if (!job || !(await jobOk(who, job))) return bad("That job isn't shared with you.", 403);
    if (sheet) { const o = await load(job, sheet); return o ? Response.json(o, { headers: H }) : bad("The AI hasn't counted that sheet.", 404); }
    return Response.json({ sheets: (await sheetsOf(job)).map(({ id, at }) => ({ id, at })) }, { headers: H });
  } catch (e) { return bad(e.message || "Couldn't open the AI count.", 500); }
}

export async function POST(request) {
  try {
    const who = await whoIs(request) || who0;
    if (!canAi(who)) return bad(AI_WHO, 403);
    const b = await request.json().catch(() => null);
    if (!b || !b.job || !b.sheet) return bad("Which sheet?");
    if (!(await jobOk(who, b.job))) return bad("That job isn't shared with you.", 403);
    if (b.op === "decide") {
      const o = await load(b.job, b.sheet); if (!o) return bad("That AI count is gone. Count the sheet again.", 404);
      o.d = o.d || {}; (Array.isArray(b.ids) ? b.ids : []).slice(0, 2000).forEach(id => { if (["y", "n"].includes(b.d)) o.d[id] = b.d; else delete o.d[id]; });
      await save(b.job, b.sheet, o); return Response.json({ ...o, at: Date.now() }, { headers: H });
    }
    if (!Array.isArray(b.tiles) || !b.tiles.length || b.tiles.length > 16) return bad("Send the sheet's tiles.");
    const st = await status();
    if (!st.key) return bad("The AI isn't set up (no ANTHROPIC_API_KEY in Vercel).", 400);
    if (!st.on) return bad("The AI is turned off on the Admin page.", 400);
    const W = num(b.w, 1, 1e6), Hh = num(b.h, 1, 1e6);
    const tiles = b.tiles.map(t => ({ x: num(t.x, 0, W), y: num(t.y, 0, Hh), w: num(t.w, 1, W), h: num(t.h, 1, Hh), iw: num(t.iw, 1, 8000), ih: num(t.ih, 1, 8000), data: String(t.data || "") }));
    if (tiles.some(t => !/^[A-Za-z0-9+/=]{100,}$/.test(t.data))) return bad("A tile of the sheet couldn't be read.");
    const types = (Array.isArray(b.types) ? b.types : []).slice(0, 300).map(t => ({ id: String(t.id || "").slice(0, 80), name: String(t.name || "").replace(/\s+/g, " ").slice(0, 80) })).filter(t => t.id && t.name);
    const content = [];
    tiles.forEach((t, i) => { content.push({ type: "text", text: `Tile ${i + 1} of ${tiles.length} (${t.iw} x ${t.ih} pixels):` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: t.data } }); });
    content.push({ type: "text", text: `Sheet name in the app: ${String(b.name || "").slice(0, 120) || "(not named)"}.\n${types.length ? `The job's own count types (id: name):\n${types.map(t => `${t.id}: ${t.name}`).join("\n")}` : "The job has no count types yet."}\nCount every electrical device symbol on all ${tiles.length} tiles.` });
    const r = await askJson(st.model, { system: SYSTEM, content, schema: SCHEMA, maxTokens: 32000 });
    // tile pixels -> sheet pixels; the same kind found twice in an overlap counts once
    const marks = [], near = Math.max(W, Hh) * 0.006;
    (r.out.marks || []).slice(0, 3000).forEach(m => {
      const t = tiles[num(m.tile, 1, tiles.length) - 1]; if (!t) return;
      const x = num(t.x + num(m.x, 0, t.iw) * t.w / t.iw, 0, W), y = num(t.y + num(m.y, 0, t.ih) * t.h / t.ih, 0, Hh);
      const kind = String(m.kind || "").replace(/\s+/g, " ").trim().slice(0, 60) || "Device";
      if (marks.some(o => o.kind === kind && Math.hypot(o.x - x, o.y - y) < near)) return;
      marks.push({ id: rid(), x, y, kind, tag: String(m.tag || "").trim().slice(0, 20), type: types.some(t2 => t2.id === m.type) ? m.type : "" });
    });
    const out = { name: String(b.name || "").slice(0, 120), at: new Date().toISOString(), by: who.n || "Office", model: r.model, w: W, h: Hh,
      legend: (r.out.legend || []).slice(0, 80).map(l => String(l).slice(0, 200)), marks, d: {}, cost: r.cost, cut: r.cut || undefined };
    await save(b.job, b.sheet, out);
    return Response.json({ ...out, at: Date.now() }, { headers: H });
  } catch (e) { return bad(e.message || "The AI couldn't count that sheet.", e.status || 500); }
}
