import { list, put, del } from "@vercel/blob";

// The shared Bid tracker list: one JSON file in Vercel Blob. Each save writes a new copy
// (random name, so the address can't be guessed) and removes the older ones.
const PREFIX = "bids/tracker";

async function readAll() {
  const { blobs } = await list({ prefix: PREFIX });
  if (!blobs.length) return { rows: [], old: [] };
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const r = await fetch(blobs[0].url, { cache: "no-store" });
  const data = r.ok ? await r.json() : { rows: [] };
  return { rows: Array.isArray(data.rows) ? data.rows : [], old: blobs.map(b => b.url) };
}
const clean = row => row && typeof row === "object" && typeof row.id === "string" && row.id.length < 80 ? row : null;

export async function GET() {
  try {
    const { rows } = await readAll();
    return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// body: { upsert: [rows] } and/or { remove: [ids] }; rows match on id
export async function POST(request) {
  try {
    const body = await request.json();
    const { rows, old } = await readAll();
    const byId = new Map(rows.map(r => [r.id, r]));
    (Array.isArray(body.upsert) ? body.upsert : []).map(clean).filter(Boolean).forEach(r => byId.set(r.id, { ...byId.get(r.id), ...r }));
    (Array.isArray(body.remove) ? body.remove : []).forEach(id => byId.delete(id));
    const next = [...byId.values()];
    if (JSON.stringify(next).length > 5e6) throw new Error("List too big");
    await put(PREFIX + ".json", JSON.stringify({ rows: next, saved: new Date().toISOString() }), { access: "public", addRandomSuffix: true, contentType: "application/json" });
    if (old.length) await del(old).catch(() => {});
    return Response.json({ rows: next });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
