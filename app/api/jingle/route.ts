import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getGenAI } from "@/lib/gemini";

export const runtime = "nodejs";

const CACHE_DIR = path.join(process.cwd(), "data", "jingles");
const LYRIA_MODEL = process.env.LYRIA_MODEL || "lyria-3-clip-preview";

// Lyria generation is billed per call — cache by fingerprint so replays,
// StrictMode double-fetches, and repeat shows cost nothing.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const chips = (url.searchParams.get("chips") || "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith("link:"))
    .slice(0, 7);
  if (chips.length === 0) {
    return Response.json({ error: "Missing chips" }, { status: 400 });
  }

  const key = createHash("sha1")
    .update(chips.map((c) => c.toLowerCase()).sort().join("|"))
    .digest("hex")
    .slice(0, 16);
  const cached = path.join(CACHE_DIR, `${key}.mp3`);
  if (fs.existsSync(cached)) {
    return new Response(new Uint8Array(fs.readFileSync(cached)), {
      headers: { "Content-Type": "audio/mpeg", "X-Jingle-Cache": "hit" },
    });
  }

  const ai = getGenAI();
  if (!ai) {
    return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });
  }

  const prompt =
    `A 30-second signature theme for a personal late-night radio station. ` +
    `Instrumental only, no vocals. Warm, modern radio-ident energy with a clean intro and a resolved ending. ` +
    `Let the listener's tastes color the style: ${chips.join(", ")}.`;

  try {
    const res = await ai.models.generateContent({
      model: LYRIA_MODEL,
      contents: prompt,
      config: { responseModalities: ["AUDIO"] },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) {
      return Response.json({ error: "No audio returned" }, { status: 503 });
    }
    const bytes = Buffer.from(part.inlineData.data, "base64");
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cached, bytes);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "audio/mpeg", "X-Jingle-Cache": "miss" },
    });
  } catch (e) {
    console.error(`[lyria] ${LYRIA_MODEL} failed:`, String(e).slice(0, 200));
    return Response.json({ error: "Jingle generation failed" }, { status: 503 });
  }
}
