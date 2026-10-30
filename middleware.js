import { secret, readSession, basicWho, norm, same } from "./lib/session.js";

// Who can open AJ Takeoff.
// With SESSION_SECRET set (Vercel environment variable, any long random text): everyone signs in on /login.html
// with their own name and password, set up on the app's Admin page. Field people can look but not change the estimate.
// APP_PASSWORD (any name, admin) and FIELD_PASSWORD (any name, field) still work as shared ways in, and the Drive
// backup script signs in with the backup key shown on the Admin page.
// Without SESSION_SECRET it works the old way: a browser password box for APP_PASSWORD / FIELD_PASSWORD,
// and if APP_PASSWORD isn't set either, the site stays open.
const FIELD_BLOCKED = [/^\/api\/bids/, /^\/api\/team-upload/, /^\/api\/share-upload/, /^\/api\/admin/];
const OPEN = [/^\/login\.html$/, /^\/sw\.js$/, /^\/api\/login$/, /^\/api\/logout$/, /^\/favicon/];
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fieldBlocked = (path, method) => FIELD_BLOCKED.some(r => r.test(path)) || (["/api/jobs", "/api/settings"].includes(path) && method !== "GET");

export default async function middleware(request) {
  const key = secret(), url = new URL(request.url), path = url.pathname;
  if (!key) return oldGate(request, path);
  if (OPEN.some(r => r.test(path))) return;
  const who = await readSession(key, request.headers.get("cookie")) || await basicWho(request, key);
  if (!who) {
    if (path.startsWith("/api/")) return json({ error: "Please sign in again.", signin: true }, 401);
    const back = path + url.search;
    return Response.redirect(new URL("/login.html" + (back.length > 1 ? "?next=" + encodeURIComponent(back) : ""), url), 302);
  }
  if (who.r === "field" && fieldBlocked(path, request.method)) return json({ error: "The field login can't change the estimate." }, 403);
  if (who.id === "backup" && request.method !== "GET") return json({ error: "The backup key can only read." }, 403);
}

function oldGate(request, path) {
  const office = norm(process.env.APP_PASSWORD), field = norm(process.env.FIELD_PASSWORD);
  if (!office) return;
  const auth = request.headers.get("authorization") || "";
  if (/^basic /i.test(auth)) {
    let raw = "";
    try { raw = new TextDecoder().decode(Uint8Array.from(atob(auth.slice(6).trim()), c => c.charCodeAt(0))); } catch (e) {}
    const i = raw.indexOf(":"), user = i < 0 ? raw : raw.slice(0, i), pass = i < 0 ? "" : raw.slice(i + 1);
    const is = want => same(norm(pass), want) || same(norm(user), want) || same(norm(raw), want);
    if (is(office)) return;
    if (field && is(field)) {
      if (fieldBlocked(path, request.method)) return json({ error: "The field login can't change the estimate." }, 403);
      return;
    }
  }
  return new Response("Password needed for AJ Takeoff. Reload the page to try again. The user name can be anything.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AJ Takeoff", charset="UTF-8"', "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}
