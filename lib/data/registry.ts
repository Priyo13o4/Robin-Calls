import { eq, and, asc, inArray, desc } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { listingSlug } from "@/lib/config/slug";
import { directoryPlatforms, registry, marketSnapshots } from "@/lib/db/schema";
import type { DirectoryPlatform } from "@/lib/types";

export function mapDirectoryPlatform(r: typeof directoryPlatforms.$inferSelect): DirectoryPlatform {
  return {
    id: Number(r.id),
    name: r.name,
    slug: r.slug,
    url: r.url,
    description: r.description,
    category: r.category,
    has_mcp: r.hasMcp ?? false,
    has_agent: r.hasAgent ?? false,
    category_details: (r.categoryDetails as Record<string, string | string[] | boolean>) ?? null,
    banner_url: r.bannerUrl ?? null,
    contact: r.contact ?? null,
    status: r.status,
    created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  };
}

/**
 * Process-local TTL cache for published directory listings (CLAUDE.md §5:
 * "Small, hot, tolerant of staleness"). /api/og-proxy calls the URL-list read
 * once PER BANNER — ~20 requests per /ecosystem page view — so leaving that
 * uncached means one full-table scan per card, per visitor. Single-flight so
 * a cold cache under a burst of concurrent banner requests doesn't fan out
 * into N identical reloads (§5's "25-way RPC probe burst" failure mode, same
 * shape, different table).
 *
 * TTL matches the page's own `revalidate = 300` in app/ecosystem/page.tsx —
 * no point caching the row set tighter than the page wrapping it.
 */
const DIRECTORY_TTL_MS = 5 * 60_000;
let directoryCache: { rows: DirectoryPlatform[]; loadedAt: number } | null = null;
let directoryInFlight: Promise<DirectoryPlatform[]> | null = null;

async function loadPublishedPlatforms(): Promise<DirectoryPlatform[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(directoryPlatforms)
    .where(eq(directoryPlatforms.status, "published"))
    .orderBy(asc(directoryPlatforms.name));

  return rows.map(mapDirectoryPlatform);
}

async function publishedPlatformsCached(): Promise<DirectoryPlatform[]> {
  if (directoryCache && Date.now() - directoryCache.loadedAt < DIRECTORY_TTL_MS) {
    return directoryCache.rows;
  }
  if (directoryInFlight) return directoryInFlight;

  const load = loadPublishedPlatforms()
    .then((rows) => {
      directoryCache = { rows, loadedAt: Date.now() };
      return rows;
    })
    .finally(() => {
      if (directoryInFlight === load) directoryInFlight = null;
    });
  directoryInFlight = load;
  return load;
}

/** Admin publish/reject/unpublish must call this — a stale cache would keep
 *  serving a just-rejected listing's banner (or hide a just-approved one) for
 *  up to DIRECTORY_TTL_MS. Pairs with `revalidatePath` (§5: "both required"),
 *  which only busts Next's page cache, not this module-local one. */
export function invalidatePublishedPlatformsCache(): void {
  directoryCache = null;
}

export async function queryPublishedPlatforms(): Promise<DirectoryPlatform[]> {
  return publishedPlatformsCached();
}

export async function getPublishedPlatformById(
  id: number
): Promise<DirectoryPlatform | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(directoryPlatforms)
    .where(and(eq(directoryPlatforms.status, "published"), eq(directoryPlatforms.id, id)))
    .limit(1);

  return rows[0] ? mapDirectoryPlatform(rows[0]) : null;
}

/** The canonical read for /ecosystem/<slug>. Only published rows resolve. */
export async function getPublishedPlatformBySlug(
  slug: string
): Promise<DirectoryPlatform | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(directoryPlatforms)
    .where(and(eq(directoryPlatforms.status, "published"), eq(directoryPlatforms.slug, slug)))
    .limit(1);

  return rows[0] ? mapDirectoryPlatform(rows[0]) : null;
}

