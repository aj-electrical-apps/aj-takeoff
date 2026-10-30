import { handleUploadPresigned } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";

// Upload address for one job's field layer (ghost marks, ghost runs, the Order page). Office and field can both use it.
export async function POST(request) {
  try {
    const body = await request.json();
    const json = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async pathname => {
        if (!/^team\/field\/[\w-]{1,80}\/m[A-Za-z0-9_-]{1,400}\.json$/.test(pathname)) throw new Error("Only AJ Takeoff field layers");
        const r = { allowedContentTypes: ["application/json"], maximumSizeInBytes: 20 * 1024 * 1024 };
        const token = await issueSignedToken({ pathname, operations: ["put"], validUntil: Date.now() + 60 * 60 * 1000, ...r });
        return { token, urlOptions: { ...r, addRandomSuffix: true } };
      }
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
