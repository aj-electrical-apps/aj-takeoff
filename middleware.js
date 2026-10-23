// Asks for the shared app password before anything on the site loads.
// The password lives in the Vercel environment variable APP_PASSWORD; any user name works.
// If APP_PASSWORD is not set, the site stays open.
export default function middleware(request) {
  const want = process.env.APP_PASSWORD;
  if (!want) return;
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    let pass = "";
    try { pass = atob(auth.slice(6)).split(":").slice(1).join(":"); } catch (e) {}
    if (pass.length === want.length) {
      let diff = 0;
      for (let i = 0; i < want.length; i++) diff |= pass.charCodeAt(i) ^ want.charCodeAt(i);
      if (!diff) return;
    }
  }
  return new Response("Password needed for AJ Takeoff.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AJ Takeoff", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}
