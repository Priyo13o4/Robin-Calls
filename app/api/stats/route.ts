import { NextResponse } from "next/server";
import { readLandingStats } from "@/lib/data/observability";

export const revalidate = 60;

/**
 * Live counters for the landing page's Record metrics — see
 * `readLandingStats` for how the two underlying reads are merged. Every field
 * degrades to its zero on a missing database: a stats endpoint that 500s is
 * worse than one that shows zeros.
 */
export async function GET() {
  try {
    const stats = await readLandingStats();
    const headers = {
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    };
    return NextResponse.json(stats, { headers });
  } catch {
    return NextResponse.json({
      verdicts_issued: 0,
      anchors_onchain: 0,
      wallets_indicted: 0,
      launchpads_live: 0,
      curve_graduations: 0,
    });
  }
}
