/**
 * The registry of every route that declares `export const revalidate`, and
 * whether Next actually prerenders it.
 *
 * Why this file exists: `Dockerfile.prod` builds with no `DATABASE_URL` (the
 * `.dockerignore` excludes `.env*` and the DB container does not exist yet), so
 * `database()` returns null and every repository function returns its documented
 * empty value. A prerendered route bakes that empty read in as its static
 * snapshot and serves it — regardless of what Postgres actually holds — until
 * the first request after `revalidate` seconds triggers a background render.
 * Verified 2026-08-17 on `/ecosystem`: 20 real rows, "THE INDEX IS BEING BUILT"
 * for a full 5 minutes after every container start.
 *
 * `force-dynamic` was proposed and rejected: it does not just skip the build
 * freeze, it opts the route out of response caching entirely — full SSR on every
 * request, forever, to fix a few minutes after each deploy. The fix is instead
 * to discard the poisoned snapshot once, at deploy time — see
 * `app/api/jobs/revalidate/route.ts`.
 *
 * GROUND TRUTH is `.next/prerender-manifest.json` after a build, NOT the
 * presence of a `revalidate` export. The two disagree today: `/ledger` exports
 * `revalidate = 60` and is still rendered on demand, because it awaits
 * `searchParams`. `tests/isr-warmup-coverage.test.ts` pins every declaring route
 * to an entry here so a new one cannot be added without being classified.
 */

export interface IsrRoute {
  /** URL path, as it appears in `.next/prerender-manifest.json`. */
  path: string;
  /** The value of the route's `export const revalidate`, in seconds. */
  revalidateSeconds: number;
  /** Repo-relative source file, so the test can find the declaration. */
  source: string;
  /**
   * True when Next prerenders this at build time — i.e. it is exposed to the
   * empty-snapshot bug and the warm-up must revalidate it.
   *
   * False means the `revalidate` export is inert. Say why in `dynamicReason`:
   * an inert cache directive is dead config, and dead config is what this repo
   * keeps getting bitten by.
   */
  prerendered: boolean;
  /** Required when `prerendered` is false. What forces on-demand rendering. */
  dynamicReason?: string;
}

/**
 * Confirmed against `.next/prerender-manifest.json` on 2026-08-23, plus two
 * added since by reasoning rather than a manifest read: "/" and "/tokenomics".
 *
 * The build bakes more than empty DB reads. `.dockerignore` excludes `.env*`,
 * so a prerendered route also freezes whatever `process.env` said at BUILD
 * time. /tokenomics is the case: no DB read at all, but it branches on
 * `flags.tokenSale`, which lives in .env.production on the VPS and is absent
 * from the build.
 */
export const ISR_ROUTES: IsrRoute[] = [
  { path: "/", revalidateSeconds: 60, source: "app/page.tsx", prerendered: true },
  { path: "/api/stats", revalidateSeconds: 60, source: "app/api/stats/route.ts", prerendered: true },
  { path: "/ecosystem", revalidateSeconds: 300, source: "app/ecosystem/page.tsx", prerendered: true },
  { path: "/wanted", revalidateSeconds: 300, source: "app/wanted/page.tsx", prerendered: true },
  { path: "/night-market", revalidateSeconds: 120, source: "app/night-market/page.tsx", prerendered: true },
  { path: "/tokenomics", revalidateSeconds: 60, source: "app/tokenomics/page.tsx", prerendered: true },

  {
    path: "/ledger",
    revalidateSeconds: 60,
    source: "app/ledger/page.tsx",
    prerendered: false,
    dynamicReason:
      "awaits searchParams (?token, ?v), which opts the route out of static generation — the revalidate export has no effect",
  },
  // Dynamic segments with no generateStaticParams are never prerendered: Next
  // has no parameter list to build from, so the first request renders live and
  // only then caches. They cannot bake a build-time empty read.
  {
    path: "/ecosystem/[slug]",
    revalidateSeconds: 300,
    source: "app/ecosystem/[slug]/page.tsx",
    prerendered: false,
    dynamicReason: "dynamic segment with no generateStaticParams",
  },
  {
    // Legacy /directory/<id> → /ecosystem/<slug>. Kept so the rename costs
    // nothing already earned; it reads one row and 301s.
    path: "/directory/[id]",
    revalidateSeconds: 300,
    source: "app/directory/[id]/page.tsx",
    prerendered: false,
    dynamicReason: "dynamic segment with no generateStaticParams",
  },
  {
    path: "/wanted/[deployer]",
    revalidateSeconds: 300,
    source: "app/wanted/[deployer]/page.tsx",
    prerendered: false,
    dynamicReason: "dynamic segment with no generateStaticParams",
  },
  {
    path: "/api/og/[id]",
    revalidateSeconds: 3600,
    source: "app/api/og/[id]/route.tsx",
    prerendered: false,
    dynamicReason: "dynamic segment with no generateStaticParams",
  },
];

/** The routes the deploy warm-up must invalidate. */
export function prerenderedIsrPaths(): string[] {
  return ISR_ROUTES.filter((r) => r.prerendered).map((r) => r.path);
}

/**
 * The longest window a stale build-time snapshot could survive if the warm-up
 * never ran. Surfaced on the capacity dashboard so "the deploy hook is broken"
 * is a number someone can see rather than a silence.
 */
export function worstCaseStaleSeconds(): number {
  return ISR_ROUTES.filter((r) => r.prerendered).reduce(
    (max, r) => Math.max(max, r.revalidateSeconds),
    0
  );
}
