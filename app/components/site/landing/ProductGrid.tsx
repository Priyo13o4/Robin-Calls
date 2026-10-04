import Link from "next/link";
import type { ReactNode } from "react";
import { NavIcon, type NavIconKey } from "../nav-icons";
import { Display, Eyebrow, Standfirst } from "./Section";
import { ProductsRevealSection, ProductsRevealStage } from "./ProductsReveal";
import { compactUsd, scoreColor, shortAddr } from "./format";
import { PRODUCT_ACCENT, tint, type ProductAccentKey } from "./palette";
import { isPureBondingCurve, rowRaisedDisplay } from "@/lib/launches/raised";
import type { LaunchFeedRow } from "@/lib/launches/feed-types";
import type { CanonicalVerdictRow } from "@/lib/data/ledger";
import type { DeployerRow } from "@/lib/types";
import type { RwaPreviewItem } from "./RwaShowcase";
import { isOwnToken } from "@/lib/sale/token";

export interface ProductGridData {
  /** Newest published verdict, or null when nothing has been scanned yet. */
  latestVerdict: CanonicalVerdictRow | null;
  wanted: DeployerRow[];
  nightMarket: LaunchFeedRow[];
  rwa: RwaPreviewItem[];
  rwaTotal: number;
  ecosystemTotal: number;
  ecosystemCategories: number;
}

/**
 * "More than a scan" — the six standalone products, each carrying a live panel
 * from its own surface.
 *
 * **Every figure in every panel is a real read.** The reference comp fills these
 * with round marketing numbers (120+ projects, 6.4K active users, $48.2M volume,
 * "$ALPHA +312%") and not one of them is a measurement this system holds. A
 * fabricated ticker on the landing page of a product that exists to catch
 * fabricated tickers is the worst copy in the building. Where a read comes back
 * empty the panel SAYS so (§4): an empty state is never dressed as a zero.
 *
 * Order is an operator decision, not alphabetical and not the nav's: swap
 * first (the newest product), scan second, then the destinations we want a
 * first visit to discover. The ledger lives in RecordSection further down.
 *
 * Accents label, they never judge (palette.ts). The one exception is the
 * verdict score, which stays binary through `scoreColor` because that is the
 * only polarity the engine actually emits.
 */

interface ProductTile {
  icon: NavIconKey;
  label: string;
  body: string;
  href: string;
  cta: string;
  features: string[];
  core?: boolean;
  badge?: string;
  panel: ReactNode;
}

