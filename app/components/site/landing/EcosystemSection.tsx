import Link from "next/link";
import { categoryLabel } from "@/lib/config/ecosystem";
import { Display, Eyebrow, GhostButton, Section, Standfirst } from "./Section";
import { PRODUCT_ACCENT, tint } from "./palette";
import { SmartImage } from "../SmartImage";

export interface EcosystemPreviewItem {
  slug: string;
  name: string;
  category: string;
  description: string | null;
  banner_url: string;
  has_agent: boolean;
}

export interface EcosystemCategoryCount {
  category: string;
  count: number;
}

/**
 * "Built on Robinhood Chain" — the directory, condensed to one band.
 *
 * Two halves because neither answers the question alone: the counts say how
 * much is here (40 platforms is the point, and a four-card row hides it), and
 * the cards say what any of it looks like.
 *
 * Every count is a real `GROUP BY` over published rows, so a category with no
 * listings simply does not appear rather than rendering a zero. The cards are
 * the rows that declared `banner_url`, newest first (operator call: a card with
 * real art reads as intentional, and there is no featured/ranking column on
 * `directory_platforms` to sort by instead).
 *
 * `banner_url` is rendered directly rather than through `PlatformBanner`. That
 * component discovers art live via /api/og-proxy on mount, which is right for a
 * detail page and wrong for the busiest page on the site: four cards would be
 * four proxy requests per visit. These rows already carry a stored URL and are
 * `status = 'published'`, so the art is the reviewed value.
 */
export function EcosystemSection({
  items,
  categories,
  totalCount,
}: {
  items: EcosystemPreviewItem[];
  categories: EcosystemCategoryCount[];
  totalCount: number;
}) {
  const accent = PRODUCT_ACCENT.ecosystem;

  return (
    <Section backdrop="/backgrounds/library-directory-bg.webp">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <Eyebrow accent={accent}>The ecosystem</Eyebrow>
          <Display>Built on Robinhood Chain.</Display>
          <Standfirst>
            {totalCount} platforms on record. Launchpads, exchanges, wallets and the tools around
            them. Every listing is reviewed before it is published.
          </Standfirst>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/ecosystem#submit"
            className="font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
          >
            List your project →
          </Link>
          <GhostButton href="/ecosystem">Explore ecosystem →</GhostButton>
        </div>
      </div>

      {/* Counts, not logos: the breadth is the claim this strip makes. */}
      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Link
              key={c.category}
              href="/ecosystem"
              style={{ borderColor: tint(accent, 0.32) }}
              className="flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
            >
              <span style={{ color: accent }} className="font-bold">
                {c.count}
              </span>
              {categoryLabel(c.category)}
            </Link>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="font-inter text-[13px] text-[#8a8a8a]">No published platforms yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((p) => (
            <Link
              key={p.slug}
              href={`/ecosystem/${p.slug}`}
              style={{ ["--accent-dim" as string]: tint(accent, 0.5) } as React.CSSProperties}
              className="group flex flex-col border border-[#2a2a2a] bg-[#141414] transition-colors hover:border-[var(--accent-dim)]"
            >
              <div className="relative h-[104px] w-full overflow-hidden border-b border-[#2a2a2a] bg-[#1c1c1c]">
                <SmartImage
                  src={p.banner_url}
                  alt=""
                  aria-hidden
                  className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                />
                <span
                  style={{ color: accent, background: "rgba(10,10,10,0.82)" }}
                  className="absolute left-2 top-2 border border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.14em]"
                >
                  {categoryLabel(p.category)}
                </span>
                {p.has_agent && (
                  <span className="absolute right-2 top-2 border border-[#2a2a2a] bg-[#0a0a0a]/85 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-[#ccff00]">
                    Agent ready
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col p-3">
                <h3 className="truncate font-cinzel text-[15px] font-bold text-[#ededea] group-hover:text-[#ccff00]">
                  {p.name}
                </h3>
                {p.description && (
                  <p className="mt-1.5 line-clamp-2 font-inter text-[11.5px] leading-[1.45] text-[#8a8a8a]">
                    {p.description}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}
