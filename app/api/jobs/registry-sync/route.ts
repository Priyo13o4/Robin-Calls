import { NextRequest, NextResponse } from "next/server";
import { upsertRegistryBatch } from "@/lib/data/registry";
import { requireJobAuth } from "@/lib/security/job-auth";

/**
 * Canonical registry sync (§6). docs.robinhood.com/chain/contracts is fetched
 * on a slow cron — never per-scan. Because the docs page is HTML without a
 * stable API, this endpoint accepts the parsed asset list as JSON:
 *
 *   POST /api/jobs/registry-sync
 *   header: x-job-secret: $INTERNAL_JOB_SECRET
 *   body: { assets: [{ asset_name, asset_symbol, address, category? }, …] }
 *
 * The scraping itself lives in the cron job (supabase/functions/registry-sync)
 * so a docs-page redesign can't break scans.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;

  let assets: unknown;
  try {
    ({ assets } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    return NextResponse.json({ error: "assets[] is required." }, { status: 400 });
  }

  const rows = assets
    .filter(
      (a): a is { asset_name: string; asset_symbol: string; address: string; category?: string } =>
        !!a &&
        typeof a.asset_name === "string" &&
        typeof a.asset_symbol === "string" &&
        typeof a.address === "string" &&
        /^0x[0-9a-fA-F]{40}$/.test(a.address)
    )
    .map((a) => ({
      asset_name: a.asset_name,
      asset_symbol: a.asset_symbol,
      address: a.address.toLowerCase(),
      category: a.category ?? null,
    }));

  try {
    const synced = await upsertRegistryBatch(rows);
    return NextResponse.json({ synced });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
