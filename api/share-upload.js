import { handleUploadPresigned } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";

// Hands the app a short-lived upload address for one .ajtakeoff job file (for emailing a job as a link).
export async function POST(request) {
  try {
    const body = await request.json();
    const json = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async pathname => {
        if (!/^jobs\/[^/]+\.ajtakeoff$/.test(pathname)) throw new Error("Only AJ Takeoff job files");
        const r = { allowedContentTypes: ["application/octet-stream"], maximumSizeInBytes: 300 * 1024 * 1024 };
        const token = await issueSignedToken({ pathname, operations: ["put"], validUntil: Date.now() + 60 * 60 * 1000, ...r });
        return { token, urlOptions: { ...r, addRandomSuffix: true } };
      }
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
