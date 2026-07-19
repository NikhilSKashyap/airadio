#!/usr/bin/env node
// Generates Airadio's three default music beds with zero-dependency DSP,
// then converts WAV → mp3 via the ffmpeg CLI and deletes the WAVs.
// Usage: node scripts/make-music.mjs

import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const TAU = Math.PI * 2;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "music");

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const cents = (c) => 2 ** (c / 1200);

const tri = (x) => Math.sin(x) - Math.sin(3 * x) / 9 + Math.sin(5 * x) / 25;
const softSquare = (x) =>
  0.6 * (Math.sin(x) + Math.sin(3 * x) / 3 + Math.sin(5 * x) / 5 + Math.sin(7 * x) / 7);
const subOsc = (x) => Math.sin(x) + 0.12 * Math.sin(2 * x);

const adsr = (a, d, s, r) => (t, dur) => {
  if (t < 0 || t >= dur) return 0;
  let e = t < a ? t / a : t < a + d ? 1 - (1 - s) * ((t - a) / d) : s;
  const rel = dur - r;
  if (t > rel) e *= 1 - (t - rel) / r;
  return e;
};

function renderTrack(cfg) {
  const beat = 60 / cfg.bpm;
  const bar = beat * 4;
  const total = cfg.bars * bar + 1.2;
  const n = Math.ceil(total * SR);
  const L = new Float64Array(n);
  const R = new Float64Array(n);

  const addVoice = (start, dur, freq, amp, pan, wave, env) => {
    const i0 = Math.max(0, Math.round(start * SR));
    const i1 = Math.min(n, Math.round((start + dur) * SR));
    const th = ((pan + 1) * Math.PI) / 4;
    const gL = amp * Math.cos(th);
    const gR = amp * Math.sin(th);
    const w = (TAU * freq) / SR;
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SR;
      const s = wave(w * (i - i0)) * env(t, dur);
      L[i] += s * gL;
      R[i] += s * gR;
    }
  };

  const padEnv = adsr(bar * 0.15, bar * 0.25, 0.7, bar * 0.35);
  const subEnv = adsr(0.04, 0.25, 0.85, bar * 0.25);
  const arpEnv = adsr(0.004, beat * 0.25, 0.3, beat * 0.12);
  const detunes = [-4, 0, 4]; // cents — chorus-like warmth
  const pans = [-0.45, 0, 0.45];

  for (let b = 0; b < cfg.bars; b++) {
    const chord = cfg.chords[b % cfg.chords.length];
    const t0 = b * bar;

    chord.notes.forEach((m, ni) => {
      const f = midiHz(m);
      detunes.forEach((c, di) => {
        addVoice(t0, bar, f * cents(c), cfg.padGain / (chord.notes.length * 3), pans[(ni + di) % 3], tri, padEnv);
      });
      addVoice(t0, bar, f * 2 * cents(detunes[ni % 3] * 1.5), cfg.padGain * 0.05, pans[(ni + 1) % 3], Math.sin, padEnv);
    });

    addVoice(t0, bar, midiHz(chord.sub), cfg.subGain, 0, subOsc, subEnv);

    if (cfg.arp) {
      const step = beat / 2;
      for (let k = 0; k < 8; k++) {
        const st = t0 + k * step + (k % 2 ? step * cfg.swing : 0);
        const m = chord.notes[cfg.arp.pattern[k % cfg.arp.pattern.length] % chord.notes.length] + 12;
        addVoice(st, step * 0.9, midiHz(m), cfg.arp.gain, k % 2 ? 0.3 : -0.3, softSquare, arpEnv);
      }
    }
  }

  // Sidechain-ish pump on every beat + slow breathing LFO (applied before hats).
  const duckRel = beat * 0.45;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t % beat;
    const duck = 1 - cfg.duckDepth * Math.max(0, 1 - p / duckRel) ** 2;
    const g = duck * (1 + cfg.lfoDepth * Math.sin(TAU * cfg.lfoRate * t));
    L[i] *= g;
    R[i] *= g;
  }

  // Swung offbeat hats: differentiated (high-passed) noise bursts.
  const addHat = (start, amp) => {
    const i0 = Math.round(start * SR);
    const i1 = Math.min(n, i0 + Math.round(0.09 * SR));
    let prev = 0;
    for (let i = Math.max(0, i0); i < i1; i++) {
      const t = (i - i0) / SR;
      const w = Math.random() * 2 - 1;
      const s = (w - prev) * 0.5 * Math.exp(-t * 55) * amp;
      prev = w;
      L[i] += s * 0.85;
      R[i] += s;
    }
  };
  for (let b = 0; b < cfg.bars; b++) {
    for (let k = 0; k < 4; k++) {
      addHat(b * bar + k * beat + beat * (0.5 + cfg.swing * 0.5), cfg.hatGain * (k % 2 ? 1 : 0.7));
    }
  }

  // Master: normalize → soft clip → gain 0.5 → 1s fades.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const norm = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fade = Math.min(1, t, total - t);
    L[i] = Math.tanh(L[i] * norm * 1.5) * 0.5 * fade;
    R[i] = Math.tanh(R[i] * norm * 1.5) * 0.5 * fade;
  }
  return { L, R };
}

