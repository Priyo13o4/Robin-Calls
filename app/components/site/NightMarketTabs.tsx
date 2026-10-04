"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import Link from "next/link";
import type { LaunchFeedRow } from "@/lib/launches/feed-types";
import { TokenIcon } from "./TokenIcon";
import { isPureBondingCurve, rowRaisedDisplay } from "@/lib/launches/raised";
import { fetchTokenImage } from "@/lib/data/token-art";
import {
  DIRECT_DEX_KEY,
  LIQUIDITY_BUCKETS,
  PROGRESS_BUCKETS,
  TIME_BUCKETS,
  VOLUME_BUCKETS,
  launchFiltersToQuery,
  type LaunchFilters,
} from "@/lib/config/launch-filters";
import { TradeLink } from "./TradeLink";
import { isOwnToken } from "@/lib/sale/token";

/**
 * Unified hot-launch Night Market tabs (docs/ways-of-work/plan/tracker/
 * unified-hot-launch-lifecycle/implementation-plan.md, "Locked Product
 * Decisions" + "UI and client metadata").
 *
 * Two tabs — BONDING and DEX / GRADUATED — both backed by the same
 * `/api/launches` feed so a token can never render twice from two sources.
 * The initial `bonding` page is server-rendered (see app/night-market/page.tsx);
 * every tab switch and "load more" goes through the client fetch below, never
 * a repository call from this component (that boundary belongs to lib/data/).
 */

type Tab = "bonding" | "dex";

export interface LaunchpadLink {
  name: string;
  slug: string;
  config: { website?: unknown; tokenUrlTemplate?: unknown } | null;
}

interface Props {
  initialTab: Tab;
  initialRows: LaunchFeedRow[];
  initialCursor: string | null;
  explorerUrl: string;
  launchpads: LaunchpadLink[];
  tradeEnabled: boolean;
}

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

