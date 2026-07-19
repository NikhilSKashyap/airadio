"use client";

import { useRef, useState } from "react";
import Player from "@/components/Player";
import type { Show } from "@/lib/types";

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const YT_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const DEMO_CHIPS = [
  "AI & tech",
  "Football",
  "Indian startups",
  "Electronic music",
  "Space",
];

// P7: display data only, hardcoded client-side — never import server-only
// persona files. The server resolves the id to the full persona.
const PERSONAS = [
  {
    id: "nova",
    name: "Nova",
    tagline: "your host after the world's bedtime",
    vibe: "warm, quick-witted, slightly nocturnal",
  },
  {
    id: "riff",
    name: "Riff",
    tagline: "the 6AM broadcast hurricane",
    vibe: "machine-gun wit, big heart, zero chill",
  },
  {
    id: "meethi",
    name: "RJ Meethi",
    tagline: "Mumbai ki sabse pyaari awaaz",
    vibe: "sunny gyaan with a Hinglish sparkle",
  },
  {
    id: "velvet",
    name: "Velvet",
    tagline: "smooth as a '70s pressing",
    vibe: "silky soul-DJ cool — it's all butter",
  },
] as const;

type Phase = "landing" | "tune" | "live";

type ShowContext = {
  localHour: number;
  daypart: "morning" | "afternoon" | "evening" | "late night";
  weather?: { tempC: number; desc: string };
};

const daypartOf = (h: number): ShowContext["daypart"] =>
  h >= 5 && h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "late night";

const weatherDescOf = (code: number): string => {
  if (code === 0) return "clear";
  if (code >= 1 && code <= 3) return "partly cloudy";
  if (code >= 45 && code <= 48) return "foggy";
  if (code >= 51 && code <= 67) return "rainy";
  if (code >= 71 && code <= 77) return "snowy";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95) return "stormy";
  return "unsettled skies";
};

