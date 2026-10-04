import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { NoirShell } from "../../components/site/NoirShell";
import { PlatformBanner } from "../../components/site/PlatformBanner";
import { getPublishedPlatformBySlug, getPublishedPlatformById, queryPublishedPlatforms } from "@/lib/data/registry";
import { COMMON_FIELDS, categoryDef, categoryLabel } from "@/lib/config/ecosystem";
import type { DirectoryPlatform } from "@/lib/types";
import { SLUG_PATTERN } from "@/lib/config/slug";
import { SITE_URL } from "@/lib/config/site";
import { cdnUrl } from "@/lib/config/cdn";
import { SmartImage } from "@/app/components/site/SmartImage";

/**
 * /ecosystem/[slug] — full listing detail. Everything a platform declared at
 * submission (and survived review) is laid out here; the card grid shows only
 * the highlights. Only published rows resolve — pending/rejected 404.
 *
 * **This page is the SEO surface.** The reason it is keyed by slug rather than
 * by row id is that "flap.sh robinhood chain" has to be able to reach it, and a
 * numeric id carries no keyword at all. Everything below that looks like
 * ceremony — the canonical, the breadcrumb, the JSON-LD — is what lets an
 * aggregator page outrank the thing it aggregates.
 */

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function loadPlatform(slug: string): Promise<DirectoryPlatform | null> {
  if (!SLUG_PATTERN.test(slug) || slug.length > 96) return null;
  return getPublishedPlatformBySlug(slug);
}

/**
 * Fuzzy alias resolver for common search variants (e.g. "ponsfamily" -> "pons").
 * Enables 301 permanent redirects so search engines consolidate ranking equity.
 */
async function resolvePlatformAlias(slug: string): Promise<string | null> {
  const norm = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm) return null;

  // 1. Direct manual alias overrides
  const ALIAS_MAP: Record<string, string> = {
    ponsfamily: "pons",
    ponsfamilycom: "pons",
    ponsfam: "pons",
    flapsex: "flap",
  };
  if (ALIAS_MAP[norm]) return ALIAS_MAP[norm];

  // 2. Dynamic lookup against published platforms
  try {
    const all = await queryPublishedPlatforms();
    for (const item of all) {
      if (item.slug === norm) return item.slug;
      try {
        const hostname = new URL(item.url).hostname.replace(/^www\./, "");
        const hostClean = hostname.replace(/[^a-z0-9]/g, "");
        if (hostClean === norm) return item.slug;
        const rootDomain = hostname.split(".")[0]?.replace(/[^a-z0-9]/g, "");
        if (rootDomain && rootDomain === norm) return item.slug;
      } catch {}
      const nameClean = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (nameClean === norm) return item.slug;
    }
  } catch {}

  return null;
}

async function idFallbackSlug(segment: string): Promise<string | null> {
  if (!/^[0-9]{1,15}$/.test(segment)) return null;
  const byId = await getPublishedPlatformById(Number(segment));
  return byId?.slug ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  let p = await loadPlatform(slug);
  if (!p) {
    const aliasSlug = await resolvePlatformAlias(slug);
    if (aliasSlug) p = await loadPlatform(aliasSlug);
  }
  if (!p) return { title: "The Ecosystem | RobinCalls" };

  const def = categoryDef(p.category);
  const catName = def?.label ?? categoryLabel(p.category);

  let hostDomain = "";
  let cleanDomain = "";
  try {
    hostDomain = new URL(p.url).hostname.replace(/^www\./, "");
    cleanDomain = hostDomain.replace(/\.[a-z]+$/, "");
  } catch {}

  const domainSuffix =
    hostDomain && !p.name.toLowerCase().includes(cleanDomain.toLowerCase())
      ? ` (${hostDomain})`
      : "";

  const title = `${p.name}${domainSuffix}: ${catName} on Robinhood Chain | RobinCalls`;
  const listed = p.description?.trim().replace(/\s*—\s*/g, ": ");
  const description =
    listed && listed.length >= 50
      ? listed
      : `${p.name}${domainSuffix} is a ${catName.toLowerCase()} project on Robinhood Chain (chain 4663). What it does, its contracts and its links, on RobinCalls.`;
  const url = `${SITE_URL}/ecosystem/${p.slug}`;

  return {
    title,
    description,
    alternates: { canonical: `/ecosystem/${p.slug}` },
    keywords: [
      p.name,
      ...(hostDomain ? [hostDomain, cleanDomain, `${cleanDomain} robinhood`, `${cleanDomain} launchpad`] : []),
      `${p.name} Robinhood Chain`,
      `${p.name} crypto`,
      "robinhood chain dapps",
      "Robinhood Chain ecosystem",
      "Robinhood Chain",
      catName,
      "chain 4663",
      "Robinhood L2",
    ],
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: "RobinCalls",
      images: p.banner_url
        ? [{ url: p.banner_url, alt: p.name }]
        : [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [p.banner_url || "/brand/og-default.jpg"],
    },
  };
}

