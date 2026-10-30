import { list, put, del } from "@vercel/blob";
import { whoIs, has } from "../lib/session.js";
import { loadSettings, saveSettings } from "../lib/team-store.js";

// Settings everyone shares: company details, labor hours, parts lists, standard exclusions and vendor lists.
// They're the same localStorage values the app always kept, so the app just copies them in and out.
// Admins change them straight away. Office people's changes come in as suggestions
// (team/admin/suggest/<id>-<random>.json) that an admin approves or turns down on the Admin page.
// GET  -> { url, saved, by, data, pending: [suggestion], decided: { id: "ok" | "no" } }
// POST { data, by }                       admins: replace the shared settings
//      { op: "suggest", diff, by }        office: suggest a change
//      { op: "decide", id, ok }           admins: approve or turn down a suggestion
const KEYS = /^aj-(company|labor-edits|asm-edits|excl-std|list-(sup|natl|falv|lp))$/;
const H = { "Cache-Control": "no-store" };
const bad = (error, status = 400) => Response.json({ error }, { status, headers: H });
async function suggestions() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: "team/admin/suggest/", limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.map(b => ({ id: (/suggest\/([\w-]+?)-[A-Za-z0-9]+\.json$/.exec(b.pathname) || [])[1], url: b.url, at: new Date(b.uploadedAt).toISOString() })).filter(x => x.id);
}
const cleanDiff = diff => {
  const out = {};
  Object.entries(diff || {}).forEach(([k, d]) => {
    if (!KEYS.test(k) || !d || typeof d !== "object") return;
    out[k] = { set: d.set && typeof d.set === "object" ? d.set : {}, del: Array.isArray(d.del) ? d.del : [], add: Array.isArray(d.add) ? d.add : [], arr: !!d.arr };
  });
  return out;
};
// apply a suggestion to the current shared value of each setting
function applyDiff(data, diff) {
  Object.entries(diff).forEach(([k, d]) => {
    let cur;
    try { cur = JSON.parse(data[k] || (d.arr ? "[]" : "{}")); } catch (e) { cur = d.arr ? [] : {}; }
    if (d.arr) {
      if (!Array.isArray(cur)) cur = [];
      cur = cur.filter(x => !d.del.includes(x));
      d.add.forEach(x => { if (!cur.includes(x)) cur.push(x); });
    } else {
      if (!cur || typeof cur !== "object" || Array.isArray(cur)) cur = {};
      Object.assign(cur, d.set); d.del.forEach(x => { delete cur[x]; });
    }
    data[k] = JSON.stringify(cur);
  });
  return data;
}
export async function GET() {
  try {
    const s = await loadSettings(), wrap = s.data || {}, decided = wrap.decided || {};
    const pending = [];
    for (const f of await suggestions()) {
      if (decided[f.id]) { del(f.url).catch(() => {}); continue; }
      try { const r = await fetch(f.url); if (r.ok) pending.push({ ...(await r.json()), id: f.id, at: f.at }); } catch (e) {}
    }
    pending.sort((a, b) => a.at.localeCompare(b.at));
    return Response.json({ url: s.url || null, saved: s.saved || null, by: wrap.by || "", data: wrap.data || {}, pending, decided }, { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
export async function POST(request) {
  try {
    const who = await whoIs(request);
    if (!who || !(has(who, "lists") || has(who, "admin"))) return bad("Your position can't change these lists.", 403);
    const b = await request.json().catch(() => ({})), by = String(b.by || who.n || "").slice(0, 30);
    if (b.op === "suggest") {
      const diff = cleanDiff(b.diff);
      if (!Object.keys(diff).length) return bad("Nothing changed.");
      if (JSON.stringify(diff).length > 2e6) return bad("That change is too big.");
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await put(`team/admin/suggest/${id}.json`, JSON.stringify({ by, diff }), { access: "public", addRandomSuffix: true, contentType: "application/json" });
      return Response.json({ id }, { headers: H });
    }
    if (!has(who, "admin")) return bad("Only an admin can change the shared settings. Your change was sent for approval instead.", 403);
    const s = await loadSettings(), wrap = s.data || {}, data = { ...(wrap.data || {}) }, decided = { ...(wrap.decided || {}) };
    if (b.op === "decide") {
      const f = (await suggestions()).find(x => x.id === b.id);
      if (!f || decided[b.id]) return bad("That change was already handled.");
      const sug = await (await fetch(f.url)).json();
      if (b.ok) applyDiff(data, cleanDiff(sug.diff));
      decided[b.id] = b.ok ? "ok" : "no";
      const keep = Object.keys(decided).slice(-200), d2 = {}; keep.forEach(k => { d2[k] = decided[k]; });
      const url = await saveSettings(data, b.ok ? by : wrap.by || "", d2);
      del(f.url).catch(() => {});
      return Response.json({ url, data }, { headers: H });
    }
    const next = {};
    Object.entries(b.data || {}).forEach(([k, v]) => { if (KEYS.test(k) && typeof v === "string") next[k] = v; });
    if (JSON.stringify(next).length > 3e6) return bad("Settings are too big.");
    const url = await saveSettings(next, by, decided);
    return Response.json({ url, saved: new Date().toISOString() }, { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
