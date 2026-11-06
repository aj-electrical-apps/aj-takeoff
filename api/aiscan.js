import { put } from "@vercel/blob";
import { whoIs } from "../lib/session.js";
import { jobOk, jobKey } from "../lib/team-store.js";
import { H, bad, status, askJson } from "../lib/ai.js";

// Read one sheet with Claude and save the words with the job (team/ai/<job>/<sheet>.json), once per sheet.
// The app cuts the sheet into a few overlapping tiles (JPEG, each small enough for Claude to see at full size):
// POST { job, sheet, name, sz, w, h, tiles: [{ x, y, w, h, iw, ih, data }] }
//   x, y, w, h = where the tile is on the sheet (sheet pixels); iw, ih = the JPEG's own size; data = base64 JPEG
// -> the saved reading: { name, at, by, model, sz, w, h, title, notes: [{ t, k, r: [x, y, w, h] }], cost, usage }
const SYSTEM = `You read construction drawings for an electrical contractor's estimator, so they can search the words later.
You get one drawing sheet cut into numbered tiles that overlap a little at the edges.
Write down the readable text on the sheet as blocks:
- every general note, keyed note and keynote (one block per numbered note, with its number),
- every schedule or table row (one block per row, the cells joined with " | "), and each schedule's title,
- callouts and labels on the drawing (circuit and panel tags, fixture and device tags, equipment names and tags, "EXISTING TO REMAIN", "BY OTHERS" and the like),
- room names and numbers,
- the sheet number and title.
Skip dimensions, grid line labels, north arrows, scale bars, the architect's and engineer's names, addresses, stamps and revision clouds' dates.
Copy the words as written (keep abbreviations); don't explain or summarize. If a word is too small or blurry to read, leave it out rather than guess.
For each block give the tile it is on and its box in that tile's own pixels (left, top, right, bottom), measured from the tile's top left corner.
Text that sits in the overlap of two tiles goes in only one of them.`;
const SCHEMA = {
  type: "object",
  properties: {
    sheet: { type: "string", description: "Sheet number and title, like E2.1 LIGHTING PLAN - LEVEL 1" },
    blocks: { type: "array", items: { type: "object", properties: {
      tile: { type: "integer" },
      kind: { type: "string", enum: ["note", "keynote", "schedule", "label", "room", "title", "other"] },
      text: { type: "string" },
      left: { type: "integer" }, top: { type: "integer" }, right: { type: "integer" }, bottom: { type: "integer" },
    }, required: ["tile", "kind", "text", "left", "top", "right", "bottom"], additionalProperties: false } },
  },
  required: ["sheet", "blocks"],
  additionalProperties: false,
};
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));

export async function POST(request) {
  try {
    const who = await whoIs(request) || { id: "open", n: "Office", r: "admin", p: "admin" };
    const b = await request.json().catch(() => null);
    if (!b || !b.job || !b.sheet || !Array.isArray(b.tiles) || !b.tiles.length || b.tiles.length > 9) return bad("Send the sheet's tiles.");
    if (!(await jobOk(who, b.job))) return bad("That job isn't shared with you.", 403);
    const st = await status();
    if (!st.key) return bad("The AI isn't set up (no ANTHROPIC_API_KEY in Vercel).", 400);
    if (!st.on) return bad("The AI is turned off on the Admin page.", 400);
    const W = num(b.w, 1, 1e6), Hh = num(b.h, 1, 1e6);
    const tiles = b.tiles.map(t => ({ x: num(t.x, 0, W), y: num(t.y, 0, Hh), w: num(t.w, 1, W), h: num(t.h, 1, Hh), iw: num(t.iw, 1, 8000), ih: num(t.ih, 1, 8000), data: String(t.data || "") }));
    if (tiles.some(t => !/^[A-Za-z0-9+/=]{100,}$/.test(t.data))) return bad("A tile of the sheet couldn't be read.");
    const content = [];
    tiles.forEach((t, i) => {
      content.push({ type: "text", text: `Tile ${i + 1} of ${tiles.length} (${t.iw} x ${t.ih} pixels):` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: t.data } });
    });
    content.push({ type: "text", text: `Sheet name in the app: ${String(b.name || "").slice(0, 120) || "(not named)"}. Read all ${tiles.length} tiles.` });
    const r = await askJson(st.model, { system: SYSTEM, content, schema: SCHEMA, maxTokens: 32000 });
    // tile pixels -> sheet pixels; drop a block a neighboring tile already has
    const notes = [];
    (r.out.blocks || []).forEach(k => {
      const t = tiles[num(k.tile, 1, tiles.length) - 1], text = String(k.text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
      if (!t || !text) return;
      const sx = t.w / t.iw, sy = t.h / t.ih, l = Math.min(k.left, k.right), r2 = Math.max(k.left, k.right), tp = Math.min(k.top, k.bottom), bt = Math.max(k.top, k.bottom);
      const x = num(t.x + num(l, 0, t.iw) * sx, 0, W), y = num(t.y + num(tp, 0, t.ih) * sy, 0, Hh);
      const rr = [x, y, Math.max(8, num((num(r2, 0, t.iw) - num(l, 0, t.iw)) * sx, 0, W - x)), Math.max(8, num((num(bt, 0, t.ih) - num(tp, 0, t.ih)) * sy, 0, Hh - y))];
      const low = text.toLowerCase(), cx = rr[0] + rr[2] / 2, cy = rr[1] + rr[3] / 2;
      if (notes.some(n => n.t.toLowerCase() === low && Math.abs(n.r[0] + n.r[2] / 2 - cx) < 200 && Math.abs(n.r[1] + n.r[3] / 2 - cy) < 200)) return;
      notes.push({ t: text, k: String(k.kind || "other"), r: rr });
    });
    const out = { name: String(b.name || "").slice(0, 120), at: new Date().toISOString(), by: who.n || "Office", model: r.model, sz: +b.sz || 0, w: W, h: Hh,
      title: String(r.out.sheet || "").slice(0, 200), notes, cost: r.cost, usage: r.usage, cut: r.cut || undefined };
    await put(`team/ai/${jobKey(b.job)}/${jobKey(b.sheet)}.json`, JSON.stringify(out), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
    return Response.json(out, { headers: H });
  } catch (e) { return bad(e.message || "The AI couldn't read that sheet.", e.status || 500); }
}
