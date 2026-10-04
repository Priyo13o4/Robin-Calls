import { NextRequest, NextResponse } from "next/server";
import {
  decodeLaunchFeedCursor,
  readLaunchFeed,
  readLaunchFeedCached,
  readLaunchFeedByAddresses,
} from "@/lib/data/launches";
import { LAUNCH_LIFECYCLE } from "@/lib/config/launches";
import { hasAnyFilter, parseLaunchFilters } from "@/lib/config/launch-filters";
import { isDatabaseConfigured } from "@/lib/db/client";
import { resolveLaunchQuotePrices } from "@/lib/launches/quote-prices";

export const dynamic = "force-dynamic";

/** L35 — how many on-screen cards one poll may ask to refresh. The Night Market
 *  shows 30 and grows by 30 per "load more"; 150 covers four pages of scroll
 *  and keeps the `IN (...)` bounded on a public, unauthenticated endpoint. */
const MAX_POLL_ADDRESSES = 150;

/**
 * GET /api/launches?tab=bonding|dex&cursor=<opaque>&limit=<n>&tokens=<csv>
 *
 * Unified hot-launch feed (docs/ways-of-work/plan/tracker/
 * unified-hot-launch-lifecycle/implementation-plan.md, "API Design"). Public,
 * read-only, capped, unexpired rows only. The Night Market consumes this instead
 * of reading curve_tokens directly so a token can never render twice from two
 * sources. (tracked_launches, the pre-unified-feed shortlist, was retired in
 * the curve/lifecycle rebuild's §5.7 table collapse.)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawTab = searchParams.get("tab");
  const tab: "bonding" | "dex" | "all" = rawTab === "dex" ? "dex" : rawTab === "all" ? "all" : "bonding";
  const limit = Math.min(
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? "", 10) || LAUNCH_LIFECYCLE.feedDefaultLimit),
    LAUNCH_LIFECYCLE.feedMaxLimit
  );
  const cursor = decodeLaunchFeedCursor(searchParams.get("cursor"));

  /**
   * `tokens` — the addresses the caller currently has on screen (L35).
   *
   * The feed is ordered newest-first and page 1 spans about two minutes on this
   * chain, so a poll that only re-reads page 1 refreshes nothing a viewer is
   * actually looking at. This lets the poll name its own rows.
   *
   * Validated and capped before it reaches the query: this is a public,
   * unauthenticated endpoint, and an unbounded caller-supplied `IN (...)` is a
   * DB amplification vector (§6). Malformed entries are dropped rather than
   * rejecting the request — a stale card in the list is not worth a 400 that
   * blanks the whole poll.
   */
  const tokens = (searchParams.get("tokens") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^0x[0-9a-f]{40}$/.test(t))
    .slice(0, MAX_POLL_ADDRESSES);

  /**
   * Picker selections, validated here and applied in SQL. Unknown bucket keys
   * are dropped by the parser rather than forwarded.
   */
  const filters = parseLaunchFilters(searchParams);
  const filtered = hasAnyFilter(filters);

  // Page 1 (no cursor) is what every client poll re-requests — served from a
  // short process-local cache so a burst of open Night Market tabs shares one DB
  // read instead of one each (lib/data/launches.ts). Deeper pages are
  // cold and go straight to the DB.
  //
  // A FILTERED page 1 bypasses that cache: the cache key is tab+limit only, so
  // serving a filtered request from it would hand back somebody else's unfiltered
  // page — and caching per filter combination is unbounded by construction.
  let rows: typeof tab extends string ? import("@/lib/launches/feed-types").LaunchFeedRow[] : never = [];
  let nextCursor: string | null = null;
  let refreshed: typeof rows = [];

  let isDegraded = !isDatabaseConfigured();
  try {
    const feed =
      cursor || filtered
        ? await readLaunchFeed(tab, limit, cursor, undefined, filters)
        : await readLaunchFeedCached(tab, limit);
    rows = feed.rows;
    nextCursor = feed.nextCursor;

    if (tokens.length && !cursor) {
      const onPage1 = new Set(rows.map((r) => r.token_address));
      const missing = tokens.filter((t) => !onPage1.has(t));
      if (missing.length) refreshed = await readLaunchFeedByAddresses(tab, missing, filters);
    }
  } catch {
    /* database unreachable -> degrade gracefully to empty rows without throwing 500 */
    isDegraded = true;
  }

  const quotePrices = await resolveLaunchQuotePrices([...rows, ...refreshed]);

  return NextResponse.json(
    { tab, rows, nextCursor, refreshed, quotePrices },
    {
      /**
       * A by-address poll is per-viewer, so a shared CDN entry would serve one
       * viewer's card set to another. Page 1 alone stays cacheable.
       */
      headers: {
        "cache-control": isDegraded
          ? "no-store, max-age=0"
          : tokens.length
          ? "private, no-store"
          : "public, s-maxage=15, stale-while-revalidate=30",
      },
    }
  );
}
