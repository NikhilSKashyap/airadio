// Wavelength — AI Studio full-stack proxy.
// Keeps GEMINI_API_KEY server-side; the client (src/App.tsx) calls /api/*.
// Dev: Vite in middleware mode. Prod: serves ./dist.
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { PERSONAS, getPersona, type Persona } from "./src/personas.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === "production";

function getAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

const TEXT_CHAIN = ["gemini-3-flash-preview", "gemini-flash-latest", "gemini-flash-lite-latest"];
const TTS_CHAIN = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"];

async function genText(ai: GoogleGenAI, contents: string, useSearch: boolean): Promise<string | null> {
  const attempts = TEXT_CHAIN.flatMap((model) =>
    useSearch
      ? [{ model, config: { tools: [{ googleSearch: {} }] } }, { model, config: {} }]
      : [{ model, config: {} }]
  );
  for (const a of attempts) {
    try {
      const res = await ai.models.generateContent({ model: a.model, contents, config: a.config });
      if (res.text) return res.text;
    } catch (e) {
      console.error(`[gemini] ${a.model} failed:`, String(e).slice(0, 160));
    }
  }
  return null;
}

function stripFences(raw: string): string {
  return raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

const DEMO_SONGS = ["Your Signature Theme", "Midnight Signal", "Neon Drive"];

function fallbackShow(interests: string[], name: string | undefined, persona: Persona) {
  const station = `${(name || "").trim().split(/\s+/)[0] || "My"} FM`;
  const [a = "the future", b = "great music"] = interests;
  return {
    stationName: station,
    tagline: "Your interests. Tonight's stories. One frequency.",
    fingerprint: interests,
    persona: { id: persona.id, name: persona.name, voice: persona.voice, delivery: persona.delivery },
    fallback: true,
    reactions: persona.reactions,
    segments: [
      { kind: "talk", label: "opening", text: `Bwaaam — that's the sonic logo. You're locked into ${station}. I'm ${persona.name}, ${persona.tagline}. Tonight the dial is tuned to ${interests.join(", ") || "whatever moves you"}. ${a} refuses to sit still this week, and it keeps colliding with ${b} in ways nobody scripted. Stick around — this one's for an audience of one. First, dim the lights.` },
      { kind: "song", title: DEMO_SONGS[0] },
      { kind: "talk", label: "transition", text: `Still ringing in the air, isn't it. While that settles — ${a} has been quietly rewriting its own rules, and I've got the story queued. Roll the windows down.` },
      { kind: "song", title: DEMO_SONGS[1] },
      { kind: "talk", label: "outro", text: `And that's the signal fading out on ${station}. You brought the interests; I just held the antenna. Keep your dial strange. ${persona.name}, signing off.` },
    ],
  };
}

app.post("/api/show", async (req, res) => {
  const interests: string[] = Array.isArray(req.body?.interests)
    ? req.body.interests.filter((i: unknown) => typeof i === "string").slice(0, 7)
    : [];
  const name: string | undefined = typeof req.body?.listenerName === "string" ? req.body.listenerName : undefined;
  const persona = getPersona(typeof req.body?.personaId === "string" ? req.body.personaId : undefined);
  const ai = getAI();
  if (!ai) return res.json(fallbackShow(interests, name, persona));

  const station = `${(name || "").trim().split(/\s+/)[0] || "My"} FM`;
  const today = new Date().toDateString();
  const prompt = `You are ${persona.name}, host of "${station}" — an ORIGINAL AI radio persona (${persona.styleBlock}). Never imitate any real person.
Today is ${today}. Use Google Search to find the biggest REAL news from the last 24h tied to these interests: ${interests.join(", ") || "general"}. If a major event (a tournament final, a launch) is happening today, lead the opening with its latest status.
Write a personal radio show${name ? ` for ${name.trim().split(/\s+/)[0]}` : ""} as STRICT JSON (no markdown, no fences):
{"stationName":"${station}","tagline":"<short punchy tagline>","segments":[
{"kind":"talk","label":"opening","text":"~150 words: greet the listener by name, the grounded headline, a second story, a preview, a segue into the first song"},
{"kind":"song","title":"Your Signature Theme"},
{"kind":"talk","label":"transition","text":"40-60 words reacting and teasing the next story"},
{"kind":"song","title":"Midnight Signal"},
{"kind":"talk","label":"outro","text":"40-60 word warm sign-off as ${persona.name}"}],
"reactions":{"skip":["4 short in-persona lines for when the listener skips a track"],"love":["4 short in-persona lines for when they love a track"]}}
Every talk must sound like ${persona.name} (${persona.delivery}).`;

  const text = await genText(ai, prompt, true);
  if (!text) return res.json(fallbackShow(interests, name, persona));
  try {
    const parsed = JSON.parse(stripFences(text));
    const segs = Array.isArray(parsed.segments) ? parsed.segments : [];
    if (segs.filter((s: any) => s?.kind === "talk").length < 2) return res.json(fallbackShow(interests, name, persona));
    const r = parsed.reactions || {};
    return res.json({
      stationName: parsed.stationName || station,
      tagline: parsed.tagline || "Your interests. Tonight's stories. One frequency.",
      fingerprint: interests,
      persona: { id: persona.id, name: persona.name, voice: persona.voice, delivery: persona.delivery },
      reactions: {
        skip: Array.isArray(r.skip) && r.skip.length ? r.skip.slice(0, 4) : persona.reactions.skip,
        love: Array.isArray(r.love) && r.love.length ? r.love.slice(0, 4) : persona.reactions.love,
      },
      segments: segs,
    });
  } catch {
    return res.json(fallbackShow(interests, name, persona));
  }
});

function pcmToWav(pcm: Buffer, rate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

app.post("/api/tts", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) return res.status(400).json({ error: "Missing text" });
  const allowedVoices = new Set(PERSONAS.map((p) => p.voice));
  const voice = typeof req.body?.voice === "string" && allowedVoices.has(req.body.voice) ? req.body.voice : "Kore";
  const allowedDeliveries = new Set(PERSONAS.map((p) => p.delivery));
  const delivery = typeof req.body?.delivery === "string" && allowedDeliveries.has(req.body.delivery) ? req.body.delivery : "";
  const contents = delivery ? `Say this ${delivery}: ${text}` : text;
  const ai = getAI();
  if (!ai) return res.status(503).json({ error: "No API key" });

  for (const model of TTS_CHAIN) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents,
        config: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      });
      const part = r.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
      const b64 = part?.inlineData?.data;
      if (!b64) continue;
      const rate = Number(part?.inlineData?.mimeType?.match(/rate=(\d+)/)?.[1]) || 24000;
      res.setHeader("Content-Type", "audio/wav");
      return res.send(pcmToWav(Buffer.from(b64, "base64"), rate));
    } catch (e) {
      console.error(`[tts] ${model} failed:`, String(e).slice(0, 160));
    }
  }
  return res.status(503).json({ error: "TTS failed" });
});

if (isProd) {
  app.use(express.static("dist"));
  app.get("*", (_req, res) => res.sendFile(process.cwd() + "/dist/index.html"));
  app.listen(PORT, () => console.log(`Wavelength (prod) on :${PORT}`));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
  app.listen(PORT, () => console.log(`Wavelength (dev) on http://localhost:${PORT}`));
}
