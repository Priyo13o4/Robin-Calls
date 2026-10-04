import { NextRequest, NextResponse } from "next/server";
import { readRwaRegistryTokens } from "@/lib/data/registry";
import { resolveTradingViewSymbol } from "@/lib/market/tradingview";

export const runtime = "nodejs";

/**
 * Resolves the official TradingView logo (and, since L79, the real
 * `PREFIX:SYMBOL` listing) for an RWA (stock/ETF) ticker, proxied server-side
 * because TradingView's symbol-search API 403s any cross-origin browser
 * request that doesn't carry a tradingview.com Referer/Origin — a plain
 * client-side fetch from robincalls.com cannot reach it directly. The RWA
 * detail page already embeds TradingView's own chart widget for the same
 * tickers, so resolving through the same vendor is consistent, not a new
 * third-party surface.
 *
 * Allowlisted against the live RWA registry (not an open ticker proxy) so
 * this can't be used to probe arbitrary symbols.
 */

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase().trim() ?? "";
  if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) {
    return NextResponse.json({ url: null, tvSymbol: null }, { status: 400 });
  }

  const registered = await readRwaRegistryTokens();
  const known = registered.some((r) => r.asset_symbol.toUpperCase() === symbol);
  if (!known) {
    return NextResponse.json({ url: null, tvSymbol: null }, { status: 404 });
  }

  const resolution = await resolveTradingViewSymbol(symbol);
  const logoid = resolution.status === "resolved" ? resolution.logoid : null;
  const url = logoid
    ? `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg`
    : null;

  return NextResponse.json(
    {
      url,
      // "unavailable" publishes null, not "absent": a dead TradingView must not
      // be rendered as "no benchmark exists" (§4 — an empty result is not a fact).
      tvSymbol: resolution.status === "resolved" ? resolution.tvSymbol : null,
    },
    { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } }
  );
}
