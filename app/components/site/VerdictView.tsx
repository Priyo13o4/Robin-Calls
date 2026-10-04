"use client";

import { PoolHooksPanel } from "./PoolHooksPanel";
import { useState, useMemo, useEffect } from "react";
import { StatusWord } from "./NoirShell";
import { TheRecord } from "./TheRecord";
import { fetchTokenImage } from "@/lib/data/token-art";
import { geckoTerminalNetwork, explorerWebUrl } from "@/lib/config/chain";
import { mechanismForCheckId, unavailableChecks } from "@/lib/config/formula";
import { InfoTooltip } from "../ui/InfoTooltip";
import { announceRobinKnightSubject } from "../agent/RobinKnightDock";
import type { CheckResult, TokenRecord, Verdict } from "@/lib/types";
import type { ScanMeta } from "@/lib/scan-control/serve";
import { degradedScanMessage } from "@/lib/ledger/completeness";
import type { TopTrader } from "@/lib/market/top-traders";
// Type-only — erased at compile time, so nothing from lib/audit's runtime
// module graph (RPC client, DB access) reaches this client component. See
// CLAUDE.md's VerdictView note: a non-type-only import here once pulled
// async_hooks into the client bundle and broke the production build while
// tsc/dev stayed green.
import type { AuthorityResolution, CapabilityFinding } from "@/lib/audit/types";
import { addressesOfInterest } from "./addresses-of-interest";
import { RobinKnightSlot } from "./RobinKnightSlot";
import { VerdictLanyard, VerdictShare } from "./VerdictLanyard";

export interface LedgerStamp {
  id: number;
  entryHash: string;
  prevHash: string;
  createdAt: string;
}

/** §19.3 DEX coverage label from the verdict's normalized adapter coverage. */
function dexCoverageLabel(dexProtocols: string[]): string {
  // V4 was missing here: a V4-only token (the common shape on this chain) reads
  // "NO SUPPORTED POOL" in the header even though its V4 pool was discovered and
  // sell-simulated through the hook — the label contradicted the honeypot card.
  const parts = [
    dexProtocols.includes("uniswap-v2") && "V2",
    dexProtocols.includes("uniswap-v3") && "V3",
    dexProtocols.includes("uniswap-v4") && "V4",
  ].filter(Boolean);
  // Non-Uniswap venues have no "Vn" bucket to fall into, so they read as zero
  // parts — "NO SUPPORTED POOL" over a card discussing the pool. Named
  // separately rather than folded into V3: Slipstream is a different protocol,
  // and the label is what tells a reader which venue was actually covered.
  const others = [dexProtocols.includes("slipstream-cl") && "SLIPSTREAM CL"].filter(Boolean);
  if (parts.length === 0 && others.length === 0) return "NO SUPPORTED POOL";
  const uniswap =
    parts.length === 0 ? [] : [parts.length === 1 ? `UNISWAP ${parts[0]}` : parts.join(" + ")];
  return [...uniswap, ...others].join(" + ");
}

/**
 * What the chart's pool means for OUR coverage — never a claim about which pool
 * is deepest.
 *
 * The old version ranked `poolsAssessed` (pools we READ) and printed the winner
 * as "DEEPEST POOL", on the premise that GeckoTerminal misses venues our
 * cross-DEX discovery finds. That premise is false on 4663: Gecko indexes 20+
 * venues here — sushiswap-v2/v3, pancakeswap-v2/v3, curve, up-v3 — a strict
 * SUPERSET of ours. So the label was only ever reachable when we had read LESS
 * than the chart, and it inverted: COCKIN printed "DEEPEST POOL · UNISWAP V4 ·
 * 96.0%" plus "NOT CHARTED" against a charted up-v3 pool holding 13.9x more of
 * the token. 96.0% was its share of the ~10% we could read.
 */
/**
 * The custody check already reconciled the chart's pool against what we read.
 * Reuse ITS finding rather than recomputing a ranking here — two components
 * ranking the same bundle is how they came to disagree.
 */
function chartCoverage(verdict: Verdict): { unreadDeepest: string; readSharePct: string | null } | null {
  const lp = verdict.checks.find((c) => c.id === "lp_custody");
  const ev = lp?.evidence as
    | { deepestPoolDisagreement?: { marketDeepest?: string }; custodyDowngrade?: { readVenuesShare?: number | null } }
    | undefined;
  const unread = ev?.deepestPoolDisagreement?.marketDeepest;
  if (!unread) return null;
  const share = ev?.custodyDowngrade?.readVenuesShare;
  return {
    unreadDeepest: unread,
    readSharePct: typeof share === "number" ? (share * 100).toFixed(1) : null,
  };
}

function relativeAge(seconds: number): string {
  if (seconds < 60) return `${seconds} SECOND${seconds === 1 ? "" : "S"} AGO`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} MINUTE${minutes === 1 ? "" : "S"} AGO`;
  const hours = Math.round(minutes / 60);
  return `${hours} HOUR${hours === 1 ? "" : "S"} AGO`;
}

function untilLabel(iso: string): string | null {
  const deltaMs = Date.parse(iso) - Date.now();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

type FreshnessTone = "fresh" | "muted" | "warn";

/** §19.1 verdict-page status line — never Electric Lime (preserve the budget). */
function freshnessLine(
  meta: ScanMeta,
  receiptId: number | null
): { label: string; tone: FreshnessTone } {
  const degraded = meta.completeness === "partial" || meta.source === "stale-fallback";
  if (meta.historyIncomplete) return { label: "POOL HISTORY INCOMPLETE · NO NEW RECEIPT", tone: "warn" };
  if (degraded) return { label: "PROVIDER DEGRADED · NO NEW RECEIPT", tone: "warn" };
  if (meta.receiptAction === "reused" && receiptId !== null) {
    return { label: `UNCHANGED · EXISTING RECEIPT #${receiptId} REUSED`, tone: "muted" };
  }
  if (meta.source === "cache" || meta.source === "database") {
    const receipt = receiptId !== null ? ` · RECEIPT #${receiptId}` : "";
    return { label: `CACHED · SCANNED ${relativeAge(meta.ageSeconds)}${receipt}`, tone: "muted" };
  }
  if (meta.receiptAction === "appended" && receiptId !== null) {
    return { label: `FRESH SCAN · RECEIPT #${receiptId}`, tone: "fresh" };
  }
  return { label: "FRESH SCAN · NOT RECORDED", tone: "muted" };
}

