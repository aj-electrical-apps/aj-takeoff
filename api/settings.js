import { whoIs } from "../lib/session.js";
import { loadSettings, saveSettings } from "../lib/team-store.js";

// Settings everyone shares: company details, labor hours, parts lists, standard exclusions and vendor lists.
// They're the same localStorage values the app always kept, so the app just copies them in and out.
const KEYS = /^aj-(company|labor-edits|asm-edits|excl-std|list-(sup|natl|falv|lp))$/;
const H = { "Cache-Control": "no-store" };
export async function GET() {
  try {
    const s = await loadSettings();
    return Response.json({ url: s.url || null, saved: s.saved || null, by: (s.data && s.data.by) || "", data: (s.data && s.data.data) || {} }, { headers: H });
  } catch (e) { return Response.json({ error: e.message }, { status: 500, headers: H }); }
}
export async function POST(request) {
  try {
    const who = await whoIs(request);
    if (!who || who.r === "field") return Response.json({ error: "The field login can't change settings." }, { status: 403, headers: H });
    const b = await request.json().catch(() => ({})), data = {};
    Object.entries(b.data || {}).forEach(([k, v]) => { if (KEYS.test(k) && typeof v === "string") data[k] = v; });
    if (JSON.stringify(data).length > 3e6) return Response.json({ error: "Settings are too big." }, { status: 400, headers: H });
    const url = await saveSettings(data, String(b.by || who.n || "").slice(0, 30));
    return Response.json({ url, saved: new Date().toISOString() }, { headers: H });
  } catch (e) { return Response.json({ error: e.message }, { status: 500, headers: H }); }
}
