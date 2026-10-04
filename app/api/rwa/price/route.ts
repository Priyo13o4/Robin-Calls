import { NextRequest, NextResponse } from "next/server";
import { readEquityReference } from "@/lib/market/equity-reference";
import { readRwaQuotes } from "@/lib/market/rwa-quotes";

export const dynamic = "force-dynamic";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const NATIVE = "0x0000000000000000000000000000000000000000";

/** One selected stock at a time; the market reader caches registry and price reads. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim().toLowerCase() ?? "";
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  if (address === NATIVE || address === WETH) {
    const result = await readRwaQuotes([WETH]);
    const priceUsd = result.complete ? result.quotes.get(WETH)?.priceUsd : null;
    const validPrice = priceUsd && Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null;
    return NextResponse.json(
      { priceUsd: validPrice },
      { headers: { "Cache-Control": validPrice ? "private, max-age=15" : "no-store" } },
    );
  }

  const reference = await readEquityReference(address);
  if (reference.kind !== "ok" || reference.stale || !Number.isFinite(reference.tokenReferenceUsd) || reference.tokenReferenceUsd <= 0) {
    return NextResponse.json({ priceUsd: null }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { priceUsd: reference.tokenReferenceUsd, symbol: reference.symbol },
    { headers: { "Cache-Control": "private, max-age=15" } },
  );
}