const TONE_COLOR: Record<FreshnessTone, string> = {
  fresh: "#ededea",
  muted: "#8a8a8a",
  warn: "#eab308",
};

/** §19.1/§19.3 — freshness, DEX coverage, and cooldown, in one calm mono strip. */
function FreshnessStrip({ meta, receiptId }: { meta: ScanMeta; receiptId: number | null }) {
  const { label, tone } = freshnessLine(meta, receiptId);
  const cooldown = untilLabel(meta.nextFreshScanAt);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.14em]">
      <span style={{ color: TONE_COLOR[tone] }} className="font-bold">
        {label}
      </span>
      <span className="text-[#3d3d3d]">·</span>
      <span className="text-[#8a8a8a]">{dexCoverageLabel(meta.dexProtocols)}</span>
      {cooldown && (
        <>
          <span className="text-[#3d3d3d]">·</span>
          <span className="text-[#8a8a8a]">NEXT FRESH SCAN IN {cooldown}</span>
        </>
      )}
    </div>
  );
}

/** §19.1 — a degraded refresh is announced; the old verdict is not rescored. */
function DegradedBanner({ meta }: { meta: ScanMeta }) {
  if (meta.completeness !== "partial" && meta.source !== "stale-fallback") return null;
  const from =
    meta.source === "stale-fallback"
      ? `the last complete verdict from ${new Date(meta.scannedAt).toLocaleString("en-US")}`
      : "no complete verdict on record yet";
  return (
    <div className="mb-6 w-full border border-[#3a3a1a] bg-[#1a1a0e] px-4 py-3 font-mono text-[11px] leading-relaxed text-[#eab308]">
      {degradedScanMessage(meta)} Showing {from}. No new receipt was written.
    </div>
  );
}

const CATEGORY_MAP: Record<string, string[]> = {
  SECURITY: ["honeypot", "lp_custody", "ownership", "upgradeability", "dangerous_selectors", "source_verification", "tax_manipulation"],
  MARKET: ["liquidity_depth", "fdv_liquidity_ratio", "volume_turnover", "pool_age", "deployer_pulled_liquidity", "holder_concentration", "paid_promotion"],
  LINEAGE: ["funder_rug_history", "deployer_history", "funding_lineage"],
  IDENTITY: ["impersonation", "explorer_scam_flag", "serial_clone", "contract_age", "launchpad_provenance", "bytecode_fingerprint"],
};

