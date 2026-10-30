// Asks for a password before anything on the site loads.
// APP_PASSWORD (Vercel environment variable) is the office password: everything works.
// FIELD_PASSWORD is the field password (PM, super): the app opens in field mode, and the bid tracker and
// changes to the team's jobs are refused here too, not just hidden on screen.
// The user name can be anything, and the password works in either box; spaces and capital letters don't matter.
// If APP_PASSWORD is not set, the site stays open.
const norm = s => String(s || "").trim().toLowerCase();
const same = (a, b) => { if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return !d; };
const FIELD_BLOCKED = [/^\/api\/bids/, /^\/api\/team-upload/, /^\/api\/share-upload/];
export default function middleware(request) {
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
      const path = new URL(request.url).pathname;
      if (FIELD_BLOCKED.some(r => r.test(path)) || (path === "/api/jobs" && request.method !== "GET"))
        return new Response(JSON.stringify({ error: "The field login can't change the estimate." }), { status: 403, headers: { "Content-Type": "application/json" } });
      return;
    }
  }
  return new Response("Password needed for AJ Takeoff. Reload the page to try again. The user name can be anything.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AJ Takeoff", charset="UTF-8"', "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}
