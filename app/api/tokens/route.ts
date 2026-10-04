import { NextRequest, NextResponse } from "next/server";
import { readSwappableTokens } from "@/lib/data/tokens";
import { readRwaQuotes } from "@/lib/market/rwa-quotes";
import { isDatabaseConfigured } from "@/lib/db/client";
import type { SelectableToken } from "@/lib/trade/types";
import { readCachedTokens } from "@/lib/trade/tokens-api-cache";

export const dynamic = "force-dynamic";

async function fetchTokensAndEnrich(query?: string): Promise<SelectableToken[]> {
  const tokens = await readSwappableTokens(query);

  // Enrich stock tokens with live market quotes if available (at most 30 per provider limit)
  const stockAddresses = tokens
    .filter((t) => t.category === "stocks" && t.address)
    .map((t) => t.address)
    .slice(0, 30);

  if (stockAddresses.length > 0) {
    try {
      const { quotes } = await readRwaQuotes(stockAddresses);
      for (const t of tokens) {
        const q = quotes.get(t.address.toLowerCase());
        if (q) {
          if (q.priceUsd !== null && q.priceUsd > 0) {
            t.priceUsd = q.priceUsd;
          }
          if (q.volume24hUsd !== null) {
            t.volume24h = q.volume24hUsd;
          }
        }
      }
    } catch {
      // Degrade gracefully without failing the tokens list
    }
  }

  // Sort by 24h volume descending like Uniswap
  tokens.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return tokens;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const cacheKey = q.toLowerCase();

  // 1. If DB is unconfigured, return immediately with no-store (never cache degraded empty/base data)
  if (!isDatabaseConfigured()) {
    try {
      const tokens = await fetchTokensAndEnrich(q || undefined);
      return NextResponse.json(
        { tokens },
        {
          headers: {
            "cache-control": "no-store",
          },
        }
      );
    } catch {
      return NextResponse.json(
        { tokens: [] },
        {
          status: 503,
          headers: {
            "cache-control": "no-store",
          },
        }
      );
    }
  }

  try {
    const tokens = await readCachedTokens(cacheKey, () => fetchTokensAndEnrich(q || undefined));
    return NextResponse.json(
      { tokens },
      {
        headers: {
          "cache-control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch {
    // AGENTS.md §4 & §5: Never cache a transient failure. Return 503 with no-store.
    return NextResponse.json(
      { tokens: [] },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  }
}
