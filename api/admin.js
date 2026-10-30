import { secret, whoIs, isPerson, backupKey, norm } from "../lib/session.js";
import { loadUsers, saveUsers, hashPassword, loginOf, ROLES, publicUser } from "../lib/team-store.js";
import { randomBytes } from "node:crypto";

// The Admin page: the people who can sign in, their access and passwords. Admins only.
// GET -> { users, signin, appPw, fieldPw, backupKey }
// POST { op: "add", name, role, password } | { op: "role", id, role } | { op: "reset", id, password }
//      { op: "off", id, off } | { op: "remove", id }
const H = { "Cache-Control": "no-store" };
const bad = (error, status = 400) => Response.json({ error }, { status, headers: H });
async function admin(request, users) {
  const who = await whoIs(request);
  if (!who || who.r !== "admin") return null;
  if (isPerson(who)) { const u = users.find(x => x.id === who.id); if (!u || u.off || u.role !== "admin" || (u.v || 0) !== (who.v || 0)) return null; }
  return who;
}
const info = async users => {
  const key = secret();
  return { users: users.map(publicUser), signin: !!key, appPw: !!norm(process.env.APP_PASSWORD), fieldPw: !!norm(process.env.FIELD_PASSWORD), backupKey: key ? await backupKey(key) : null };
};
export async function GET(request) {
  try {
    const users = await loadUsers();
    if (!await admin(request, users)) return bad("Only an admin can open the Admin page.", 403);
    return Response.json(await info(users), { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
export async function POST(request) {
  try {
    let users = await loadUsers();
    const who = await admin(request, users);
    if (!who) return bad("Only an admin can change who has access.", 403);
    const b = await request.json().catch(() => ({})), now = new Date().toISOString();
    const u = users.find(x => x.id === b.id);
    const pwOk = pw => String(pw || "").length >= 6;
    if (b.op === "add") {
      const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 30);
      if (name.length < 2) return bad("Type the person's name.");
      if (users.some(x => x.login === loginOf(name))) return bad(`${name} is already on the list.`);
      if (!pwOk(b.password)) return bad("Use at least 6 characters for the password.");
      const role = users.length ? (ROLES.includes(b.role) ? b.role : "office") : "admin"; // the first person is always an admin
      users = users.concat({ id: randomBytes(6).toString("hex"), name, login: loginOf(name), role, ...hashPassword(b.password), v: 0, added: now, by: who.n, changed: now });
    } else if (!u) return bad("That person isn't on the list any more.");
    else if (b.op === "role") {
      if (!ROLES.includes(b.role)) return bad("Pick Admin, Office or Field.");
      Object.assign(u, { role: b.role, changed: now });
    } else if (b.op === "reset") {
      if (!pwOk(b.password)) return bad("Use at least 6 characters for the password.");
      Object.assign(u, hashPassword(b.password), { v: (u.v || 0) + 1, changed: now });
    } else if (b.op === "off") {
      Object.assign(u, { off: !!b.off, v: (u.v || 0) + 1, changed: now });
    } else if (b.op === "remove") {
      users = users.filter(x => x !== u);
    } else return bad("Unknown change.");
    if (!users.some(x => x.role === "admin" && !x.off) && (users.length || secret())) return bad("Keep at least one admin who is turned on, or nobody could get back in here.");
    await saveUsers(users, who.n);
    return Response.json(await info(users), { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
