import { eq } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { launchFactories } from "@/lib/db/schema";

/**
 * A2 (KNOWN-PROBLEMS L58) persistence boundary for `launch_factories`
 * (migration 0073). Pure DB access only — the process cache/TTL/priming that
 * consumes this lives in `lib/config/launch-factories.ts`, mirroring the
 * `locker-adapters.ts` split (CLAUDE.md §1).
 */

export interface LaunchFactoryRow {
  address: string;
  label: string;
  enabled: boolean;
}

function mapRow(r: typeof launchFactories.$inferSelect): LaunchFactoryRow {
  return {
    address: r.address,
    label: r.label,
    enabled: r.enabled,
  };
}

export async function enabledLaunchFactories(): Promise<LaunchFactoryRow[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn.select().from(launchFactories).where(eq(launchFactories.enabled, true));
  return rows.map(mapRow);
}
