import { secret, readSession, basicWho, makeSession, cookieLine, clearCookie, whoIs, isPerson, norm } from "../lib/session.js";
import { loadUsers } from "../lib/team-store.js";

// Tells the app who is using it: { role: "office" | "field", admin, name, signin }.
// For a signed-in person it checks they're still on the Admin page's list, turned on and with the same password;
// if not, they're signed out. Otherwise their sign-in is renewed for another 30 days.
const H = { "Cache-Control": "no-store" };
const answer = (who, signin, extra = {}) => Response.json({ role: who.r === "field" ? "field" : "office", admin: who.r === "admin", name: who.n || "", signin, locked: signin || !!norm(process.env.APP_PASSWORD) }, { headers: { ...H, ...extra } });
export async function GET(request) {
  try {
    const key = secret();
    if (!key) return answer(await whoIs(request) || { r: "office" }, false);
    let who = await readSession(key, request.headers.get("cookie"));
    if (!who) {
      who = await basicWho(request, key);
      return who ? answer(who, true) : Response.json({ error: "Please sign in again.", signin: true }, { status: 401, headers: H });
    }
    if (isPerson(who)) {
      const u = (await loadUsers()).find(x => x.id === who.id);
      if (!u || u.off || (u.v || 0) !== (who.v || 0))
        return Response.json({ error: "Please sign in again.", signin: true }, { status: 401, headers: { ...H, "Set-Cookie": clearCookie() } });
      who = { n: u.name, r: u.role, id: u.id, v: u.v || 0 };
    }
    return answer(who, true, { "Set-Cookie": cookieLine(await makeSession(key, who)) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500, headers: H });
  }
}
