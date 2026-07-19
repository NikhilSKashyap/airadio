"use client";

import { useCallback, useEffect, useState } from "react";
import type { Campaign } from "@/lib/types";

export default function AdvertisePage() {
  const [advertiser, setAdvertiser] = useState("");
  const [product, setProduct] = useState("");
  const [facts, setFacts] = useState("");
  const [tags, setTags] = useState("");
  const [bidCpm, setBidCpm] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<
    (Campaign & { rejectedReason?: string }) | null
  >(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/ads");
      const data = await res.json();
      setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
    } catch {
      // list is decorative — never block the page on it
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertiser: advertiser.trim(),
          product: product.trim(),
          facts: facts.trim(),
          tags: tags
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
          bidCpm,
        }),
      });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      setLive((data.campaign ?? data) as Campaign & { rejectedReason?: string });
      loadCampaigns();
    } catch {
      setError("Could not create the campaign — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40";

  return (
    <main className="min-h-screen bg-[#07070b] text-zinc-200">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <a
          href="/"
          className="text-xs font-bold uppercase tracking-[0.3em] text-amber-500 hover:text-amber-400"
        >
          Wavelength
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-zinc-50 sm:text-4xl">
          Reach one listener at a time —{" "}
          <span className="bg-gradient-to-r from-amber-400 to-violet-400 bg-clip-text text-transparent">
            Gemini rewrites your ad for every show
          </span>
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
          Give us your approved facts and tags. Nova, our host, reads a
          disclosed 8–10 second spot woven into shows whose listeners actually
          care about what you make.
        </p>
        <p className="mt-2 max-w-xl text-xs text-zinc-500">
          How ranking works:{" "}
          <span className="font-mono text-violet-400">
            bid × listener relevance × brand safety
          </span>{" "}
          — a high bid never beats zero relevance.
        </p>

        {live && !live.approved ? (
          <div className="mt-10 rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-red-400">
                Not approved
              </span>
            </div>
            <p className="mt-3 text-lg font-semibold text-zinc-50">
              {live.advertiser} — {live.product}
            </p>
            <p className="mt-2 text-sm text-zinc-300">
              Not approved: category not allowed in demo.
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {live.rejectedReason ??
                "Medical, financial, gambling, and political campaigns can't run on Wavelength."}
            </p>
            <p className="mt-4 text-xs text-zinc-600">
              Brand safety is part of the ranking formula — blocked categories
              score zero and never air, regardless of bid.
            </p>
            <button
              onClick={() => {
                setLive(null);
                setAdvertiser("");
                setProduct("");
                setFacts("");
                setTags("");
                setBidCpm(15);
              }}
              className="mt-6 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-amber-500/60 hover:text-amber-400"
            >
              Try a different campaign
            </button>
          </div>
        ) : live ? (
          <div className="mt-10 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-amber-400">
                Campaign live
              </span>
            </div>
            <p className="mt-3 text-lg font-semibold text-zinc-50">
              {live.advertiser} — {live.product}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              Tags: {live.tags.join(", ")} · Bid ₹/$ {live.bidCpm} CPM
            </p>
            <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
              <p className="font-semibold text-zinc-200">How matching works</p>
              <p className="mt-1">
                Every show, we score each approved campaign as{" "}
                <span className="font-mono text-violet-400">
                  bid × listener relevance × brand safety
                </span>{" "}
                — the more your tags overlap the listener&apos;s interest
                fingerprint, the more shows you win, and a high bid never beats
                zero relevance. Nova always opens the spot with a sponsor
                disclosure and only uses your approved facts.
              </p>
            </div>
            <button
              onClick={() => {
                setLive(null);
                setAdvertiser("");
                setProduct("");
                setFacts("");
                setTags("");
                setBidCpm(15);
              }}
              className="mt-6 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:border-amber-500/60 hover:text-amber-400"
            >
              Create another campaign
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="mt-10 space-y-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Advertiser
                </span>
                <input
                  required
                  value={advertiser}
                  onChange={(e) => setAdvertiser(e.target.value)}
                  placeholder="StriderLab"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Product
                </span>
                <input
                  required
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  placeholder="Featherlight football boots"
                  className={inputCls}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Approved facts{" "}
                <span className="normal-case text-zinc-600">
                  (the only claims Nova will read)
                </span>
              </span>
              <textarea
                required
                value={facts}
                onChange={(e) => setFacts(e.target.value)}
                rows={4}
                placeholder="Our boots weigh 180g. Worn by 3 semi-pro clubs. 30-day free returns."
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Tags{" "}
                <span className="normal-case text-zinc-600">
                  (comma-separated)
                </span>
              </span>
              <input
                required
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="football, sports, fitness"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-zinc-500">
                <span>Max bid CPM (₹/$)</span>
                <span className="text-base font-bold text-amber-400">
                  {bidCpm}
                </span>
              </span>
              <input
                type="range"
                min={1}
                max={100}
                value={bidCpm}
                onChange={(e) => setBidCpm(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-gradient-to-r from-amber-500 to-violet-500 px-4 py-2.5 text-sm font-bold uppercase tracking-widest text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? "Launching…" : "Launch campaign"}
            </button>
            <p className="text-xs text-zinc-600">
              No medical, financial, gambling or political ads. Every read
              starts with a sponsor disclosure.
            </p>
          </form>
        )}

        <section className="mt-14">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
            Demo campaigns
          </h2>
          {campaigns.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">No campaigns yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {campaigns.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">
                      {c.advertiser}{" "}
                      <span className="font-normal text-zinc-500">
                        · {c.product}
                      </span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-amber-400">
                      {c.bidCpm} CPM
                    </p>
                    <p className="text-xs text-zinc-500">
                      {c.impressions.toLocaleString()} plays
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
