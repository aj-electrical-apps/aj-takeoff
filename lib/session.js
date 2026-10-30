// Sign-in cookie for AJ Takeoff, shared by middleware.js (edge) and the api functions (Node). Uses Web Crypto only.
// The cookie holds the person's name, role and password version, signed with SESSION_SECRET (a Vercel
// environment variable nobody needs to remember), so it can't be made up or changed by hand.
const enc = new TextEncoder();
export const COOKIE = "aj_s";
export const DAYS = 30;
export const secret = () => String(process.env.SESSION_SECRET || "").trim();
const b64u = bytes => { let s = ""; new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
export const same = (a, b) => { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return !d; };
export const norm = s => String(s || "").trim().toLowerCase();
async function hmac(key, text) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}
// who: { n: name, r: "admin" | "office" | "field", id, v }
export async function makeSession(key, who) {
  const body = b64u(enc.encode(JSON.stringify({ ...who, exp: Date.now() + DAYS * 864e5 })));
  return body + "." + await hmac(key, "s." + body);
}
export function cookieOf(header) {
  const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)").exec(header || "");
  return m ? m[1] : "";
}
export async function readSession(key, cookieHeader) {
  const v = cookieOf(cookieHeader), i = v.indexOf(".");
  if (!key || i < 1) return null;
  const body = v.slice(0, i);
  if (!same(v.slice(i + 1), await hmac(key, "s." + body))) return null;
  try {
    const who = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return who && who.exp > Date.now() && ["admin", "office", "field"].includes(who.r) ? who : null;
  } catch (e) { return null; }
}
export const cookieLine = (value, days = DAYS) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(days * 86400)}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
// The Drive backup script's key: made from SESSION_SECRET, so it needs no saving and changes if the secret does.
export const backupKey = async key => "bk-" + (await hmac(key, "backup-key")).slice(0, 26);
// Who a "Basic" Authorization header is: the APP_PASSWORD (admin), FIELD_PASSWORD (field) or the backup key (office).
export async function basicWho(request, key) {
  const auth = request.headers.get("authorization") || "";
  if (!/^basic /i.test(auth)) return null;
  let raw = "";
  try { raw = new TextDecoder().decode(Uint8Array.from(atob(auth.slice(6).trim()), c => c.charCodeAt(0))); } catch (e) { return null; }
  const i = raw.indexOf(":"), parts = [raw, i < 0 ? raw : raw.slice(0, i), i < 0 ? "" : raw.slice(i + 1)];
  const is = want => !!want && parts.some(p => same(norm(p), want));
  const office = norm(process.env.APP_PASSWORD), field = norm(process.env.FIELD_PASSWORD);
  if (key) { const bk = await backupKey(key); if (parts.some(p => same(p.trim(), bk))) return { n: "Drive backup", r: "office", id: "backup" }; }
  if (is(office)) return { n: "Office", r: "admin", id: "app" };
  if (is(field)) return { n: "Field", r: "field", id: "field" };
  return null;
}
// Who is asking. With SESSION_SECRET set: the sign-in cookie or a Basic header (see basicWho).
// Without it the site works the old way: open to everyone (as admin) unless APP_PASSWORD is set.
export async function whoIs(request) {
  const key = secret();
  if (key) return await readSession(key, request.headers.get("cookie")) || await basicWho(request, key);
  if (!norm(process.env.APP_PASSWORD)) return { n: "Office", r: "admin", id: "open" };
  return basicWho(request, "");
}
export const isPerson = who => !!who && !["app", "field", "backup", "open"].includes(who.id);
