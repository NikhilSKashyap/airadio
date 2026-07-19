"use client";

import { useEffect, useRef, useState } from "react";
import type { Show, TalkSegment, TrackEvent } from "@/lib/types";

function track(event: TrackEvent) {
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// P8 — YouTube playback. Minimal local IFrame API declarations (no new deps).

type YTPlayer = {
  playVideo(): void;
  setVolume(volume: number): void;
  destroy(): void;
};

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState?: { PLAYING?: number; ENDED?: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Load https://www.youtube.com/iframe_api exactly once per page. Guarded on
// window.YT AND an existing script tag; `onYouTubeIframeAPIReady` may already
// be claimed by an earlier effect run (or anything else), so we chain the
// previous callback AND poll for window.YT.Player as a fallback. The returned
// promise never rejects — callers race it against their own timeout so a
// blocked script can never stall the show.
let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    let poll: ReturnType<typeof setInterval> | undefined;
    let ticks = 0;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      resolve();
    };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } catch {}
      done();
    };
    if (!document.querySelector('script[src^="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      document.head.appendChild(s);
    }
    poll = setInterval(() => {
      if (window.YT?.Player) return done();
      // Give up after ~20s and allow a fresh attempt later; pending callers'
      // own race timeouts have long since moved the show along.
      if (++ticks > 200) {
        if (poll) clearInterval(poll);
        ytApiPromise = null;
      }
    }, 100);
  });
  return ytApiPromise;
}

// ---------------------------------------------------------------------------
// V4 forward-compat: `coHost` on Show and `personaId` on TalkSegment are owned
// by the show-backend slice (lib/types.ts). Read them as optional extensions —
// not redeclared shapes — so this file compiles before and after those type
// changes land, and older shows (no coHost) behave exactly as before.
type CoHost = { id: string; name: string; voice: string; delivery: string };
function coHostOf(show: Show): CoHost | undefined {
  return (show as Show & { coHost?: CoHost }).coHost;
}
function personaIdOf(seg: TalkSegment): string | undefined {
  return (seg as TalkSegment & { personaId?: string }).personaId;
}

// ---------------------------------------------------------------------------
// Chunked talks (perf): a long monologue used to be one /api/tts call (~25s of
// dead air after GO LIVE for the opening). V1 generalizes the opening's
// mechanism to EVERY talk segment >= CHUNK_MIN_CHARS: split into chunk A
// (first sentence(s), accumulated to >=140 chars) and chunk B (the rest); both
// are fetched in parallel and A plays the moment it decodes while B generates
// underneath it. Pure function — playTalk recomputes it for the
// speechSynthesis remainder fallback, so nothing extra needs caching.
const CHUNK_MIN_CHARS = 200;
function splitTalk(text: string): { a: string; b: string } {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  let a = "";
  let n = 0;
  while (n < sentences.length && (n === 0 || a.length < 140)) {
    a = a ? `${a} ${sentences[n]}` : sentences[n];
    n++;
  }
  return { a, b: sentences.slice(n).join(" ") };
}