/** The panel's heading strip. `note` is for a read that came back empty. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3.5 rounded-lg border border-[#242424] bg-[#0d0d0d]/80 p-2.5">
      <p className="mb-2.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-[#6f6f6f]">
        {title}
      </p>
      {children}
    </div>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="font-inter text-[11px] leading-snug text-[#6f6f6f]">{children}</p>;
}

function PanelRow({
  left,
  right,
  rightColor,
}: {
  left: ReactNode;
  right: ReactNode;
  rightColor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="min-w-0 truncate font-inter text-[11px] text-[#c7c7c2]">{left}</span>
      <span
        style={rightColor ? { color: rightColor } : undefined}
        className="shrink-0 font-mono text-[10.5px] text-[#8a8a8a]"
      >
        {right}
      </span>
    </div>
  );
}

// The venues lib/swap plans against (venues.ts), not a marketing list.
const SWAP_VENUES = ["Uniswap", "PancakeSwap", "SushiSwap"];

function tiles(d: ProductGridData): ProductTile[] {
  return [
    {
      icon: "swap",
      label: "Swap",
      body: "Trade any token with its verdict beside the button.",
      href: "/swap",
      cta: "Start trading",
      badge: "NEW",
      features: ["Best route across DEXs", "Simulated before you sign"],
      panel: (
        <Panel title="Routes through">
          <div className="flex flex-wrap gap-1.5">
            {SWAP_VENUES.map((name) => (
              <span key={name} className="rounded border border-[#2a2a2a] bg-[#141414] px-1.5 py-0.5 font-inter text-[10.5px] text-[#c7c7c2]">
                {name}
              </span>
            ))}
          </div>
        </Panel>
      ),
    },
    {
      icon: "scan",
      label: "Scan",
      body: "Instant, evidence-backed risk analysis for any contract.",
      href: "/scan",
      cta: "Scan now",
      core: true,
      features: ["Contract risk analysis", "Honeypot detection"],
      panel: (
        <Panel title="Latest verdict">
          {d.latestVerdict == null ? (
            <PanelEmpty>No verdict published yet.</PanelEmpty>
          ) : (
            <div className="flex items-baseline justify-between gap-3">
              {isOwnToken(d.latestVerdict.token_address) ? (
                <span className="font-cinzel text-[15px] font-black leading-none text-[#ededea]">
                  NOT SCORED
                </span>
              ) : (
                <span
                  style={{ color: scoreColor(d.latestVerdict.tier) }}
                  className="font-cinzel text-[26px] font-black leading-none tabular-nums"
                >
                  {d.latestVerdict.score}
                  <span className="ml-1 font-inter text-[11px] font-normal text-[#6f6f6f]">
                    / 100
                  </span>
                </span>
              )}
              <span className="min-w-0 text-right">
                <span className="block truncate font-cinzel text-[13px] font-bold text-[#ededea]">
                  {d.latestVerdict.token_symbol
                    ? `$${d.latestVerdict.token_symbol}`
                    : shortAddr(d.latestVerdict.token_address)}
                </span>
                <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-[#6f6f6f]">
                  #{d.latestVerdict.id} · {isOwnToken(d.latestVerdict.token_address) ? "OUR TOKEN" : d.latestVerdict.tier}
                </span>
              </span>
            </div>
          )}
        </Panel>
      ),
    },
    {
      icon: "rwa",
      label: "RWAs",
      body: "Verified real-world assets on Robinhood Chain.",
      href: "/rwa",
      cta: "Browse RWAs",
      features: ["Tokenized real assets", "Canonical beacon check"],
      panel: (
        <Panel title={`Registry · ${d.rwaTotal} assets`}>
          {d.rwa.length === 0 ? (
            <PanelEmpty>The registry holds no assets yet.</PanelEmpty>
          ) : (
            d.rwa
              .slice(0, 2)
              .map((r) => (
                <PanelRow
                  key={r.address}
                  left={`${r.asset_name} · $${r.asset_symbol}`}
                  right={compactUsd(r.price_usd)}
                />
              ))
          )}
        </Panel>
      ),
    },
    {
      icon: "night-market",
      label: "Night Market",
      body: "Discover high-signal launches before they graduate.",
      href: "/night-market",
      cta: "Explore",
      features: ["Traction, not deployment", "Curve fill tracking"],
      panel: (
        <Panel title="On the curve now">
          {d.nightMarket.length === 0 ? (
            <PanelEmpty>Nothing has crossed the traction threshold.</PanelEmpty>
          ) : (
            d.nightMarket.slice(0, 2).map((r) => (
              <PanelRow
                key={r.token_address}
                left={r.token_symbol ? `$${r.token_symbol}` : "Unnamed"}
                right={
                  isPureBondingCurve(r)
                    ? rowRaisedDisplay(r)
                    : compactUsd(r.liquidity_usd)
                }
              />
            ))
          )}
        </Panel>
      ),
    },
    {
      icon: "ecosystem",
      label: "Ecosystem",
      body: "Projects, tools and infrastructure building on the chain.",
      href: "/ecosystem",
      cta: "Explore",
      features: ["Reviewed before publishing", "Developer tools"],
      panel: (
        <Panel title="On record">
          {d.ecosystemTotal === 0 ? (
            <PanelEmpty>No published listings yet.</PanelEmpty>
          ) : (
            <div className="flex items-end gap-6">
              <span>
                <span className="block font-cinzel text-[22px] font-black leading-none text-[#ededea]">
                  {d.ecosystemTotal}
                </span>
                <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-[#6f6f6f]">
                  Platforms
                </span>
              </span>
              <span>
                <span className="block font-cinzel text-[22px] font-black leading-none text-[#ededea]">
                  {d.ecosystemCategories}
                </span>
                <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-[#6f6f6f]">
                  Categories
                </span>
              </span>
            </div>
          )}
        </Panel>
      ),
    },
    {
      icon: "wanted",
      label: "Wanted",
      body: "Track repeat offenders across wallets and launches.",
      href: "/wanted",
      cta: "View board",
      features: ["Linked wallets", "Funding lineage"],
      panel: (
        <Panel title="Indicted wallets">
          {d.wanted.length === 0 ? (
            <PanelEmpty>No indicted deployers on record.</PanelEmpty>
          ) : (
            d.wanted
              .slice(0, 2)
              .map((w) => (
                <PanelRow
                  key={w.address}
                  left={shortAddr(w.address)}
                  right={`${w.taken_is_ceiling && w.taken_usd != null ? "up to " : ""}${compactUsd(w.taken_usd)}`}
                />
              ))
          )}
        </Panel>
      ),
    },
  ];
}

export function ProductGrid(data: ProductGridData) {
  return (
    // scroll-mt clears the fixed nav: the click lands on the eyebrow, not under it.
    <ProductsRevealSection className="relative scroll-mt-24 border-t border-[#2a2a2a] bg-[#0a0a0a] px-4 py-11 sm:px-8 sm:py-16">
      <div className="relative z-10 mx-auto max-w-[1320px]">
        <div className="pg-lead">
          <Eyebrow>One ecosystem. A full advantage.</Eyebrow>
          <Display>
            More than a scan.
            <br />
            A complete <span className="text-[#ccff00]">toolkit</span>.
          </Display>
          <Standfirst className="max-w-xl">
            From risk analysis to real-world assets. Everything you need to trade, track and build
            on Robinhood Chain, in one place.
          </Standfirst>
        </div>

        <ProductsRevealStage>
          <div className="grid grid-cols-2 gap-2.5 pt-8 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {tiles(data).map((p, i) => {
              const accent = PRODUCT_ACCENT[p.icon as ProductAccentKey] ?? "#ededea";
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  style={
                    {
                      "--pg-i": i,
                      // The border stays in classNames, never inline: an inline
                      // borderColor outranks the hover rule and the tile would
                      // never light up. The vars carry the hex so the classes
                      // can stay static.
                      "--accent": accent,
                      "--accent-dim": tint(accent, 0.42),
                      "--accent-glow": tint(accent, 0.16),
                    } as React.CSSProperties
                  }
                  className={`pg-card group relative flex flex-col overflow-hidden rounded-xl border bg-[linear-gradient(180deg,#161616_0%,#111111_55%,#0d0d0d_100%)] p-4 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.95)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[0_26px_54px_-20px_var(--accent-glow)] ${
                    p.core
                      ? "border-[#ccff00]/70 hover:border-[#ccff00]"
                      : "border-[#242424] hover:border-[var(--accent-dim)]"
                  }`}
                >
                  {/* The depth cue: an accent bloom seated under the icon,
                      clipped by the card's own rounding. */}
                  <span
                    aria-hidden
                    style={{
                      background: `radial-gradient(60% 100% at 12% 0%, ${tint(accent, 0.16)} 0%, transparent 70%)`,
                    }}
                    className="pointer-events-none absolute inset-x-0 top-0 h-28"
                  />

                  {p.core && (
                    <span className="absolute right-3 top-3 rounded border border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.14em] text-[#8a8a8a]">
                      CORE
                    </span>
                  )}
                  {p.badge && (
                    <span
                      style={{ background: accent }}
                      className="absolute right-3 top-3 rounded px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.14em] text-[#0a0a0a]"
                    >
                      {p.badge}
                    </span>
                  )}

                  <span
                    style={
                      p.core
                        ? { boxShadow: `0 8px 20px -8px ${tint(accent, 0.7)}` }
                        : {
                            borderColor: tint(accent, 0.4),
                            color: accent,
                            background: tint(accent, 0.1),
                            boxShadow: `0 8px 20px -10px ${tint(accent, 0.55)}`,
                          }
                    }
                    className={`relative mb-3.5 flex h-10 w-10 items-center justify-center rounded-lg border ${
                      p.core ? "border-[#ccff00] bg-[#ccff00] text-[#0a0a0a]" : ""
                    }`}
                  >
                    <NavIcon name={p.icon} size={19} />
                  </span>

                  <h3 className="relative mb-1.5 font-cinzel text-[14px] font-bold uppercase tracking-[0.03em] text-[#ededea]">
                    {p.label}
                  </h3>
                  <p className="relative mb-3 font-inter text-[11.5px] leading-[1.45] text-[#8a8a8a]">
                    {p.body}
                  </p>

                  <ul className="relative mb-1 space-y-1.5">
                    {p.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2 font-inter text-[11px] leading-snug text-[#c7c7c2]"
                      >
                        <span
                          aria-hidden
                          style={{ borderColor: tint(accent, 0.5), background: tint(accent, 0.14) }}
                          className="mt-[5px] h-2 w-2 shrink-0 rounded-[2px] border"
                        />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="relative flex-1">{p.panel}</div>

                  <span
                    style={
                      p.core
                        ? undefined
                        : { borderColor: tint(accent, 0.35), color: accent }
                    }
                    className={`relative mt-3.5 block rounded-lg border px-2 py-2.5 text-center font-inter text-[9.5px] font-bold uppercase tracking-[0.12em] transition-colors ${
                      p.core
                        ? "border-[#ccff00] bg-[#ccff00] text-[#0a0a0a]"
                        : "group-hover:border-[var(--accent)]"
                    }`}
                  >
                    {p.cta} →
                  </span>
                </Link>
              );
            })}
          </div>
        </ProductsRevealStage>
      </div>
    </ProductsRevealSection>
  );
}
