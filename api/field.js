import { list, del } from "@vercel/blob";

// The field layer of each job: the PM's and super's ghost marks and runs, and their Order page.
// Saved apart from the job (team/field/<job id>/m<details>-<random>.json) so nothing in the field ever
// touches the office estimate. The newest file is current; a few older ones are kept.
const KEEP = 6;
async function files(id) {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: `team/field/${id}/`, limit: 1000, cursor });
    r.blobs.forEach(b => {
      const m = /^team\/field\/[\w-]{1,80}\/m([A-Za-z0-9_-]+)-[A-Za-z0-9]+\.json$/.exec(b.pathname);
      if (!m) return;
      let d = {}; try { d = JSON.parse(Buffer.from(m[1], "base64url").toString()); } catch (e) {}
      out.push({ url: b.url, by: d.by || "", saved: new Date(b.uploadedAt).toISOString() });
    });
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.saved.localeCompare(a.saved));
}
const okId = id => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!okId(id)) return Response.json({ error: "Bad job" }, { status: 400 });
    const [current] = await files(id);
    return Response.json({ current: current || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
// { op: "tidy", id }: keeps the newest few copies
export async function POST(request) {
  try {
    const body = await request.json();
    if (body.op !== "tidy" || !okId(body.id)) return Response.json({ error: "Bad request" }, { status: 400 });
    const extra = (await files(body.id)).slice(KEEP).map(f => f.url);
    if (extra.length) await del(extra);
    return Response.json({ removed: extra.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
