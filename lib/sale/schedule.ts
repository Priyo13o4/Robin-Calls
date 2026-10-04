import { isDatabaseConfigured } from "@/lib/db/client";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import type { SaleSchedule } from "./schedule-clock";

export type { SaleSchedule } from "./schedule-clock";

/**
 * The sale's announced window, set in /admin/token-sale. Display only: the
 * contract has no clock and opens when the owner calls start(), so these times
 * drive the landing countdown and nothing that moves funds.
 */
export const TOKEN_SALE_STARTS_AT_KEY = "token_sale_starts_at";
export const TOKEN_SALE_ENDS_AT_KEY = "token_sale_ends_at";

const toMs = (v: string | undefined) => {
  const ms = v ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const realDeps = { configured: isDatabaseConfigured, read: readSiteConfigKeys };

export async function readSaleSchedule(deps = realDeps): Promise<SaleSchedule> {
  if (!deps.configured()) return { kind: "unavailable" };
  let keys: Record<string, string | undefined>;
  try {
    keys = await deps.read([TOKEN_SALE_STARTS_AT_KEY, TOKEN_SALE_ENDS_AT_KEY]);
  } catch {
    // Unreachable DB is "we could not look", not "no date set".
    return { kind: "unavailable" };
  }
  return { kind: "read", startsAt: toMs(keys[TOKEN_SALE_STARTS_AT_KEY]), endsAt: toMs(keys[TOKEN_SALE_ENDS_AT_KEY]) };
}

/** The schedule plus the server's clock at read time, the countdown's first frame. */
export async function readSaleClock() {
  const schedule = await readSaleSchedule();
  return { schedule, renderedAt: Date.now() };
}