/**
 * Structured data: Breadcrumbs + WebPage + Organization.
 */
function structuredData(p: DirectoryPlatform) {
  const url = `${SITE_URL}/ecosystem/${p.slug}`;
  const def = categoryDef(p.category);
  const catName = def?.label ?? categoryLabel(p.category);

  let hostDomain = "";
  try {
    hostDomain = new URL(p.url).hostname.replace(/^www\./, "");
  } catch {}

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "RobinCalls", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Ecosystem", item: `${SITE_URL}/ecosystem` },
          { "@type": "ListItem", position: 3, name: p.name, item: url },
        ],
      },
      {
        "@type": "WebPage",
        "@id": url,
        url,
        name: `${p.name} — ${catName} on Robinhood Chain`,
        description: p.description ?? undefined,
        isPartOf: { "@type": "WebSite", name: "RobinCalls", url: SITE_URL },
        about: {
          "@type": "Organization",
          name: p.name,
          alternateName: hostDomain ? [hostDomain, hostDomain.replace(/\.[a-z]+$/, "")] : undefined,
          url: p.url,
          sameAs: [p.url],
          description: p.description ?? undefined,
          ...(p.banner_url ? { image: p.banner_url } : {}),
        },
      },
    ],
  };
}

function detailRows(p: DirectoryPlatform): Array<[string, string]> {
  const def = categoryDef(p.category);
  const details = p.category_details ?? {};
  const rows: Array<[string, string]> = [];
  for (const f of [...(def?.fields ?? []), ...COMMON_FIELDS]) {
    const v = details[f.key];
    if (v == null) continue;
    rows.push([f.label, Array.isArray(v) ? v.join(" · ") : v === true ? "YES" : String(v)]);
  }
  return rows;
}

