import type { Metadata } from "next";
import { cache } from "react";
import { NoirShell } from "@/app/components/site/NoirShell";
import { getMarketDataForToken } from "@/lib/trade/dexscreener-api";
import { readRwaTerminalMarket } from "@/lib/trade/rwa-terminal-market";
import {
  readLaunchFeedByAddresses,
  findTokenAddressByPoolOrToken,
} from "@/lib/data/launches";
import { readEnabledLaunchpads } from "@/lib/data/launchpads";
import { readTokenRecord } from "@/lib/scanner/record";
import type { TokenRecord } from "@/lib/types";
import { launchFeedRowToTokenMarketData, type TokenMarketData } from "@/lib/trade/types";
import { getDexScreenerRobinhoodFeed } from "@/lib/trade/dexscreener-feed";
import { pickTrending } from "@/lib/trade/market-filters";
import { TradePageClient } from "./TradePageClient";
import { withCappedLabels } from "@/lib/trade/format";
import { resolveTerminalLaunchMarket } from "@/lib/trade/terminal-market";

const resolveTokenMarketData = cache(async (param: string): Promise<TokenMarketData> => {
  return withCappedLabels(await resolveUncapped(param));
});

const readEnabledLaunchpadsForRender = cache(() => readEnabledLaunchpads());
const findTokenForRender = cache((value: string) => findTokenAddressByPoolOrToken(value));
const readLaunchFeedForRender = cache((address: string) => readLaunchFeedByAddresses("all", [address]));
const readTokenRecordForRender = cache((address: string) => readTokenRecord(address));
const readDeepestMarketForRender = cache(async (address: string): Promise<TokenMarketData> =>
  (await readRwaTerminalMarket(address))?.token ?? getMarketDataForToken(address));

async function resolveUncapped(param: string): Promise<TokenMarketData> {
  const norm = param.toLowerCase().trim();
  try {
    const padRows = await readEnabledLaunchpadsForRender();
    // 1. Resolve canonical token address in case param is a pool or pair address
    const canonicalToken = (await findTokenForRender(norm)) || norm;

    // 2. Query launch feed by token address
    const dbRows = await readLaunchFeedForRender(canonicalToken);
    if (dbRows && dbRows.length > 0 && dbRows[0]) {
      return resolveTerminalLaunchMarket(
        launchFeedRowToTokenMarketData(dbRows[0], undefined, padRows),
        readDeepestMarketForRender,
      );
    }
  } catch {
    /* fallback to live DexScreener API */
  }
  return readDeepestMarketForRender(norm);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await resolveTokenMarketData(token);
  const title = `${data.name} (${data.pairSymbol || data.symbol}) Trading · RobinCalls Night Market`;
  const description = `Real-time DexScreener chart, live order transactions, and instant overlay trading for ${data.name} on Robinhood Chain.`;
  return {
    title,
    description,
    keywords: [
      data.symbol,
      data.name,
      `${data.symbol} trade`,
      `${data.symbol} robinhood chain`,
      "robinhood chain trading",
      "robinhood chain dex",
      "night market trade",
    ],
    alternates: { canonical: `/trade/${token}` },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "RobinCalls",
      images: [
        {
          url: "/brand/og-default.jpg",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/brand/og-default.jpg"],
    },
  };
}

export default async function TokenTradePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const norm = token.toLowerCase().trim();
  const canonicalToken = (await findTokenForRender(norm).catch(() => null)) || norm;

  const marketData = await resolveTokenMarketData(token);
  const targetTokenAddress = marketData.address || canonicalToken;
  const tokenRecord = await readTokenRecordForRender(targetTokenAddress).catch(() => null as TokenRecord | null);

  // Trending = most active in the last hour (market-filters.ts). It was the five newest launches,
  // so four same-name spam launches with no trades filled the bar at "+0%".
  let trendingTokens: TokenMarketData[] = [];
  try {
    trendingTokens = pickTrending((await getDexScreenerRobinhoodFeed()).pairs);
  } catch {
    /* DexScreener down: the bar falls back to the current token */
  }

  return (
    <NoirShell showFooter={false}>
      <TradePageClient token={marketData} trendingTokens={trendingTokens} record={tokenRecord} />
    </NoirShell>
  );
}
