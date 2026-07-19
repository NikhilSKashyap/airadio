import { distillInterests } from "@/lib/gemini";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let videoTitles: string[] = [];
  let channelTitles: string[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body.videoTitles)) {
      videoTitles = body.videoTitles.filter((t: unknown): t is string => typeof t === "string");
    }
    if (Array.isArray(body.channelTitles)) {
      channelTitles = body.channelTitles.filter((t: unknown): t is string => typeof t === "string");
    }
  } catch {}

  const interests = await distillInterests(videoTitles, channelTitles);
  return Response.json({ interests });
}
