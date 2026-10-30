import { randomBytes } from "node:crypto";
import { whoIs, has, roleKey } from "../lib/session.js";
import { loadTeam, saveUsers, hashPassword, loginOf, publicUser } from "../lib/team-store.js";
import { SUB } from "../lib/positions.js";

// Subcontractor sign-ins, run by a PM (or anyone whose position has "Add subcontractors").
// Only touches people in the Subcontractor position.
// GET -> { subs }
// POST { op: "add", name, company, lang, password, jobs } | { op: "jobs", id, jobs } | { op: "reset", id, password }
//      { op: "off", id, off } | { op: "lang", id, lang } | { op: "remove", id }
const H = { "Cache-Control": "no-store" };
const bad = (error, status = 400) => Response.json({ error }, { status, headers: H });
const okJobs = j => Array.isArray(j) ? [...new Set(j.filter(x => typeof x === "string" && /^[\w-]{1,80}$/.test(x)))].slice(0, 300) : [];
async function allowed(request) {
  const who = await whoIs(request);
  return who && (has(who, "subs") || has(who, "admin")) ? who : null;
}
export async function GET(request) {
  try {
    if (!await allowed(request)) return bad("Your position can't add subcontractors. Ask an admin.", 403);
    const { users } = await loadTeam();
    return Response.json({ subs: users.filter(u => roleKey(u.role) === SUB).map(publicUser) }, { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
export async function POST(request) {
  try {
    const who = await allowed(request);
    if (!who) return bad("Your position can't add subcontractors. Ask an admin.", 403);
    const b = await request.json().catch(() => ({}));
    let { users, positions } = await loadTeam();
    const now = new Date().toISOString();
    const pw = p => typeof p === "string" && p.trim().length >= 6;
    if (b.op === "add") {
      const name = String(b.name || "").trim().slice(0, 40);
      if (!name) return bad("Type the sub's name.");
      if (!pw(b.password)) return bad("The password needs at least 6 letters or numbers.");
      if (users.some(u => u.login === loginOf(name))) return bad(`Someone named ${name} is already on the list. Add the company or a last initial.`);
      users = users.concat({ id: randomBytes(6).toString("hex"), name, login: loginOf(name), role: SUB, company: String(b.company || "").trim().slice(0, 60), lang: b.lang === "es" ? "es" : "en",
        jobs: okJobs(b.jobs), ...hashPassword(b.password.trim()), v: 0, added: now, by: who.n, changed: now });
    } else {
      const u = users.find(x => x.id === b.id && roleKey(x.role) === SUB);
      if (!u) return bad("That subcontractor isn't on the list anymore.", 404);
      if (b.op === "jobs") Object.assign(u, { jobs: okJobs(b.jobs), changed: now });
      else if (b.op === "lang") Object.assign(u, { lang: b.lang === "es" ? "es" : "en", changed: now });
      else if (b.op === "reset") { if (!pw(b.password)) return bad("The password needs at least 6 letters or numbers."); Object.assign(u, hashPassword(b.password.trim()), { v: (u.v || 0) + 1, changed: now }); }
      else if (b.op === "off") Object.assign(u, { off: !!b.off, v: (u.v || 0) + 1, changed: now });
      else if (b.op === "remove") users = users.filter(x => x !== u);
      else return bad("Unknown change.");
    }
    await saveUsers(users, who.n, positions);
    return Response.json({ ok: true, subs: users.filter(u => roleKey(u.role) === SUB).map(publicUser) }, { headers: H });
  } catch (e) { return bad(e.message, 500); }
}
