import { secret, whoIs, isPerson, backupKey, norm, roleKey } from "../lib/session.js";
import { loadTeam, saveUsers, hashPassword, loginOf, publicUser } from "../lib/team-store.js";
import { PERMS, ALL, positionsOf } from "../lib/positions.js";
import { randomBytes } from "node:crypto";

// The Admin page: the people who can sign in, their positions and passwords, and what each position can do. Admins only.
// GET -> { users, positions, perms, signin, appPw, fieldPw, backupKey }
// POST { op: "add", name, role, password } | { op: "role", id, role } | { op: "rename", id, name } | { op: "reset", id, password }
//      { op: "off", id, off } | { op: "remove", id } | { op: "positions", positions: [{ key, name, perms }] }
const H = { "Cache-Control": "no-store" };
const bad = (error, status = 400) => Response.json({ error }, { status, headers: H });
async function admin(request, users) {
  const who = await whoIs(request);
  if (!who || roleKey(who.r) !== "admin") return null;
  if (isPerson(who)) { const u = users.find(x => x.id === who.id); if (!u || u.off || roleKey(u.role) !== "admin" || (u.v || 0) !== (who.v || 0)) return null; }
  return who;
}
const info = async (users, positions) => {
  const key = secret();
  return { users: users.map(publicUser), positions, perms: PERMS, signin: !!key, appPw: !!norm(process.env.APP_PASSWORD), fieldPw: !!norm(process.env.FIELD_PASSWORD), backupKey: key ? await backupKey(key) : null };
};
export async function GET(request) {
  try {
    const { users, positions } = await loadTeam();
    if (!await admin(request, users)) return bad("Only an admin can open the Admin page.", 403);
    return Response.json(await info(users, positions), { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
export async function POST(request) {
  try {
    let { users, positions } = await loadTeam();
    const who = await admin(request, users);
    if (!who) return bad("Only an admin can change who has access.", 403);
    const b = await request.json().catch(() => ({})), now = new Date().toISOString();
    const u = users.find(x => x.id === b.id);
    const pwOk = pw => String(pw || "").length >= 6;
    const okRole = r => positions.some(p => p.key === r);
    if (b.op === "positions") {
      if (!Array.isArray(b.positions)) return bad("No positions sent.");
      const seen = new Set(), next = [];
      for (const p of b.positions) {
        const key = String(p.key || "").replace(/[^\w-]/g, "").slice(0, 30), name = String(p.name || "").trim().slice(0, 40);
        if (!key || seen.has(key)) continue;
        if (!name) return bad("Every position needs a name.");
        seen.add(key); next.push({ key, name, perms: (p.perms || []).filter(x => ALL.includes(x)) });
      }
      const gone = users.filter(x => !next.some(p => p.key === roleKey(x.role)));
      if (gone.length) return bad(`Move ${gone.map(x => x.name).join(", ")} to another position first.`);
      positions = positionsOf(next);
    } else if (b.op === "add") {
      const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 30);
      if (name.length < 2) return bad("Type the person's name.");
      if (users.some(x => x.login === loginOf(name))) return bad(`${name} is already on the list.`);
      if (!pwOk(b.password)) return bad("Use at least 6 characters for the password.");
      const role = users.length ? (okRole(b.role) ? b.role : "estimator") : "admin"; // the first person is always an admin
      users = users.concat({ id: randomBytes(6).toString("hex"), name, login: loginOf(name), role, ...hashPassword(b.password), v: 0, added: now, by: who.n, changed: now });
    } else if (!u) return bad("That person isn't on the list any more.");
    else if (b.op === "role") {
      if (!okRole(b.role)) return bad("Pick one of the positions.");
      Object.assign(u, { role: b.role, changed: now });
    } else if (b.op === "rename") {
      const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 30);
      if (name.length < 2) return bad("Type the person's name.");
      if (users.some(x => x !== u && x.login === loginOf(name))) return bad(`${name} is already on the list.`);
      Object.assign(u, { name, login: loginOf(name), changed: now });
    } else if (b.op === "reset") {
      if (!pwOk(b.password)) return bad("Use at least 6 characters for the password.");
      Object.assign(u, hashPassword(b.password), { v: (u.v || 0) + 1, changed: now });
    } else if (b.op === "off") {
      Object.assign(u, { off: !!b.off, v: (u.v || 0) + 1, changed: now });
    } else if (b.op === "remove") {
      users = users.filter(x => x !== u);
    } else return bad("Unknown change.");
    if (!users.some(x => roleKey(x.role) === "admin" && !x.off) && (users.length || secret())) return bad("Keep at least one admin who is turned on, or nobody could get back in here.");
    await saveUsers(users, who.n, positions);
    return Response.json(await info(users, positions), { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