export async function insertDirectorySubmission(
  submission: {
    name: string;
    url: string;
    description: string;
    category: string;
    has_mcp: boolean;
    has_agent: boolean;
    category_details?: Record<string, unknown>;
    contact?: string;
    banner_url?: string;
  }
): Promise<{ id: number }> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  /**
   * `slug` is NOT NULL UNIQUE, and two platforms can legitimately submit the
   * same name, so a collision is an expected outcome — not an error to let
   * escape as a 500 on a public form. Retry with a numeric suffix rather than
   * pre-querying for a free slug: the pre-query loses the race anyway, and the
   * constraint is the only thing that actually decides.
   */
  const base = listingSlug(submission.name, 0).replace(/^listing-0$/, "listing");
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const [inserted] = await conn
        .insert(directoryPlatforms)
        .values({
          name: submission.name,
          slug,
          url: submission.url,
          description: submission.description,
          category: submission.category,
          hasMcp: submission.has_mcp,
          hasAgent: submission.has_agent,
          categoryDetails: submission.category_details ?? null,
          contact: submission.contact ?? null,
          bannerUrl: submission.banner_url ?? null,
          status: "pending",
        })
        .returning({ id: directoryPlatforms.id });

      return { id: Number(inserted.id) };
    } catch (err) {
      if (!isSlugCollision(err) || attempt === SLUG_ATTEMPTS - 1) throw err;
    }
  }
  // Unreachable: the loop either returns or rethrows on its last attempt.
  throw new Error("Could not allocate a listing slug.");
}

const SLUG_ATTEMPTS = 25;

/** Postgres 23505 on the slug index specifically — any other violation is a real fault. */
function isSlugCollision(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = e?.code ?? e?.cause?.code;
  const constraint = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && constraint === "directory_platforms_slug_key";
}

export async function queryDirectoryPlatformsByStatus(
  status: "pending" | "published" | "rejected"
): Promise<DirectoryPlatform[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(directoryPlatforms)
    .where(eq(directoryPlatforms.status, status))
    .orderBy(status === "pending" ? directoryPlatforms.createdAt : directoryPlatforms.name);

  return rows.map(mapDirectoryPlatform);
}

export async function updateDirectoryPlatformStatus(
  id: number,
  status: "published" | "rejected" | "pending"
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .update(directoryPlatforms)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(directoryPlatforms.id, id));
}

export async function readRwaBasketTokens(): Promise<Array<{ address: string; asset_symbol: string }>> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select({
      address: registry.address,
      asset_symbol: registry.assetSymbol,
    })
    .from(registry)
    .where(inArray(registry.category, ["stock-token", "etf"]))
    .orderBy(asc(registry.assetSymbol));

  return rows;
}

export async function readCanonicalRegistryData(): Promise<Array<{ asset_name: string; asset_symbol: string; address: string }>> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select({
      asset_name: registry.assetName,
      asset_symbol: registry.assetSymbol,
      address: registry.address,
    })
    .from(registry);

  return rows;
}

export async function upsertRegistryBatch(
  rows: Array<{
    asset_name: string;
    asset_symbol: string;
    address: string;
    category?: string | null;
  }>
): Promise<number> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  const nowIso = new Date().toISOString();

  for (const r of rows) {
    await conn
      .insert(registry)
      .values({
        assetName: r.asset_name,
        assetSymbol: r.asset_symbol,
        address: r.address.toLowerCase(),
        category: r.category ?? null,
        fetchedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: registry.address,
        set: {
          assetName: r.asset_name,
          assetSymbol: r.asset_symbol,
          category: r.category ?? null,
          fetchedAt: nowIso,
        },
      });
  }

  return rows.length;
}

export async function readPublishedDirectoryUrls(): Promise<
  Array<{ url: string; banner_url: string | null }>
> {
  const rows = await publishedPlatformsCached();
  return rows.map((r) => ({ url: r.url, banner_url: r.banner_url ?? null }));
}

