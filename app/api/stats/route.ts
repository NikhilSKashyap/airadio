import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const { stats, campaigns } = getStore();
  return Response.json({ stats, campaigns });
}
