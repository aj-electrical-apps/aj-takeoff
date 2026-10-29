import { handleUpload } from "@vercel/blob/client";

// Hands the app a short-lived permission to upload one plan sheet image or one job data file for the team's jobs.
export async function POST(request) {
  try {
    const body = await request.json();
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async pathname => {
        if (/^team\/sheet\/[\w-]{1,80}\/[\w-]{1,120}\.(jpg|png)$/.test(pathname))
          return { allowedContentTypes: ["image/jpeg", "image/png"], maximumSizeInBytes: 80 * 1024 * 1024, addRandomSuffix: true };
        if (/^team\/data\/[\w-]{1,80}\/m[A-Za-z0-9_-]{1,800}\.json$/.test(pathname))
          return { allowedContentTypes: ["application/json"], maximumSizeInBytes: 200 * 1024 * 1024, addRandomSuffix: true };
        throw new Error("Only AJ Takeoff sheets and job data");
      },
      onUploadCompleted: async () => {}
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
