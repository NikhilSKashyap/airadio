import { addCampaign, campaignSafety, getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const { campaigns } = getStore();
  // Approved AND currently safe — older stored campaigns are re-screened on read.
  return Response.json({
    campaigns: campaigns.filter((c) => c.approved && campaignSafety(c) === 1),
  });
}

export async function POST(request: Request) {
  let body: {
    advertiser?: unknown;
    product?: unknown;
    facts?: unknown;
    tags?: unknown;
    bidCpm?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { advertiser, product, facts, tags, bidCpm } = body;
  if (
    typeof advertiser !== "string" ||
    !advertiser.trim() ||
    typeof product !== "string" ||
    !product.trim() ||
    typeof facts !== "string" ||
    !facts.trim() ||
    !Array.isArray(tags) ||
    !tags.every((t) => typeof t === "string") ||
    typeof bidCpm !== "number" ||
    !Number.isFinite(bidCpm) ||
    bidCpm <= 0
  ) {
    return Response.json(
      { error: "Required: advertiser, product, facts (strings), tags (string[]), bidCpm (positive number)" },
      { status: 400 }
    );
  }
  // Brand safety is decided inside addCampaign: unsafe campaigns are stored
  // with approved:false and returned with a rejectedReason (not a 4xx — the
  // submission itself succeeded, the campaign just won't air).
  const campaign = addCampaign({
    advertiser: advertiser.trim(),
    product: product.trim(),
    facts: facts.trim(),
    tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
    bidCpm,
  });
  return Response.json(campaign);
}