export default async function PlatformDetailPage({ params }: PageProps) {
  const { slug } = await params;
  let p = await loadPlatform(slug);
  if (!p) {
    const aliasSlug = await resolvePlatformAlias(slug);
    if (aliasSlug && aliasSlug !== slug) {
      permanentRedirect(`/ecosystem/${aliasSlug}`);
    }
    const canonicalSlug = await idFallbackSlug(slug);
    if (canonicalSlug) permanentRedirect(`/ecosystem/${canonicalSlug}`);
    notFound();
  }

  const def = categoryDef(p.category);
  const rows = detailRows(p);
  const allPlatforms = await queryPublishedPlatforms();
  const related = allPlatforms
    .filter((item) => item.category === p.category && item.slug !== p.slug)
    .slice(0, 3);

  let hostDomain = "";
  try {
    hostDomain = new URL(p.url).hostname.replace(/^www\./, "");
  } catch {
    hostDomain = p.url;
  }

  return (
    <NoirShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(p)) }}
      />
      <div className="relative min-h-screen w-full bg-[#0a0a0a]">
        {/* Background texture & ambient glow */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/library-directory-bg.webp")}
            alt=""
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-40 mix-blend-luminosity"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.85) 20%, rgba(10,10,10,0.85) 80%, #0A0A0A 100%)",
            }}
          />
        </div>

        <div className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
          {/* Navigation Breadcrumb */}
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-[#8a8a8a]">
            <Link
              href="/ecosystem"
              className="flex items-center gap-1.5 transition-colors hover:text-[#ccff00]"
            >
              <span>← THE ECOSYSTEM</span>
            </Link>
            <span className="text-[#3d3d3d]">/</span>
            <span className="text-[#6a6a6a] uppercase">{def?.label ?? p.category}</span>
            <span className="text-[#3d3d3d]">/</span>
            <span className="text-[#ededea] font-bold">{p.name}</span>
          </div>

          {/* Main Showcase Profile Card */}
          <div className="lime-marble-glass group relative mt-6 overflow-hidden border border-[#2a2a2a] bg-[#141414] shadow-2xl">
            {/* Background card texture */}
            <SmartImage
              src={cdnUrl("/backgrounds/card-bg.webp")}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-screen"
            />

            {/* Banner Section */}
            <div className="relative z-10">
              <PlatformBanner url={p.url} className="h-52 sm:h-72 lg:h-80" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent opacity-90" />
            </div>

            {/* Platform Profile Body */}
            <div className="relative z-10 p-6 sm:p-10">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="border border-[#ccff00]/60 bg-[#0a0a0a]/90 px-2 py-0.5 font-mono text-[10px] font-bold text-[#ccff00] uppercase tracking-wider">
                      VERIFIED ON ROBINHOOD CHAIN
                    </span>
                    <span className="font-mono text-[10px] text-[#8a8a8a]">
                      CHAIN ID 4663
                    </span>
                  </div>

                  <h1 className="font-cinzel text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[#ededea]">
                    {p.name}
                  </h1>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="border border-[#2a2a2a] bg-[#0a0a0a]/90 px-2.5 py-1 font-mono text-[11px] tracking-wider text-[#ededea] uppercase">
                      {def ? `${def.emoji} ${def.label}` : p.category}
                    </span>
                    {p.has_mcp && (
                      <span className="border border-[#ccff00]/60 bg-[#0a0a0a]/90 px-2.5 py-1 font-mono text-[11px] font-bold text-[#ccff00]">
                        ⚡ MCP READY
                      </span>
                    )}
                    {p.has_agent && (
                      <span className="border border-[#2a2a2a] bg-[#0a0a0a]/90 px-2.5 py-1 font-mono text-[11px] text-[#ededea]">
                        🤖 AGENT API
                      </span>
                    )}
                  </div>
                </div>

                {/* Primary CTA button */}
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="brutalist-box brutalist-shadow-dark brutalist-pressable flex items-center justify-center gap-2.5 bg-[#ccff00] border-[#ccff00] px-6 py-3.5 font-inter text-xs font-bold uppercase tracking-[0.18em] text-[#0a0a0a] transition-transform hover:scale-[1.02] cursor-pointer"
                  >
                    <span>LAUNCH PLATFORM</span>
                    <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Detailed Overview */}
              <div className="mt-8 border-t border-[#2a2a2a] pt-8">
                <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-[#8a8a8a]">
                  PLATFORM OVERVIEW
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-relaxed text-[#d4d4d0]">
                  {p.description ||
                    `${p.name} is an active decentralized ${def?.label.toLowerCase() ?? "ecosystem"} protocol deployed on Robinhood Chain (Chain ID 4663), providing high-throughput infrastructure and liquidity for on-chain users and AI agents.`}
                </p>
              </div>

              {/* Technical Specifications Grid */}
              <div className="mt-10">
                <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-[#8a8a8a]">
                  NETWORK & TECHNICAL SPECIFICATIONS
                </h2>
                <div className="mt-4 grid grid-cols-1 gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-2 lg:grid-cols-3">
                  <div className="bg-[#141414] p-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6a6a6a] block">
                      Target Network
                    </span>
                    <span className="mt-1 font-mono text-sm font-bold text-[#ededea] block">
                      Robinhood Chain
                    </span>
                    <span className="font-mono text-[10px] text-[#8a8a8a]">
                      Chain ID 4663 (Arbitrum Nitro L2)
                    </span>
                  </div>

                  <div className="bg-[#141414] p-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6a6a6a] block">
                      Official Domain
                    </span>
                    <span className="mt-1 font-mono text-sm font-bold text-[#ccff00] block truncate">
                      {hostDomain}
                    </span>
                    <span className="font-mono text-[10px] text-[#8a8a8a]">
                      Verified SSL Origin
                    </span>
                  </div>

                  <div className="bg-[#141414] p-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6a6a6a] block">
                      Integration Status
                    </span>
                    <span className="mt-1 font-mono text-sm font-bold text-[#ededea] block">
                      Production Live
                    </span>
                    <span className="font-mono text-[10px] text-[#8a8a8a]">
                      Indexed in RobinCalls Ledger
                    </span>
                  </div>

                  {rows.map(([label, value]) => (
                    <div key={label} className="bg-[#141414] p-4">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6a6a6a] block">
                        {label}
                      </span>
                      <span className="mt-1 font-mono text-sm text-[#ededea] block break-words">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Verified Badge / Disclaimer */}
              <div className="mt-10 flex flex-col gap-2 rounded border border-[#2a2a2a]/80 bg-[#0a0a0a]/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center border border-[#ccff00]/40 bg-[#ccff00]/10 text-[#ccff00] font-bold text-xs">
                    ✓
                  </div>
                  <div>
                    <span className="font-mono text-[11px] font-bold text-[#ededea] block">
                      RobinCalls Authenticity Verification
                    </span>
                    <span className="font-mono text-[10px] text-[#8a8a8a] block">
                      Metadata reviewed and indexed for Robinhood Chain. Not financial or investment advice.
                    </span>
                  </div>
                </div>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-[#ccff00] hover:underline whitespace-nowrap self-start sm:self-auto"
                >
                  Visit {hostDomain} ↗
                </a>
              </div>
            </div>
          </div>

          {/* Related Category Platforms */}
          {related.length > 0 && (
            <div className="mt-16">
              <div className="flex items-center justify-between border-b border-[#2a2a2a] pb-4">
                <div>
                  <h3 className="font-cinzel text-xl font-bold text-[#ededea]">
                    EXPLORE MORE {def?.label.toUpperCase() ?? p.category} PLATFORMS
                  </h3>
                  <p className="mt-1 font-mono text-[11px] text-[#8a8a8a]">
                    Other verified protocols building on Robinhood Chain
                  </p>
                </div>
                <Link
                  href="/ecosystem"
                  className="font-mono text-[11px] text-[#ccff00] hover:underline"
                >
                  VIEW ALL →
                </Link>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((rel) => (
                  <Link
                    key={rel.slug}
                    href={`/ecosystem/${rel.slug}`}
                    className="lime-marble-glass group relative flex flex-col overflow-hidden border border-[#2a2a2a] bg-[#141414] transition-all hover:border-[#ccff00] hover:scale-[1.02]"
                  >
                    <PlatformBanner url={rel.url} className="h-32" />
                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-[#8a8a8a]">
                          {def?.label ?? rel.category}
                        </span>
                        <h4 className="mt-1 font-cinzel text-base font-bold text-[#ededea] group-hover:text-[#ccff00] transition-colors">
                          {rel.name}
                        </h4>
                        <p className="mt-2 text-xs text-[#8a8a8a] line-clamp-2 leading-relaxed">
                          {rel.description}
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#2a2a2a]/60 flex items-center justify-between font-mono text-[10px] text-[#ccff00]">
                        <span>VIEW PROFILE</span>
                        <span>→</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </NoirShell>
  );
}
