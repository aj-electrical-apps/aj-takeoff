import { secret, readSession, basicWho, norm, same, has } from "./lib/session.js";

// Who can open AJ Takeoff.
// With SESSION_SECRET set (Vercel environment variable, any long random text): everyone signs in on /login.html
// with their own name and password, set up on the app's Admin page. Field people can look but not change the estimate.
// APP_PASSWORD (any name, admin) and FIELD_PASSWORD (any name, field) still work as shared ways in, and the Drive
// backup script signs in with the backup key shown on the Admin page.
// Without SESSION_SECRET it works the old way: a browser password box for APP_PASSWORD / FIELD_PASSWORD,
// and if APP_PASSWORD isn't set either, the site stays open.
const FIELD_BLOCKED = [/^\/api\/bids/, /^\/api\/team-upload/, /^\/api\/share-upload/, /^\/api\/admin/, /^\/api\/aiscan/];
const OPEN = [/^\/login\.html$/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/, /^\/(icon-\d+|apple-touch-icon|favicon)\.png$/, /^\/mark\.svg$/, /^\/api\/login$/, /^\/api\/logout$/, /^\/favicon/];
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
function needs(path, method) {
  const write = method !== "GET" && method !== "HEAD";
  if (/^\/api\/admin/.test(path)) return ["admin"];
  if (/^\/api\/subs/.test(path)) return ["subs", "admin"];
  if (/^\/api\/bids/.test(path)) return ["tracker", "admin"];
  if (/^\/api\/aiscan/.test(path) || (path === "/api/ai" && write)) return ["edit", "admin"];
  if (/^\/api\/(team-upload|share-upload)/.test(path) || (path === "/api/jobs" && write)) return ["edit"];
  if (path === "/api/settings" && write) return ["lists", "admin"];
  if (/^\/api\/field/.test(path) && write) return ["marks", "order", "scale", "edit"];
  if (path === "/api/cos" && write) return ["edit", "cost", "marks", "order", "scale"]; // change orders (v185): everyone who works on a job
  return null;
}
const fieldBlocked = (path, method) => FIELD_BLOCKED.some(r => r.test(path)) || (["/api/jobs", "/api/settings"].includes(path) && method !== "GET");

// Test links (Vercel "preview" builds, one per PR) must never touch the real jobs or real logins (2026-11-24).
// Preview has its own BLOB_STORE_ID (store "aj-takeoff-TEST-only") and its own SESSION_SECRET in Vercel.
// If either is ever missing or pointed back at the real store, the test link stops here instead of using real data.
const REAL_STORE = "RxlaSvRIHU4WVzaz"; // aj-commercial-takeoff-blob: the real jobs
function testCopyProblem() {
  const env = process.env.VERCEL_ENV;
  if (!env || env === "production") return "";
  if (String(process.env.BLOB_STORE_ID || "").includes(REAL_STORE)) return "This test copy is hooked to the REAL jobs, so it is switched off. Ask Claude to fix the test copy settings.";
  if (!String(process.env.BLOB_STORE_ID || "").trim()) return "This test copy has no test jobs store yet. Ask Claude to finish setting up the test copy.";
  if (!secret()) return "This test copy has no sign-in key yet. Ask Claude to finish setting up the test copy.";
  return "";
}

export default async function middleware(request) {
  const key = secret(), url = new URL(request.url), path = url.pathname;
  const stop = testCopyProblem();
  if (stop) return path.startsWith("/api/") ? json({ error: stop }, 503)
    : new Response(stop, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  if (!key) return oldGate(request, path);
  if (OPEN.some(r => r.test(path))) return;
  const who = await readSession(key, request.headers.get("cookie")) || await basicWho(request, key);
  if (!who) {
    if (path.startsWith("/api/")) return json({ error: "Please sign in again.", signin: true }, 401);
    const back = path + url.search;
    return Response.redirect(new URL("/login.html" + (back.length > 1 ? "?next=" + encodeURIComponent(back) : ""), url), 302);
  }
  if (who.id === "backup" && request.method !== "GET") return json({ error: "The backup key can only read." }, 403);
  // what each position can do is set on the Admin page; the sign-in cookie carries it
  const need = needs(path, request.method);
  if (need && !need.some(p => has(who, p))) return json({ error: "Your position doesn't have access to that. Ask an admin." }, 403);
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
