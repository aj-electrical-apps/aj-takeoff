// Spanish <-> English for messages on the drawings (Jonathan 2026-10-30: "an option for Spanish and translate to English").
// Uses Vercel AI Gateway, signed in with the project's own OIDC token, so there's no key to set up.
// If it can't translate (no internet, gateway off), the message is kept as written and the app offers a Google Translate link.
export async function translate(text, request) {
  text = String(text || "").trim();
  if (!text) return null;
  const token = (request && request.headers.get("x-vercel-oidc-token")) || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY;
  if (!token) return null;
  try {
    const r = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-5",
        models: ["anthropic/claude-haiku-4.5", "google/gemini-3.6-flash"],
        messages: [
          { role: "system", content: "You translate short job-site messages between electricians, project managers and subcontractors on a construction job. Keep trade words, sheet numbers, sizes and part numbers as they are. Answer with only JSON: {\"from\":\"en\" or \"es\",\"en\":\"the message in English\",\"es\":\"the message in Spanish\"}." },
          { role: "user", content: text },
        ],
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const out = String((await r.json()).choices?.[0]?.message?.content || "");
    const o = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    if (typeof o.en !== "string" || typeof o.es !== "string") return null;
    return { from: o.from === "es" ? "es" : "en", en: o.en.slice(0, 4000), es: o.es.slice(0, 4000) };
  } catch (e) { return null; }
}
