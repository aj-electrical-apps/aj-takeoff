import { whoIs, roleKey } from "../lib/session.js";
import { loadTeam } from "../lib/team-store.js";

// Who a message on the drawings can go to: everyone who's turned on, with their position.
// A subcontractor sees the company's people, not the other subs.
export async function GET(request) {
  try {
    const who = await whoIs(request);
    const { users, positions } = await loadTeam();
    const name = k => (positions.find(p => p.key === k) || {}).name || k;
    const sub = who && roleKey(who.r) === "sub";
    const people = users.filter(u => !u.off && (!sub || roleKey(u.role) !== "sub"))
      .map(u => ({ id: u.id, name: u.name, role: roleKey(u.role), position: name(roleKey(u.role)), lang: u.lang || "en", company: u.company || "", jobs: roleKey(u.role) === "sub" ? u.jobs || [] : undefined }));
    return Response.json({ me: who ? who.id : null, people }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
