"use client";

import { useEffect, useState } from "react";
import type { Campaign, Stats } from "@/lib/types";

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/stats");
        const data = await res.json();
        if (!alive) return;
        setStats(data.stats ?? null);
        setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []);
      } catch {
        // keep last good numbers on transient failures
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const approvedCampaigns = campaigns.filter((c) => c.approved);
  const avgBid =
    approvedCampaigns.length > 0
      ? approvedCampaigns.reduce((sum, c) => sum + c.bidCpm, 0) /
        approvedCampaigns.length
      : 0;
  const estRevenue = stats ? (stats.adImpressions * avgBid) / 1000 : 0;
  const maxImpressions = Math.max(1, ...campaigns.map((c) => c.impressions));
  const maxBid = Math.max(1, ...campaigns.map((c) => c.bidCpm));

  const cards: {
    label: string;
    value: string;
    accent: string;
    sub?: string;
  }[] = stats
    ? [
        {
          label: "Listeners",
          value: stats.listeners.toLocaleString(),
          accent: "text-amber-400",
        },
        {
          label: "Minutes streamed",
          value: stats.minutesStreamed.toLocaleString(),
          accent: "text-amber-400",
        },
        {
          label: "Shows generated",
          value: stats.showsGenerated.toLocaleString(),
          accent: "text-violet-400",
        },
        {
          label: "Ad impressions",
          value: stats.adImpressions.toLocaleString(),
          accent: "text-violet-400",
        },
        {
          label: "Shares",
          value: stats.shares.toLocaleString(),
          accent: "text-amber-400",
        },
        {
          label: "Projected revenue",
          value: `₹/$ ${estRevenue.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}`,
          accent: "text-violet-400",
          sub: "demo campaigns · seeded + live session data",
        },
      ]
    : [];

  return (
    <main className="min-h-screen bg-[#07070b] text-zinc-200">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex items-center justify-between">
          <a
            href="/"
            className="text-xs font-bold uppercase tracking-[0.3em] text-amber-500 hover:text-amber-400"
          >
            Wavelength
          </a>
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            Refreshing every 5s
          </span>
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-zinc-50">
          Station dashboard
        </h1>

        {!stats ? (
          <p className="mt-10 text-sm text-zinc-600">Tuning in…</p>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {cards.map((c) => (
                <div
                  key={c.label}
                  className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5"
                >
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    {c.label}
                  </p>
                  <p
                    className={`mt-2 text-2xl font-extrabold tabular-nums sm:text-3xl ${c.accent}`}
                  >
                    {c.value}
                  </p>
                  {c.sub && (
                    <p className="mt-1 text-[11px] text-zinc-600">{c.sub}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 text-right text-xs text-zinc-600">
              Projected revenue = ad impressions × avg approved bid CPM ÷ 1000
            </p>

            <section className="mt-12">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-zinc-500">
                Campaigns
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-amber-400">
                  DEMO
                </span>
              </h2>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800/80 bg-zinc-900/40">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
                      <th className="px-4 py-3 font-bold">Advertiser</th>
                      <th className="px-4 py-3 font-bold">Product</th>
                      <th className="px-4 py-3 font-bold">Tags</th>
                      <th className="px-4 py-3 font-bold">Bid CPM</th>
                      <th className="px-4 py-3 font-bold">Impressions</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-zinc-800/60 last:border-0"
                      >
                        <td className="px-4 py-3 font-semibold text-zinc-100">
                          {c.advertiser}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.product}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {c.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold tabular-nums text-amber-400">
                            {c.bidCpm}
                          </p>
                          <div className="mt-1 h-1 w-24 rounded-full bg-zinc-800">
                            <div
                              className="h-1 rounded-full bg-amber-500"
                              style={{
                                width: `${(c.bidCpm / maxBid) * 100}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="tabular-nums text-zinc-200">
                            {c.impressions.toLocaleString()}
                          </p>
                          <div className="mt-1 h-1 w-24 rounded-full bg-zinc-800">
                            <div
                              className="h-1 rounded-full bg-violet-500"
                              style={{
                                width: `${(c.impressions / maxImpressions) * 100}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.approved ? (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                              approved
                            </span>
                          ) : (
                            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                              rejected
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {campaigns.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-6 text-center text-zinc-600"
                        >
                          No campaigns yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="mt-6 text-xs text-zinc-600">
              Seeded demo data + real events from this session — not actual
              revenue.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