function age(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

/**
 * Compact USD — $1.2M / $12.5k / $940. `null`/`undefined` means "we don't
 * know yet" (never polled, or a fake bond pre-DexScreener match) and renders
 * as "—" — coercing it to 0 would make an unread row look identical to a
 * genuinely drained $0 pool, which in a trust product is a confident wrong
 * number (CLAUDE.md §8.3). Only a real, measured 0 renders "$0".
 */
function usd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function ageMinutes(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export interface FilterState {
  time: Set<string>;
  liquidity: Set<string>;
  volume: Set<string>;
  progress: Set<string>;
  launchpads: Set<string>;
}

function emptyFilters(): FilterState {
  return {
    time: new Set(),
    liquidity: new Set(),
    volume: new Set(),
    progress: new Set(),
    launchpads: new Set(),
  };
}

function filterCount(f: FilterState): number {
  return f.time.size + f.liquidity.size + f.volume.size + f.progress.size + f.launchpads.size;
}

/** FilterState (Sets, for the picker) → LaunchFilters (arrays, for the URL). */
function toQueryFilters(f: FilterState): LaunchFilters {
  return {
    time: [...f.time],
    liquidity: [...f.liquidity],
    volume: [...f.volume],
    progress: [...f.progress],
    launchpads: [...f.launchpads],
  };
}

/** Small monogram badge — no external logo assets/fetches, matches TokenIcon's existing fallback style. */
function LaunchpadMonogram({ label }: { label: string }) {
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] font-cinzel text-[9px] text-[#8a8a8a]">
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

/**
 * Generic multi-select dropdown: a toggle button showing the active count,
 * and a checkbox panel. Selections within one filter OR together; filters
 * across dimensions AND together (see matchesFilters).
 */
function MultiSelectFilter({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { key: string; label: string; icon?: ReactNode }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] transition-colors ${
          selected.size > 0
            ? "border-[#ccff00] text-[#ededea]"
            : "border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] hover:text-[#ededea]"
        }`}
      >
        {label}
        {selected.size > 0 && <span className="text-[#ccff00]">{selected.size}</span>}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 min-w-[180px] border border-[#2a2a2a] bg-[#141414] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          {options.map((opt) => (
            <label
              key={opt.key}
              className="flex cursor-pointer items-center gap-2 px-2 py-1.5 font-mono text-[11px] text-[#c4c4c4] hover:bg-[#1c1c1c]"
            >
              <input
                type="checkbox"
                checked={selected.has(opt.key)}
                onChange={() => onToggle(opt.key)}
                className="accent-[#ccff00]"
              />
              {opt.icon}
              <span className="truncate">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterBar({
  tab,
  filters,
  setFilters,
  launchpads,
  rows,
}: {
  tab: Tab;
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  launchpads: LaunchpadLink[];
  rows: LaunchFeedRow[];
}) {
  const toggle = (dim: keyof FilterState, key: string) => {
    setFilters((prev) => {
      const next = new Set(prev[dim]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [dim]: next };
    });
  };

  // Options come from what's actually loaded for this tab, not the enabled-
  // launchpads config list — that list is for resolving click-through URLs
  // (launchpadUrl) and can legitimately diverge from what the feed is
  // currently showing (a pad disabled after it surfaced tokens, a config
  // read that came back empty). The config list still fills in name/slug
  // pairs for a pad not yet represented in the loaded rows, so switching tabs
  // or paginating doesn't make an option disappear once it appeared.
  const launchpadOptions = useMemo(() => {
    const bySlug = new Map<string, { key: string; label: string }>();
    for (const p of launchpads) bySlug.set(p.slug, { key: p.slug, label: p.name.toUpperCase() });
    for (const r of rows) {
      if (r.launchpad_slug && !bySlug.has(r.launchpad_slug)) {
        bySlug.set(r.launchpad_slug, {
          key: r.launchpad_slug,
          label: (r.launchpad_name ?? r.launchpad_slug).toUpperCase(),
        });
      }
    }
    const options = [...bySlug.values()].map((o) => ({ ...o, icon: <LaunchpadMonogram label={o.label} /> }));
    if (rows.some((r) => r.source_kind === "DIRECT_DEX")) {
      options.push({ key: DIRECT_DEX_KEY, label: "DIRECT DEX", icon: <LaunchpadMonogram label="DX" /> });
    }
    return options;
  }, [launchpads, rows]);

  const count = filterCount(filters);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <MultiSelectFilter
        label="TIME"
        options={TIME_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
        selected={filters.time}
        onToggle={(k) => toggle("time", k)}
      />
      <MultiSelectFilter
        label="LIQUIDITY"
        options={LIQUIDITY_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
        selected={filters.liquidity}
        onToggle={(k) => toggle("liquidity", k)}
      />
      <MultiSelectFilter
        label="VOLUME"
        options={VOLUME_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
        selected={filters.volume}
        onToggle={(k) => toggle("volume", k)}
      />
      {tab === "bonding" && (
        <MultiSelectFilter
          label="FILLED"
          options={PROGRESS_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
          selected={filters.progress}
          onToggle={(k) => toggle("progress", k)}
        />
      )}
      <MultiSelectFilter
        label="LAUNCHPAD"
        options={launchpadOptions}
        selected={filters.launchpads}
        onToggle={(k) => toggle("launchpads", k)}
      />
      {count > 0 && (
        <button
          onClick={() => setFilters(emptyFilters())}
          className="font-mono text-[10px] tracking-[0.1em] text-[#8a8a8a] underline decoration-dotted hover:text-[#ededea]"
        >
          CLEAR ({count})
        </button>
      )}
    </div>
  );
}

/**
 * Launchpad token-page link, resolved from the enabled-launchpads config: a
 * `{token}` URL template first, then the launchpad's website.
 * `launchpad_name`/`launchpad_slug` on the row itself are the provenance of
 * record — they persist even after graduation — this lookup only recovers the
 * *link*, which can go stale if a pad is later disabled.
 *
 * **null when we do not know, never a guess.** This used to fall back to
 * `https://${slug}`, which for a pad shipped without a config produced
 * `https://ponsv2` — not a domain at all. Every Pons V2 card on the Night Market
 * carried it. A slug is an internal key and was never a hostname; treating one
 * as the other is §4's shape in the UI layer, where the invented value is a
 * link the reader is invited to click. No link beats a broken one.
 */
function launchpadUrl(row: LaunchFeedRow, launchpads: LaunchpadLink[]): string | null {
  const slug = row.launchpad_slug?.toLowerCase();
  const pad = slug ? launchpads.find((p) => p.slug.toLowerCase() === slug) : null;
  const template = pad?.config?.tokenUrlTemplate;
  const website = pad?.config?.website;
  if (typeof template === "string" && template.includes("{token}")) {
    return template.replace("{token}", row.token_address);
  }
  if (typeof website === "string" && /^https?:\/\//i.test(website)) return website;
  return null;
}

function dexMarketUrl(row: Pick<LaunchFeedRow, "pool_address" | "token_address">): string {
  const marketId = row.pool_address ?? row.token_address;
  return `https://dexscreener.com/robinhood/${marketId}`;
}

/**
 * The card's one "go look at the market" link, chosen by evidence.
 *
 * `liquidity_usd` is non-null ONLY because DexScreener returned a pair for
 * this token, so the field is direct proof the destination page exists; a
 * measured $0 passes (zero is a measurement, §8.3). Where that proof is
 * absent we link the explorer's token page instead, which always resolves —
 * before this gate, only DIRECT_DEX rows linked to the market and pads with
 * empty config (CashCat, Party) carried no outbound link at all. Never a
 * synthesised URL here: no link beats a broken one (see launchpadUrl).
 */
function venueLink(
  row: Pick<LaunchFeedRow, "source_kind" | "pool_address" | "token_address" | "liquidity_usd">,
  explorerBase: string
): { href: string; label: string } {
  if (row.liquidity_usd !== null) {
    return {
      href: dexMarketUrl(row),
      label: row.source_kind === "DIRECT_DEX" ? "VIEW DIRECT DEX MARKET" : "VIEW DEX MARKET",
    };
  }
  return { href: `${explorerBase}/token/${row.token_address}`, label: "VIEW ON EXPLORER" };
}

/**
 * Card badge, exact wording per the plan's locked decisions. Pump-style
 * (LAUNCHPAD + BONDING_CURVE) cards carry `BONDING CURVE` pre-graduation and
 * `GRADUATED` after. Pons-style (DEX_RESTRICTED) cards carry
 * `DEX LISTED · RESTRICTED`/`DEX LISTED · GRADUATED`. DIRECT_DEX cards carry
 * no launchpad badge — plain venue label only.
 */
function badgeFor(row: LaunchFeedRow): string | null {
  if (row.venue_model === "BONDING_CURVE") {
    return row.lifecycle_state === "GRADUATED" ? "GRADUATED" : "BONDING CURVE";
  }
  /**
   * No graduation word on a DEX_RESTRICTED row. These pads mint straight into a
   * pool and their rows are born GRADUATED — the status is a venue flag, not an
   * event — so "DEX LISTED · GRADUATED" claimed a milestone that never happened
   * on every CashCat and Party card. RESTRICTED still means something (a pool
   * exists but trading is gated), so only the cleared side loses its suffix.
   */
  if (row.venue_model === "DEX_RESTRICTED") {
    return row.lifecycle_state === "GRADUATED" ? "DEX LISTED" : "DEX LISTED · RESTRICTED";
  }
  return null;
}

/**
 * The out-link arrow.
 *
 * `↗` renders at a different weight and baseline in every font on every
 * platform — in the card's Cinzel it sat low and thin against bold caps. An
 * inline SVG inherits `currentColor` and the font size, so it matches whatever
 * button it lands in and stays optically aligned with the label.
 */
function ArrowOut({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`inline-block h-[0.85em] w-[0.85em] shrink-0 align-[-0.05em] ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
    >
      <path d="M4.5 11.5 11.5 4.5" />
      <path d="M5.75 4.5h5.75v5.75" />
    </svg>
  );
}

/**
 * Click-to-copy rendered AS the short form it copies. Writes the FULL
 * lowercase value — a truncated address that looks copied is worse than no
 * button. The clipboard promise rejects on insecure origins and while the
 * document is unfocused, both ordinary states, so rejection is swallowed and
 * the label stays what it was; a card must never throw from a copy click.
 */
function CopyAddress({ value, prefix }: { value: string; prefix?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // clipboard unavailable — show nothing, never throw inside a card
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1_200);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={prefix ? `Copy ${prefix.toLowerCase()} address` : "Copy token address"}
      className={`font-mono text-[10px] tracking-[0.14em] transition-colors ${
        copied ? "text-[#ccff00]" : "text-[#8a8a8a] hover:text-[#ededea]"
      }`}
    >
      {copied ? "COPIED" : `${prefix ? `${prefix} ` : ""}${short(value)}`}
    </button>
  );
}

/**
 * Verdict rosette — the award-ribbon stamp in a card's top-right corner.
 *
 * Rendered ONLY when a verdict exists. There is deliberately no "unscanned"
 * variant: an empty corner reads as "we have not looked", which is true, while
 * any badge at all would read as a result. The card's RUN THE VERDICT button is
 * what an unscanned token gets (§4 — an absent verdict is not a clean one).
 *
 * The pleats are a conic-gradient rather than 24 SVG wedges: it is one paint,
 * scales with the box, and costs nothing on a grid of 60 cards.
 */
function VerdictRosette({ verdict, ownToken }: { verdict: NonNullable<LaunchFeedRow["verdict"]>; ownToken: boolean }) {
  // Our own token is never scored in public (lib/sale/token.ts).
  if (ownToken) return null;
  // Same semantics as TheRecord's inkFor — the guilty end is stamped hardest,
  // and lime stays reserved for CLEAR so the grid can be read at a glance.
  const ink =
    verdict.tier === "CRITICAL"
      ? { ring: "#ededea", text: "#ededea", pleat: "#3a3a3a" }
      : verdict.tier === "DANGER"
        ? { ring: "#8a8a8a", text: "#ededea", pleat: "#333" }
        : verdict.tier === "CAUTION"
          ? { ring: "#8a8a8a", text: "#c7c7c2", pleat: "#2a2a2a" }
          : { ring: "#ccff00", text: "#ccff00", pleat: "#2f3a12" };

  return (
    <Link
      href={`/ledger?v=${verdict.verdict_id}`}
      title={`${verdict.score} ${verdict.tier} — open this record in the Ledger`}
      className="absolute -top-1 right-3 z-10 flex flex-col items-center transition-transform hover:-translate-y-0.5"
    >
      {/* pleated disc */}
      <span
        className="relative flex h-11 w-11 items-center justify-center rounded-full"
        style={{
          background: `repeating-conic-gradient(${ink.pleat} 0deg 7.5deg, #141414 7.5deg 15deg)`,
          border: `1px solid ${ink.ring}`,
        }}
      >
        <span
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#0a0a0a] font-cinzel text-[13px] font-bold leading-none"
          style={{ border: `1px solid ${ink.ring}`, color: ink.text }}
        >
          {verdict.score}
        </span>
      </span>
      {/* tails */}
      <span className="-mt-1 flex gap-[3px]">
        <span
          className="h-3 w-[7px]"
          style={{
            background: ink.pleat,
            clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)",
          }}
        />
        <span
          className="h-3 w-[7px]"
          style={{
            background: ink.pleat,
            clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)",
          }}
        />
      </span>
      <span
        className="mt-0.5 font-mono text-[7px] tracking-[0.1em]"
        style={{ color: ink.text }}
      >
        {verdict.tier}
      </span>
    </Link>
  );
}

/**
 * Icon resolution, three tiers in provenance order: stored metadata pointer
 * in browser img/fetch, explorer icon_url second, DexScreener pair art last.
 * Fallback reaches the noir monogram without retrying or broken-image state.
 */
/**
 * LinkedIn-style shimmer block — a diagonal gradient sweep animated via
 * background-position (globals.css `shimmer` keyframes/`animate-shimmer`),
 * not a plain opacity pulse. Reused for every placeholder line below.
 */
function ShimmerBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer bg-[length:200%_100%] bg-[linear-gradient(90deg,#1c1c1c_25%,#262626_37%,#1c1c1c_63%)] ${className}`}
    />
  );
}

/** Skeleton placeholder mirroring LaunchCard's layout, shown while a tab's first page is in flight. */
function SkeletonCard({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col border border-[#2a2a2a] bg-[#141414] p-5">
      <div className="flex items-center gap-3">
        <ShimmerBlock className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <ShimmerBlock className="h-4 w-24" />
          <ShimmerBlock className="mt-2 h-3 w-32" />
        </div>
      </div>

      <div className="mt-2 flex gap-1.5">
        <ShimmerBlock className="h-4 w-20" />
        <ShimmerBlock className="h-4 w-16" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px border border-[#2a2a2a] bg-[#2a2a2a]">
        <div className="bg-[#141414] px-3 py-2">
          <ShimmerBlock className="h-2.5 w-14" />
          <ShimmerBlock className="mt-2 h-4 w-12" />
        </div>
        <div className="bg-[#141414] px-3 py-2">
          <ShimmerBlock className="h-2.5 w-14" />
          <ShimmerBlock className="mt-2 h-4 w-12" />
        </div>
      </div>

      {tab === "bonding" && (
        <>
          <ShimmerBlock className="mt-4 h-1.5 w-full" />
          <ShimmerBlock className="mt-1 h-3 w-20" />
        </>
      )}

      <ShimmerBlock className="mt-2 h-3 w-28" />

      <div className="mt-4">
        <ShimmerBlock className="h-9 w-full" />
      </div>
    </div>
  );
}

function SkeletonGrid({ tab }: { tab: Tab }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <SkeletonCard key={i} tab={tab} />
      ))}
    </div>
  );
}

