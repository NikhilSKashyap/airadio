import { genText, getGenAI } from "@/lib/gemini";

export const runtime = "nodejs";

// Canned Nova reactions, indexed by songTitle length parity — never let the demo go silent.
const CANNED: Record<"skip" | "love", [string, string]> = {
  skip: [
    "Skipped — no argument from me, some songs just aren't tonight's frequency. Switching gears; the next stretch of the dial suits you better.",
    "Say less — that one's benched. A good host reads the room, and this room wants something different. Switching gears right now.",
  ],
  love: [
    "Ooh, noted in permanent marker — you love that one. There's more where that came from, so keep the dial exactly where it is.",
    "That's the good stuff, right? Consider your taste officially on record — more where that came from, later on this very frequency.",
  ],
};

function stripDecoration(raw: string): string {
  return raw
    .replace(/^\s*```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .trim();
}

export async function POST(request: Request) {
  let action: unknown;
  let songTitle: unknown;
  let stationName: unknown;
  let interests: unknown;
  try {
    ({ action, songTitle, stationName, interests } = await request.json());
  } catch {}

  const act: "skip" | "love" = action === "love" ? "love" : "skip";
  const title = typeof songTitle === "string" ? songTitle : "";
  const station =
    typeof stationName === "string" && stationName.trim() ? stationName.trim() : "the station";
  const chips = Array.isArray(interests)
    ? interests.filter((c): c is string => typeof c === "string" && c.trim().length > 0).slice(0, 7)
    : [];
  const canned = CANNED[act][title.length % 2];

  const ai = getGenAI();
  if (!ai) return Response.json({ text: canned, fallback: true });

  const prompt = `You are Nova, the host of "${station}" — an original AI radio persona: warm, quick-witted, slightly nocturnal. You never imitate any real person.

Your one listener just pressed ${act.toUpperCase()} on the song "${title || "the current track"}", live on air.${chips.length ? ` Their interests: ${chips.join(", ")}.` : ""}

React ON AIR in 15-25 words, in persona: acknowledge the ${act} playfully, then hand off naturally — ${
    act === "skip"
      ? `"switching gears" energy, hinting what's next fits them better`
      : `"more where that came from" energy`
  }.

OUTPUT: the spoken line only — plain text, no quotes, no markdown, no stage directions.`;

  const text = await genText(ai, prompt);
  const clean = text ? stripDecoration(text) : "";
  if (!clean) return Response.json({ text: canned, fallback: true });
  return Response.json({ text: clean });
}
