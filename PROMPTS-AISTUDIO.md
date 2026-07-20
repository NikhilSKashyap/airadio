# Wavelength — AI Studio Build prompt log

The AI Studio track entry is built entirely inside Google AI Studio → Build, by prompting. This file logs every prompt fed to Build, in order, as required to showcase AI-Studio-driven development. (The Replit flagship's prompt architecture is documented separately in PROMPTS.md.)

## Prompt 1 — core app

> Build "Wavelength" — a personal AI radio station web app. Dark late-night studio aesthetic: near-black #07070b background, amber #f59e0b and violet #8b5cf6 accents, monospace accent labels, tasteful and premium (no gradient soup).
>
> LAYOUT (like NotebookLM): left sidebar + main stage.
> Sidebar top-to-bottom: (1) wordmark "WAVELENGTH" with "fm for an audience of one" tagline; (2) "YOUR SIGNALS" — 5 editable interest chips (defaults: AI & tech, Football, Indian startups, Electronic music, Space; removable ×, add via input, max 7); (3) "YOUR HOST" — 4 selectable host cards with circular CSS-art avatars: Nova (calm late-night host, amber crescent motif), Riff (explosive 6AM broadcast comedian, sunrise motif), RJ Meethi (warm Mumbai RJ, light Hinglish, marigold motif), Velvet ('70s soul-funk DJ, vinyl motif) — each an ORIGINAL fictional persona, selected card gets an amber ring; (4) name input labeled "your name → names the station"; (5) big amber "GO LIVE" button.
> Main stage idle: giant WAVELENGTH wordmark + an FM tuner dial graphic. Main stage live: "ON AIR" pulsing badge, station name "\<Name\> FM" in huge type, a hero animated waveform visualization, now-playing line, and skip ("not tonight") / love ("more like this") buttons.
>
> ON GO LIVE, generate the show with the Gemini API (@google/genai, model gemini-3-flash-preview) with Google Search grounding, requesting STRICT JSON: a ~150-word opening monologue in the selected host's persona (station-ID greeting addressing the listener by name, the biggest REAL news story from the last 24h tied to the interest chips — if a major event like a tournament final is happening today, lead with it — then a second story, a preview, a segue), plus two 40-60 word transition talks, an outro, and 4 "listener skipped" + 4 "listener loved it" one-liner reactions in persona. Parse defensively (strip code fences; on any error use a well-written hardcoded fallback show so the app NEVER fails).
>
> Speak every talk segment with Gemini native TTS (model gemini-2.5-flash-preview-tts, responseModalities AUDIO): voices — Nova=Kore, Riff=Puck, Meethi=Leda, Velvet=Charon — wrapping text as "Say this \<persona delivery style\>: \<text\>". Decode the returned base64 PCM (24kHz mono 16-bit) via Web Audio and animate the waveform from an AnalyserNode while it plays. Between talk segments play a 20-second synthesized lo-fi music bed (Web Audio oscillators/noise, pleasant chord loop, gentle fades — no external audio files). While a song plays, the skip button ducks it in 300ms and instantly plays a pre-generated reaction line via TTS; love plays a reaction after the song.
>
> Cover ALL loading gaps with a synthesized "scanning the dial" radio static bed (filtered white noise + brief phantom-station tone blips) so there is never dead air. Show friendly "adjusting the antenna…" retry states on API errors. Keep all audio started from the GO LIVE user gesture.

*(Prompts 2+ appended below as the build session continues: ad marketplace, admin analytics, YouTube taste import, Lyria signature theme, Android packaging.)*
