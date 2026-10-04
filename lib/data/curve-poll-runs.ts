import { desc, count } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { curvePollRuns } from "@/lib/db/schema";

import { reportError } from "../observability/reporter";

export type CurvePollRunInsert = typeof curvePollRuns.$inferInsert;
export type CurvePollRunSelect = typeof curvePollRuns.$inferSelect;

/**
 * Record one curve-poll tick's execution history and RPC provider usage (plan doc §4).
 * Best-effort write: fails open if DB is unconfigured or write fails.
 */
export async function recordCurvePollRun(
  data: CurvePollRunInsert
): Promise<number | null> {
  const conn = database();
  if (!conn) return null;

  try {
    const inserted = await conn
      .insert(curvePollRuns)
      .values(data)
      .returning({ id: curvePollRuns.id });
    return inserted[0]?.id ?? null;
  } catch (error) {
    // Best-effort telemetry: report error and continue so background job isn't failed
    await reportError({
      code: "RC_CURVE_SYNC_FAILED",
      message: "failed to persist curve_poll_runs row",
      operation: "data.curvePollRuns.recordCurvePollRun",
      error,
    });
    return null;
  }
}

/**
 * Read the most recent curve poll runs for admin diagnostics and telemetry.
 */
export async function readRecentCurvePollRuns(
  limit = 50
): Promise<CurvePollRunSelect[]> {
  const conn = database();
  if (!conn) return [];

  return conn
    .select()
    .from(curvePollRuns)
    .orderBy(desc(curvePollRuns.startedAt))
    .limit(limit);
}

/**
 * Total count of recorded curve-poll runs.
 */
export async function readCurvePollRunsCount(): Promise<number> {
  const conn = database();
  if (!conn) return 0;

  const result = await conn.select({ count: count() }).from(curvePollRuns);
  return result[0]?.count ?? 0;
}
