// Asks for the shared app password before anything on the site loads.
// The password lives in the Vercel environment variable APP_PASSWORD.
// The user name can be anything, and the password works in either box; spaces and capital letters don't matter.
// If APP_PASSWORD is not set, the site stays open.
const norm = s => String(s || "").trim().toLowerCase();
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return !d; };
export default function middleware(request) {
  const want = norm(process.env.APP_PASSWORD);
  if (!want) return;
  const auth = request.headers.get("authorization") || "";
  if (/^basic /i.test(auth)) {
    let raw = "";
    try { raw = new TextDecoder().decode(Uint8Array.from(atob(auth.slice(6).trim()), c => c.charCodeAt(0))); } catch (e) {}
    const i = raw.indexOf(":"), user = i < 0 ? raw : raw.slice(0, i), pass = i < 0 ? "" : raw.slice(i + 1);
    if (same(norm(pass), want) || same(norm(user), want) || same(norm(raw), want)) return;
  }
  return new Response("Password needed for AJ Takeoff. Reload the page to try again. The user name can be anything.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AJ Takeoff", charset="UTF-8"', "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}
