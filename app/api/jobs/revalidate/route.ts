import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ISR_ROUTES, prerenderedIsrPaths } from "@/lib/config/isr-paths";
import { reportError } from "@/lib/observability/reporter";
import { requireJobAuth } from "@/lib/security/job-auth";

export const maxDuration = 60;

/**
 * Post-deploy ISR warm-up (CLAUDE.md §5).
 *
 * The image is built with no `DATABASE_URL`, so every prerendered route bakes an
 * empty read as its static snapshot and serves it for up to `revalidate`
 * seconds after each container start. This discards those snapshots once, at
 * deploy time, so the window is closed before a user can see it.
 *
 * Called by `scripts/deploy-remote.sh` after both health gates pass — not
 * earlier: revalidating before the app is healthy would re-render against a
 * database the container cannot reach yet and simply re-poison the entry with a
 * *different* empty read. The list is `lib/config/isr-paths.ts`, pinned by
 * `tests/isr-warmup-coverage.test.ts`.
 *
 *   POST /api/jobs/revalidate
 *   header: x-job-secret: $INTERNAL_JOB_SECRET
 *
 * Not flag-gated. There is no state in which serving a known-stale snapshot is
 * the behaviour we want, so there is nothing to switch off.
 */

/**
 * Two steps, and only the first is required for correctness.
 *
 * `revalidatePath` marks the entry stale; Next re-renders on the NEXT request,
 * so without the fetch the first visitor after a deploy pays the SSR cost and
 * everyone after them gets a cached hit. The fetch just moves that cost off the
 * first real user. It is best-effort on purpose: a failed warm leaves a correct
 * (if slower) route, whereas a failed invalidation leaves a wrong one.
 */
async function warm(origin: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(path, origin), {
      headers: { "user-agent": "robincalls-isr-warmup" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    // Warming is an optimisation; the revalidatePath above already did the
    // load-bearing work. Swallowing here cannot mask a stale page.
    return false;
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;

  const paths = prerenderedIsrPaths();
  const invalidated: string[] = [];

  for (const path of paths) {
    try {
      revalidatePath(path);
      invalidated.push(path);
    } catch (error) {
      // A path that cannot be revalidated is the whole point of this job
      // failing, so it is a reported fault rather than a silent skip.
      await reportError({
        code: "RC_ISR_REVALIDATE_FAILED",
        message: `could not revalidate ${path}`,
        route: "/api/jobs/revalidate",
        operation: "isr.revalidate",
        error,
        details: { path },
        requestOutcome: "degraded",
      });
    }
  }

  // `req.nextUrl.origin` is what the caller reached us on, which inside the
  // compose network is the app container itself — exactly the origin we want to
  // warm, and never an attacker-influenced host, because this route is
  // secret-gated and only ever called by the deploy script.
  const origin = req.nextUrl.origin;
  const warmed = await Promise.all(
    invalidated.map(async (path) => ({ path, ok: await warm(origin, path) }))
  );

  const failedWarms = warmed.filter((w) => !w.ok).map((w) => w.path);
  const incomplete = invalidated.length !== paths.length;

  return NextResponse.json(
    {
      // The deploy script greps this. It is false only when a path we know is
      // exposed to the empty-snapshot bug could not be invalidated.
      ok: !incomplete,
      declared: ISR_ROUTES.length,
      prerendered: paths.length,
      invalidated,
      failedWarms,
    },
    { status: incomplete ? 500 : 200 }
  );
}
