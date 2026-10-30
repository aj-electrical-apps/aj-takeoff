import { secret, makeSession, cookieLine, norm, same } from "../lib/session.js";
import { loadUsers, saveUsers, hashPassword, checkPassword, loginOf } from "../lib/team-store.js";
import { randomBytes } from "node:crypto";

// The sign-in page (login.html) talks to this.
// GET  -> { signin, setup, appPw }   setup: nobody has been added yet, so the page offers to make the first admin
// POST { name, password }  or  { setup: true, name, password, appPassword }
const H = { "Cache-Control": "no-store" };
const slow = () => new Promise(r => setTimeout(r, 600)); // makes guessing passwords slow
export async function GET() {
  try {
    const key = secret(), users = key ? await loadUsers() : [];
    return Response.json({ signin: !!key, setup: !!key && !users.length, appPw: !!norm(process.env.APP_PASSWORD) }, { headers: H });
  } catch (e) { return Response.json({ error: e.message }, { status: 500, headers: H }); }
}
export async function POST(request) {
  try {
    const key = secret();
    if (!key) return Response.json({ error: "Sign-in isn't turned on yet (SESSION_SECRET isn't set in Vercel)." }, { status: 400, headers: H });
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 30), pw = String(b.password || "");
    const users = await loadUsers();
    let who = null;
    if (b.setup) {
      if (users.length) return Response.json({ error: "The first admin is already set up. Sign in instead." }, { status: 400, headers: H });
      const app = norm(process.env.APP_PASSWORD);
      if (app && !same(norm(b.appPassword), app)) { await slow(); return Response.json({ error: "That isn't the app's current password." }, { status: 403, headers: H }); }
      if (name.length < 2) return Response.json({ error: "Type your name." }, { status: 400, headers: H });
      if (pw.length < 6) return Response.json({ error: "Use at least 6 characters for the password." }, { status: 400, headers: H });
      const now = new Date().toISOString();
      const u = { id: randomBytes(6).toString("hex"), name, login: loginOf(name), role: "admin", ...hashPassword(pw), v: 0, added: now, by: name, changed: now };
      await saveUsers([u], name);
      who = { n: u.name, r: "admin", id: u.id, v: 0 };
    } else {
      const u = users.find(x => x.login === loginOf(name) && !x.off);
      if (u && checkPassword(u, pw)) who = { n: u.name, r: u.role, id: u.id, v: u.v || 0 };
      else if (norm(process.env.APP_PASSWORD) && same(norm(pw), norm(process.env.APP_PASSWORD))) who = { n: name || "Office", r: "admin", id: "app" };
      else if (norm(process.env.FIELD_PASSWORD) && same(norm(pw), norm(process.env.FIELD_PASSWORD))) who = { n: name || "Field", r: "field", id: "field" };
    }
    if (!who) { await slow(); return Response.json({ error: "That name and password don't match. Check with the office if you've forgotten it." }, { status: 401, headers: H }); }
    return Response.json({ ok: true, name: who.n, role: who.r }, { headers: { ...H, "Set-Cookie": cookieLine(await makeSession(key, who)) } });
  } catch (e) { return Response.json({ error: e.message }, { status: 500, headers: H }); }
}
