import { list, put, del } from "@vercel/blob";

// The team's jobs, kept in Vercel Blob so everyone using the app sees the same list.
// Every save of a job is its own JSON file at team/data/<job id>/m<details>-<random>.json, uploaded straight
// from the app (api/team-upload). <details> is the job's name, GC, bid date and so on, so listing the files
// is enough to show the job list without opening them. The newest file for a job is its current copy; the few
// before it are kept in case one needs to come back. A deleted job gets a small "deleted" file on top.
// Plan sheets are their own images under team/sheet/<job id>/, listed inside each job's JSON.
const KEEP = 4; // the current copy plus three older ones

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
function parse(b) {
  const m = /^team\/data\/([\w-]{1,80})\/m([A-Za-z0-9_-]+)-[A-Za-z0-9]+\.json$/.exec(b.pathname);
  if (!m) return null;
  let d = {};
  try { d = JSON.parse(Buffer.from(m[2], "base64url").toString()); } catch (e) {}
  return { id: m[1], name: d.n || "Untitled job", customer: d.c || "", address: d.a || "", bidDate: d.b || "", created: d.cr || "", updated: d.u || "", sheets: d.s || 0, by: d.by || "",
    deleted: d.d ? String(b.uploadedAt) : undefined, url: b.url, saved: new Date(b.uploadedAt).toISOString(), size: b.size };
}
async function files(prefix) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, limit: 1000, cursor });
    r.blobs.forEach(b => { const f = parse(b); if (f) out.push(f); });
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.saved.localeCompare(a.saved));
}
const jobFiles = id => files(`team/data/${id}/`);
const okId = id => typeof id === "string" && /^[\w-]{1,80}$/.test(id);

export async function GET(request) {
  try {
    const q = new URL(request.url).searchParams, id = q.get("id");
    if (id) {
      if (!okId(id)) return Response.json({ error: "Bad job" }, { status: 400 });
      const [current] = await jobFiles(id);
      return Response.json({ current: current || null }, { headers: { "Cache-Control": "no-store" } });
    }
    const newest = new Map();
    (await files("team/data/")).forEach(f => { if (!newest.has(f.id)) newest.set(f.id, f); });
    const jobs = [...newest.values()].filter(f => q.get("all") === "1" || !f.deleted).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// { op: "tidy", id }    after a save: removes all but the newest few copies of that job
// { op: "delete", id, by }   { op: "restore", id }
export async function POST(request) {
  try {
    const body = await request.json();
    if (!okId(body.id)) return Response.json({ error: "Bad job" }, { status: 400 });
    const all = await jobFiles(body.id);
    if (body.op === "tidy") {
      const extra = all.slice(KEEP).map(f => f.url);
      if (extra.length) await del(extra);
      return Response.json({ removed: extra.length });
    }
    if (body.op === "delete") {
      const cur = all[0];
      if (!cur || cur.deleted) return Response.json({ ok: true }); // never saved online, or already deleted
      const d = { d: 1, n: cur.name, u: new Date().toISOString(), by: String(body.by || "").slice(0, 40) };
      await put(`team/data/${body.id}/m${b64(d)}.json`, "{}", { access: "public", contentType: "application/json", addRandomSuffix: true });
      return Response.json({ ok: true });
    }
    if (body.op === "restore") {
      const marks = [];
      for (const f of all) { if (!f.deleted) break; marks.push(f.url); }
      if (marks.length) await del(marks);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown request" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
