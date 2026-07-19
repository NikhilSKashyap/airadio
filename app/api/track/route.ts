import { trackEvent } from "@/lib/store";
import type { TrackEvent } from "@/lib/types";

export const runtime = "nodejs";

const EVENTS: TrackEvent[] = [
  "show_generated",
  "play_start",
  "minute",
  "ad_impression",
  "share",
];

export async function POST(request: Request) {
  let event: unknown;
  try {
    ({ event } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof event !== "string" || !EVENTS.includes(event as TrackEvent)) {
    return Response.json({ error: "Unknown event" }, { status: 400 });
  }
  trackEvent(event as TrackEvent);
  return Response.json({ ok: true });
}
