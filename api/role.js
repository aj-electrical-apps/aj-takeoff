import { secret, readSession, basicWho, makeSession, cookieLine, clearCookie, whoIs, isPerson, norm, permsFor, roleKey } from "../lib/session.js";
import { loadTeam } from "../lib/team-store.js";

// Tells the app who is using it: { role (position key), position (its name), perms, admin, name, signin }.
// For a signed-in person it checks they're still on the Admin page's list, turned on and with the same password;
// if not, they're signed out. Otherwise their sign-in is renewed for another 30 days with their position's
// current access, so a change on the Admin page reaches them the next time the app checks.
const H = { "Cache-Control": "no-store" };
function answer(who, signin, positions, extra = {}) {
  const r = roleKey(who.r), perms = who.p != null ? String(who.p).split(",").filter(Boolean) : permsFor(positions, r);
  const pos = positions.find(p => p.key === r);
  return Response.json({ role: perms.includes("edit") ? "office" : "field", position: r, positionName: pos ? pos.name : r, perms, admin: perms.includes("admin"), name: who.n || "", signin,
    locked: signin || !!norm(process.env.APP_PASSWORD) }, { headers: { ...H, ...extra } });
}
export async function GET(request) {
  try {
    const key = secret();
    const { users, positions } = await loadTeam();
    if (!key) {
      const who = await whoIs(request) || { r: "admin", n: "Office" };
      return answer({ ...who, p: permsFor(positions, who.r).join(",") }, false, positions);
    }
    let who = await readSession(key, request.headers.get("cookie"));
    if (!who) {
      who = await basicWho(request, key);
      return who ? answer(who, true, positions) : Response.json({ error: "Please sign in again.", signin: true }, { status: 401, headers: H });
    }
    if (isPerson(who)) {
      const u = users.find(x => x.id === who.id);
      if (!u || u.off || (u.v || 0) !== (who.v || 0))
        return Response.json({ error: "Please sign in again.", signin: true }, { status: 401, headers: { ...H, "Set-Cookie": clearCookie() } });
      who = { n: u.name, r: roleKey(u.role), id: u.id, v: u.v || 0 };
    }
    who = { ...who, p: permsFor(positions, who.r).join(",") };
    return answer(who, true, positions, { "Set-Cookie": cookieLine(await makeSession(key, who)) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: H });
  }
}