// Chips starting with "link:" carry a full URL — show just the hostname.
const displayChip = (c: string): string => {
  if (!c.startsWith("link:")) return c;
  const url = c.slice(5).trim();
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

async function fetchWeather(): Promise<NonNullable<ShowContext["weather"]>> {
  const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 3000,
      maximumAge: 600_000,
    });
  });
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&current=temperature_2m,weather_code`,
    { signal: AbortSignal.timeout(3000) },
  );
  if (!r.ok) throw new Error(String(r.status));
  const data = await r.json();
  const tempC = data?.current?.temperature_2m;
  const code = data?.current?.weather_code;
  if (typeof tempC !== "number" || typeof code !== "number")
    throw new Error("bad weather payload");
  return { tempC: Math.round(tempC), desc: weatherDescOf(code) };
}

// Time-of-day always; weather best-effort, hard-capped so Go Live never waits > ~3.5s.
async function buildContext(): Promise<ShowContext> {
  const localHour = new Date().getHours();
  const ctx: ShowContext = { localHour, daypart: daypartOf(localHour) };
  try {
    // .catch on the racing promise: if the timeout wins, a late geolocation
    // denial / fetch failure would otherwise fire an unhandledrejection.
    const weather = await Promise.race([
      fetchWeather().catch(() => undefined),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3500)),
    ]);
    if (weather) ctx.weather = weather;
  } catch {
    // denied / offline / weird payload — omit weather silently
  }
  return ctx;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [chips, setChips] = useState<string[]>(DEMO_CHIPS);
  const [chipInput, setChipInput] = useState("");
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [personaId, setPersonaId] = useState<string>("nova");
  // P8: embeddable Music-category videos from the listener's likes, played via
  // a visible IFrame embed in the Player (never downloaded). Toggle defaults on.
  const [ytSongs, setYtSongs] = useState<{ videoId: string; title: string }[]>([]);
  const [useYtSongs, setUseYtSongs] = useState(true);
  // V5: true once the likes scan actually ran, so a 0-track result shows an
  // honest "using studio tracks" note instead of silently hiding the toggle.
  const [ytScanned, setYtScanned] = useState(false);
  const [busy, setBusy] = useState<null | "youtube" | "show">(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const tryDemo = () => {
    setChips(DEMO_CHIPS);
    setPhase("tune");
  };

  const connectYouTube = () => {
    if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.oauth2) {
      tryDemo();
      return;
    }
    setBusy("youtube");
    setError(null);
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: `${YT_SCOPE} openid profile`,
      callback: async (res: any) => {
        try {
          if (!res?.access_token) throw new Error("no token");
          // Station takes the listener's real first name from their Google
          // account — the name field is only a demo-mode fallback.
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${res.access_token}` },
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((u) => {
              const first = (u?.given_name || u?.name || "").trim().split(/\s+/)[0];
              if (first) setName((n) => n.trim() || first);
            })
            .catch(() => {});
          const yt = (path: string) =>
            fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
              headers: { Authorization: `Bearer ${res.access_token}` },
            }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
          const likesPage = (pageToken?: string) =>
            yt(
              `videos?part=snippet,status&myRating=like&maxResults=50${
                pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
              }`,
            );
          const [likes, subs] = await Promise.all([
            likesPage(),
            yt("subscriptions?part=snippet&mine=true&maxResults=25"),
          ]);
          const videoTitles = (likes.items ?? [])
            .map((i: any) => i?.snippet?.title)
            .filter(Boolean)
            .slice(0, 25);
          // V5: tiered pick for in-show playback (visible embed only).
          // Tier 1 = embeddable + Music category ("10"). Tier 2 (used only
          // when tier 1 is empty) = embeddable + music-ish title/channel.
          // Category "10" alone starves easily: uploads under Entertainment /
          // People & Blogs never qualify, hence the fallback tier.
          const MUSICY = /official|music|video|song|lyric|audio|mv|feat|remix/i;
          const playable = (i: any) =>
            i?.status?.embeddable === true &&
            typeof i?.id === "string" &&
            typeof i?.snippet?.title === "string";
          const tiersOf = (items: any[]) => {
            const tier1 = items.filter(
              (i) => playable(i) && i?.snippet?.categoryId === "10",
            );
            const tier2 = items.filter(
              (i) =>
                playable(i) &&
                i?.snippet?.categoryId !== "10" &&
                (MUSICY.test(i.snippet.title) ||
                  MUSICY.test(i?.snippet?.channelTitle ?? "")),
            );
            return { tier1, tier2 };
          };
          let likeItems: any[] = likes.items ?? [];
          let { tier1, tier2 } = tiersOf(likeItems);
          // One extra page only, and only when the first 50 likes were thin.
          if (tier1.length + tier2.length < 3 && likes.nextPageToken) {
            try {
              const page2 = await likesPage(likes.nextPageToken);
              likeItems = [...likeItems, ...(page2.items ?? [])];
              ({ tier1, tier2 } = tiersOf(likeItems));
            } catch {
              // second page is best-effort — keep page-1 tiers
            }
          }
          const best = tier1.length > 0 ? tier1 : tier2;
          console.info(
            `[airadio] yt likes: scanned=${likeItems.length} tier1(music category)=${tier1.length} tier2(musicy title/channel)=${tier2.length} → ${best.length === 0 ? "none playable" : `${Math.min(best.length, 3)} from ${tier1.length > 0 ? "tier1" : "tier2"}`}`,
          );
          setYtSongs(
            best
              .slice(0, 3)
              .map((i: any) => ({ videoId: i.id, title: i.snippet.title })),
          );
          setYtScanned(true);
          const channelTitles = (subs.items ?? [])
            .map((i: any) => i?.snippet?.title)
            .filter(Boolean);
          const r = await fetch("/api/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoTitles, channelTitles }),
          });
          const data = r.ok ? await r.json() : null;
          setChips(
            Array.isArray(data?.interests) && data.interests.length > 0
              ? data.interests.slice(0, 7)
              : DEMO_CHIPS,
          );
          setPhase("tune");
        } catch {
          setChips(DEMO_CHIPS);
          setPhase("tune");
        } finally {
          setBusy(null);
        }
      },
      error_callback: () => setBusy(null),
    });
    client.requestAccessToken();
  };

  const addChip = (raw: string) => {
    const v = raw.trim();
    if (!v || chips.length >= 7 || chips.includes(v)) return;
    setChips((c) => [...c, v]);
    setChipInput("");
  };

  const goLive = async () => {
    const interests = [...chips];
    const l = link.trim();
    if (l && !interests.includes(`link:${l}`)) interests.push(`link:${l}`);
    if (interests.length === 0) return;

    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as any).webkitAudioContext;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    void ctxRef.current.resume();

    setBusy("show");
    setError(null);
    try {
      const context = await buildContext();
      const r = await fetch("/api/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interests,
          listenerName: name.trim() || undefined,
          context,
          personaId,
          ytSongs:
            useYtSongs && ytSongs.length > 0 ? ytSongs : undefined,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const s: Show = await r.json();
      setShow({
        ...s,
        fingerprint: (s.fingerprint ?? interests).map(displayChip),
      });
      setPhase("live");
    } catch {
      setError("The transmitter hiccuped — hit Go Live again.");
    } finally {
      setBusy(null);
    }
  };

  const hostName = PERSONAS.find((p) => p.id === personaId)?.name ?? "Nova";

  return (
    <main className="flex min-h-dvh w-full flex-col lg:h-dvh lg:flex-row lg:overflow-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* Left sidebar — controls panel (stacks above the stage on mobile).  */}
      <aside className="sidebar flex w-full flex-col gap-7 border-b border-line px-5 py-6 lg:h-full lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        {/* wordmark */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-sm font-semibold tracking-[0.3em] text-foreground">
            WAVE<span className="text-amber">LENGTH</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
            fm for an audience of one
          </span>
        </div>

        {/* sign-in area */}
        <div className="flex flex-col gap-2">
          {GOOGLE_CLIENT_ID ? (
            <>
              <button
                onClick={connectYouTube}
                disabled={busy === "youtube"}
                className="w-full rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-50"
              >
                {busy === "youtube" ? "Reading your likes…" : "Sign in with Google"}
              </button>
              <button
                onClick={connectYouTube}
                disabled={busy === "youtube"}
                className="w-full rounded-full border border-line px-4 py-2 text-xs font-medium text-foreground transition-colors hover:border-violet hover:text-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet disabled:opacity-50"
              >
                Connect YouTube
              </button>
              <button
                onClick={tryDemo}
                className="self-start font-mono text-[11px] text-muted underline-offset-2 transition-colors hover:text-violet hover:underline"
              >
                or try demo mode
              </button>
            </>
          ) : (
            <button
              onClick={tryDemo}
              className="flex items-center gap-2 self-start rounded-full border border-violet/40 bg-violet/10 px-4 py-1.5 text-sm text-foreground transition-colors hover:border-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-violet" />
              demo mode
            </button>
          )}
        </div>

        {/* YOUR SIGNALS */}
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-muted">
            your signals
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span
                key={c}
                className="flex items-center gap-1.5 rounded-full border border-violet/40 bg-violet/10 px-3 py-1 text-xs"
              >
                {displayChip(c)}
                <button
                  onClick={() => setChips(chips.filter((x) => x !== c))}
                  aria-label={`Remove ${displayChip(c)}`}
                  className="text-muted transition-colors hover:text-amber"
                >
                  ×
                </button>
              </span>
            ))}
            {chips.length < 7 && (
              <input
                value={chipInput}
                onChange={(e) => setChipInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addChip(chipInput)}
                placeholder="add an interest ⏎"
                className="w-36 rounded-full border border-line bg-transparent px-3 py-1 text-xs placeholder:text-muted focus:border-amber focus:outline-none"
              />
            )}
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
              paste a link you care about (optional)
            </span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              className="rounded-lg border border-line bg-transparent px-3 py-2 text-sm placeholder:text-muted focus:border-amber focus:outline-none"
            />
          </label>
          {ytSongs.length > 0 ? (
            <label className="flex items-center gap-2 self-start text-xs text-muted transition-colors hover:text-foreground">
              <input
                type="checkbox"
                checked={useYtSongs}
                onChange={(e) => setUseYtSongs(e.target.checked)}
                className="h-4 w-4 accent-amber"
              />
              Play {ytSongs.length} track{ytSongs.length === 1 ? "" : "s"} from
              your YouTube likes
            </label>
          ) : ytScanned ? (
            <p className="font-mono text-[10px] text-muted">
              no embeddable music in your recent likes — using studio tracks
            </p>
          ) : null}
        </div>

        {/* YOUR HOST */}
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-muted">
            your host
          </p>
          <div className="flex flex-col gap-2">
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersonaId(p.id)}
                aria-pressed={personaId === p.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                  personaId === p.id
                    ? "avatar-selected border-amber/70 bg-amber/10"
                    : "border-line bg-black/20 hover:border-violet/50"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/avatars/${p.id}.jpg`}
                  alt=""
                  width={56}
                  height={56}
                  className={`h-14 w-14 shrink-0 rounded-full object-cover ${
                    personaId === p.id ? "ring-2 ring-amber" : "ring-1 ring-line"
                  }`}
                />
                <span className="flex min-w-0 flex-col">
                  <span
                    className={`text-sm font-semibold ${
                      personaId === p.id ? "text-amber" : "text-foreground"
                    }`}
                  >
                    {p.name}
                  </span>
                  <span className="font-mono text-[10px] leading-snug text-muted">
                    {p.tagline}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* bottom — station name + GO LIVE */}
        <div className="mt-auto flex flex-col gap-2.5 pt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name auto-fills from Google — or type one"
            aria-label="Station name — auto-filled from your Google account, editable"
            className="rounded-lg border border-line bg-transparent px-3 py-2 text-sm placeholder:text-muted focus:border-amber focus:outline-none"
          />
          <button
            onClick={goLive}
            disabled={
              phase === "live" ||
              busy === "show" ||
              chips.length + (link.trim() ? 1 : 0) === 0
            }
            className="flex items-center justify-center gap-3 rounded-full bg-amber px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.25em] text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-50"
          >
            <span
              className={`h-2 w-2 rounded-full bg-background ${busy === "show" ? "onair-dot" : ""}`}
            />
            {phase === "live"
              ? "On air"
              : busy === "show"
                ? `${hostName} is writing…`
                : "Go live"}
          </button>
          {error && <p className="text-sm text-amber">{error}</p>}
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Main stage.                                                        */}
      <section className="flex flex-1 flex-col overflow-y-auto px-6 py-10 lg:px-12">
        {phase === "live" && show && ctxRef.current ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
            <Player show={show} ctx={ctxRef.current} />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-8">
            <p className="mb-6 font-mono text-xs uppercase tracking-[0.3em] text-amber">
              the station on your wavelength
            </p>
            <h1 className="text-6xl font-bold tracking-[0.12em] sm:text-7xl">
              WAVE<span className="text-amber">LENGTH</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
              {`Gemini writes the show. ${hostName} hosts it. Your interests, tonight's news, and your music taste — live on your own frequency.`}
            </p>

            <div className="mt-12">
              <div className="flex justify-between font-mono text-[11px] text-muted">
                {["88", "92", "96", "100", "104", "108"].map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
              <div className="dial relative mt-1 h-10">
                <div className="dial-needle absolute bottom-0 left-[63%] h-full w-0.5" />
              </div>
            </div>

            <p className="mt-10 font-mono text-[11px] text-muted">
              {GOOGLE_CLIENT_ID
                ? "Sign-in reads your liked videos + subscriptions to tune your station. "
                : ""}
              All four hosts are original AI voices. Sponsors are always
              disclosed.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
