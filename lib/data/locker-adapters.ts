import { eq } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { lockerAdapters } from "@/lib/db/schema";

/**
 * A1 (KNOWN-PROBLEMS L58) persistence boundary for `locker_adapters`
 * (migration 0072). Pure DB access only — the process cache/TTL/priming that
 * consumes this lives in `lib/config/locker-adapters.ts`, mirroring the
 * `lockers.ts` / `trusted-addresses.ts` split (CLAUDE.md §1).
 */

export interface LockerAdapterRow {
  address: string;
  family: string;
  label: string;
  enabled: boolean;
}

function mapRow(r: typeof lockerAdapters.$inferSelect): LockerAdapterRow {
  return {
    address: r.address,
    family: r.family,
    label: r.label,
    enabled: r.enabled,
  };
}

export async function enabledLockerAdapters(): Promise<LockerAdapterRow[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn.select().from(lockerAdapters).where(eq(lockerAdapters.enabled, true));
  return rows.map(mapRow);
}
