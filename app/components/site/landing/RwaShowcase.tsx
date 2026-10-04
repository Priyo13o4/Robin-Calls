import Link from "next/link";
import { RwaIcon } from "../RwaPageClient";
import { CopyAddressChip } from "../CopyAddressChip";
import { LandingIcon } from "./icons";
import { Display, Eyebrow, GhostButton, Section, Standfirst } from "./Section";
import { compactCount, compactUsd } from "./format";
import { PRODUCT_ACCENT, tint } from "./palette";
import { rwaCategoryAccent, rwaCategoryLabel } from "@/lib/config/rwa-categories";

export interface RwaPreviewItem {
  address: string;
  asset_name: string;
  asset_symbol: string;
  category: string;
  trusted: boolean;
  price_usd: number | null;
  /** Market cap and FDV are the same figure from this provider — lib/market/rwa-quotes.ts. */
  market_cap_usd: number | null;
  volume_24h_usd: number | null;
  trades_24h: number | null;
}

/**
 * The RWA registry, condensed to a card row.
 *
 * Real data only — every figure is a live provider read (`readRwaQuotes`),
 * because `market_snapshots` is written for SCANNED tokens and holds nothing
 * for 192 of the 194 registry RWAs. `RwaIcon` and `CopyAddressChip` are /rwa's
 * own components, so a token that resolves there resolves here.
 *
 * The comps show a seven-tab category filter. The tabs here are built from the
 * categories actually present in the registry and each one navigates to /rwa:
 * a tab naming a category we hold no rows for is a filter that returns nothing,
 * which is a worse answer than a shorter tab row. No 24h change is rendered for
 * the same reason — `market_snapshots` stores a price, not a delta, and a
 * derived-looking number nobody measured is the failure mode this product
 * exists to call out.
 */
export function RwaShowcase({
  items,
  totalCount,
  categoryCount,
  categories,
  marketComplete,
}: {
  items: RwaPreviewItem[];
  totalCount: number;
  categoryCount: number;
  categories: string[];
  /** False when the market provider did not answer, which is OUR gap and must
   *  not read as "this asset has no market" (CLAUDE.md §8 #9). */
  marketComplete: boolean;
}) {
  const stats = [
    { value: `${totalCount}`, label: "Verified assets" },
    { value: `${categoryCount}`, label: "Categories" },
    { value: "100%", label: "On-chain record" },
  ];

  return (
    <Section>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[270px_1fr]">
        <div>
          <Eyebrow accent={PRODUCT_ACCENT.rwa}>Real-world assets</Eyebrow>
          <Display>Trusted RWAs.</Display>
          <Standfirst>
            Verified real-world assets on Robinhood Chain. Canonical assets, real infrastructure,
            not just tickers.
          </Standfirst>
          <GhostButton href="/rwa" className="mt-5">
            Browse RWAs →
          </GhostButton>

          <div className="mt-6 grid grid-cols-3 gap-4 border-t border-[#2a2a2a] pt-4">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="font-cinzel text-[20px] font-black leading-none text-[#ededea]">
                  {s.value}
                </p>
                <p className="mt-1.5 font-inter text-[10px] uppercase leading-tight tracking-[0.12em] text-[#8a8a8a]">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="border border-[#ccff00] bg-[#141414] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#ccff00]">
                Featured
              </span>
              {categories.map((c) => (
                <Link
                  key={c}
                  href="/rwa"
                  style={{
                    borderColor: tint(rwaCategoryAccent(c), 0.4),
                    color: rwaCategoryAccent(c),
                  }}
                  className="border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-opacity hover:opacity-70"
                >
                  {rwaCategoryLabel(c)}
                </Link>
              ))}
              <Link
                href="/rwa"
                className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a8a8a] transition-colors hover:border-[#8a8a8a] hover:text-[#ededea]"
              >
                All
              </Link>
            </div>
            <Link
              href="/rwa"
              className="font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
            >
              View all →
            </Link>
          </div>

          {items.length === 0 ? (
            <p className="font-inter text-[13px] text-[#8a8a8a]">No verified RWAs on record yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {items.map((r) => (
                <Link
                  key={r.address}
                  href={`/rwa/${r.address}`}
                  /* /rwa's card chrome, minus its `bg-[#141414]/90
                     backdrop-blur-sm`: that pairing is for /rwa's photo
                     backdrop, and here it painted the card EMPTY at mobile
                     widths. `backdrop-filter` inside Lenis's transformed
                     wrapper rasterises blank, and this section's backdrop is
                     flat #0a0a0a, so the blur had nothing to blur either. */
                  className="group brutalist-box brutalist-shadow-dark brutalist-pressable halftone-dark flex flex-col border-2 border-[#2A2A2A] bg-[#141414] transition-colors hover:border-[#CCFF00]"
                >
                  <div
                    style={{ background: tint(rwaCategoryAccent(r.category), 0.08) }}
                    className="flex items-center justify-between gap-2 border-b border-[#2A2A2A] px-3 py-1.5"
                  >
                    <span
                      style={{ color: rwaCategoryAccent(r.category) }}
                      className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em]"
                    >
                      {rwaCategoryLabel(r.category)}
                    </span>
                    {r.trusted && (
                      <span className="flex items-center gap-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[#ccff00]">
                        <LandingIcon name="verified" size={11} /> Verified
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-3">
                    {/* Name beside the symbol, not under it: the name is the
                        thing a reader recognises, so it takes the width and the
                        ticker holds its own column. */}
                    <div className="flex min-w-0 items-center gap-2">
                      <RwaIcon symbol={r.asset_symbol} className="h-8 w-8" />
                      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                        <h3
                          title={r.asset_name}
                          className="line-clamp-3 font-cinzel text-[17px] font-bold leading-tight text-[#ededea] group-hover:text-[#ccff00]"
                        >
                          {r.asset_name}
                        </h3>
                        <span className="shrink-0 font-mono text-[10px] text-[#8a8a8a]">
                          ${r.asset_symbol}
                        </span>
                      </div>
                    </div>

                    <CopyAddressChip address={r.address} compact />

                    <p className="font-mono text-[19px] font-bold leading-none text-[#ededea]">
                      {r.price_usd != null ? `$${r.price_usd.toFixed(2)}` : "—"}
                    </p>

                    {marketComplete ? (
                      <div className="mt-auto grid grid-cols-3 gap-1.5 border-t border-[#2A2A2A] pt-2">
                        {/* One figure, not two: the provider returns fdv and
                            marketCap identical for every RWA here, and two
                            labels over one number invents a distinction. */}
                        <Stat label="Cap / FDV" value={compactUsd(r.market_cap_usd)} />
                        <Stat label="24h vol" value={compactUsd(r.volume_24h_usd)} />
                        <Stat label="24h trades" value={compactCount(r.trades_24h)} />
                      </div>
                    ) : (
                      <p className="mt-auto border-t border-[#2A2A2A] pt-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#8a8a8a]">
                        Market data unavailable
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-inter text-[8px] uppercase tracking-[0.03em] text-[#8a8a8a]">
        {label}
      </p>
      <p className="truncate font-mono text-[11px] text-[#c7c7c2]">{value}</p>
    </div>
  );
}
