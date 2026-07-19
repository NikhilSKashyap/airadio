import { getGenAI } from "@/lib/gemini";
import { PERSONAS } from "@/lib/personas";
import { pcmToWav } from "@/lib/wav";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let text: unknown;
  let voice: unknown;
  let delivery: unknown;
  try {
    ({ text, voice, delivery } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Missing text" }, { status: 400 });
  }

  // voice/delivery are interpolated into the TTS request — accept ONLY the
  // known persona values (delivery is prompt-injectable otherwise). Anything
  // else silently falls back to the default voice / plain text.
  const defaultVoice = process.env.GEMINI_TTS_VOICE || "Puck";
  const allowedVoices = new Set([defaultVoice, ...PERSONAS.map((p) => p.voice)]);
  const voiceName = typeof voice === "string" && allowedVoices.has(voice) ? voice : defaultVoice;
  const allowedDeliveries = new Set(PERSONAS.map((p) => p.delivery));
  const styled =
    typeof delivery === "string" && allowedDeliveries.has(delivery)
      ? `Say this ${delivery}: ${text}`
      : text;

  const ai = getGenAI();
  if (!ai) {
    return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });
  }

  const models = [
    ...new Set(
      [
        process.env.GEMINI_TTS_MODEL,
        "gemini-2.5-flash-preview-tts",
        "gemini-3.1-flash-tts-preview",
      ].filter((m): m is string => !!m)
    ),
  ];
  for (const model of models) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: styled,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const base64 = part?.inlineData?.data;
      if (!base64) continue;
      const rateMatch = part?.inlineData?.mimeType?.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      const wav = pcmToWav(Buffer.from(base64, "base64"), sampleRate);
      return new Response(new Uint8Array(wav), {
        headers: { "Content-Type": "audio/wav" },
      });
    } catch (e) {
      console.error(`[tts] ${model} failed:`, String(e).slice(0, 200));
    }
  }
  return Response.json({ error: "TTS generation failed" }, { status: 503 });
}
