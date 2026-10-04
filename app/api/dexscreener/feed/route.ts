import { NextRequest, NextResponse } from "next/server";
import { getDexScreenerRobinhoodFeed } from "@/lib/trade/dexscreener-feed";
import { byNewest, compareKnown } from "@/lib/trade/market-filters";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") || "trending";
    const q = (searchParams.get("q") || "").trim().toLowerCase();

    const data = await getDexScreenerRobinhoodFeed();
    let pairs = [...data.pairs];

    if (q) {
      pairs = pairs.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const symbol = (p.symbol || "").toLowerCase();
        const addr = (p.address || "").toLowerCase();
        const pairAddr = (p.pairAddress || "").toLowerCase();
        const quote = (p.quoteToken?.symbol || "").toLowerCase();
        return (
          name.includes(q) ||
          symbol.includes(q) ||
          addr.includes(q) ||
          pairAddr.includes(q) ||
          quote.includes(q)
        );
      });
    }

    switch (sort) {
      case "volume":
        pairs.sort((a, b) => compareKnown(a.volume24h, b.volume24h, "desc"));
        break;
      case "gainers":
        pairs.sort((a, b) => compareKnown(a.priceChange.h24, b.priceChange.h24, "desc"));
        break;
      case "new":
        pairs.sort(byNewest);
        break;
      case "mcap":
        pairs.sort((a, b) => compareKnown(a.marketCap, b.marketCap, "desc"));
        break;
      case "txns":
        pairs.sort((a, b) => b.txns24h.total - a.txns24h.total);
        break;
      case "trending":
      default:
        // Already sorted by trending score in getDexScreenerRobinhoodFeed
        break;
    }

    // Re-rank for this view
    pairs.forEach((p, idx) => {
      p.rank = idx + 1;
    });

    return NextResponse.json(
      {
        stats: data.stats,
        pairs,
      },
      {
        headers: {
          // The browser polls every 30s and the upstream aggregation already has
          // a bounded 20s cache. A second CDN stale window can show an older 5m
          // change while a viewer compares the same pair on DexScreener.
          "cache-control": "no-store, max-age=0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        stats: {
          totalVolume24h: 0,
          totalTxns24h: 0,
          activePairsCount: 0,
          boostedTokensCount: 0,
          lastUpdated: Date.now(),
        },
        pairs: [],
        error: err?.message || "Failed to fetch DexScreener feed",
      },
      { status: 200 }
    );
  }
}
