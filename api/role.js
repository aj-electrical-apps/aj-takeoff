// Tells the app whether it was opened with the office password or the field password (see middleware.js).
const norm = s => String(s || "").trim().toLowerCase();
export async function GET(request) {
  const office = norm(process.env.APP_PASSWORD), field = norm(process.env.FIELD_PASSWORD);
  let role = "office";
  const auth = request.headers.get("authorization") || "";
  if (office && field && /^basic /i.test(auth)) {
    const raw = Buffer.from(auth.slice(6).trim(), "base64").toString();
    const i = raw.indexOf(":"), parts = [raw, i < 0 ? raw : raw.slice(0, i), i < 0 ? "" : raw.slice(i + 1)].map(norm);
    if (!parts.includes(office) && parts.includes(field)) role = "field";
  }
  return Response.json({ role, locked: !!office }, { headers: { "Cache-Control": "no-store" } });
}
