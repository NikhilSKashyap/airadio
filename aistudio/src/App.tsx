import { useEffect, useRef, useState } from "react";
import { PERSONAS } from "./personas.ts";

type Seg = { kind: "talk"; label: string; text: string } | { kind: "song"; title: string };
type Show = {
  stationName: string;
  tagline: string;
  fingerprint: string[];
  persona: { id: string; name: string; voice: string; delivery: string };
  reactions: { skip: string[]; love: string[] };
  segments: Seg[];
  fallback?: boolean;
};

const DEFAULT_CHIPS = ["AI & tech", "Football", "Indian startups", "Electronic music", "Space"];
const AVATAR: Record<string, { emoji: string; bg: string }> = {
  nova: { emoji: "🌙", bg: "radial-gradient(circle at 35% 30%, #2a2450, #0d0d14)" },
  riff: { emoji: "🎙️", bg: "radial-gradient(circle at 35% 30%, #5a3a12, #0d0d14)" },
  meethi: { emoji: "🌼", bg: "radial-gradient(circle at 35% 30%, #5a2a3a, #0d0d14)" },
  velvet: { emoji: "🕶️", bg: "radial-gradient(circle at 35% 30%, #3a2a12, #0d0d14)" },
};

export default function App() {
  const [chips, setChips] = useState<string[]>(DEFAULT_CHIPS);
  const [draft, setDraft] = useState("");
  const [personaId, setPersonaId] = useState("nova");
  const [name, setName] = useState("");
  const [show, setShow] = useState<Show | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const addChip = () => {
    const v = draft.trim();
    if (v && chips.length < 7 && !chips.includes(v)) setChips([...chips, v]);
    setDraft("");
  };

  const goLive = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    await ctxRef.current.resume();
    try {
      const r = await fetch("/api/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests: chips, listenerName: name || undefined, personaId }),
      });
      const data: Show = await r.json();
      setShow(data);
    } catch {
      setError("Couldn't reach the studio. Adjusting the antenna — try again.");
    } finally {
      setBusy(false);
    }
  };

  const hostName = PERSONAS.find((p) => p.id === personaId)?.name ?? "Nova";

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <div className="wordmark" style={{ fontSize: 22 }}>
            WAVE<span style={{ color: "var(--amber)" }}>LENGTH</span>
          </div>
          <div className="eyebrow" style={{ marginTop: 4 }}>fm for an audience of one</div>
        </div>

        <div>
          <div className="section-label">Your signals</div>
          <div className="chips">
            {chips.map((c) => (
              <span className="chip" key={c}>
                {c}
                <button onClick={() => setChips(chips.filter((x) => x !== c))} aria-label={`remove ${c}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            className="input"
            style={{ marginTop: 9 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChip()}
            placeholder="add an interest ↵"
          />
        </div>

        <div>
          <div className="section-label">Your host</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                className={`host-card${personaId === p.id ? " sel" : ""}`}
                onClick={() => setPersonaId(p.id)}
              >
                <span className="host-avatar" style={{ background: AVATAR[p.id].bg }}>
                  {AVATAR[p.id].emoji}
                </span>
                <span>
                  <div className="host-name">{p.name}</div>
                  <div className="host-tag">{p.tagline}</div>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="your name → names the station"
          />
          <button className="btn btn-primary" onClick={goLive} disabled={busy}>
            {busy ? `${hostName} is tuning in…` : "● Go Live"}
          </button>
          {error && <div className="error">{error}</div>}
        </div>
      </aside>

      <main className="stage">
        {show ? (
          <Player show={show} ctx={ctxRef.current!} />
        ) : (
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">the station on your wavelength</div>
            <h1 className="wordmark" style={{ fontSize: 72, margin: "14px 0 22px" }}>
              WAVE<span style={{ color: "var(--amber)" }}>LENGTH</span>
            </h1>
            <p style={{ color: "var(--muted)", maxWidth: 440, margin: "0 auto 30px", lineHeight: 1.6 }}>
              Gemini writes the show. {hostName} hosts it. Your interests, tonight's news, and your taste — live on your own frequency.
            </p>
            <Dial />
          </div>
        )}
      </main>
    </div>
  );
}

function Dial() {
  return (
    <svg className="dial" viewBox="0 0 520 60">
      {Array.from({ length: 53 }).map((_, i) => {
        const major = i % 5 === 0;
        return <line key={i} x1={10 + i * 9.6} y1={40} x2={10 + i * 9.6} y2={major ? 20 : 30} stroke={major ? "#3a3a48" : "#23232e"} strokeWidth={1} />;
      })}
      <line x1={260} y1={12} x2={260} y2={46} stroke="var(--amber)" strokeWidth={2} />
    </svg>
  );
}

function Player({ show, ctx }: { show: Show; ctx: AudioContext }) {
  const [index, setIndex] = useState(0);
  const [offAir, setOffAir] = useState(false);
  const [heard, setHeard] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controls = useRef<{ skip?: () => void } | null>(null);
  const reactBufs = useRef<{ skip: AudioBuffer[]; love: AudioBuffer[] }>({ skip: [], love: [] });
  const reactRot = useRef({ skip: 0, love: 0 });
  const pending = useRef<AudioBuffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    const master = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    const persona = show.persona;
    const ttsBuf = async (text: string): Promise<AudioBuffer | null> => {
      try {
        const r = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: persona.voice, delivery: persona.delivery }),
        });
        if (!r.ok) return null;
        return await ctx.decodeAudioData(await r.arrayBuffer());
      } catch {
        return null;
      }
    };

    // Prefetch two reactions per action so a skip plays with no lull.
    (async () => {
      for (const kind of ["skip", "love"] as const) {
        for (const line of show.reactions[kind].slice(0, 2)) {
          const b = await ttsBuf(line);
          if (cancelled) return;
          if (b) reactBufs.current[kind].push(b);
        }
      }
    })();

    // ---- synthesized beds (no external audio) ----
    let staticNode: { stop: () => void } | null = null;
    const startStatic = (gain: number) => {
      if (staticNode) return;
      const dur = 2;
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2600;
      filter.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(master);
      src.start();
      // phantom station blips
      const blips = [420, 660, 900];
      blips.forEach((f, i) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.frequency.value = f;
        o.type = "triangle";
        og.gain.value = 0;
        o.connect(og).connect(master);
        const t = ctx.currentTime + 0.3 + i * 0.5;
        og.gain.setValueAtTime(0, t);
        og.gain.linearRampToValueAtTime(0.08, t + 0.06);
        og.gain.linearRampToValueAtTime(0, t + 0.5);
        o.start(t);
        o.stop(t + 0.6);
      });
      staticNode = {
        stop: () => {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0.0001, t + 0.25);
          setTimeout(() => {
            try {
              src.stop();
            } catch {}
          }, 300);
          staticNode = null;
        },
      };
    };

    const musicBed = (seconds: number): { stop: () => void; done: Promise<void> } => {
      const notes = [220, 261.63, 329.63, 392];
      const t0 = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.linearRampToValueAtTime(0.18, t0 + 1.5);
      g.gain.setValueAtTime(0.18, t0 + seconds - 1.5);
      g.gain.linearRampToValueAtTime(0.0001, t0 + seconds);
      g.connect(master);
      const oscs: OscillatorNode[] = [];
      notes.forEach((base, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = base;
        o.detune.value = (i - 1.5) * 4;
        const og = ctx.createGain();
        og.gain.value = i === 0 ? 0.6 : 0.22;
        o.connect(og).connect(g);
        o.start(t0);
        o.stop(t0 + seconds + 0.1);
        oscs.push(o);
      });
      // gentle chord LFO
      const done = new Promise<void>((res) => setTimeout(res, seconds * 1000));
      return {
        stop: () => {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
          g.gain.linearRampToValueAtTime(0.0001, t + 0.3);
          oscs.forEach((o) => {
            try {
              o.stop(t + 0.32);
            } catch {}
          });
        },
        done,
      };
    };

    const playBuffer = (buf: AudioBuffer) =>
      new Promise<void>((res) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(master);
        src.onended = () => res();
        src.start();
      });

    const speak = (text: string) =>
      new Promise<void>((res) => {
        if (!("speechSynthesis" in window)) return res();
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => res();
        u.onerror = () => res();
        window.speechSynthesis.speak(u);
      });

    // ---- waveform ----
    const canvas = canvasRef.current;
    const g2d = canvas?.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!canvas || !g2d) return;
      analyser.getByteFrequencyData(data);
      const w = canvas.width, h = canvas.height, bars = 56, step = Math.floor(data.length / bars), bw = w / bars;
      g2d.clearRect(0, 0, w, h);
      for (let b = 0; b < bars; b++) {
        const v = data[b * step] / 255;
        const bh = Math.max(2, v * h);
        g2d.fillStyle = `rgba(245,158,11,${0.28 + v * 0.72})`;
        g2d.fillRect(b * bw + 1, (h - bh) / 2, bw - 2, bh);
      }
    };
    raf = requestAnimationFrame(draw);

    const playReaction = async () => {
      const buf = pending.current;
      pending.current = null;
      if (buf) {
        await playBuffer(buf);
        if (!cancelled) {
          setHeard(true);
          setTimeout(() => !cancelled && setHeard(false), 2200);
        }
      }
    };

    (async () => {
      for (let i = 0; i < show.segments.length; i++) {
        if (cancelled) return;
        setIndex(i);
        const seg = show.segments[i];
        if (seg.kind === "talk") {
          const buf = await ttsBuf(seg.text);
          if (cancelled) return;
          if (buf) await playBuffer(buf);
          else {
            startStatic(0.05);
            await speak(seg.text);
            staticNode?.stop();
          }
        } else {
          const bed = musicBed(20);
          let skipped = false;
          controls.current = {
            skip: () => {
              if (skipped) return;
              skipped = true;
              const kind = "skip" as const;
              const arr = reactBufs.current[kind];
              if (arr.length) pending.current = arr[reactRot.current[kind]++ % arr.length];
              bed.stop();
            },
          };
          await Promise.race([bed.done, new Promise<void>((res) => {
            const iv = setInterval(() => {
              if (skipped || cancelled) {
                clearInterval(iv);
                res();
              }
            }, 100);
          })]);
          controls.current = null;
          if (pending.current) await playReaction();
        }
      }
      if (!cancelled) setOffAir(true);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      staticNode?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      try {
        master.disconnect();
        analyser.disconnect();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const love = () => {
    const arr = reactBufs.current.love;
    if (arr.length && !pending.current) pending.current = arr[reactRot.current.love++ % arr.length];
    setHeard(true);
    setTimeout(() => setHeard(false), 2200);
  };

  const seg = show.segments[index];
  const now =
    offAir ? "that's the show — thanks for listening" : seg?.kind === "song" ? `♪ ${seg.title}` : `${show.persona.name} — on air`;
  const isSong = seg?.kind === "song";

  return (
    <div style={{ width: "100%", maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className={`badge ${offAir ? "off" : "on"} mono`}>
          <span className={`dot ${offAir ? "off" : "on"}`} />
          {offAir ? "off air" : "on air"}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          {index + 1} / {show.segments.length}
        </span>
      </div>

      <h2 style={{ fontSize: 46, fontWeight: 800, margin: "22px 0 6px", letterSpacing: "-0.02em" }}>{show.stationName}</h2>
      <p style={{ color: "var(--muted)" }}>{show.tagline}</p>
      {show.fallback && (
        <p className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>studio fallback — add GEMINI_API_KEY for live news + voice</p>
      )}

      <p className="mono" style={{ color: "var(--amber)", margin: "22px 0 10px", fontSize: 14 }}>
        {now}
        {heard && <span style={{ color: "var(--violet)" }}> · {show.persona.name} heard you</span>}
      </p>

      <div className="canvas-wrap">
        <canvas ref={canvasRef} width={760} height={150} style={{ width: "100%", height: 150, display: "block" }} />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, minHeight: 40 }}>
        {isSong && !offAir && (
          <>
            <button className="btn" onClick={() => controls.current?.skip?.()}>⏭ not tonight</button>
            <button className="btn" onClick={love}>♥ more like this</button>
          </>
        )}
      </div>

      <div className="chips" style={{ marginTop: 20 }}>
        {show.fingerprint.map((c) => (
          <span className="chip" key={c}>{c}</span>
        ))}
      </div>
    </div>
  );
}
