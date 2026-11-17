import { list, put, del } from "@vercel/blob";
import { whoIs } from "../lib/session.js";
import { jobOk as mayOpen } from "../lib/team-store.js";

// Change orders, shared by every login on a job (v185, Jonathan 2026-11-17: "When a change order is made only the one
// that is making it can see the material list and the change order number").
// Each change order is saved on its own, apart from the job, so the office, PM, super and precon all see the same list:
//   team/cos/<job>/n-<number>.json        claims a change order number. Blob refuses a second file with the same name,
//                                         so two people making a change order at the same moment never get the same number.
//   team/cos/<job>/r-<co id>-<random>.json the change order itself (name, date, what changed, bid, proposal). Newest wins.
const KEEP = 3;
const okId = id => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
const coSeg = id => String(id || "").replace(/[^\w-]/g, "_").slice(0, 60);
async function blobs(job) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: `team/cos/${job}/`, limit: 1000, cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
// what's saved for one job: the numbers taken, and every change order's copies, newest first
function sortOut(job, all) {
  const nums = new Set(), recs = new Map();
  all.forEach(b => {
    const rest = b.pathname.slice(`team/cos/${job}/`.length);
    let m = /^n-(\d{1,5})\.json$/.exec(rest);
    if (m) return nums.add(+m[1]);
    m = /^r-([\w-]{1,60})-[A-Za-z0-9]+\.json$/.exec(rest);
    if (m) { const l = recs.get(m[1]) || []; l.push(b); recs.set(m[1], l); }
  });
  recs.forEach(l => l.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
  return { nums, recs };
}
async function readRec(b) {
  const r = await fetch(b.url, { cache: "no-store" });
  if (!r.ok) throw new Error("Couldn't read a change order");
  return r.json();
}
async function writeRec(job, rec, older) {
  const b = await put(`team/cos/${job}/r-${coSeg(rec.id)}.json`, JSON.stringify(rec), { access: "public", addRandomSuffix: true, contentType: "application/json", cacheControlMaxAge: 60 });
  const extra = (older || []).slice(KEEP - 1).map(x => x.url);
  if (extra.length) await del(extra).catch(() => {});
  return b.url;
}
// take the first free number from `want` up; Blob says no if someone else just took it, so try the next one
async function claim(job, want, nums, coId) {
  let n = Math.max(1, want);
  for (let i = 0; i < 50; i++, n++) {
    if (nums.has(n)) continue;
    try {
      await put(`team/cos/${job}/n-${n}.json`, JSON.stringify({ co: coId, at: new Date().toISOString() }), { access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
      return n;
    } catch (e) {
      if (!/exist/i.test(String(e && e.message))) throw e;
      nums.add(n);
    }
  }
  throw new Error("No change order number free");
}
const clean = (co, who) => {
  const { id, n, deleted, pend, ...rest } = co || {};
  return { ...rest, id: String(id), at: new Date().toISOString(), by: who ? who.n || "" : String(co.by || "").slice(0, 40) };
};

export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!okId(id) || !await mayOpen(await whoIs(request), id)) return Response.json({ error: "Bad job" }, { status: 400 });
    const { recs } = sortOut(id, await blobs(id));
    const newest = await Promise.all([...recs.values()].map(l => readRec(l[0]).catch(() => null)));
    const cos = [], gone = [];
    newest.forEach(r => { if (!r || !r.id) return; if (r.deleted) gone.push(r.id); else cos.push(r); });
    cos.sort((a, b) => a.n - b.n);
    return Response.json({ cos, gone }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// { op: "save", id: <job>, co }   a new change order gets the next free number (or the one it asks for, when free);
//                                  one already online keeps its number and the rest is replaced
// { op: "delete", id: <job>, co: { id } }
export async function POST(request) {
  try {
    const body = await request.json(), job = body.id, co = body.co;
    const who = await whoIs(request);
    if (!okId(job) || !co || !co.id || String(co.id).length > 80 || !await mayOpen(who, job)) return Response.json({ error: "Bad request" }, { status: 400 });
    if (JSON.stringify(co).length > 4e6) return Response.json({ error: "Too big" }, { status: 400 });
    const { nums, recs } = sortOut(job, await blobs(job));
    const older = recs.get(coSeg(co.id)) || [];
    const prev = older[0] ? await readRec(older[0]).catch(() => null) : null;
    if (body.op === "delete") {
      if (!prev) return Response.json({ ok: true });
      await writeRec(job, { id: String(co.id), n: prev.n, deleted: true, at: new Date().toISOString(), by: who ? who.n || "" : "" }, older);
      return Response.json({ ok: true });
    }
    if (body.op !== "save") return Response.json({ error: "Unknown request" }, { status: 400 });
    if (prev && prev.deleted && !body.restore) return Response.json({ co: prev, deleted: true });
    let n = prev && prev.n;
    if (!n) {
      const max = Math.max(0, ...nums);
      const want = Number.isInteger(+co.n) && +co.n > 0 && !nums.has(+co.n) ? +co.n : max + 1;
      n = await claim(job, want, nums, String(co.id));
    }
    const rec = { ...clean(co, who), n, made: (prev && prev.made) || co.made || new Date().toISOString() };
    await writeRec(job, rec, older);
    return Response.json({ co: rec });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
