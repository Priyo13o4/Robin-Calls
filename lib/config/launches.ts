/**
 * Launch registry knobs (docs/ways-of-work/plan/launchpad-tracking/ARCHITECTURE.md).
 * Hard, deterministic gates, same philosophy as lib/config/tracker.ts.
 */

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const LAUNCH_LIFECYCLE = {
  /** Night Market label window from the immutable creation time. Locked decision. */
  retentionDays: 7,
  /** GET /api/launches page size cap. */
  get feedMaxLimit() {
    return intEnv("LAUNCH_FEED_MAX_LIMIT", 200);
  },
  get feedDefaultLimit() {
    return intEnv("LAUNCH_FEED_DEFAULT_LIMIT", 100);
  },
} as const;
