import { handleUploadPresigned } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";

// Hands the app a short-lived upload address for one plan sheet image or one job data file for the team's jobs.
// The store signs in with Vercel's OIDC (BLOB_STORE_ID), so this uses presigned uploads, not client tokens.
function rule(pathname) {
  if (/^team\/sheet\/[\w-]{1,80}\/[\w-]{1,120}\.(jpg|png)$/.test(pathname)) return { allowedContentTypes: ["image/jpeg", "image/png"], maximumSizeInBytes: 80 * 1024 * 1024 };
  if (/^team\/sheet\/[\w-]{1,80}\/[\w-]{1,120}\.json$/.test(pathname)) return { allowedContentTypes: ["application/json"], maximumSizeInBytes: 50 * 1024 * 1024 };
  if (/^team\/data\/[\w-]{1,80}\/m[A-Za-z0-9_-]{1,800}\.json$/.test(pathname)) return { allowedContentTypes: ["application/json"], maximumSizeInBytes: 200 * 1024 * 1024 };
  throw new Error("Only AJ Takeoff sheets and job data");
}
export async function POST(request) {
  try {
    const body = await request.json();
    const json = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async pathname => {
        const r = rule(pathname);
        const token = await issueSignedToken({ pathname, operations: ["put"], validUntil: Date.now() + 60 * 60 * 1000, ...r });
        return { token, urlOptions: { ...r, addRandomSuffix: true } };
      }
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
