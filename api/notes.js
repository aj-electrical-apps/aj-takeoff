import { list, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { whoIs, has, roleKey } from "../lib/session.js";
import { loadTeam, jobsFor } from "../lib/team-store.js";
import { translate } from "../lib/translate.js";

// Highlight a part of a drawing and send it to people you pick; they answer back (Jonathan 2026-10-30).
// Each message is its own file: team/notes/<note id>/n.json (the highlight and first message) and
// team/notes/<note id>/r-<time>-<random>.json for every answer. Messages are kept in English and Spanish.
// Only the sender, the people it went to and admins can read a note; a subcontractor only on jobs shared with them.
// GET ?job=<id> -> { notes: [...] }   (no job = every note for me)
// POST { op: "new", job, jobName, page, pageName, rect: {x,y,w,h}, to: [ids], text, lang }
// POST { op: "reply", id, text, lang }
// Either can carry photo: "data:image/jpeg;base64,..." (stamped with date and time by the app) and photoAt; it's saved as
// team/notes/<note id>/p-<time>-<random>.jpg and the message keeps its address (Jonathan 2026-10-31).
const H = { "Cache-Control": "no-store" };
const bad = (error, status = 400) => Response.json({ error }, { status, headers: H });
const okId = id => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
const meOf = who => who.id || "open";
async function all() {
  const out = [];
  let cursor;
  do { const r = await list({ prefix: "team/notes/", limit: 1000, cursor }); out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  const byNote = new Map();
  out.forEach(b => {
    const m = /^team\/notes\/([\w-]+)\/(n|r-[\w-]+)\.json$/.exec(b.pathname);
    if (!m) return;
    const n = byNote.get(m[1]) || { id: m[1], head: null, replies: [] };
    if (m[2] === "n") n.head = b; else n.replies.push(b);
    byNote.set(m[1], n);
  });
  return byNote;
}
const read = async b => { const r = await fetch(b.url, { cache: "no-store" }); return r.ok ? r.json() : null; };
const canSee = (n, who, jobs) => (has(who, "admin") || n.from.id === meOf(who) || n.to.includes(meOf(who))) && (!jobs || jobs.has(n.job));
async function message(text, lang, who, request, photo) {
  text = String(text || "").trim().slice(0, 4000);
  const t = text ? await translate(text, request) : null;
  return { by: who.n || "Someone", byId: meOf(who), at: new Date().toISOString(), text, lang: t ? t.from : lang === "es" ? "es" : "en", en: t ? t.en : null, es: t ? t.es : null, ...(photo || {}) };
}
// a photo from the app: a JPEG under 4 MB, saved next to the note's messages
function photoBytes(b) {
  if (!b.photo) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
  if (!m) throw Object.assign(new Error("That photo couldn't be read."), { status: 400 });
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 4 * 1024 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) throw Object.assign(new Error("That photo is too big or isn't a picture."), { status: 400 });
  return buf;
}
async function savePhoto(noteId, buf, b) {
  if (!buf) return null;
  const r = await put(`team/notes/${noteId}/p-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}.jpg`, buf, { access: "public", addRandomSuffix: false, contentType: "image/jpeg" });
  const at = Date.parse(b.photoAt);
  return { photo: r.url, photoAt: Number.isFinite(at) ? new Date(at).toISOString() : new Date().toISOString() };
}
export async function GET(request) {
  try {
    const who = await whoIs(request) || { id: "open", n: "Office", r: "admin", p: "admin" };
    const job = new URL(request.url).searchParams.get("job");
    const { users } = await loadTeam();
    const jobs = jobsFor(users, who);
    const heads = [...(await all()).values()].filter(n => n.head);
    const notes = (await Promise.all(heads.map(async n => {
      const h = await read(n.head);
      if (!h || (job && h.job !== job) || !canSee(h, who, jobs)) return null;
      const rs = (await Promise.all(n.replies.sort((a, b) => a.pathname.localeCompare(b.pathname)).map(read))).filter(Boolean);
      return { ...h, id: n.id, msgs: [h.msg, ...rs] };
    }))).filter(Boolean).map(n => { delete n.msg; return n; });
    notes.sort((a, b) => b.msgs[b.msgs.length - 1].at.localeCompare(a.msgs[a.msgs.length - 1].at));
    return Response.json({ me: meOf(who), notes }, { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
export async function POST(request) {
  try {
    const who = await whoIs(request) || { id: "open", n: "Office", r: "admin", p: "admin" };
    const b = await request.json().catch(() => ({}));
    let buf;
    try { buf = photoBytes(b); } catch (e) { return bad(e.message, e.status || 400); }
    if (!String(b.text || "").trim() && !buf) return bad("Type a message or add a photo.");
    const { users } = await loadTeam();
    const jobs = jobsFor(users, who);
    const put1 = (path, o) => put(path, JSON.stringify(o), { access: "public", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
    if (b.op === "new") {
      if (!okId(b.job) || (jobs && !jobs.has(b.job))) return bad("That job isn't shared with you.", 403);
      const live = new Set(users.filter(u => !u.off).map(u => u.id));
      const to = [...new Set((Array.isArray(b.to) ? b.to : []).filter(id => live.has(id) && id !== meOf(who)))];
      if (!to.length) return bad("Pick who it goes to.");
      const r = b.rect || {}, num = v => Math.round(Number(v) || 0);
      const id = Date.now().toString(36) + randomBytes(4).toString("hex");
      const head = { app: "aj-takeoff", kind: "note", job: b.job, jobName: String(b.jobName || "").slice(0, 120), page: String(b.page || "").slice(0, 120), pageName: String(b.pageName || "").slice(0, 80),
        rect: { x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) }, from: { id: meOf(who), name: who.n || "Someone" }, to, toNames: to.map(id => (users.find(u => u.id === id) || {}).name || ""),
        msg: await message(b.text, b.lang, who, request, await savePhoto(id, buf, b)) };
      await put1(`team/notes/${id}/n.json`, head);
      return Response.json({ ok: true, id }, { headers: H });
    }
    if (b.op === "reply") {
      if (!okId(b.id)) return bad("Bad message.");
      const n = (await all()).get(b.id);
      const h = n && n.head && await read(n.head);
      if (!h || !canSee(h, who, jobs)) return bad("That message isn't yours to answer.", 403);
      const m = await message(b.text, b.lang, who, request, await savePhoto(b.id, buf, b));
      await put1(`team/notes/${b.id}/r-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}.json`, m);
      return Response.json({ ok: true, msg: m }, { headers: H });
    }
    return bad("Unknown change.");
  } catch (e) { return bad(e.message, 500); }
}
