import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { latestVerdictRowForToken } from "@/lib/data/ledger";
import {
  readRwaTokenByAddress,
  readLatestMarketSnapshot,
  readRwaRegistryTokens,
} from "@/lib/data/registry";
import { rpc } from "@/lib/rpc/client";
import { verifyRwaToken } from "@/lib/verify/trusted-address";
import { readTokenRecord } from "@/lib/scanner/record";
import { readRwaTerminalMarket } from "@/lib/trade/rwa-terminal-market";
import { resolveTradingViewSymbol } from "@/lib/market/tradingview";
import { NoirShell } from "@/app/components/site/NoirShell";
import { RwaDetailClient } from "@/app/components/site/RwaDetailClient";
import { readSwapConfig } from "@/lib/swap/config";
import { readEquityReference } from "@/lib/market/equity-reference";
import { describeEquityBasis } from "@/lib/market/equity-basis";
import type { TokenRecord } from "@/lib/types";
import type { TokenMarketData } from "@/lib/trade/types";
import { mergeLiveMarketData } from "@/lib/trade/terminal-market";
import { explorerWebUrl } from "@/lib/config/chain";

export const dynamic = "force-dynamic";

const readRwaTokenForRender = cache((address: string) => readRwaTokenByAddress(address));
const readMarketSnapshotForRender = cache((address: string) => readLatestMarketSnapshot(address));
const readTokenRecordForRender = cache((address: string) => readTokenRecord(address));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return { title: "Tokenized Stocks | RobinCalls" };

  const asset = await readRwaTokenForRender(address);
  if (!asset) return { title: "Tokenized Stocks | RobinCalls" };

  const kind = asset.category === "etf" ? "Tokenized ETF" : "Tokenized Stock";
  const rawTitle = `${asset.asset_symbol} ${kind}: ${asset.asset_name} | RobinCalls`;
  const title = rawTitle.length <= 60 ? rawTitle : `${asset.asset_symbol} ${kind} | RobinCalls`;
  const description =
    asset.verify_status === "ok"
      ? `${asset.asset_name} (${asset.asset_symbol}) tokenized ${asset.category === "etf" ? "ETF" : "stock"} on Robinhood Chain, checked against the contracts behind Robinhood's real stock tokens, not just a matching ticker.`
      : `${asset.asset_name} (${asset.asset_symbol}) tokenized ${asset.category === "etf" ? "ETF" : "stock"} on Robinhood Chain: contract authenticity check is ${asset.verify_status}.`;

  return {
    title,
    description,
    keywords: [
      asset.asset_symbol,
      `${asset.asset_symbol} robinhood chain`,
      `${asset.asset_name} ${kind.toLowerCase()}`,
      "robinhood chain tokenized stocks",
      "robinhood chain rwa",
      "chain 4663 rwa",
    ],
    alternates: { canonical: `/rwa/${address}` },
    openGraph: {
      title,
      description,
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

export default async function RwaDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) notFound();

  const asset = await readRwaTokenForRender(address);
  if (!asset) notFound();

  const [proof, verdict, marketSnapshot, tokenRecord, tv, allRwaTokens, market] = await Promise.all([
    verifyRwaToken(rpc(), address).catch(() => ({
      ok: false,
      status: "unprobeable" as const,
      transient: true,
      reason: "Live authenticity check unavailable.",
      evidence: {},
    })),
    latestVerdictRowForToken(address),
    readMarketSnapshotForRender(address),
    readTokenRecordForRender(address).catch(() => null as TokenRecord | null),
    resolveTradingViewSymbol(asset.asset_symbol).catch(() => ({ status: "unavailable" as const })),
    readRwaRegistryTokens().catch(() => []),
    readRwaTerminalMarket(address),
  ]);

  const tvSymbol = tv.status === "resolved" ? tv.tvSymbol : null;
  const dbSnapshot = marketSnapshot;

  const priceNum = market?.token.priceUsd ?? dbSnapshot?.price_usd ?? verdict?.market_snapshot?.priceUsd ?? null;
  const liquidityNum = market?.token.liquidityUsd ?? dbSnapshot?.liquidity_usd ?? verdict?.market_snapshot?.liquidityUsd ?? null;
  const volume24hNum = market?.token.volume24h ?? dbSnapshot?.volume_24h_usd ?? verdict?.market_snapshot?.volume24hUsd ?? null;
  const fdvNum = market?.token.fdv ?? dbSnapshot?.fdv_usd ?? verdict?.market_snapshot?.fdvUsd ?? null;
  const buys24hNum = market?.token.txns24h.buys ?? dbSnapshot?.buys_24h ?? verdict?.market_snapshot?.buys24h ?? null;
  const sells24hNum = market?.token.txns24h.sells ?? dbSnapshot?.sells_24h ?? verdict?.market_snapshot?.sells24h ?? null;
  const poolAddr = market?.token.pairAddress ?? dbSnapshot?.pool_address ?? verdict?.market_snapshot?.poolAddress ?? null;
  const poolQuoteSymbol = market?.token.quoteToken.symbol ?? (poolAddr && verdict?.market_snapshot?.poolAddress?.toLowerCase() === poolAddr.toLowerCase()
    ? verdict.market_snapshot.liquidityQuoteSymbol ?? null
    : null);

  const money = (v: number | null) =>
    v == null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: v < 1 ? 4 : 2,
        }).format(v);

  const verdictText = verdict
    ? `Latest verdict: ${verdict.tier} · score ${verdict.score}.`
    : "No archived RobinCalls verdict yet.";

  let equityBasisView = null;
  let equityGateOn = false;
  try {
    const config = await readSwapConfig();
    equityGateOn = Boolean(config.features.equityBasis.on);
  } catch {
    equityGateOn = false;
  }

  if (equityGateOn) {
    const ref = await readEquityReference(address);
    if (ref.kind !== "not-equity") {
      const market =
        ref.kind === "ok"
          ? typeof priceNum === "number" && Number.isFinite(priceNum) && priceNum > 0
            ? { kind: "price" as const, usd: priceNum }
            : ({ kind: "unavailable" } as const)
          : ({ kind: "unavailable" } as const);
      equityBasisView = describeEquityBasis(ref, market);
    }
  }

  // Stored observations do not include a quote address or native conversion.
  // Keep those unknown until the shared live market poll returns the pair.
  const initialTokenMarketData: TokenMarketData = {
    address: asset.address,
    name: asset.asset_name,
    symbol: asset.asset_symbol,
    pairAddress: poolAddr || "",
    pairSymbol: `${asset.asset_symbol} / ${poolQuoteSymbol || "?"}`,
    baseToken: {
      address: asset.address,
      name: asset.asset_name,
      symbol: asset.asset_symbol,
      decimals: 18,
    },
    quoteToken: {
      address: "",
      name: poolQuoteSymbol || "Unknown quote token",
      symbol: poolQuoteSymbol || "?",
      decimals: 6,
    },
    venue: asset.category === "etf" ? "Tokenized ETF" : "Tokenized Stock",
    isBondingCurve: false,
    isStock: true,
    priceUsd: priceNum ?? NaN,
    priceEth: NaN,
    priceQuote: null,
    fdv: fdvNum ?? NaN,
    marketCap: fdvNum ?? NaN,
    liquidityUsd: liquidityNum ?? NaN,
    volume24h: volume24hNum ?? NaN,
    txns24h: {
      total: (buys24hNum ?? NaN) + (sells24hNum ?? NaN),
      buys: buys24hNum ?? NaN,
      sells: sells24hNum ?? NaN,
    },
    volumeBreakdown24h: {
      buyUsd: NaN,
      sellUsd: NaN,
    },
    traders24h: {
      total: NaN,
      buyers: NaN,
      sellers: NaN,
    },
    priceChange: {
      m5: NaN,
      h1: NaN,
      h6: NaN,
      h24: NaN,
    },
    age: "Canonical",
    rank: 1,
    socials: {
      explorer: `${explorerWebUrl}/token/${asset.address}`,
      website:
        asset.category === "etf"
          ? "https://robinhood.com"
          : `https://www.google.com/finance/quote/${asset.asset_symbol}:NASDAQ`,
      twitter: `https://x.com/search?q=%24${asset.asset_symbol}`,
    },
    pooled: {
      baseAmount: NaN,
      baseUsd: NaN,
      quoteAmount: NaN,
      quoteUsd: NaN,
    },
    auditVerdict: {
      score: tokenRecord?.stamps?.[0]?.score ?? (proof.ok ? 100 : 70),
      tier: proof.ok ? "VERIFIED" : "CAUTION",
      honeypotPass: proof.ok,
      mintable: false,
      liquidityLocked: true,
      lockedPct: 100,
    },
  };

  const tokenMarketData = market
    ? mergeLiveMarketData(initialTokenMarketData, market.token) ?? initialTokenMarketData
    : initialTokenMarketData;

  // Popular RWAs for the ticker bar (excluding current token)
  const popularRwas = allRwaTokens
    .filter((r) => r.address.toLowerCase() !== address.toLowerCase())
    .slice(0, 10);

  return (
    <NoirShell showFooter={false}>
      <RwaDetailClient
        initialMarketUpdatedAt={market?.observedAt ?? null}
        token={tokenMarketData}
        asset={asset}
        proof={proof}
        record={tokenRecord}
        verdictText={verdictText}
        tvSymbol={tvSymbol}
        equityBasisView={equityBasisView}
        trendingRwas={popularRwas}
        priceUsd={money(priceNum)}
        liquidityUsd={money(liquidityNum)}
        volume24hUsd={money(volume24hNum)}
        fdvUsd={money(fdvNum)}
        buys24h={buys24hNum}
        sells24h={sells24hNum}
        poolAddress={poolAddr}
      />
    </NoirShell>
  );
}
