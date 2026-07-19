import { readdirSync } from "fs";
import path from "path";
import { generateShow, type ShowContext } from "@/lib/gemini";
import { getPersona, PERSONAS } from "@/lib/personas";
import { pickSponsor, bumpImpression, trackEvent } from "@/lib/store";
import type { Campaign } from "@/lib/types";

export const runtime = "nodejs";

// Context values are interpolated into the Gemini prompt — accept only the
// closed vocabularies the client produces (SPEC Personalization v2 P1), never
// free-form strings from arbitrary callers.
const DAYPARTS = ["morning", "afternoon", "evening", "late night"];
const WEATHER_DESCS = [
  "clear",
  "partly cloudy",
  "foggy",
  "rainy",
  "snowy",
  "showers",
  "stormy",
  "unsettled skies",
];

const SIGNATURE_TITLE = "Your Signature Theme";

const PLACEHOLDER_SONGS = [
  { title: "Midnight Signal", src: "/music/midnight-signal.mp3" },
  { title: "Neon Drive", src: "/music/neon-drive.mp3" },
];

function titleCase(stem: string): string {
  return stem
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function readSongs(): { title: string; src: string }[] {
  try {
    const files = readdirSync(path.join(process.cwd(), "public", "music"))
      .filter((f) => f.toLowerCase().endsWith(".mp3"))
      .sort()
      .slice(0, 3);
    // Fresh copies — the route unshifts the signature theme into this array,
    // and returning the module-level constant by reference would let that
    // mutation accumulate across requests.
    if (files.length === 0) return PLACEHOLDER_SONGS.map((s) => ({ ...s }));
    return files.map((f) => ({
      title: titleCase(f.replace(/\.mp3$/i, "")),
      src: `/music/${f}`,
    }));
  } catch {
    return PLACEHOLDER_SONGS.map((s) => ({ ...s }));
  }
}

export async function POST(request: Request) {
  let interests: string[] = [];
  let listenerName: string | undefined;
  let context: ShowContext | undefined;
  let personaId: string | undefined;
  let ytSongs: { title: string; src: string }[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body.interests)) {
      interests = body.interests.filter((i: unknown): i is string => typeof i === "string");
    }
    if (typeof body.listenerName === "string") listenerName = body.listenerName;
    if (typeof body.personaId === "string") personaId = body.personaId;
    // P8: listener-liked YouTube songs, played client-side through a VISIBLE
    // IFrame embed only (never downloaded/extracted). Strict validation —
    // 11-char videoId shape, string title (truncated), max 3. Anything that
    // fails validation is dropped; an empty result falls back to local mp3s.
    if (Array.isArray(body.ytSongs)) {
      const raw: unknown[] = body.ytSongs;
      ytSongs = raw
        .filter(
          (s: unknown): s is { videoId: string; title: string } =>
            !!s &&
            typeof s === "object" &&
            typeof (s as { videoId?: unknown }).videoId === "string" &&
            /^[A-Za-z0-9_-]{11}$/.test((s as { videoId: string }).videoId) &&
            typeof (s as { title?: unknown }).title === "string",
        )
        .slice(0, 3)
        .map((s) => ({ title: s.title.slice(0, 100), src: `yt:${s.videoId}` }));
    }
    const c = body.context;
    if (c && typeof c === "object") {
      context = {};
      if (
        typeof c.localHour === "number" &&
        Number.isInteger(c.localHour) &&
        c.localHour >= 0 &&
        c.localHour <= 23
      ) {
        context.localHour = c.localHour;
      }
      if (typeof c.daypart === "string" && DAYPARTS.includes(c.daypart)) {
        context.daypart = c.daypart;
      }
      if (
        c.weather &&
        typeof c.weather === "object" &&
        typeof c.weather.tempC === "number" &&
        Number.isFinite(c.weather.tempC) &&
        c.weather.tempC > -90 &&
        c.weather.tempC < 60 &&
        typeof c.weather.desc === "string" &&
        WEATHER_DESCS.includes(c.weather.desc)
      ) {
        context.weather = { tempC: c.weather.tempC, desc: c.weather.desc };
      }
    }
  } catch {}

  // P8: valid YouTube songs replace the local mp3 list entirely; the signature
  // theme unshift below still runs afterwards, so it stays FIRST either way.
  const songs = ytSongs.length > 0 ? ytSongs : readSongs();

  // Lead with a Lyria-composed station ident when the key can generate one —
  // the player treats /api/jingle like any other song source and skips it
  // gracefully on 503, so this never risks the show.
  const jingleChips = interests.filter((i) => !i.startsWith("link:")).slice(0, 7);
  if (process.env.GEMINI_API_KEY && jingleChips.length > 0) {
    songs.unshift({
      title: SIGNATURE_TITLE,
      src: `/api/jingle?chips=${encodeURIComponent(jingleChips.join(","))}`,
    });
  }

  let sponsor: Campaign | null = null;
  try {
    sponsor = pickSponsor(interests);
    if (sponsor) bumpImpression(sponsor.id);
    trackEvent("show_generated");
  } catch {}

  const persona = getPersona(personaId);
  // v4 co-host handoff: deterministic pick — the next persona in PERSONAS
  // order (wraps around), guaranteed ≠ primary. generateShow only activates
  // the handoff when the song plan leaves room for it (≥2 songs).
  const coHost = PERSONAS[(PERSONAS.findIndex((p) => p.id === persona.id) + 1) % PERSONAS.length];
  const show = await generateShow(interests, listenerName, songs, sponsor, persona, coHost, context);
  return Response.json(show);
}
