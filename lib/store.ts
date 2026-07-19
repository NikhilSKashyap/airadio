import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Campaign, StoreShape, TrackEvent } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

// V4 brand safety — campaigns touching these categories never air, regardless of bid.
// Screened at submission AND re-screened on every read (older store files may hold
// campaigns that were never screened).
const SAFETY_BLOCKLIST =
  /\b(medic(?:al|ine|ation)?|pharma(?:ceutical)?|prescri(?:be|ption)s?|cure|diagnos\w*|treatment|supplement|weight.?loss|diet pill\w*|crypto(?:currency)?|casino|gambl\w*|bet(?:ting|s)?|lottery|jackpot|wager\w*|loan|payday|mortgage|invest(?:ment|ing)?|trading|forex|stock tips|political|election|vote|voting|alcohol|tobacco|vap(?:e|ing))\b/i;

export const REJECTED_REASON =
  "Category not allowed in this demo: medical, financial, gambling, political and similar regulated content can't run on Wavelength.";

/** 1 = safe to air, 0 = blocked by the brand-safety blocklist. */
export function campaignSafety(
  c: Pick<Campaign, "advertiser" | "product" | "facts" | "tags">
): 0 | 1 {
  const text = [c.advertiser, c.product, c.facts, ...c.tags].join(" ");
  return SAFETY_BLOCKLIST.test(text) ? 0 : 1;
}

function seed(): StoreShape {
  const now = new Date().toISOString();
  return {
    stats: {
      listeners: 1287,
      minutesStreamed: 41230,
      showsGenerated: 3412,
      adImpressions: 9860,
      shares: 412,
    },
    campaigns: [
      {
        id: randomUUID(),
        advertiser: "StriderLab",
        product: "Strider One football boots",
        facts:
          "Strider One boots weigh 198 grams, come in a colorway called Volt Nebula, and were kicked around 40,000 times in lab testing before launch. Free returns within 30 days.",
        tags: ["football", "sports", "fitness"],
        bidCpm: 18,
        approved: true,
        impressions: 0,
        createdAt: now,
      },
      {
        id: randomUUID(),
        advertiser: "LoomLine",
        product: "LoomLine AI stylist app",
        facts:
          "LoomLine scans your closet from photos, builds outfits in under 3 seconds, and its users report re-wearing 2x more of what they already own. Free tier includes 5 outfits a week.",
        tags: ["fashion", "ai", "shopping"],
        bidCpm: 22,
        approved: true,
        impressions: 0,
        createdAt: now,
      },
    ],
  };
}

// Older store files on disk may hold campaigns missing newer fields — coerce
// every field defensively instead of trusting the JSON shape.
function normalizeCampaign(raw: unknown): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === "string" && r.id ? r.id : randomUUID(),
    advertiser: typeof r.advertiser === "string" ? r.advertiser : "",
    product: typeof r.product === "string" ? r.product : "",
    facts: typeof r.facts === "string" ? r.facts : "",
    tags: Array.isArray(r.tags)
      ? r.tags.filter((t): t is string => typeof t === "string")
      : [],
    bidCpm:
      typeof r.bidCpm === "number" && Number.isFinite(r.bidCpm) ? r.bidCpm : 0,
    approved: r.approved === true,
    impressions:
      typeof r.impressions === "number" && Number.isFinite(r.impressions)
        ? r.impressions
        : 0,
    createdAt:
      typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
  };
}

function normalizeStore(raw: unknown): StoreShape {
  const base = seed();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const stats = { ...base.stats };
  if (r.stats && typeof r.stats === "object") {
    const rs = r.stats as Record<string, unknown>;
    for (const key of Object.keys(stats) as (keyof StoreShape["stats"])[]) {
      const v = rs[key];
      if (typeof v === "number" && Number.isFinite(v)) stats[key] = v;
    }
  }
  const campaigns = Array.isArray(r.campaigns)
    ? r.campaigns
        .map(normalizeCampaign)
        .filter((c): c is Campaign => c !== null)
    : base.campaigns;
  return { stats, campaigns };
}

function readStore(): StoreShape {
  if (!fs.existsSync(STORE_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const s = seed();
    fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2));
    return s;
  }
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(STORE_FILE, "utf8")));
  } catch {
    const s = seed();
    fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2));
    return s;
  }
}

export function getStore(): StoreShape {
  return readStore();
}

export function saveStore(s: StoreShape): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2));
}

const EVENT_FIELD: Record<TrackEvent, keyof StoreShape["stats"]> = {
  show_generated: "showsGenerated",
  play_start: "listeners",
  minute: "minutesStreamed",
  ad_impression: "adImpressions",
  share: "shares",
};

export function trackEvent(e: TrackEvent): void {
  const s = readStore();
  s.stats[EVENT_FIELD[e]] += 1;
  saveStore(s);
}

export function addCampaign(
  c: Omit<Campaign, "id" | "approved" | "impressions" | "createdAt">
): Campaign & { rejectedReason?: string } {
  const safe = campaignSafety(c) === 1;
  const campaign: Campaign = {
    ...c,
    id: randomUUID(),
    approved: safe, // hackathon: auto-approve safe campaigns, auto-reject unsafe ones
    impressions: 0,
    createdAt: new Date().toISOString(),
  };
  const s = readStore();
  s.campaigns.push(campaign);
  saveStore(s);
  return safe ? campaign : { ...campaign, rejectedReason: REJECTED_REASON };
}

/**
 * V4 ranking: rank = bidCpm × relevance × safety.
 * - relevance = interest/tag overlap count; 0 ⇒ ineligible for the ranked pass
 * - safety = 0 (blocklisted content ⇒ never returned) or 1
 * If no campaign has overlap ≥ 1, silently falls back to the highest-bid SAFE
 * campaign; returns null when nothing safe exists.
 */
export function pickSponsor(interests: string[]): Campaign | null {
  const s = readStore();
  // Re-screen on read: stored approvals may pre-date the safety blocklist.
  const eligible = s.campaigns.filter(
    (c) => c.approved && campaignSafety(c) === 1
  );
  if (eligible.length === 0) return null;
  const wants = interests.map((i) => i.toLowerCase());
  let best: Campaign | null = null;
  let bestScore = 0;
  for (const c of eligible) {
    const relevance = c.tags.filter((t) => {
      const tag = t.toLowerCase();
      return wants.some((w) => w.includes(tag) || tag.includes(w));
    }).length;
    if (relevance < 1) continue; // zero relevance ⇒ ineligible, no matter the bid
    const score = c.bidCpm * relevance;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best) return best;
  // No overlap anywhere: highest-bid safe campaign (safety already enforced above).
  let fallback: Campaign | null = null;
  for (const c of eligible) {
    if (!fallback || c.bidCpm > fallback.bidCpm) fallback = c;
  }
  return fallback;
}

export function bumpImpression(id: string): void {
  const s = readStore();
  const c = s.campaigns.find((x) => x.id === id);
  if (!c) return;
  c.impressions += 1;
  saveStore(s);
}