function wavBuffer(L, R) {
  const n = L.length;
  const bytes = n * 4;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(bytes, 40);
  const clip = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(clip(L[i]), 44 + i * 4);
    buf.writeInt16LE(clip(R[i]), 46 + i * 4);
  }
  return buf;
}

const TRACKS = {
  "midnight-signal": {
    // lo-fi late-night bed: Am – F – C – G
    bpm: 72,
    bars: 14,
    chords: [
      { notes: [57, 60, 64], sub: 33 }, // Am
      { notes: [53, 57, 60], sub: 29 }, // F
      { notes: [55, 60, 64], sub: 36 }, // C
      { notes: [55, 59, 62], sub: 31 }, // G
    ],
    padGain: 0.9,
    subGain: 0.35,
    hatGain: 0.16,
    swing: 0.3,
    duckDepth: 0.35,
    lfoRate: 0.07,
    lfoDepth: 0.07,
  },
  "neon-drive": {
    // brighter cruise: Dm – Bb – F – C with a squareish arp low in the mix
    bpm: 100,
    bars: 20,
    chords: [
      { notes: [62, 65, 69], sub: 38 }, // Dm
      { notes: [58, 62, 65], sub: 34 }, // Bb
      { notes: [57, 60, 65], sub: 41 }, // F
      { notes: [55, 60, 64], sub: 36 }, // C
    ],
    padGain: 0.8,
    subGain: 0.3,
    hatGain: 0.2,
    swing: 0.18,
    duckDepth: 0.45,
    lfoRate: 0.05,
    lfoDepth: 0.04,
    arp: { gain: 0.09, pattern: [0, 1, 2, 1, 0, 2, 1, 2] },
  },
  "static-bloom": {
    // dreamy maj7 drift: Cmaj7 – Am7 – Fmaj7 – G, soft rising arp, gentle pump
    bpm: 88,
    bars: 17,
    chords: [
      { notes: [60, 64, 67, 71], sub: 36 }, // Cmaj7
      { notes: [57, 60, 64, 67], sub: 33 }, // Am7
      { notes: [53, 57, 60, 64], sub: 29 }, // Fmaj7
      { notes: [55, 59, 62, 67], sub: 31 }, // G(add12)
    ],
    padGain: 0.95,
    subGain: 0.26,
    hatGain: 0.1,
    swing: 0.24,
    duckDepth: 0.22,
    lfoRate: 0.06,
    lfoDepth: 0.09,
    arp: { gain: 0.06, pattern: [0, 2, 1, 3, 2, 0, 3, 1] },
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, cfg] of Object.entries(TRACKS)) {
  console.log(`Rendering ${name}…`);
  const { L, R } = renderTrack(cfg);
  const wavPath = path.join(OUT, `${name}.wav`);
  const mp3Path = path.join(OUT, `${name}.mp3`);
  writeFileSync(wavPath, wavBuffer(L, R));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-codec:a", "libmp3lame", "-q:a", "2", mp3Path]);
  unlinkSync(wavPath);
  console.log(`  → ${path.relative(process.cwd(), mp3Path)}`);
}
