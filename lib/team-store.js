import { list, put, del } from "@vercel/blob";
import { positionsOf, roleKey } from "./positions.js";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// The people who can sign in (team/admin/users-<random>.json) and the settings everyone shares
// (team/admin/settings-<random>.json). Each change is a new file; the newest one counts and a few older ones are kept.
const KEEP = 5;
async function newest(prefix) {
  const all = [];
  let cursor;
  do {
    const r = await list({ prefix, limit: 1000, cursor });
    all.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return all.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}
async function readNewest(prefix) {
  const [b] = await newest(prefix);
  if (!b) return { data: null };
  const r = await fetch(b.url, { cache: "no-store" });
  if (!r.ok) throw new Error("Couldn't read " + prefix);
  return { data: await r.json(), url: b.url, saved: new Date(b.uploadedAt).toISOString() };
}
async function writeNew(prefix, data) {
  const b = await put(prefix + ".json", JSON.stringify(data), { access: "public", addRandomSuffix: true, contentType: "application/json", cacheControlMaxAge: 60 });
  const extra = (await newest(prefix)).slice(KEEP).map(x => x.url);
  if (extra.length) await del(extra).catch(() => {});
  return b.url;
}
// the people and the positions (what each position can do) are kept together
export const loadTeam = async () => { const d = (await readNewest("team/admin/users-")).data || {}; return { users: d.users || [], positions: positionsOf(d.positions) }; };
export const loadUsers = async () => (await loadTeam()).users;
export const saveUsers = async (users, by, positions) => writeNew("team/admin/users-", { app: "aj-takeoff", kind: "users", v: 2, savedAt: new Date().toISOString(), by, users, positions: positions || (await loadTeam()).positions });
export const loadSettings = () => readNewest("team/admin/settings-");
export const saveSettings = (data, by, decided = {}) => writeNew("team/admin/settings-", { app: "aj-takeoff", kind: "settings", v: 1, savedAt: new Date().toISOString(), by, data, decided });

// Passwords are never saved, only a PBKDF2 hash of them with their own salt.
export function hashPassword(pw) {
  const salt = randomBytes(16).toString("base64url");
  return { salt, hash: pbkdf2Sync(String(pw), salt, 120000, 32, "sha256").toString("base64url") };
}
export function checkPassword(u, pw) {
  if (!u || !u.salt || !u.hash) return false;
  const a = pbkdf2Sync(String(pw), u.salt, 120000, 32, "sha256"), b = Buffer.from(u.hash, "base64url");
  return a.length === b.length && timingSafeEqual(a, b);
}
export const loginOf = name => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
export const publicUser = u => ({ id: u.id, name: u.name, role: roleKey(u.role), off: !!u.off, added: u.added, by: u.by, changed: u.changed, lang: u.lang || "en", company: u.company || "", jobs: u.jobs || undefined });
// A subcontractor sees only the jobs shared with them; everyone else sees every job. null = every job.
export const jobsFor = (users, who) => {
  if (!who || roleKey(who.r) !== "sub") return null;
  const u = users.find(x => x.id === who.id);
  return new Set(u && !u.off ? u.jobs || [] : []);
};
