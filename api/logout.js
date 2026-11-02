import { clearCookie } from "../lib/session.js";
// Signs this browser out and goes back to the sign-in page.
export function GET(request) {
  return new Response(null, { status: 302, headers: { Location: new URL("/login.html", request.url).toString(), "Set-Cookie": clearCookie(), "Cache-Control": "no-store" } });
}