function LaunchCard({
  row,
  tab,
  explorerUrl,
  launchpads,
  tradeEnabled,
}: {
  row: LaunchFeedRow;
  tab: Tab;
  explorerUrl: string;
  launchpads: LaunchpadLink[];
  tradeEnabled: boolean;
}) {
  const badge = badgeFor(row);
  const isDirectDex = row.source_kind === "DIRECT_DEX";
  // Every card on the DEX / GRADUATED tab already has a live DEX pool —
  // direct launches by definition, DEX_RESTRICTED (Pons) pads create their
  // pool at launch, and BONDING_CURVE rows only land on this tab once
  // graduated. So the verdict button is keyed off the tab, not one venue
  // model, per the plan's "graduated / dex" cards each exposing RUN THE
  // VERDICT alongside their existing link(s).
  const showVerdict = tab === "dex";
  const pct = row.progress_bps != null ? row.progress_bps / 100 : null;
  // null when the pad has no configured token page — the card then shows no
  // link at all rather than one built out of the slug. See launchpadUrl.
  const padUrl = launchpadUrl(row, launchpads);
  // Always resolves: the DEX market when liquidity_usd proves it exists, the
  // explorer page otherwise. See venueLink.
  const venue = venueLink(row, explorerUrl);
  // A true bond with no pool yet has no DEX liquidity/volume to show at all —
  // "LIQUIDITY $0 / VOL $0" there was a fabricated pair of zeros, not a
  // measurement. Once a pool exists (graduated), it's on the DEX tab with
  // real DexScreener numbers, so this only applies pre-graduation.
  const bonding = isPureBondingCurve(row);

  return (
    <div className="relative flex flex-col border border-[#2a2a2a] bg-[#141414] p-5">
      {row.verdict && <VerdictRosette verdict={row.verdict} ownToken={isOwnToken(row.token_address)} />}
      {/* pr clears the rosette's corner so a long symbol cannot run under it */}
      <div className={`flex items-start justify-between gap-3 ${row.verdict ? "pr-14" : ""}`}>
        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon
            address={row.token_address}
            symbol={row.token_symbol}
            explorerUrl={explorerUrl}
            metadataUri={row.metadata_uri}
          />
          <div className="min-w-0">
            <div className="truncate font-cinzel text-xl font-semibold text-[#ededea]">
              {row.token_symbol ?? "UNKNOWN"}
            </div>
            {row.token_name && row.token_name !== row.token_symbol && (
              <div className="truncate text-xs text-[#8a8a8a]">{row.token_name}</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {badge && (
          <span className="w-fit border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-[#8a8a8a]">
            {badge}
          </span>
        )}
        {/**
          * The pad's NAME is the one chip worth finding at a glance — it is how
          * a reader scans a grid for "the flap ones". Inverted to a white box so
          * it separates from the lifecycle badge beside it, which stays dark.
          * Same padding and type size as before: this is a contrast change, not
          * a size change, and the row must not reflow.
          *
          * Rendered identically on both tabs, so a GRADUATED card's pad reads
          * the same as a BONDING CURVE card's.
          */}
        {row.launchpad_name ? (
          <span className="w-fit border-2 border-[#ededea] bg-[#ededea] px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[#0a0a0a]">
            {row.launchpad_name.toUpperCase()}
          </span>
        ) : (
          isDirectDex && (
            <span className="w-fit border-2 border-[#ededea] bg-[#ededea] px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[#0a0a0a]">
              DIRECT DEX
            </span>
          )
        )}
      </div>

      {/* traction snapshot — native RAISED pre-graduation, liquidity + 24h volume once a pool exists */}
      {bonding ? (
        <div className="mt-4 border border-[#2a2a2a] bg-[#141414] px-3 py-2 font-mono">
          <div className="text-[9px] tracking-[0.14em] text-[#8a8a8a]">RAISED</div>
          <div className="text-sm text-[#ccff00]">
            {rowRaisedDisplay(row)}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-px border border-[#2a2a2a] bg-[#2a2a2a] font-mono">
          <div className="bg-[#141414] px-3 py-2">
            <div className="text-[9px] tracking-[0.14em] text-[#8a8a8a]">LIQUIDITY</div>
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-sm text-[#ccff00]">{usd(row.liquidity_usd)}</span>
              {row.liquidity_pulled && (
                <span
                  title="This pool's liquidity dropped from at least $20K to $0 on two readings in a row."
                  className="rounded border border-[#ff4444]/40 bg-[#ff4444]/10 px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.06em] text-[#ff6f61]"
                >
                  Liquidity pulled
                </span>
              )}
            </div>
          </div>
          <div className="bg-[#141414] px-3 py-2">
            <div className="text-[9px] tracking-[0.14em] text-[#8a8a8a]">VOL 24H</div>
            <div className="text-sm text-[#ededea]">{usd(row.volume_24h_usd)}</div>
          </div>
        </div>
      )}

      {/* bonding-tab progress bar — DB-snapshot only, no live on-chain poll */}
      {tab === "bonding" && pct != null && (
        <>
          <div className="mt-4 h-1.5 w-full bg-[#1c1c1c]">
            <div className="h-full bg-[#ccff00]/80" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="mt-1 font-mono text-[11px] text-[#8a8a8a]">{pct.toFixed(1)}% filled</div>
        </>
      )}

      <div className="mt-2 font-mono text-[11px] text-[#8a8a8a]">
        <CopyAddress value={row.token_address} />
        {row.pool_address && (
          <>
            {" · "}
            <CopyAddress value={row.pool_address} prefix="POOL" />
          </>
        )}
        {" · "}
        {age(row.created_at)} old
      </div>

      {/**
        * Three button colours, one per rank — the DEX tab previously stacked
        * two GREEN buttons, which made the card's primary action unfindable:
        * if everything is emphasised, nothing is.
        *
        *   green  RUN THE VERDICT       our product, and the only green on the card
        *   white  VIEW … DEX MARKET     the token's live venue — shown exactly when
        *                                liquidity_usd proves the page resolves
        *   black  VIEW ON <PAD>         provenance, lowest rank; VIEW ON EXPLORER
        *                                takes this slot when that proof is absent
        *
        * The pad link is black rather than the old hairline grey so it still
        * reads as a button; rank comes from colour, not from taking the border
        * away.
        */}
      <div className="mt-4 flex flex-col gap-2">
        {row.launchpad_name && padUrl && (
          <a
            href={padUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="brutalist-box brutalist-pressable brutalist-shadow-dark inline-flex items-center justify-center gap-1.5 border-[#ededea] bg-[#0a0a0a] py-2.5 text-center font-cinzel text-[11px] font-bold tracking-[0.18em] text-[#ededea]"
          >
            VIEW ON {row.launchpad_name.toUpperCase()}
            <ArrowOut />
          </a>
        )}
        {venue && (
          <a
            href={venue.href}
            target="_blank"
            rel="noopener noreferrer"
            className="brutalist-box brutalist-pressable brutalist-shadow-dark inline-flex items-center justify-center gap-1.5 border-[#0a0a0a] bg-[#ededea] py-2.5 text-center font-cinzel text-[11px] font-bold tracking-[0.18em] text-[#0a0a0a]"
          >
            {venue.label}
            <ArrowOut />
          </a>
        )}
        {showVerdict && (
          <Link
            href={`/scan/${row.token_address}`}
            className="brutalist-box brutalist-pressable brutalist-shadow-dark py-2.5 text-center font-cinzel text-[11px] font-bold tracking-[0.18em] text-[#0a0a0a]"
            style={{ background: "#ccff00", borderColor: "#0a0a0a" }}
          >
            RUN THE VERDICT
          </Link>
        )}
        {tradeEnabled && (
          <TradeLink
            token={row.token_address}
            variant="card"
            signal={row.verdict ? { kind: "verdict", tier: row.verdict.tier } : { kind: "unscanned" }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Background refresh cadence — matches GraduatingSoon's existing live-poll
 * interval (LIVE_REFRESH_MS), so the app doesn't grow a second, different
 * polling rhythm. The server behind /api/launches only ever changes as often
 * as the poll jobs run (5-10 min once cron is on), and page-1 reads within
 * this window are served from a short-TTL server cache (lib/data/
 * launch-candidates.ts), so this interval is cheap even with many open tabs.
 */
const POLL_MS = 30_000;

/**
 * Refresh page 1 in place: update rows that are still in the fresh window
 * (progress/liquidity/lifecycle can all change), prepend anything genuinely
 * new (fresh is already newest-first), and keep whatever the user pulled in
 * via "load more" that has since aged out of page 1 — a poll must never
 * discard pagination progress the user already paid a request for.
 */
/**
 * Merge a poll result into what is on screen.
 *
 * `fresh` is page 1 — newest first — and goes to the top. `refreshed` is the
 * current state of cards that have already scrolled out of page 1 (L35): they
 * keep their existing position and are updated in place, because re-sorting
 * them to the top would reorder the grid under the reader's cursor every 30s.
 *
 * An existing row that appears in NEITHER is dropped. That is deliberate: the
 * by-address read applies the same visibility and expiry filters as page 1, so
 * a row missing from the response has graduated or expired, and keeping the
 * card would be showing a launch that is no longer in the feed.
 */
function mergeFreshPage(
  existing: LaunchFeedRow[],
  fresh: LaunchFeedRow[],
  refreshed: LaunchFeedRow[] = [],
  askedFor: string[] = []
): LaunchFeedRow[] {
  const freshAddresses = new Set(fresh.map((r) => r.token_address));
  const byAddress = new Map(refreshed.map((r) => [r.token_address, r]));
  const asked = new Set(askedFor);

  const rest = existing
    .filter((r) => !freshAddresses.has(r.token_address))
    // Only a row we actually ASKED about can be judged missing. One that was
    // never in the request (past the cap, say) has no verdict either way and
    // must be kept — dropping it would delete cards on a large page.
    .filter((r) => !asked.has(r.token_address) || byAddress.has(r.token_address))
    .map((r) => byAddress.get(r.token_address) ?? r);

  return [...fresh, ...rest];
}

const EMPTY_COPY: Record<Tab, { title: string; body: string }> = {
  bonding: {
    title: "No curves worth watching yet.",
    body: "Nothing on a launchpad has crossed the traction gate. Come back once the fills start moving.",
  },
  dex: {
    title: "The DEX floor is empty.",
    body: "No direct listings or graduates have cleared the bar yet. This is where they land the moment they do.",
  },
};

export function NightMarketTabs({
  initialTab,
  initialRows,
  initialCursor,
  explorerUrl,
  launchpads,
  tradeEnabled,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // Per-tab state so switching back doesn't refetch or lose "load more" progress.
  const [rowsByTab, setRowsByTab] = useState<Record<Tab, LaunchFeedRow[]>>({
    bonding: initialTab === "bonding" ? initialRows : [],
    dex: initialTab === "dex" ? initialRows : [],
  });
  const [cursorByTab, setCursorByTab] = useState<Record<Tab, string | null>>({
    bonding: initialTab === "bonding" ? initialCursor : null,
    dex: initialTab === "dex" ? initialCursor : null,
  });
  // A server-rendered zero-row page is not proof the tab is empty — it's
  // also what a down/misconfigured DB connection looks like (readLaunchFeed
  // degrades to `{ rows: [] }` either way). Only treat the initial tab as
  // "loaded" when it actually came back with rows; an empty SSR result falls
  // through to the mount-effect below, which shows the skeleton and gives the
  // client one real fetch to confirm, instead of asserting "empty" on a read
  // that might just have failed.
  const [loadedByTab, setLoadedByTab] = useState<Record<Tab, boolean>>({
    bonding: initialTab === "bonding" && initialRows.length > 0,
    dex: initialTab === "dex" && initialRows.length > 0,
  });
  const [loading, setLoading] = useState(false);
  // Whether the user has clicked "load more" on a tab — once true, a
  // background poll must stop touching that tab's cursor (it only ever
  // re-fetches page 1) so it can't strand pagination mid-scroll.
  const extendedRef = useRef<Record<Tab, boolean>>({ bonding: false, dex: false });
  // Guards the background poll only — kept separate from `loading` so a
  // silent refresh never flips the visible "LOADING…" state on the button.
  const pollingRef = useRef<Record<Tab, boolean>>({ bonding: false, dex: false });
  // When each tab's rows were last fetched by THIS client. 0 for SSR rows: they
  // come from an ISR snapshot of unknown age, so the poll effect refreshes them
  // immediately instead of waiting a full interval.
  const lastFetchRef = useRef<Record<Tab, number>>({ bonding: 0, dex: 0 });
  /**
   * The rows currently rendered, mirrored into a ref so `fetchTab` can name
   * them (L35) without taking `rowsByTab` as a dependency. Depending on state
   * here would give `fetchTab` a new identity on every row update, which the
   * poll effect depends on — restarting the 30s interval each time and, on a
   * fast-moving feed, meaning it never actually fires.
   */
  const rowsRef = useRef<Record<Tab, LaunchFeedRow[]>>({ bonding: [], dex: [] });
  /** Read by fetchTab, which is a stable callback declared before `filters`
   *  state exists. A ref keeps the poll's identity from changing every time a
   *  checkbox moves, which would restart the interval. */
  const filtersRef = useRef<FilterState>(emptyFilters());

  const fetchTab = useCallback(async (t: Tab, cursor: string | null, mode: "replace" | "append" | "poll") => {
    if (mode !== "poll") setLoading(true);
    try {
      /**
       * L35 — a poll names the cards it is displaying.
       *
       * Page 1 is `created_at desc` and spans about two minutes on this chain,
       * so re-requesting it refreshed nothing the viewer could still see: every
       * card older than that froze on screen until a manual reload. Read from a
       * ref, not from state, so the poll's identity does not change on every
       * row update and restart the interval.
       */
      const displayed = mode === "poll" ? rowsRef.current[t].map((r) => r.token_address) : [];
      const filterQuery = launchFiltersToQuery(toQueryFilters(filtersRef.current));
      const url =
        `/api/launches?tab=${t}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "") +
        (displayed.length ? `&tokens=${displayed.join(",")}` : "") +
        (filterQuery ? `&${filterQuery}` : "");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        rows: LaunchFeedRow[];
        nextCursor: string | null;
        refreshed?: LaunchFeedRow[];
      };
      setRowsByTab((prev) => ({
        ...prev,
        [t]:
          mode === "append"
            ? [...prev[t], ...body.rows]
            : mode === "poll"
              ? mergeFreshPage(prev[t], body.rows, body.refreshed ?? [], displayed)
              : body.rows,
      }));
      // A poll only advances the cursor while the user hasn't paginated past
      // page 1 yet — once they have, their existing cursor is further along
      // than this page-1 fetch could ever tell us.
      if (mode !== "poll" || !extendedRef.current[t]) {
        setCursorByTab((prev) => ({ ...prev, [t]: body.nextCursor }));
      }
      setLoadedByTab((prev) => ({ ...prev, [t]: true }));
      lastFetchRef.current[t] = Date.now();
    } finally {
      if (mode !== "poll") setLoading(false);
    }
  }, []);

  const selectTab = useCallback(
    (t: Tab) => {
      setTab(t);
      // The tab lives in the URL so a reload keeps the view. replaceState, not the
      // router: this page is ISR and must never read searchParams on the server.
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") !== t) {
        url.searchParams.set("tab", t);
        window.history.replaceState(window.history.state, "", url);
      }
      if (!loadedByTab[t]) fetchTab(t, null, "replace");
    },
    [loadedByTab, fetchTab]
  );

  // A zero-row SSR page left the initial tab unconfirmed (see loadedByTab's
  // init above) — the skeleton is already showing, so give it one real
  // client-side fetch rather than sitting on an unconfirmed empty result.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if ((requested === "bonding" || requested === "dex") && requested !== initialTab) {
      selectTab(requested);
      return;
    }
    if (!loadedByTab[initialTab]) fetchTab(initialTab, null, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(() => {
    const cursor = cursorByTab[tab];
    if (!cursor) return;
    extendedRef.current[tab] = true;
    fetchTab(tab, cursor, "append");
  }, [tab, cursorByTab, fetchTab]);

  // Background refresh of the active tab only — the inactive tab's cards
  // don't need to be fresh until the user actually switches to it (selectTab
  // already fetches on first switch). Pauses while the document is hidden so
  // a backgrounded browser tab doesn't keep polling forever.
  useEffect(() => {
    if (!loadedByTab[tab]) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden || pollingRef.current[tab]) return;
      pollingRef.current[tab] = true;
      fetchTab(tab, null, "poll").finally(() => {
        pollingRef.current[tab] = false;
      });
    };

    const interval = setInterval(tick, POLL_MS);
    // Rows older than one interval (always true for ISR rows) refresh now.
    if (Date.now() - lastFetchRef.current[tab] >= POLL_MS) tick();
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tab, loadedByTab, fetchTab]);

  // Filters apply client-side over whatever's already loaded for this tab —
  // "load more" keeps fetching fresh, unfiltered pages from the server, and
  // the filter just narrows what's shown. Shared across tabs (a liquidity
  // filter you set means the same thing whichever tab you're looking at);
  // the FILLED dimension is simply inert outside "bonding" (matchesFilters
  // only checks it when tab === "bonding").
  const [filters, setFilters] = useState<FilterState>(emptyFilters());

  useEffect(() => {
    rowsRef.current = rowsByTab;
  }, [rowsByTab]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  /**
   * A filter change is a new QUERY, not a new view of the rows already held —
   * so it refetches page 1 and drops both tabs' cursors. Skipped on mount,
   * where the initial fetch has already run with no filters.
   */
  const filterKey = launchFiltersToQuery(toQueryFilters(filters));
  const firstFilterRun = useRef(true);
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      return;
    }
    setCursorByTab({ bonding: null, dex: null });
    extendedRef.current = { bonding: false, dex: false };
    setLoadedByTab({ bonding: false, dex: false });
    fetchTab(tab, null, "replace");
    // filterKey is the serialised filter state — a stable string, so this fires
    // once per real change rather than on every Set identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, tab]);

  const rows = rowsByTab[tab];
  /**
   * The server already applied the filter (readLaunchFeed). Re-filtering here
   * would only re-introduce the bug: the old client-side pass narrowed whatever
   * page 1 happened to hold and reported it as the whole answer.
   */
  const filteredRows = rows;
  const nextCursor = cursorByTab[tab];
  const copy = EMPTY_COPY[tab];

  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-cinzel text-2xl tracking-[0.06em] text-[#ededea]">HOT LAUNCHES</h2>
        <span className="font-mono text-[11px] tracking-[0.18em] text-[#8a8a8a]">
          REAL LIQUIDITY · REAL VOLUME
        </span>
      </div>
      <p className="mb-6 max-w-2xl text-xs text-[#8a8a8a]">
        Fresh tokens that have crossed the traction thresholds — genuine depth
        on a live DEX pool, direct launches included. Not the deployment firehose.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {(["bonding", "dex"] as const).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => selectTab(t)}
              className={`border px-4 py-2 text-[11px] tracking-[0.16em] transition-colors ${
                active
                  ? "border-[#ededea] bg-[#ededea] text-[#0a0a0a]"
                  : "border-[#2a2a2a] bg-[#1c1c1c] text-[#8a8a8a] hover:text-[#ededea]"
              }`}
            >
              {t === "bonding" ? "BONDING" : "DEX / GRADUATED"}
            </button>
          );
        })}
      </div>

      {loadedByTab[tab] && (
        <FilterBar tab={tab} filters={filters} setFilters={setFilters} launchpads={launchpads} rows={rows} />
      )}

      {!loadedByTab[tab] ? (
        <SkeletonGrid tab={tab} />
      ) : rows.length === 0 ? (
        <div className="border border-[#2a2a2a] bg-[#141414] px-6 py-24 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-sm.webp"
            alt=""
            className="mx-auto mb-6 h-12 w-12 object-contain opacity-30 grayscale"
          />
          <p className="font-cinzel text-xl tracking-[0.08em] text-[#8a8a8a]">{copy.title}</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-[#8a8a8a]">{copy.body}</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="border border-[#2a2a2a] bg-[#141414] px-6 py-24 text-center">
          <p className="font-cinzel text-xl tracking-[0.08em] text-[#8a8a8a]">No launches match these filters.</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-[#8a8a8a]">
            {rows.length} loaded, none in the selected ranges. Try widening a filter or clearing them.
          </p>
          <button
            onClick={() => setFilters(emptyFilters())}
            className="mx-auto mt-6 block border border-[#2a2a2a] px-6 py-2.5 text-[11px] font-medium tracking-[0.18em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ededea]"
          >
            CLEAR FILTERS
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredRows.map((row) => (
              <LaunchCard
                key={row.token_address}
                row={row}
                tab={tab}
                explorerUrl={explorerUrl}
                launchpads={launchpads}
                tradeEnabled={tradeEnabled}
              />
            ))}
          </div>
          {nextCursor && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loading}
                className="border border-[#2a2a2a] px-6 py-2.5 text-[11px] font-medium tracking-[0.18em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ededea] disabled:opacity-50"
              >
                {loading ? "LOADING…" : "LOAD MORE"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
