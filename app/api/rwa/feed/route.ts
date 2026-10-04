import { NextResponse } from "next/server";
import { readRwaRegistryTokens } from "@/lib/data/registry";
import { isTrustedRwaToken, primeTrustedAddresses } from "@/lib/config/trusted-addresses";
import { readAllRwaQuotes, type RwaQuote } from "@/lib/market/rwa-quotes";

export interface RwaMarketRow {
  address: string;
  asset_name: string;
  asset_symbol: string;
  category: string;
  verify_status: string;
  trusted: boolean;
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  trades24h: number | null;
  poolAddress: string | null;
  changeM5: number | null;
  changeH1: number | null;
  changeH6: number | null;
  changeH24: number | null;
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [, rawTokens] = await Promise.all([
      primeTrustedAddresses(),
      readRwaRegistryTokens(),
    ]);

    const addresses = rawTokens.map((t) => t.address);
    // Listing assets must not wait out every market-provider timeout. Pending
    // shared refills can warm the next request; unread prices stay null.
    const { quotes, complete } = await readAllRwaQuotes(addresses, { waitMs: 3_000 });

    const rows: RwaMarketRow[] = rawTokens.map((t) => {
      const q: RwaQuote | undefined = quotes.get(t.address.toLowerCase());
      return {
        address: t.address,
        asset_name: t.asset_name,
        asset_symbol: t.asset_symbol,
        category: t.category,
        verify_status: t.verify_status,
        trusted: t.verify_status === "ok" && isTrustedRwaToken(t.address),
        priceUsd: q?.priceUsd ?? null,
        marketCapUsd: q?.marketCapUsd ?? null,
        volume24hUsd: q?.volume24hUsd ?? null,
        liquidityUsd: q?.liquidityUsd ?? null,
        trades24h: q?.trades24h ?? null,
        poolAddress: q?.poolAddress ?? null,
        changeM5: q?.changeM5 ?? null,
        changeH1: q?.changeH1 ?? null,
        changeH6: q?.changeH6 ?? null,
        changeH24: q?.changeH24 ?? null,
      };
    });

    // Default sort by volume descending, then alphabetical by symbol
    rows.sort((a, b) => {
      const volA = a.volume24hUsd ?? 0;
      const volB = b.volume24hUsd ?? 0;
      if (volB !== volA) return volB - volA;
      return a.asset_symbol.localeCompare(b.asset_symbol);
    });

    return NextResponse.json(
      {
        tokens: rows,
        count: rows.length,
        quotesComplete: complete,
        updated_at: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": complete
            ? "public, s-maxage=30, stale-while-revalidate=60"
            : "no-store",
        },
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch RWA feed" },
      { status: 500 },
    );
  }
}