export function VerdictView({
  verdict,
  ledger,
  record,
  scanMeta,
  traders: initialTraders,
}: {
  verdict: Verdict;
  ledger: LedgerStamp | null;
  record?: TokenRecord | null;
  scanMeta?: ScanMeta | null;
  /**
   * Optional initial seed. M18 relocated the top-traders fetch off the scan
   * critical path, so no caller populates this anymore — VerdictView fetches
   * it itself, below, after the verdict has already rendered.
   */
  traders?: TopTrader[] | null;
}) {
  const criticalFired = verdict.criticalOverride !== null;
  const pass = verdict.tier === "CLEAR" && !criticalFired;
  const overrideCheck = verdict.checks.find((c) => c.id === verdict.criticalOverride);
  const coverage = useMemo(() => chartCoverage(verdict), [verdict]);

  const [activeCategory, setActiveCategory] = useState<string>("SECURITY");
  const [traders, setTraders] = useState<TopTrader[] | null>(initialTraders ?? null);

  // M18 — the v1.9 top-traders table (high-frequency-bot / wash-suspect tags)
  // is market description, not scoring, and no longer sits
  // in the scan's critical path. Fetch it here, after the verdict itself has
  // rendered, from the small cached endpoint that owns the lookup; the
  // existing conditional render below already tolerates it staying absent —
  // it simply pops in when this resolves. Mirrors TokenArt's icon-fetch
  // pattern elsewhere in this file.
  // Tell the Robin Knight dock which token is on screen.
  //
  // `/scan` (no address in the route) runs the scan client-side and swaps its
  // own form out for this component. The App Router never re-renders, so
  // `page.tsx` never learns an address and the rail — which took its subject
  // from the route param — never mounted. The rail was therefore present at
  // `/scan/0x…` and `/rwa/0x…` and missing on the path most people take.
  //
  // Announced from here rather than from ScanForm because this component is
  // what exists exactly when a verdict is on screen: both the streaming and the
  // cached branch reach it, and only one of ScanForm's two success paths even
  // rewrote the URL.
  useEffect(() => {
    if (!verdict.tokenAddress) return;
    announceRobinKnightSubject(verdict.tokenAddress);
    // Withdrawn on unmount: on `/scan` the verdict is rendered INLINE, so
    // scanning again returns the page to the bare form while this dock would
    // otherwise stay open over it, still scoped to the previous token.
    return () => announceRobinKnightSubject(null);
  }, [verdict.tokenAddress]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/scan/${verdict.tokenAddress}/traders`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { traders: TopTrader[] | null } | null) => {
        if (!ctrl.signal.aborted && data?.traders && data.traders.length > 0) {
          setTraders(data.traders);
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [verdict.tokenAddress]);

  const checksByCategory = useMemo(() => {
    const res: Record<string, CheckResult[]> = {
      SECURITY: [],
      MARKET: [],
      LINEAGE: [],
      IDENTITY: [],
    };
    verdict.checks.forEach((c) => {
      let found = false;
      for (const [cat, ids] of Object.entries(CATEGORY_MAP)) {
        if (ids.includes(c.id)) {
          res[cat].push(c);
          found = true;
          break;
        }
      }
      if (!found) res["IDENTITY"].push(c); // fallback
    });
    return res;
  }, [verdict.checks]);

  return (
    // `relative` positions the lanyard layer below. Nothing else depends on it.
    <section className="relative mx-auto w-full min-w-0 max-w-6xl px-4 pb-24 sm:px-6">
      {/*
        Hangs from above the page and dangles over this section — a layer, not a
        panel, and transparent to the pointer everywhere except the card itself.
        It is here rather than in the right column because a lanyard whose
        anchor is inside a box reads as a floating string; see the component.
      */}
      <VerdictLanyard
        receiptId={ledger?.id ?? null}
        shareHref={shareIntent(verdict, ledger?.id ?? null)}
      />
      {scanMeta && <DegradedBanner meta={scanMeta} />}
      <div
        data-testid="verdict-columns"
        className="grid min-w-0 gap-10 lg:grid-cols-[minmax(280px,1fr)_1.4fr]"
      >
        {/* left zone — the score and metrics */}
        <div className="flex w-full min-w-0 flex-col items-start">
          {criticalFired && (
            <div className="mb-6 w-full break-words bg-[#ccff00] px-3 py-3 text-center font-cinzel text-sm font-bold tracking-[0.1em] text-[#0a0a0a] sm:px-4 sm:text-lg sm:tracking-[0.14em]">
              {verdict.criticalOverride === "honeypot"
                ? "HONEYPOT · DO NOT BUY"
                : `${(overrideCheck?.name ?? "CRITICAL").toUpperCase()} · DO NOT BUY`}
            </div>
          )}
          <div
            className="max-w-full font-cinzel text-[clamp(7rem,42vw,10rem)] font-black leading-none sm:text-[13rem]"
            style={{ color: pass ? "#ccff00" : "#ededea" }}
          >
            {verdict.score}
          </div>
          <div className="mt-2 font-cinzel text-2xl tracking-[0.2em] text-[#ededea]">
            {verdict.tier}
          </div>
          <div className="mt-6 font-mono text-sm text-[#8a8a8a]">
            <div className="flex items-start gap-3">
              <TokenArt address={verdict.tokenAddress} symbol={verdict.tokenSymbol} />
              <div className="flex flex-col items-start gap-1">
                {verdict.tokenName && (
                  <div className="text-[#ccff00] font-bold">
                    {verdict.tokenName}
                  </div>
                )}
                <div>
                  {verdict.tokenSymbol ?? "UNKNOWN"}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-col items-start gap-1">
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[#ededea]">{short(verdict.tokenAddress)}</span>
                <CopyAddressButton address={verdict.tokenAddress} />
                <a
                  href={`${explorerWebUrl}/address/${verdict.tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 text-[10px] tracking-wider transition-colors hover:bg-[#2a2a2a] hover:text-[#ededea]"
                  title="View in Explorer"
                >
                  EXPLORER ↗
                </a>
              </div>
            </div>
            <div className="mt-4">scored under v{verdict.scoreVersion}</div>
          </div>
          {verdict.market?.liquidityUsd != null && (
            <div className="mt-6 max-w-full border border-[#2a2a2a] bg-[#141414] px-4 py-3 font-mono w-full">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] tracking-widest text-[#8a8a8a]">LIQUIDITY</span>
                  <span className="font-bold text-[#ccff00]">${Math.round(verdict.market.liquidityUsd).toLocaleString("en-US")}</span>
                </div>
                {verdict.market.volume24hUsd != null && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] tracking-widest text-[#8a8a8a]">24H VOL</span>
                    <span className="font-bold text-[#ccff00]">${Math.round(verdict.market.volume24hUsd).toLocaleString("en-US")}</span>
                  </div>
                )}
                {verdict.market.fdvUsd != null && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] tracking-widest text-[#8a8a8a]">FDV</span>
                    <span className="font-bold text-[#ccff00]">${Math.round(verdict.market.fdvUsd).toLocaleString("en-US")}</span>
                  </div>
                )}
                {verdict.market.buys24h != null && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] tracking-widest text-[#8a8a8a]">24H BUYS</span>
                    <span className="font-bold text-[#ccff00]">{verdict.market.buys24h.toLocaleString("en-US")}</span>
                  </div>
                )}
                {verdict.market.sells24h != null && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] tracking-widest text-[#8a8a8a]">24H SELLS</span>
                    <span className="font-bold text-[#ccff00]">{verdict.market.sells24h.toLocaleString("en-US")}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* right zone — just the chart */}
        <div className="flex min-w-0 flex-col gap-2">
          {verdict.market?.poolAddress && (
            <div className="mb-4 w-full border border-[#2a2a2a] bg-[#141414]">
              <div className="border-b border-[#2a2a2a] px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-[#3d3d3d]">
                PRICE · DEX MARKET DATA
              </div>
              {/* `token_address` names the SUBJECT. We pin the pool by DexScreener's
                  base-token choice; GeckoTerminal orients the same pool by its own
                  unpublished rule (a quote allowlist, then V4 currency0 as tie-break,
                  and not even that consistently — two SPY pools orient oppositely).
                  Never infer their side; state ours. CRC charted Amazon's $259 share
                  price without this. */}
              <iframe
                title="Price chart"
                height={320}
                width="100%"
                loading="lazy"
                className="block w-full"
                src={`https://www.geckoterminal.com/${geckoTerminalNetwork}/pools/${verdict.market.poolAddress}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&token_address=${verdict.tokenAddress}`}
                allow="clipboard-write"
              />
              {coverage && (
                <div className="border-t border-[#2a2a2a] px-4 py-2 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
                  CHARTED POOL IS ON A VENUE THIS SCAN CANNOT READ
                  {coverage.readSharePct && (
                    <span className="text-[#3d3d3d]">
                      {" "}· CUSTODY CHECKS COVER THE {coverage.readSharePct}% OF LIQUIDITY WE COULD READ, NOT THIS POOL
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* freshness + DEX coverage + cooldown (§19.1/§19.3) */}
          {scanMeta && (
            <div className="mt-6">
              <FreshnessStrip meta={scanMeta} receiptId={ledger?.id ?? null} />
            </div>
          )}

          {/* ledger stamp */}
          <div className="mt-6 border-t border-[#2a2a2a] pt-4 font-mono text-xs text-[#8a8a8a]">
            {ledger ? (
              <>
                Verdict #{ledger.id} · {short(ledger.entryHash)} · chained to{" "}
                {short(ledger.prevHash)} · scored under v{verdict.scoreVersion}{" "}
                <a href="/ledger" className="underline hover:text-[#ededea]">
                  VERIFY IN THE LEDGER
                </a>
              </>
            ) : (
              <>Off the record. Persistence not configured, so this verdict was not chained.</>
            )}
          </div>
        </div>
      </div>

      {/* THE RECORD (Full width, placed below the two-column grid) */}
      <div className="mt-12 w-full">
        <TheRecord
          record={record ?? null}
          currentVerdictId={ledger?.id ?? null}
          tokenAddress={verdict.tokenAddress}
        />
      </div>

      {/* Key Highlights and Social Card */}
      <div className="mt-12 w-full">
        <KeyHighlights verdict={verdict} receiptId={ledger?.id ?? null} />
      </div>

      {/* New Categorized Evidence Grid (Full width) */}
      <div className="mt-12 w-full">
        <CheckCategoryGrid
          checksByCategory={checksByCategory}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
        />
      </div>

      {/* Unified Detail Container below grid (Full width) */}
      {activeCategory && checksByCategory[activeCategory] && (
        <div className="mt-6 w-full border border-[#2a2a2a] bg-[#141414] flex flex-col">
          <div className="border-b border-[#2a2a2a] px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-[#8a8a8a] bg-[#1a1a1a]">
            {activeCategory} DETAILS
          </div>
          <div className="flex flex-col bg-[#1a1a1a]">
            {checksByCategory[activeCategory].map((c, i) => (
              <div key={c.id} className={i !== 0 ? "border-t border-[#2a2a2a]" : ""}>
                <CompactCheckRow check={c} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* M8 — capability findings from the contract-authority audit. Weightless:
          visible evidence, never a scoring category (see the plan's locked UI
          decision). Authority/proxy-graph findings are folded into the
          existing ownership/upgradeable-proxy check evidence instead. */}
      {verdict.contractAudit && (
        <div className="mt-12 w-full">
          <ContractAuthorityPanel audit={verdict.contractAudit} />
        </div>
      )}

      {/* Uniswap hook list entries for this token's V4 pool hooks. Reference, never scored. */}
      {verdict.tokenAddress && <PoolHooksPanel token={verdict.tokenAddress} />}

      {/* v1.9 — tagged top traders. Market description beside the verdict, never scored. */}
      {traders && traders.length > 0 && (
        <div className="mt-12 w-full">
          <TopTradersTable traders={traders} />
        </div>
      )}

      <DisputeVerdictCTA />
    </section>
  );
}

/**
 * Every verdict is deterministic, but the chain can still surprise us — a pool
 * migrates, an aggregator lags. This gives readers a one-click way to flag a
 * verdict they believe is wrong, routed to the public Telegram chat.
 */
function DisputeVerdictCTA() {
  return (
    <div className="mt-12 border-t border-[#2a2a2a] pt-6">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center font-mono text-xs text-[#8a8a8a]">
        <span>Think this verdict got it wrong?</span>
        <a
          href="https://t.me/RobinCallsChat"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-1 tracking-[0.14em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]"
        >
          FLAG IT IN THE TELEGRAM CHAT ↗
        </a>
      </div>
      {/*
        The registry (trusted lockers, known-good contracts) is reviewed by a
        person before an address earns credit, so a legitimate project can read
        lower than it should until that review catches up. Said here rather than
        buried in /methodology because this is where a project owner arrives when
        the score surprises them.
      */}
      <p className="mx-auto mt-4 max-w-2xl text-center font-mono text-[11px] leading-relaxed text-[#eab308]/70">
        Heads up: the scanner is improved continuously, and some fixes only surface once
        they meet real tokens on production. Our trusted registry — verified LP lockers,
        known-good launchpad contracts — is checked and approved by a human on the team,
        so a legitimate project can score lower for a while until we&apos;ve confirmed its
        contracts ourselves. A low score is a prompt to look closer, not a conclusion.
      </p>
    </div>
  );
}

/** Behavior-tag chip colors: bots read amber, wash reads red-ish. */
const TRADER_TAG_STYLE: Record<string, string> = {
  "high-frequency-bot": "border-[#3a3a1a] bg-[#1a1a0e] text-[#eab308]",
  "wash-suspect": "border-[#3a1a1a] bg-[#1a0e0e] text-[#f87171]",
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Same materiality idiom as lib/audit/probes/adapter-registry.ts's selectAuthority. */
function authorityFor(
  finding: CapabilityFinding,
  authorities: AuthorityResolution[],
): AuthorityResolution | null {
  const byMateriality = authorities.find((a) =>
    a.materialityNote?.toLowerCase().includes(finding.capability.toLowerCase()),
  );
  return byMateriality ?? authorities[0] ?? null;
}

/**
 * The line the task exists to get right: a capability finding on its own
 * ("has fee/limit/rescue capability") is not the same claim as "and it's
 * reachable" — a renounced ownership only neuters OWNER-gated functions. If
 * the same capability is gated by a different role (a dev wallet, a
 * ProxyAdmin, an unresolved controller) it stays live regardless of what
 * ownership() says. This never collapses to "ownership renounced -> safe".
 */
function describeReachability(finding: CapabilityFinding, authorities: AuthorityResolution[]): string {
  const authority = authorityFor(finding, authorities);
  if (!authority) {
    return "Authority unresolved — reachability is unknown, not proven safe.";
  }
  // A missing controller is an unread one, never a renounce (same rule as audit-scoring's auditReachability).
  const controllerRenounced =
    !!authority.controller &&
    (authority.controller.toLowerCase() === ZERO_ADDRESS || authority.controller.toLowerCase() === "0x000000000000000000000000000000000000dead");
  if (controllerRenounced && (authority.kind === "ownable" || authority.kind === "ownable-two-step" || authority.kind === "eoa")) {
    return `Owner renounced — unreachable via this ${authority.kind} authority. If a different role gates this function, it may still be live.`;
  }
  if (authority.kind === "factory-operator" && authority.handoffTo) {
    return authority.handoffTo.toLowerCase() === ZERO_ADDRESS || authority.handoffTo.toLowerCase() === "0x000000000000000000000000000000000000dead"
      ? "Held by the launchpad contract, which can only pass ownership to a dead address. Nobody can use this."
      : `Held by the launchpad contract, which passes ownership to ${short(authority.handoffTo)} when the token migrates.`;
  }
  if (authority.kind === "unknown") {
    return "Controlling authority could not be resolved — this capability's reachability is unknown, not proven safe.";
  }
  return `Reachable via ${authority.kind}${authority.controller ? ` (${short(authority.controller)})` : ""}.`;
}

// "VERIFIED" read as "confirmed dangerous" — it actually means "found and
// traced in Blockscout-verified source" (M8 handoff issue #5). Renamed to
// what each confidence level actually attests to.
const CONFIDENCE_LABEL: Record<CapabilityFinding["confidence"], string> = {
  "verified-semantic": "IN SOURCE",
  heuristic: "LIKELY",
  "selector-hint": "BYTECODE ONLY",
  unresolved: "UNRESOLVED",
};

function ContractAuthorityPanel({
  audit,
}: {
  audit: NonNullable<Verdict["contractAudit"]>;
}) {
  const capabilities = audit.capabilities;
  // If every finding resolves to the identical reachability sentence, say it
  // once at the panel level instead of repeating it on every row (M8 handoff
  // issue #5) — per-row only when the findings actually diverge.
  const reachabilityByFinding = capabilities.map((f) => describeReachability(f, audit.authorities));
  const sharedReachability =
    capabilities.length > 1 && reachabilityByFinding.every((r) => r === reachabilityByFinding[0])
      ? reachabilityByFinding[0]
      : null;
  return (
    <div className="w-full">
      <div className="mb-6 flex items-center gap-3">
        <span className="font-cinzel text-lg font-bold tracking-[0.2em] text-[#ededea]">
          CONTRACT AUTHORITY
        </span>
        <span className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">
          PRIVILEGED CAPABILITIES · WHO CAN REACH THEM · FEEDS THE DANGEROUS-FUNCTIONS SCORE
        </span>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
      </div>

      <div className="w-full border border-[#2a2a2a] bg-[#141414]">
        <div className="flex items-center justify-between gap-3 border-b border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-[#8a8a8a]">
          <span>
            {capabilities.length} CAPABILIT{capabilities.length === 1 ? "Y" : "IES"} DETECTED
          </span>
          <span title="Overall proxy/authority resolution completeness — not the per-capability confidence badges below.">
            EVIDENCE: {audit.completeness.toUpperCase()}
            {audit.truncationReason ? ` (${audit.truncationReason})` : ""}
          </span>
        </div>

        {capabilities.length === 0 ? (
          audit.completeness === "complete" ? (
            <div className="px-4 py-4 text-[13px] text-[#8a8a8a]">
              No privileged capabilities found in the audited source and bytecode.
            </div>
          ) : (
            // Zero findings on an audit that did NOT complete is "we couldn't
            // look", not "nothing there" (CLAUDE.md §4). Never render it as a
            // clean bill. Distinguish unverified source (bytecode only) from a
            // mid-analysis fault so the reader knows which uncertainty this is.
            <div className="px-4 py-4 text-[13px] leading-relaxed text-[#c9a227]">
              {audit.evidenceHashes?.sourceHash
                ? "Analysis did not complete — the absence of findings here is not a clean bill. Treat privileged authority as unverified."
                : "Source is not verified on the explorer — only bytecode selectors could be scanned. The absence of findings here is not a clean bill."}
            </div>
          )
        ) : (
          <div className="flex flex-col">
            {sharedReachability && (
              <div className="border-b border-[#2a2a2a] px-4 py-2 text-[13px] leading-relaxed text-[#c4c4c4]">
                {sharedReachability}
              </div>
            )}
            {capabilities.map((finding, i) => (
              <div
                key={`${finding.capability}-${i}`}
                className={i !== 0 ? "border-t border-[#2a2a2a] px-4 py-3" : "px-4 py-3"}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-cinzel text-[13px] font-semibold tracking-[0.08em] text-[#ededea]">
                    {finding.capability.replace(/_/g, " ")}
                  </span>
                  <span className="border border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-[#8a8a8a]">
                    {CONFIDENCE_LABEL[finding.confidence]}
                  </span>
                  {finding.probeStatus && finding.probeStatus !== "not-run" && (
                    <span className="border border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-[#8a8a8a]">
                      PROBE: {finding.probeStatus.toUpperCase()}
                    </span>
                  )}
                </div>
                {finding.functionSignatures.length > 0 && (
                  <p className="mt-1 font-mono text-[12px] text-[#8a8a8a]">
                    {finding.functionSignatures.join(", ")}
                  </p>
                )}
                {!sharedReachability && (
                  <p className="mt-1 text-[13px] leading-relaxed text-[#c4c4c4]">
                    {reachabilityByFinding[i]}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TopTradersTable({ traders }: { traders: TopTrader[] }) {
  return (
    <div className="w-full">
      <div className="mb-6 flex items-center gap-3">
        <span className="font-cinzel text-lg font-bold tracking-[0.2em] text-[#ededea]">
          TOP TRADERS
        </span>
        <span className="font-mono text-[10px] tracking-widest text-[#8a8a8a]">
          24H · BY VOLUME · TAGGED BY BEHAVIOR
        </span>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
      </div>
      <div className="w-full overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b border-[#2a2a2a] text-left text-[10px] tracking-[0.18em] text-[#8a8a8a]">
              <th className="px-4 py-2 font-normal">#</th>
              <th className="px-4 py-2 font-normal">WALLET</th>
              <th className="px-4 py-2 font-normal">BEHAVIOR</th>
              <th className="px-4 py-2 font-normal">TRADES</th>
              <th className="px-4 py-2 font-normal text-right">VOLUME</th>
            </tr>
          </thead>
          <tbody>
            {traders.map((t, i) => (
              <tr key={t.address} className={i !== 0 ? "border-t border-[#2a2a2a]" : ""}>
                <td className="px-4 py-2 text-[#8a8a8a]">{i + 1}</td>
                <td className="px-4 py-2">
                  <a
                    href={`${explorerWebUrl}/address/${t.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#ededea] underline decoration-[#2a2a2a] hover:decoration-[#ccff00]"
                  >
                    {short(t.address)}
                  </a>
                </td>
                <td className="px-4 py-2">
                  {t.tags.length === 0 ? (
                    <span className="text-[#3d3d3d]">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {t.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`border px-1.5 py-0.5 text-[10px] tracking-wider ${TRADER_TAG_STYLE[tag] ?? "border-[#2a2a2a] text-[#8a8a8a]"}`}
                        >
                          {tag.toUpperCase()}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-[#c4c4c4]">
                  {t.buys} buy / {t.sells} sell
                </td>
                <td className="px-4 py-2 text-right font-bold text-[#ccff00]">
                  ${t.volumeUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-[#8a8a8a]">
        Last ~300 trades on the anchor pool. Tags are behavioral reads (first-trade timing,
        cadence, buy/sell symmetry) — they describe the market and do not move the score.
        Untagged wallets are presumed human.
      </p>
    </div>
  );
}

/**
 * The X intent URL for a verdict. One definition because two places need it now
 * — the hanging card at the page root and the share control in the column — and
 * a card that shares a different link than the button beside it is the kind of
 * bug nobody reports.
 */
function shareIntent(verdict: Verdict, receiptId: number | null): string {
  const text = `Verdict for ${verdict.tokenSymbol ?? "token"} is ${verdict.tier}. Read the record:`;
  // Points at the ledger entry, not a rescan — the ledger links back to this
  // exact archived verdict (/scan/[address]?v=<id>) for anyone who opens it.
  const url =
    receiptId !== null
      ? `https://robincalls.com/ledger?v=${receiptId}#v${receiptId}`
      : `https://robincalls.com/scan/${verdict.tokenAddress}`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * The Robin Knight column's height, `xl` and up — a fixed clamp, deliberately
 * NOT the flags column's height.
 *
 * It used to measure the left column and match it, which sounds like alignment
 * and behaves like neither of the two things a chat panel needs. On a token
 * with five short flags it produced ~548px, of which the opening strip takes
 * ~164, leaving 372px for a header (58) and a composer (149) that cannot
 * shrink — a 32px transcript. On a token with five long ones (JAMCAT) it
 * produced well over a screen, so the composer sat below the fold and the
 * panel had no bounded box to scroll inside at all. The flags column simply
 * does not know what it is being asked to hold.
 *
 * `78dvh` is the same clamp `/robin-knight` uses for the same reason: tall
 * enough to read an answer in, never taller than the screen, and definite —
 * which is what the transcript's `overflow-y-auto` needs to clip against. The
 * floor covers short laptop windows; the ceiling stops it dwarfing the verdict
 * on a tall monitor.
 *
 * Below `xl` there is no chat in this column at all (`RobinKnightDock` only
 * portals into the slot when `wide`; everything else is its fixed sheet), so
 * the column stays auto — a height there reserves hundreds of px for nothing,
 * the exact blank gap `RobinKnightSlot` already had to delete once.
 *
 * The column is sticky, so the panel rides down beside a long flags list rather
 * than scrolling off while the reader is still reading the thing they want to
 * ask about. Sticky needs `self-start`: a stretched grid item is already as tall
 * as its row and has nowhere to travel. Its travel stops at the end of the grid
 * area on its own — a sticky element cannot leave its containing block — so it
 * follows the flags and lets go when KEY HIGHLIGHTS ends, with no measurement.
 */
const ROBIN_KNIGHT_COLUMN_H = "xl:h-[clamp(560px,78dvh,900px)]";

/**
 * The same clamp as a floor under the GRID ROW, and it must stay character-for-
 * character identical to `ROBIN_KNIGHT_COLUMN_H` (two literals because Tailwind
 * scans source text for class names, so neither can be built by interpolation).
 *
 * `self-start` is what makes this load-bearing rather than belt-and-braces: it
 * stops the column stretching to the row, so a highlights section shorter than
 * the panel would leave the panel hanging out of the bottom of its own row and
 * over THE RECORD below. The row is now never the shorter of the two.
 */
const ROBIN_KNIGHT_ROW_MIN_H = "xl:min-h-[clamp(560px,78dvh,900px)]";

function KeyHighlights({
  verdict,
  receiptId,
}: {
  verdict: Verdict;
  receiptId: number | null;
}) {
  const clear = verdict.tier === "CLEAR";
  /**
   * A SKIP that means "we could not look" belongs here, and dropping every SKIP
   * was hiding exactly the ones that matter: LAPTOP's `lp_custody` stood down
   * over 0.0% of its pool and the panel showed five PASSes instead. The filter
   * is `unavailableChecks`, the same predicate that moves the score, so the
   * panel cannot show a different set from the one the cap counted (§8 #15).
   * A subject-less SKIP ("this token has no V2 pair") is still dropped: it is
   * not a gap in what we know.
   */
  const unreadIds = useMemo(
    () => new Set(unavailableChecks(verdict.checks).map((c) => c.id)),
    [verdict.checks]
  );
  const checks = verdict.checks.filter(
    (c) => c.status !== "SKIP" || unreadIds.has(c.id)
  );
  const order = { CRITICAL: 0, FAIL: 1, WARN: 2, PASS: 3, SKIP: 4 } as const;
  const flags = [...checks]
    .sort((a, b) => {
      // An unread load-bearing check outranks everything except a kill shot,
      // in both directions of the sort — on a CLEAR verdict the PASS-first
      // order would otherwise bury it at the bottom, which is the reading the
      // cap exists to prevent.
      const ua = unreadIds.has(a.id) && a.status !== "CRITICAL";
      const ub = unreadIds.has(b.id) && b.status !== "CRITICAL";
      if (ua !== ub) return ua ? -1 : 1;
      return clear
        ? order[b.status] - order[a.status]
        : order[a.status] - order[b.status];
    })
    .slice(0, 5); // top 5 flags

  const twitterIntent = shareIntent(verdict, receiptId);

  // Read from the whole verdict's EVIDENCE, not from the five flags this column
  // happens to display and not from their prose. See `addresses-of-interest.ts`
  // for why both of those were wrong (L130).
  const flaggedAddresses = useMemo(
    () => addressesOfInterest(verdict.checks),
    [verdict.checks]
  );

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-6">
        <span className="font-cinzel text-lg font-bold tracking-[0.2em] text-[#ededea]">
          KEY HIGHLIGHTS
        </span>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-8 ${ROBIN_KNIGHT_ROW_MIN_H}`}>
        <div className="flex flex-col gap-3">
          {flaggedAddresses.length > 0 && (
            <div className="border border-[#2a2a2a] bg-[#141414] p-4 mb-1">
              <div className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#8a8a8a]">
                KEY ADDRESSES
              </div>
              <div className="flex flex-col gap-2">
                {flaggedAddresses.map(({ address, role }) => (
                  <div key={address} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a] min-w-[11rem]">
                      {role}
                    </span>
                    <InlineAddress address={address} />
                    <a
                      href={`${explorerWebUrl}/address/${address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 font-mono text-[10px] tracking-wider text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ededea]"
                      title="View in Explorer"
                    >
                      EXPLORER ↗
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
          {flags.map((f) => (
            <div key={f.id} className="border border-[#2a2a2a] bg-[#141414] p-4 flex flex-col gap-2 transition-colors hover:border-[#ccff00]">
              <div className="flex items-center justify-between">
                <span className="font-cinzel text-xs tracking-[0.1em] text-[#ededea]">{f.name.toUpperCase()}</span>
                <StatusWord status={f.status} />
              </div>
              <p className="font-mono text-[13px] leading-relaxed text-[#c4c4c4]"><ReasonText text={f.reason} /></p>
            </div>
          ))}
          {flags.length === 0 && (
            <div className="border border-[#2a2a2a] bg-[#141414] p-4 flex items-center justify-center h-full">
              <span className="font-mono text-xs text-[#8a8a8a]">No significant highlights.</span>
            </div>
          )}
        </div>

        {/*
          The column the "coming soon" panel used to hold. PLAN.md §5: the
          Robin Knight, and the share control. The card itself is no longer here
          — it hangs over the whole page from the section root, see
          `VerdictLanyard` at the top of this component.
        */}
        <div
          className={`flex min-h-0 flex-col gap-6 xl:sticky xl:top-6 xl:self-start ${ROBIN_KNIGHT_COLUMN_H}`}
        >
          <RobinKnightSlot verdict={verdict} />
          <VerdictShare
            receiptId={receiptId}
            alt={`Verdict card for ${verdict.tokenSymbol ?? "token"}: score ${verdict.score}, tier ${verdict.tier}`}
            shareHref={twitterIntent}
          />
        </div>
      </div>
    </div>
  );
}

function CheckCategoryGrid({
  checksByCategory,
  activeCategory,
  setActiveCategory,
}: {
  checksByCategory: Record<string, CheckResult[]>;
  activeCategory: string;
  setActiveCategory: (cat: string) => void;
}) {
  return (
    <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Object.entries(checksByCategory).map(([catName, catChecks]) => {
        if (catChecks.length === 0) return null;
        return (
          <CategoryBox
            key={catName}
            name={catName}
            checks={catChecks}
            isActive={activeCategory === catName}
            onClick={() => setActiveCategory(catName)}
          />
        );
      })}
    </div>
  );
}

function CategoryBox({
  name,
  checks,
  isActive,
  onClick,
}: {
  name: string;
  checks: CheckResult[];
  isActive: boolean;
  onClick: () => void;
}) {
  const passes = checks.filter((c) => c.status === "PASS").length;
  const fails = checks.filter((c) => c.status === "FAIL" || c.status === "CRITICAL").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  const skips = checks.filter((c) => c.status === "SKIP").length;

  return (
    <button
      onClick={onClick}
      className={`p-5 brutalist-box brutalist-shadow-dark brutalist-pressable halftone-dark text-left w-full transition-colors border bg-[#141414] cursor-pointer ${isActive ? "border-[#CCFF00]" : "border-[#2A2A2A] hover:border-[#CCFF00]"
        }`}
    >
      <div className="w-full flex items-center justify-between">
        <div className="font-cinzel text-xs font-bold tracking-[0.12em] text-[#ededea]">
          {name}
        </div>
        <div
          className={`text-[10px] tracking-[0.18em] font-bold ${isActive ? "text-[#ccff00]" : "text-[#8a8a8a]"
            }`}
        >
          {isActive ? "SELECTED" : "VIEW DETAILS"}
        </div>
      </div>

      <div className="mt-2 font-mono text-[10px] text-[#8a8a8a] flex flex-wrap gap-2">
        {fails > 0 && <span className="text-[#ff3333] font-bold">{fails} FAIL</span>}
        {warns > 0 && <span className="text-[#eab308] font-bold">{warns} WARN</span>}
        {passes > 0 && <span className="text-[#ccff00] font-bold">{passes} PASS</span>}
        {skips > 0 && <span>{skips} SKIP</span>}
      </div>
    </button>
  );
}

function CompactCheckRow({ check }: { check: CheckResult }) {
  const [open, setOpen] = useState(false);
  const adapterEvidence = (check.evidence as { adapterSell?: { alternativeRoutes?: unknown } } | undefined)?.adapterSell;
  const alternativeRoutes = Array.isArray(adapterEvidence?.alternativeRoutes)
    ? adapterEvidence.alternativeRoutes.slice(0, 5) as Array<{ routeId?: string; poolId?: string; feeTier?: number; status?: string; reason?: string }>
    : [];
  return (
    <div className="bg-[#141414]">
      <div className="flex flex-col items-stretch gap-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-cinzel text-[13px] font-semibold tracking-[0.1em] text-[#ededea]">
                {check.name.toUpperCase()}
              </span>
              <InfoTooltip
                text={mechanismForCheckId(check.id)}
                label={`How we check ${check.name}`}
              />
              {check.weight !== null && (
                <span className="font-mono text-[10px] text-[#8a8a8a]">
                  w{check.weight}
                  {check.deduction > 0 && ` · −${check.deduction}`}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 scale-90 origin-top-right">
            <StatusWord status={check.status} />
          </div>
        </div>

        <p className="mt-1 text-[13px] leading-relaxed text-[#c4c4c4] pr-2"><ReasonText text={check.reason} /></p>

        <div className="mt-2 text-right">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] tracking-[0.18em] text-[#ededea] font-bold cursor-pointer"
          >
            {open ? "HIDE RAW DATA" : "VIEW RAW DATA"}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#2a2a2a] bg-[#1c1c1c] px-4 py-3">
          {check.id === "honeypot" && alternativeRoutes.length > 0 && (
            <div className="mb-3 space-y-1 text-[11px] text-[#b8b8b8]">
              <div className="font-mono tracking-[0.12em] text-[#ededea]">OTHER CHECKED POOLS</div>
              {alternativeRoutes.map((route, i) => (
                <div key={`${route.routeId ?? route.poolId ?? i}-${i}`} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-[#8a8a8a]">{route.routeId ?? route.poolId ?? "Pool identity unavailable"}</span>
                  <span>fee {typeof route.feeTier === "number" ? `${route.feeTier / 10_000}%` : "unknown"}</span>
                  <span>{route.status ?? "UNRESOLVED"}</span>
                  {route.reason && <span className="text-[#8a8a8a]">{route.reason}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[11px] tracking-[0.18em] text-[#8a8a8a]">
            <span>SOURCE: {check.source.toUpperCase()}</span>
            <CopyButton text={JSON.stringify(check.evidence, null, 2)} label="COPY JSON" />
          </div>
          <div className="max-w-full overflow-x-auto font-mono text-[12px] leading-relaxed text-[#8a8a8a]">
            <ColoredJson data={check.evidence} />
          </div>
        </div>
      )}
    </div>
  );
}

function ColoredJson({ data }: { data: unknown }) {
  if (data === null) return <span className="text-[#ccff00]">null</span>;
  if (typeof data === "string") return <span className="text-[#ccff00]">&quot;{data}&quot;</span>;
  if (typeof data === "number" || typeof data === "boolean") {
    return <span className="text-[#ccff00]">{String(data)}</span>;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-[#8a8a8a]">[]</span>;
    return (
      <span>
        <span className="text-[#8a8a8a]">[</span>
        <div className="pl-4">
          {data.map((item, i) => (
            <div key={i}>
              <ColoredJson data={item} />
              {i < data.length - 1 && <span className="text-[#8a8a8a]">,</span>}
            </div>
          ))}
        </div>
        <span className="text-[#8a8a8a]">]</span>
      </span>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data);
    if (entries.length === 0) return <span className="text-[#8a8a8a]">{"{}"}</span>;

    return (
      <span>
        <span className="text-[#8a8a8a]">{"{"}</span>
        <div className="pl-4">
          {entries.map(([key, val], i) => (
            <div key={key}>
              <span className="text-[#ededea]">&quot;{key}&quot;</span>
              <span className="text-[#8a8a8a]">: </span>
              <ColoredJson data={val} />
              {i < entries.length - 1 && <span className="text-[#8a8a8a]">,</span>}
            </div>
          ))}
        </div>
        <span className="text-[#8a8a8a]">{"}"}</span>
      </span>
    );
  }

  return <span className="text-[#ccff00]">{String(data)}</span>;
}

/**
 * Token icon for the verdict header, discovered client-side from DexScreener
 * (open CORS, nothing stored). Graduated tokens have a DEX pair and therefore
 * an image; if none resolves, a noir monogram stands in.
 */
function TokenArt({ address, symbol }: { address: string; symbol: string | null }) {
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchTokenImage(address, ctrl.signal).then((url) => {
      if (url && !ctrl.signal.aborted) setIcon(url);
    });
    return () => ctrl.abort();
  }, [address]);

  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        className="h-12 w-12 shrink-0 border border-[#2a2a2a] bg-[#1c1c1c] object-cover"
        onError={() => setIcon(null)}
      />
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] font-cinzel text-base text-[#8a8a8a]">
      {(symbol ?? "?").slice(0, 2).toUpperCase()}
    </div>
  );
}

export function short(hash: string, n = 6) {
  return hash.length > n * 2 + 2 ? `${hash.slice(0, n + 2)}…${hash.slice(-4)}` : hash;
}

function CopyAddressButton({ address }: { address: string }) {
  return <CopyButton text={address} label="COPY" title="Copy address" />;
}

/**
 * A 40-hex address, not followed by more hex (so a 64-char hash/poolId is left
 * intact rather than sliced at 40). Used to find wallet addresses embedded in a
 * check's prose so they can be rendered as copy chips.
 */
const REASON_ADDRESS_RE = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;

/**
 * Render a check's reason string, turning every wallet address into an inline
 * copy chip. The prose already names the controlling wallet (deployer or whale);
 * this makes that address one click to copy without leaving the sentence.
 */
function ReasonText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  REASON_ADDRESS_RE.lastIndex = 0;
  for (let m = REASON_ADDRESS_RE.exec(text); m !== null; m = REASON_ADDRESS_RE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(<InlineAddress key={key++} address={m[0]} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

/** Inline, seamless address chip: truncated display, copies the full address. */
function InlineAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const handleCopy = () => {
    navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = address;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
        document.body.removeChild(ta);
      });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied" : `Copy ${address}`}
      className="mx-0.5 inline-flex items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#1c1c1c] px-1.5 py-px align-baseline font-mono text-[11px] text-[#ededea] transition-colors hover:border-[#ccff00]"
    >
      <span>{short}</span>
      {copied ? (
        <svg className="h-2.5 w-2.5 text-[#ccff00]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-2.5 w-2.5 text-[#8a8a8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

/** Generic clipboard-copy button — reused for the address chip and per-check evidence JSON. */
function CopyButton({
  text,
  label = "COPY",
  title = "Copy",
}: {
  text: string;
  label?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // fallback for older browsers or non-secure contexts
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Fallback copy failed', err);
      }
      document.body.removeChild(textArea);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex shrink-0 items-center gap-1 border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 text-[10px] tracking-wider transition-colors hover:border-[#ccff00] hover:text-[#ededea]"
      title={title}
    >
      {copied ? (
        <>
          <svg className="h-3 w-3 text-[#ccff00]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-[#ccff00]">COPIED</span>
        </>
      ) : (
        <>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}
