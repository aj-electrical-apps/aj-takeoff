import { handleUpload } from "@vercel/blob/client";

// Hands the app a short-lived permission to upload one .ajtakeoff job file to Vercel Blob.
export async function POST(request) {
  try {
    const body = await request.json();
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async pathname => {
        if (!/^jobs\/[^/]+\.ajtakeoff$/.test(pathname)) throw new Error("Only AJ Takeoff job files");
        return { allowedContentTypes: ["application/octet-stream"], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: true };
      },
      onUploadCompleted: async () => {}
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