export async function readRwaTokenByAddress(
  address: string
): Promise<{ address: string; asset_name: string; asset_symbol: string; category: string; verify_status: string } | null | undefined> {
  const norm = address.toLowerCase();

  const conn = database();
  // Keep an unavailable registry distinct from a completed lookup with no row.
  // The swap planner must not treat an unreadable canonical-RWA registry as a non-RWA.
  if (!conn) return undefined;

  const rows = await conn
    .select({
      address: registry.address,
      asset_name: registry.assetName,
      asset_symbol: registry.assetSymbol,
      category: registry.category,
      verify_status: registry.verifyStatus,
    })
    .from(registry)
    .where(and(eq(registry.address, norm), inArray(registry.category, ["stock-token", "etf"])))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    address: r.address,
    asset_name: r.asset_name,
    asset_symbol: r.asset_symbol,
    category: r.category ?? "",
    verify_status: r.verify_status ?? "ok",
  };
}

export async function readRwaRegistryTokens(): Promise<Array<{ address: string; asset_name: string; asset_symbol: string; category: string; verify_status: string }>> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select({
      address: registry.address,
      asset_name: registry.assetName,
      asset_symbol: registry.assetSymbol,
      category: registry.category,
      verify_status: registry.verifyStatus,
    })
    .from(registry)
    .where(inArray(registry.category, ["stock-token", "etf"]))
    .orderBy(asc(registry.assetSymbol));

  return rows.map((r) => ({
    address: r.address,
    asset_name: r.asset_name,
    asset_symbol: r.asset_symbol,
    category: r.category ?? "",
    verify_status: r.verify_status ?? "ok",
  }));
}

export async function readLatestMarketSnapshot(
  tokenAddress: string
): Promise<{
  price_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  fdv_usd: number | null;
  buys_24h: number | null;
  sells_24h: number | null;
  ts: string | null;
  pool_address: string | null;
} | null> {
  const norm = tokenAddress.toLowerCase();

  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select({
      priceUsd: marketSnapshots.priceUsd,
      liquidityUsd: marketSnapshots.liquidityUsd,
      volume24HUsd: marketSnapshots.volume24HUsd,
      fdvUsd: marketSnapshots.fdvUsd,
      buys24H: marketSnapshots.buys24H,
      sells24H: marketSnapshots.sells24H,
      ts: marketSnapshots.ts,
      poolAddress: marketSnapshots.poolAddress,
    })
    .from(marketSnapshots)
    .where(eq(marketSnapshots.tokenAddress, norm))
    .orderBy(desc(marketSnapshots.ts))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    price_usd: r.priceUsd != null ? Number(r.priceUsd) : null,
    liquidity_usd: r.liquidityUsd != null ? Number(r.liquidityUsd) : null,
    volume_24h_usd: r.volume24HUsd != null ? Number(r.volume24HUsd) : null,
    fdv_usd: r.fdvUsd != null ? Number(r.fdvUsd) : null,
    buys_24h: r.buys24H != null ? Number(r.buys24H) : null,
    sells_24h: r.sells24H != null ? Number(r.sells24H) : null,
    ts: r.ts ? new Date(r.ts).toISOString() : null,
    pool_address: r.poolAddress ?? null,
  };
}

export async function upsertPublishedDirectoryPlatform(platform: {
  name: string;
  slug: string;
  url: string;
  description: string;
  category: string;
  hasMcp?: boolean;
  hasAgent?: boolean;
  categoryDetails?: Record<string, unknown>;
  bannerUrl?: string | null;
}): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  const nowIso = new Date().toISOString();

  await conn
    .insert(directoryPlatforms)
    .values({
      name: platform.name,
      slug: platform.slug,
      url: platform.url,
      description: platform.description,
      category: platform.category,
      hasMcp: platform.hasMcp ?? false,
      hasAgent: platform.hasAgent ?? false,
      categoryDetails: platform.categoryDetails ?? {},
      bannerUrl: platform.bannerUrl ?? null,
      status: "published",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: directoryPlatforms.slug,
      set: {
        name: platform.name,
        url: platform.url,
        description: platform.description,
        category: platform.category,
        hasMcp: platform.hasMcp ?? false,
        hasAgent: platform.hasAgent ?? false,
        categoryDetails: platform.categoryDetails ?? {},
        bannerUrl: platform.bannerUrl ?? null,
        status: "published",
        updatedAt: nowIso,
      },
    });

  invalidatePublishedPlatformsCache();
}