// Encode decoded AudioBuffers into a single 16-bit PCM mono WAV (mono
// mixdown — channels are averaged, so the possibly-stereo signature theme
// folds cleanly under the mono TTS voice). Safe to concatenate: every buffer
// came out of ctx.decodeAudioData, which resamples to the context's rate.
function encodeWav(buffers: AudioBuffer[]): ArrayBuffer {
  const sampleRate = buffers[0].sampleRate;
  const total = buffers.reduce((n, b) => n + b.length, 0);
  const out = new ArrayBuffer(44 + total * 2);
  const v = new DataView(out);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + total * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bit depth
  str(36, "data");
  v.setUint32(40, total * 2, true);
  let o = 44;
  for (const b of buffers) {
    const chs: Float32Array[] = [];
    for (let c = 0; c < b.numberOfChannels; c++) chs.push(b.getChannelData(c));
    for (let i = 0; i < b.length; i++) {
      let sum = 0;
      for (const ch of chs) sum += ch[i];
      const s = Math.max(-1, Math.min(1, sum / chs.length));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}

export default function Player({ show, ctx }: { show: Show; ctx: AudioContext }) {
  const [index, setIndex] = useState(0);
  const [offAir, setOffAir] = useState(false);
  const [reacting, setReacting] = useState<"skip" | "love" | null>(null);
  const [heardYou, setHeardYou] = useState(false);
  // V1 share kit modal. The modal is conditionally rendered — it does NOT
  // exist in the DOM until `shareOpen` flips true.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTab, setShareTab] = useState<"linkedin" | "x" | "instagram">("linkedin");
  const [shareTexts, setShareTexts] = useState<{
    linkedin: string;
    x: string;
    instagram: string;
  } | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [saved, setSaved] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // P8: always-mounted container the YouTube IFrame player mounts into; kept
  // visible (className swap, never unmounted) so the effect's async code can
  // rely on the ref.
  const ytBoxRef = useRef<HTMLDivElement>(null);
  const openingWav = useRef<ArrayBuffer | null>(null);
  // Chunked talks: decoded chunk B promises keyed by segment index. The cached
  // load(i) promise resolves with chunk A (so the reaction-prefetch kick-off
  // and the prefetch loop are untouched); B rides here. A ref for the same
  // reason `cache` is one — a cancelled StrictMode run leaves both fetches
  // warming and the surviving run reuses them. No entry for talks short enough
  // (< CHUNK_MIN_CHARS) that they stay a single call.
  const chunkB = useRef<Map<number, Promise<AudioBuffer | null>>>(new Map());
  const cache = useRef<Map<number, Promise<AudioBuffer | null>>>(new Map());
  // Prebuilt reaction TTS (P6). `reactionFetches` caches the fire-and-forget
  // fetch promises (keyed "skip-0"…) so a StrictMode remount reuses them instead
  // of refetching; each promise body runs exactly once, so every decoded buffer
  // lands in `reactionReady` exactly once. `reactionRot` rotates repeat presses
  // through whatever has loaded.
  const reactionFetches = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const reactionReady = useRef<{ skip: AudioBuffer[]; love: AudioBuffer[] }>({
    skip: [],
    love: [],
  });
  const reactionRot = useRef<{ skip: number; love: number }>({ skip: 0, love: 0 });
  const activeSource = useRef<AudioBufferSourceNode | null>(null);
  // Bridge from the buttons to the CURRENT effect run's closures. The active run
  // sets this on setup and nulls it on cleanup, so a press can never reach a
  // cancelled run's song wait or reaction queue.
  const controls = useRef<((action: "skip" | "love") => void) | null>(null);
  // Stable per-show facts used by both the playback effect and the render/share
  // paths. `show` never changes for a mounted Player.
  const coHost = coHostOf(show);
  const hostName = show.persona?.name ?? "Nova";

  useEffect(() => {
    let cancelled = false;

    // Persona voice/delivery for every /api/tts call this run makes (segments
    // AND reactions). Absent on older shows — the route falls back to its env
    // default, so undefined is simply omitted from the JSON body.
    const voice = show.persona?.voice;
    const delivery = show.persona?.delivery;

    const master = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    // -----------------------------------------------------------------------
    // V1 — shared "scanning the dial" engine. ONE implementation serves three
    // callers: the intro bed (GO LIVE → opening chunk A ready, 30s cap
    // unchanged), the universal filler (any mid-show wait for audio), and the
    // deliberate handoff burst (the "changing DJs" moment). Each start builds
    // band-limited static plus a looping scan pattern: 2-3 phantom stations
    // flicker in per sweep — short 0.5-0.9s bursts of narrow-bandpassed
    // musical triads (detune-wobbled, at different center frequencies on the
    // "dial") separated by static — closed by a lock-on sweep blip; subtler
    // after the first pass. All client-synthesized, all routed through one bed
    // gain into `master` (waveform canvas stays alive). The returned stop
    // ramps the bed down and detaches the whole subtree — repeat calls are
    // no-ops, so cap timers / cleanup / normal disengage can race safely.
    const startScan = (staticGain: number, stationGain: number) => {
      const bed = ctx.createGain();
      bed.gain.value = 1;
      bed.connect(master);
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = noise.getChannelData(0);
      for (let s = 0; s < nd.length; s++) nd[s] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2800;
      filter.Q.value = 0.8;
      const sg = ctx.createGain();
      sg.gain.value = staticGain;
      src.connect(filter);
      filter.connect(sg);
      sg.connect(bed);
      src.start();
      const CHORDS = [
        [220, 261.63, 329.63], // A minor
        [246.94, 293.66, 369.99], // B minor
        [196, 246.94, 293.66], // G major
      ];
      const CENTERS = [700, 1500, 2400];
      let stopped = false;
      let pass = 0;
      let passTimer: ReturnType<typeof setTimeout> | undefined;
      const schedulePass = () => {
        if (stopped) return;
        const sub = pass === 0 ? 1 : 0.55; // subtler after the first sweep
        const bursts = pass === 0 ? 3 : 2;
        let t = ctx.currentTime + 0.35; // open on static
        for (let k = 0; k < bursts; k++) {
          const dur = 0.5 + ((pass + k) % 3) * 0.2; // 0.5–0.9s
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = CENTERS[(pass + k) % CENTERS.length];
          bp.Q.value = 7;
          const bg = ctx.createGain();
          bg.gain.setValueAtTime(0.0001, t);
          bg.gain.linearRampToValueAtTime(stationGain * sub, t + 0.08);
          bg.gain.setValueAtTime(stationGain * sub, t + Math.max(dur - 0.12, 0.1));
          bg.gain.linearRampToValueAtTime(0.0001, t + dur);
          bp.connect(bg);
          bg.connect(bed);
          // Slight detune wobble shared by this station's oscillators.
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 4.5 + k;
          const lfoDepth = ctx.createGain();
          lfoDepth.gain.value = 9; // cents
          lfo.connect(lfoDepth);
          lfo.start(t);
          lfo.stop(t + dur);
          CHORDS[(pass + k) % CHORDS.length].forEach((f, n) => {
            const o = ctx.createOscillator();
            o.type = "triangle";
            o.frequency.value = f * (k % 2 === 0 ? 1 : 2); // some stations an octave up
            o.detune.value = (n - 1) * 5;
            lfoDepth.connect(o.detune);
            o.connect(bp);
            o.start(t + n * 0.11); // lazy arp — notes stagger in
            o.stop(t + dur);
          });
          t += dur + 0.3 + (k % 2) * 0.2; // static between stations
        }
        // Lock-on sweep blip closes the pass.
        const osc = ctx.createOscillator();
        const og = ctx.createGain();
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.linearRampToValueAtTime(900, t + 0.25);
        og.gain.value = 0.06;
        osc.connect(og);
        og.connect(bed);
        osc.start(t);
        osc.stop(t + 0.25);
        t += 0.35;
        pass++;
        passTimer = setTimeout(
          schedulePass,
          Math.max((t - ctx.currentTime) * 1000, 100),
        );
      };
      schedulePass();
      return (fadeMs = 250) => {
        if (stopped) return;
        stopped = true;
        if (passTimer) clearTimeout(passTimer);
        const now = ctx.currentTime;
        bed.gain.setValueAtTime(bed.gain.value, now);
        bed.gain.linearRampToValueAtTime(0.0001, now + Math.max(fadeMs, 1) / 1000);
        setTimeout(() => {
          try {
            src.stop();
          } catch {}
          // Detaching the bed silences any oscillator still running out its
          // scheduled stop (all within a few seconds — they self-stop).
          bed.disconnect();
        }, fadeMs + 30);
      };
    };

    // Intro bed: the scan sequence runs from the moment the live screen
    // appears until the opening's chunk A is ready (30s cap unchanged), so GO
    // LIVE is never dead air. `stopStatic` nulls itself so repeat calls (cap
    // timer, playTalk, cleanup) are no-ops. Cleanup calls it with a 0ms fade,
    // so a cancelled StrictMode run never leaves it playing.
    let stopStatic: ((fadeMs?: number) => void) | null = null;
    {
      const stop = startScan(0.1, 0.08);
      const capTimer = setTimeout(() => stopStatic?.(250), 30_000);
      stopStatic = (fadeMs = 250) => {
        stopStatic = null;
        clearTimeout(capTimer);
        stop(fadeMs);
      };
    }

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // Universal filler: whenever the show loop must wait for a segment's audio
    // that isn't ready yet (any talk chunk or any song buffer), the scan bed
    // comes back up — quieter (~0.06) — within ~300ms of silence starting, and
    // fades out (250ms) when the awaited audio arrives. Never engages while
    // the intro bed or another scan (filler/handoff) is live. `fillerStop` is
    // per-run state; cleanup kills it instantly, so a cancelled StrictMode run
    // never leaves it playing.
    let fillerStop: ((fadeMs?: number) => void) | null = null;
    const awaitWithFiller = async <T,>(p: Promise<T>): Promise<T> => {
      const timer = setTimeout(() => {
        if (!cancelled && !stopStatic && !fillerStop)
          fillerStop = startScan(0.06, 0.05);
      }, 300);
      try {
        return await p;
      } finally {
        clearTimeout(timer);
        if (fillerStop) {
          const s = fillerStop;
          fillerStop = null;
          s(250);
        }
      }
    };

    // V1 handoff: a deliberate ~1.2s scan burst before the coHost's first talk
    // — even if its audio IS ready — the audible "changing DJs" moment. Rides
    // the fillerStop slot so cleanup and the filler guard both see it:
    // ~950ms of scan, then the shared 250ms fade-out.
    const handoffBurst = async () => {
      if (stopStatic || fillerStop) return; // already scanning — let it ride
      fillerStop = startScan(0.1, 0.08);
      await wait(950);
      if (fillerStop) {
        const s = fillerStop;
        fillerStop = null;
        s(250);
      }
      await wait(250);
    };

    // V1 handoff: talks whose personaId matches the coHost are voiced by the
    // coHost; reactions ALWAYS use the primary persona (accepted
    // simplification per spec).
    const ttsParamsFor = (seg: TalkSegment) =>
      coHost && personaIdOf(seg) === coHost.id
        ? { voice: coHost.voice, delivery: coHost.delivery }
        : { voice, delivery };

    const load = (i: number): Promise<AudioBuffer | null> => {
      const seg = show.segments[i];
      if (!seg) return Promise.resolve(null);
      // P8 compliance: YouTube segments have NOTHING to fetch or decode —
      // audio is never downloaded/extracted; the iframe embed does playback.
      if (seg.kind === "song" && seg.src.startsWith("yt:"))
        return Promise.resolve(null);
      let p = cache.current.get(i);
      if (p) return p;
      if (seg.kind === "talk") {
        const { voice: segVoice, delivery: segDelivery } = ttsParamsFor(seg);
        const tts = async (text: string) => {
          const r = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice: segVoice, delivery: segDelivery }),
          });
          return r.ok ? await r.arrayBuffer() : null;
        };
        // V1: EVERY talk >= CHUNK_MIN_CHARS is chunked (the opening's
        // mechanism, generalized). Both /api/tts fetches fire in parallel
        // right here — for the opening, the first load(0) call happens during
        // effect setup (the reaction-prefetch kick-off below), so generation
        // starts the moment the live screen mounts. The cached load(i) promise
        // IS chunk A; chunk B rides the chunkB ref map.
        const { a, b } =
          seg.text.length >= CHUNK_MIN_CHARS
            ? splitTalk(seg.text)
            : { a: seg.text, b: "" };
        p = (async () => {
          const raw = await tts(a);
          if (!raw) return null;
          // Opening only: chunk A's raw wav stands in until the full opening
          // re-encodes, so an early share press always has something to
          // download.
          if (i === 0) openingWav.current = raw.slice(0);
          return await ctx.decodeAudioData(raw);
        })().catch(() => null);
        if (b) {
          const pb = (async () => {
            const raw = await tts(b);
            if (!raw) return null;
            return await ctx.decodeAudioData(raw);
          })().catch(() => null);
          chunkB.current.set(i, pb);
          // Share: once BOTH opening chunks decode, re-encode the full opening
          // as one wav. If B failed, chunk A's raw wav (set above) stays,
          // matching the old single-call behavior as closely as possible.
          if (i === 0) {
            void Promise.all([p, pb]).then(([bufA, bufB]) => {
              if (bufA && bufB) openingWav.current = encodeWav([bufA, bufB]);
            });
          }
        }
        cache.current.set(i, p);
        return p;
      }
      p = (async () => {
        const r = await fetch(seg.src);
        if (!r.ok) return null;
        return await ctx.decodeAudioData(await r.arrayBuffer());
      })().catch(() => null);
      cache.current.set(i, p);
      return p;
    };

    // Per-run skip hook: while a song's wait is pending this holds its
    // interrupter; null otherwise. Being a `let` inside the effect, it belongs
    // to exactly one run — a stale run's version is unreachable once cleanup
    // nulls `controls.current`.
    let skipSong: (() => void) | null = null;
    // A skip pressed while the song buffer is still loading (skipSong not yet
    // assigned) is remembered here and honored the moment the wait starts.
    let skipRequested = false;
    // At most one queued listener reaction per segment. Holds a prebuilt buffer,
    // or an empty marker when none had loaded at press time — either way it
    // keeps the buttons one-press-at-a-time until the current segment ends.
    let pendingReaction: { buf: AudioBuffer | null } | null = null;
    // P8: teardown hook for the in-flight YouTube segment (if any) so cleanup
    // can destroy the iframe player; and a flag the waveform loop reads to draw
    // synthetic bars (the analyser hears nothing during iframe playback).
    let ytStop: (() => void) | null = null;
    let ytLive = false;

    const playBuffer = (buf: AudioBuffer) =>
      new Promise<void>((res) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(master);
        src.onended = () => res();
        activeSource.current = src;
        src.start();
      });

    const speak = (text: string) =>
      new Promise<void>((res) => {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.03;
        u.onend = () => res();
        u.onerror = () => res();
        window.speechSynthesis.speak(u);
      });

    const playTalk = async (i: number, text: string) => {
      const buf = await awaitWithFiller(load(i));
      if (cancelled) return;
      // The intro scan bed ends the moment chunk A settles (decoded OR failed
      // — the speechSynthesis fallback shouldn't talk over static): 250ms ramp
      // to silence, then the voice starts. Only ever live for segment 0.
      if (stopStatic) {
        stopStatic(250);
        await wait(250);
        if (cancelled) return;
      }
      if (buf) {
        await playBuffer(buf);
        if (cancelled) return;
        // Chunked talk: chunk B follows back-to-back, started from chunk A's
        // onended (the await above resolves there — no click, no gap beyond
        // B's own remaining generation time, which usually finished while A
        // played; any residual wait brings up the filler scan bed).
        const pb = chunkB.current.get(i);
        if (pb) {
          const bufB = await awaitWithFiller(pb);
          if (cancelled) return;
          if (bufB) {
            await playBuffer(bufB);
          } else if ("speechSynthesis" in window) {
            // B failed: speak ONLY the un-spoken remainder.
            const rest = splitTalk(text).b;
            if (rest) await speak(rest);
          }
        }
      } else if ("speechSynthesis" in window) {
        await speak(text);
      }
    };

    const playSong = async (i: number, overlapNext: boolean) => {
      const buf = await awaitWithFiller(load(i));
      if (cancelled || !buf) {
        // Drop any skip that was queued for this (failed) song so it can't
        // insta-skip the next one.
        skipRequested = false;
        return;
      }
      const dur = Math.min(45, buf.duration);
      const fade = Math.min(2, dur / 2);
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.connect(master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + fade);
      g.gain.setValueAtTime(1, t + dur - fade);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      activeSource.current = src;
      src.start(t, 0, dur);
      // Interruptible song wait: same timer as before, but a skip can resolve
      // it early after a 300ms ramp-down on this song's own gain node.
      await new Promise<void>((res) => {
        const timer = setTimeout(() => {
          skipSong = null;
          res();
        }, (overlapNext ? Math.max(dur - 1.5, 0) : dur) * 1000);
        skipSong = () => {
          skipSong = null;
          clearTimeout(timer);
          const now = ctx.currentTime;
          // Read the audible level BEFORE cancelling: cancelScheduledValues
          // snaps the param back to its last set-point, so reading after would
          // anchor the ramp at the wrong value (click on fade-in, pop on
          // fade-out).
          const v = Math.max(g.gain.value, 0.0001);
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(v, now);
          g.gain.linearRampToValueAtTime(0.0001, now + 0.3);
          setTimeout(() => {
            try {
              src.stop();
            } catch {}
            res();
          }, 320);
        };
        if (skipRequested) {
          skipRequested = false;
          skipSong();
        }
      });
    };

    // P8 COMPLIANCE (hard rules): YouTube playback happens ONLY through this
    // VISIBLE embedded IFrame player — >=320x180, rendered on-screen inside the
    // player card, never hidden/offscreen/covered while playing. Volume fades
    // use ONLY the IFrame API's setVolume. Audio is never downloaded or
    // extracted. A video that errors or won't start (embed blocked) is skipped
    // forward — the show never stalls.
    const playYt = async (videoId: string) => {
      // The API script can be blocked (adblock/offline) — race it so a yt
      // segment costs at most ~8s before we move on.
      const apiOk = await Promise.race([
        loadYouTubeApi().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 8000)),
      ]);
      const box = ytBoxRef.current;
      const yt = window.YT;
      if (cancelled || !apiOk || !yt?.Player || !box) {
        skipRequested = false;
        return;
      }
      // Let React paint the now-visible container before the iframe mounts.
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;

      box.replaceChildren();
      const holder = document.createElement("div");
      box.appendChild(holder);
      const PLAYING = yt.PlayerState?.PLAYING ?? 1;
      const ENDED = yt.PlayerState?.ENDED ?? 0;

      await new Promise<void>((resolve) => {
        let player: YTPlayer | null = null;
        let done = false;
        let entered = false;
        let vol = 0; // last volume we set — skips ramp down from here
        const timeouts = new Set<ReturnType<typeof setTimeout>>();
        const intervals = new Set<ReturnType<typeof setInterval>>();

        // Single exit: kill timers, destroy the player, clear hooks, resolve.
        const finish = () => {
          if (done) return;
          done = true;
          skipSong = null;
          skipRequested = false;
          ytStop = null;
          ytLive = false;
          timeouts.forEach(clearTimeout);
          intervals.forEach(clearInterval);
          try {
            player?.destroy();
          } catch {}
          box.replaceChildren();
          resolve();
        };
        ytStop = finish;

        // Volume ramp in JS steps via the IFrame API only (compliance).
        const ramp = (from: number, to: number, ms: number, then?: () => void) => {
          const steps = Math.max(1, Math.round(ms / 50));
          let n = 0;
          const iv = setInterval(() => {
            n++;
            vol = Math.round(
              Math.max(0, Math.min(100, from + ((to - from) * n) / steps)),
            );
            try {
              player?.setVolume(vol);
            } catch {}
            if (n >= steps) {
              clearInterval(iv);
              intervals.delete(iv);
              then?.();
            }
          }, 50);
          intervals.add(iv);
        };

        // Watchdog: 5s without ever entering PLAYING ⇒ treat as embed-blocked.
        const watchdog = setTimeout(finish, 5000);
        timeouts.add(watchdog);

        try {
          player = new yt.Player(holder, {
            videoId,
            width: "640",
            height: "360",
            playerVars: {
              enablejsapi: 1,
              origin: window.location.origin,
              playsinline: 1,
              rel: 0,
            },
            events: {
              onReady: () => {
                if (done) return;
                try {
                  player?.setVolume(0);
                  player?.playVideo();
                } catch {
                  finish();
                }
              },
              onError: () => finish(),
              onStateChange: (e) => {
                if (done) return;
                if (e.data === PLAYING && !entered) {
                  entered = true;
                  ytLive = true;
                  clearTimeout(watchdog);
                  timeouts.delete(watchdog);
                  // Fade in 0→100 over ~2s; hold; ramp down the last 2s of the
                  // 45s cap, then destroy and continue the loop.
                  ramp(0, 100, 2000);
                  const down = setTimeout(() => ramp(vol, 0, 2000, finish), 43_000);
                  timeouts.add(down);
                  // Skip: rapid ~300ms setVolume ramp, then destroy. The queued
                  // prebuilt reaction plays through the master gain right after
                  // (Web Audio context keeps running under iframe playback).
                  skipSong = () => {
                    skipSong = null;
                    intervals.forEach(clearInterval);
                    intervals.clear();
                    ramp(vol, 0, 300, finish);
                  };
                  if (skipRequested) {
                    skipRequested = false;
                    skipSong?.();
                  }
                } else if (e.data === ENDED) {
                  finish(); // video shorter than the 45s cap
                }
              },
            },
          });
        } catch {
          finish();
        }
      });
    };

    const requestReaction = (action: "skip" | "love") => {
      if (cancelled || pendingReaction) return; // one at a time — ignore extra presses
      setReacting(action);
      // P6: prebuilt reactions only — take the first available prefetched
      // buffer, rotating through them on repeat presses. Nothing loaded yet ⇒
      // proceed WITHOUT a reaction: never wait, never fetch on-press.
      const avail = reactionReady.current[action];
      const buf =
        avail.length > 0 ? avail[reactionRot.current[action]++ % avail.length] : null;
      pendingReaction = { buf };
      if (action === "skip") {
        // If the song buffer is still loading, skipSong isn't assigned yet —
        // remember the request so playSong honors it as soon as the wait starts.
        if (skipSong) skipSong();
        else skipRequested = true;
      }
    };
    controls.current = requestReaction;

    const playReaction = async () => {
      if (!pendingReaction) return;
      const { buf } = pendingReaction;
      pendingReaction = null;
      if (cancelled) return;
      if (buf) {
        await new Promise<void>((res) => {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(master);
          src.onended = () => res();
          activeSource.current = src;
          src.start();
        });
      }
      if (cancelled) return;
      setReacting(null);
      if (buf) {
        setHeardYou(true);
        setTimeout(() => setHeardYou(false), 3500);
      }
    };

    // P6: prefetch TTS for the show's prebuilt reaction lines (first 2 skip +
    // first 2 love), kicked off only once the opening buffer has resolved so
    // reaction fetches never compete with segment prefetch. Fire-and-forget:
    // promises live in `reactionFetches` (a ref), so a cancelled StrictMode run
    // leaves them warming and the surviving run reuses them.
    const prefetchReaction = (action: "skip" | "love", j: number, text: string) => {
      const key = `${action}-${j}`;
      if (reactionFetches.current.has(key)) return;
      reactionFetches.current.set(
        key,
        (async () => {
          const r = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice, delivery }),
          });
          if (!r.ok) return null;
          const buf = await ctx.decodeAudioData(await r.arrayBuffer());
          reactionReady.current[action].push(buf);
          return buf;
        })().catch(() => null),
      );
    };
    void load(0).then(() => {
      if (cancelled) return;
      for (const action of ["skip", "love"] as const) {
        (show.reactions?.[action] ?? [])
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .slice(0, 2)
          .forEach((text, j) => prefetchReaction(action, j, text));
      }
    });

    const canvas = canvasRef.current;
    const g2d = canvas?.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!canvas || !g2d) return;
      analyser.getByteFrequencyData(data);
      const w = canvas.width;
      const h = canvas.height;
      g2d.clearRect(0, 0, w, h);
      const bars = 48;
      const step = Math.floor(data.length / bars);
      const bw = w / bars;
      // P8: while the YouTube iframe plays, the analyser hears nothing — keep
      // the station alive with synthetic bars instead of a flatline.
      const t = performance.now() / 1000;
      for (let b = 0; b < bars; b++) {
        const v = ytLive
          ? Math.min(
              1,
              Math.max(
                0.06,
                0.4 +
                  0.28 * Math.sin(t * 2.3 + b * 0.55) +
                  0.22 * Math.sin(t * 4.1 + b * 1.31),
              ),
            )
          : data[b * step] / 255;
        const bh = Math.max(2, v * h);
        g2d.fillStyle = `rgba(245, 158, 11, ${0.3 + v * 0.7})`;
        g2d.fillRect(b * bw + 1, h - bh, bw - 2, bh);
      }
    };
    raf = requestAnimationFrame(draw);

    track("play_start");
    const minuteTimer = setInterval(() => track("minute"), 60_000);

    // V1 handoff: the "changing DJs" scan burst runs exactly once, right
    // before the coHost's FIRST talk segment. Per-run state — a StrictMode
    // remount replays it, which is correct (the show restarts).
    let handoffScanDone = false;
    (async () => {
      for (let i = 0; i < show.segments.length; i++) {
        if (cancelled) return;
        setIndex(i);
        if (i + 1 < show.segments.length) void load(i + 1);
        const seg = show.segments[i];
        if (seg.kind === "talk") {
          if (!handoffScanDone && coHost && personaIdOf(seg) === coHost.id) {
            handoffScanDone = true;
            await handoffBurst();
            if (cancelled) return;
          }
          if (i === 0 && show.sponsor) track("ad_impression");
          await playTalk(i, seg.text);
        } else if (seg.src.startsWith("yt:")) {
          await playYt(seg.src.slice(3));
        } else {
          await playSong(i, show.segments[i + 1]?.kind === "talk");
        }
        if (cancelled) return;
        // A queued skip/love reaction plays here — after the song it belongs
        // to, before the next scheduled segment.
        await playReaction();
      }
      if (!cancelled) setOffAir(true);
    })();

    return () => {
      cancelled = true;
      controls.current = null;
      clearInterval(minuteTimer);
      cancelAnimationFrame(raf);
      // P8: destroy this run's iframe player (if one is mid-segment) so a
      // StrictMode remount or unmount never leaves YouTube audio playing.
      try {
        ytStop?.();
      } catch {}
      // Kill the scan beds instantly (no fade) — master.disconnect() below
      // silences the ~30ms teardown timer's window anyway.
      try {
        stopStatic?.(0);
      } catch {}
      try {
        fillerStop?.(0);
      } catch {}
      fillerStop = null;
      try {
        activeSource.current?.stop();
      } catch {}
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      master.disconnect();
      analyser.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // V1 share kit: the capture is the FULL opening talk (all decoded chunks)
  // plus the signature theme's decoded buffer — already in the segment cache
  // from playback prefetch, and STILL there even if the listener skipped it
  // mid-play (skip only stops the source node; the decoded AudioBuffer stays
  // cached). Signature absent (no key) or failed (503 ⇒ null) ⇒ opening only.
  // Mixed down to one mono wav; if chunk A never decoded, fall back to
  // whatever raw wav `openingWav` holds (possibly null ⇒ no download yet).
  const buildCaptureWav = async (): Promise<ArrayBuffer | null> => {
    try {
      const pa = cache.current.get(0);
      const a = pa ? await pa : null;
      if (!a) return openingWav.current;
      const bufs: AudioBuffer[] = [a];
      const pb = chunkB.current.get(0);
      if (pb) {
        const b = await pb;
        if (b) bufs.push(b);
      }
      const sigIdx = show.segments.findIndex(
        (s) => s.kind === "song" && s.src.startsWith("/api/jingle"),
      );
      if (sigIdx >= 0) {
        const sp = cache.current.get(sigIdx);
        if (sp) {
          const sig = await sp;
          if (sig) bufs.push(sig);
        }
      }
      return encodeWav(bufs);
    } catch {
      return openingWav.current;
    }
  };

  const downloadSignal = async () => {
    if (encoding) return;
    setEncoding(true);
    const wav = await buildCaptureWav();
    setEncoding(false);
    if (!wav) return;
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-signal.wav";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // Lazily fetched on first open, cached for the session; route failure ⇒ one
  // generic client-side fallback text. Tracks "share" once per OPEN (not per
  // copy/download).
  const openShare = () => {
    setShareOpen(true);
    track("share");
    if (shareTexts || shareLoading || shareFailed) return;
    setShareLoading(true);
    (async () => {
      try {
        const r = await fetch("/api/share-texts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stationName: show.stationName,
            // The route rejects >7 chips or any chip >60 chars, and the
            // fingerprint can legitimately hold 7 chips + a link chip (8) with
            // uncapped lengths — clamp so honest inputs never 400.
            fingerprint: show.fingerprint.slice(0, 7).map((c) => c.slice(0, 60)),
            personaName: hostName,
            ...(coHost ? { coHostName: coHost.name } : {}),
          }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as Record<string, unknown>;
        if (
          typeof j.linkedin === "string" &&
          typeof j.x === "string" &&
          typeof j.instagram === "string"
        ) {
          setShareTexts({ linkedin: j.linkedin, x: j.x, instagram: j.instagram });
        } else {
          throw new Error("bad shape");
        }
      } catch {
        setShareFailed(true);
      } finally {
        setShareLoading(false);
      }
    })();
  };

  const genericShareText = `${show.stationName} — my personal AI radio station, built live around ${show.fingerprint.slice(0, 3).join(", ") || "my interests"}. Hosted by ${hostName}${coHost ? ` with ${coHost.name}` : ""}. Make yours → ${typeof window !== "undefined" ? window.location.origin : ""}`;

  const copyShare = async (tab: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTab(tab);
      setTimeout(() => setCopiedTab(null), 2000);
    } catch {}
  };

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const nativeShare = (text: string) => {
    navigator.share({ text }).catch(() => {});
  };

  // Share modal: Escape dismisses. The listener exists only while the modal is
  // open (and the modal itself is conditionally rendered — it is absent from
  // the DOM until opened).
  useEffect(() => {
    if (!shareOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShareOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shareOpen]);

  const reactTo = (action: "skip" | "love") => {
    if (show.segments[index]?.kind !== "song") return;
    controls.current?.(action);
  };

  const seg = show.segments[index];
  const isYtSeg = !offAir && seg?.kind === "song" && seg.src.startsWith("yt:");
  // "handoff" arrives with the V4 backend slice; the Record type keeps the
  // lookup total either way, with a safe fallback for unknown labels.
  const talkLabels: Record<string, string> = {
    opening: "opening monologue",
    transition: "between tracks",
    handoff: "taking over the mic",
    outro: "sign-off",
  };
  // Now-playing credits the coHost for their segments; the "heard you" line
  // stays on the primary host (reactions always use the primary persona).
  const talkName =
    seg?.kind === "talk" && coHost && personaIdOf(seg) === coHost.id
      ? coHost.name
      : hostName;
  const nowPlaying =
    seg?.kind === "song"
      ? `♪ ${seg.title}`
      : seg
        ? `${talkName} — ${talkLabels[seg.label] ?? "on the mic"}`
        : "";

  return (
    <section className="flex flex-1 flex-col">
      <div className="flex items-center justify-between">
        <span
          className={`flex items-center gap-2.5 rounded-full border px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.25em] ${
            offAir ? "border-line text-muted" : "border-amber/50 text-amber"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              offAir ? "bg-muted" : "onair-dot bg-amber"
            }`}
          />
          {offAir ? "off air" : "on air"}
        </span>
        <span className="font-mono text-[11px] text-muted">
          {index + 1} / {show.segments.length}
        </span>
      </div>

      <h2 className="mt-8 text-5xl font-bold tracking-tight sm:text-6xl">
        {show.stationName}
      </h2>
      <p className="mt-3 text-lg text-muted">{show.tagline}</p>

      <p className="mt-6 font-mono text-sm text-amber" aria-live="polite">
        {offAir ? "that's the show — thanks for listening" : nowPlaying}
      </p>
      {isYtSeg && (
        <p className="mt-1 font-mono text-[11px] text-muted">
          playing via YouTube
        </p>
      )}
      <p
        className={`mt-1 font-mono text-[11px] text-violet transition-opacity duration-1000 ${
          heardYou ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!heardYou}
      >
        {hostName} heard you
      </p>

      {/* P8 COMPLIANCE: the YouTube player mounts here — a VISIBLE embed of at
          least 320x180, in normal flow inside the player card, never hidden,
          offscreen, or covered while a video plays. Volume is controlled only
          via the IFrame API's setVolume; embed failures skip forward; audio is
          never downloaded or extracted. The div stays mounted (class swap
          only) so the playback effect can rely on the ref. */}
      <div
        ref={ytBoxRef}
        className={
          isYtSeg
            ? "mt-4 aspect-video w-full overflow-hidden rounded-lg border border-line bg-black [&_iframe]:h-full [&_iframe]:w-full"
            : "hidden"
        }
        style={isYtSeg ? { minWidth: 320, minHeight: 180 } : undefined}
      />

      {/* The waveform is the hero of the stage — just the voice waves. */}
      <canvas
        ref={canvasRef}
        width={1024}
        height={220}
        className="mt-5 h-40 w-full rounded-xl border border-line bg-black/30 sm:h-52"
      />

      <div
        className={`mt-4 flex gap-2 ${
          !offAir && seg?.kind === "song" ? "" : "invisible"
        }`}
      >
        <button
          onClick={() => reactTo("skip")}
          disabled={reacting !== null}
          className="rounded-full border border-line px-4 py-1.5 text-xs font-medium transition-colors hover:border-amber hover:text-amber focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:pointer-events-none disabled:opacity-40"
        >
          ⏭ not tonight
        </button>
        <button
          onClick={() => reactTo("love")}
          disabled={reacting !== null}
          className="rounded-full border border-line px-4 py-1.5 text-xs font-medium transition-colors hover:border-violet hover:text-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet disabled:pointer-events-none disabled:opacity-40"
        >
          ♥ more like this
        </button>
      </div>

      <div className="mt-4 flex gap-1.5" aria-hidden="true">
        {show.segments.map((s, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < index || offAir
                ? s.kind === "talk"
                  ? "bg-amber/70"
                  : "bg-violet/70"
                : i === index
                  ? s.kind === "talk"
                    ? "bg-amber"
                    : "bg-violet"
                  : "bg-line"
            }`}
          />
        ))}
      </div>

      {show.sponsor && (
        <p className="mt-3 font-mono text-[11px] text-muted">
          today&apos;s show is brought to you by {show.sponsor.advertiser}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {show.fingerprint.map((c) => (
          <span
            key={c}
            className="rounded-full border border-violet/40 bg-violet/10 px-3 py-1 text-xs"
          >
            {c}
          </span>
        ))}
      </div>

      <button
        onClick={openShare}
        className="mt-8 self-start rounded-full border border-line px-6 py-3 font-medium transition-colors hover:border-amber hover:text-amber focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
      >
        Share my Signal
      </button>

      {/* V1 share kit modal — conditionally rendered: NOT in the DOM until
          opened. Dismissible three ways: Escape (effect above), backdrop
          click, and the close button. */}
      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShareOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Share my Signal"
            className="w-full max-w-md rounded-xl border border-line bg-[#0b0b12] p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-amber">
                share my signal
              </h3>
              <button
                onClick={() => setShareOpen(false)}
                aria-label="Close share modal"
                className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-amber hover:text-amber focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
              >
                ✕
              </button>
            </div>

            <button
              onClick={downloadSignal}
              className="mt-4 w-full rounded-full border border-amber/50 px-4 py-2.5 text-sm font-medium text-amber transition-colors hover:bg-amber/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
            >
              {encoding
                ? "encoding your signal…"
                : saved
                  ? "saved — check your downloads"
                  : "Download my Signal .wav"}
            </button>
            <p className="mt-1.5 font-mono text-[10px] text-muted">
              {show.segments.some(
                (s) => s.kind === "song" && s.src.startsWith("/api/jingle"),
              )
                ? "your opening monologue + your Lyria-composed station ident"
                : "your opening monologue, music-free"}
            </p>

            {shareLoading ? (
              <p className="mt-5 font-mono text-xs text-muted" aria-live="polite">
                writing your captions…
              </p>
            ) : shareFailed ? (
              <div className="mt-5">
                <p className="whitespace-pre-wrap rounded-lg border border-line bg-black/30 p-3 text-xs leading-relaxed">
                  {genericShareText}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => copyShare("generic", genericShareText)}
                    className="rounded-full border border-line px-4 py-1.5 text-xs font-medium transition-colors hover:border-amber hover:text-amber"
                  >
                    {copiedTab === "generic" ? "copied" : "Copy"}
                  </button>
                  {canNativeShare && (
                    <button
                      onClick={() => nativeShare(genericShareText)}
                      className="rounded-full border border-line px-4 py-1.5 text-xs font-medium transition-colors hover:border-violet hover:text-violet"
                    >
                      Share…
                    </button>
                  )}
                </div>
              </div>
            ) : shareTexts ? (
              <div className="mt-5">
                <div className="flex gap-1.5" role="tablist" aria-label="Share text style">
                  {(["linkedin", "x", "instagram"] as const).map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={shareTab === tab}
                      onClick={() => setShareTab(tab)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        shareTab === tab
                          ? "border-amber/60 text-amber"
                          : "border-line text-muted hover:border-amber/40 hover:text-amber"
                      }`}
                    >
                      {tab === "linkedin" ? "LinkedIn" : tab === "x" ? "X" : "Instagram"}
                    </button>
                  ))}
                </div>
                <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-black/30 p-3 text-xs leading-relaxed">
                  {shareTexts[shareTab]}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => copyShare(shareTab, shareTexts[shareTab])}
                    className="rounded-full border border-line px-4 py-1.5 text-xs font-medium transition-colors hover:border-amber hover:text-amber"
                  >
                    {copiedTab === shareTab ? "copied" : "Copy"}
                  </button>
                  {canNativeShare && (
                    <button
                      onClick={() => nativeShare(shareTexts[shareTab])}
                      className="rounded-full border border-line px-4 py-1.5 text-xs font-medium transition-colors hover:border-violet hover:text-violet"
                    >
                      Share…
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
