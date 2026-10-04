// Via ./blockscout (which re-exports the router) rather than ./router directly:
// that is the seam every other consumer and every test mocks, and importing
// past it silently escapes those mocks.
import { explorer } from "./blockscout";
import { readAddressInfoCache, writeAddressInfoCache } from "../data/explorer-address-cache";
import { recordExplorerDedupe } from "../observability/context";
import type { ExplorerAddressInfo } from "./types";

/**
 * `/addresses/:id`, read through a bounded durable cache (migration 0047).
 *
 * WHY: measured on prod 2026-08-02, this single call costs 3.0-5.6s of wire
 * time and is the LONGEST read in pipeline.ts's opening `Promise.all`. Because
 * that block runs concurrently, the slowest member sets the floor for the whole
 * gather — so this one call, on its own, is several seconds of every scan.
 *
 * WHAT MAY GO STALE, STATED PLAINLY: most of the payload is immutable for a
 * deployed contract (is_contract, creation_tx_hash, creator_address_hash), but
 * `is_scam` and `public_tags` are not, and they feed `checkExplorerScamFlag` —
 * a CRITICAL check. A cache hit can therefore miss a scam tag raised within the
 * TTL. That is a bounded, deliberate trade: Blockscout's scam tags are
 * human-curated and lag the underlying event by days, so an hour of cache adds
 * little on top of the source's own latency. `EXPLORER_ADDRESS_INFO_TTL_MINUTES`
 * exists so this can be cut to 0 — disabling the cache entirely — without a
 * deploy, the moment that judgement stops holding.
 *
 * A FAULT IS NEVER CACHED (CLAUDE.md §4). Only a non-null response is stored,
 * and a failed refresh returns null exactly as the uncached call did, leaving
 * the pipeline's existing explorer gate to decide the scan's fate. Nor is a
 * stale entry served to paper over an outage: that would turn "we could not
 * look" into "we looked an hour ago and it was clean", which is the precise
 * shape of bug this codebase keeps having to fix.
 */

function ttlMinutes(): number {
  const raw = Number.parseInt(process.env.EXPLORER_ADDRESS_INFO_TTL_MINUTES ?? "", 10);
  // Not `|| 60` — an explicit 0 means "disable the cache" and must survive.
  return Number.isFinite(raw) && raw >= 0 ? raw : 60;
}

export interface AddressInfoProbe {
  /** Which adapter's payload the caller received; null when unknown/cache/no answer. */
  sourceId: string | null;
  servedFrom: "cache" | "fresh";
}

export async function addressInfoCached(
  address: string,
  probe?: AddressInfoProbe,
): Promise<ExplorerAddressInfo | null> {
  const ttl = ttlMinutes();
  if (ttl === 0) {
    const detailed = await explorer.addressInfoDetailed(address);
    if (probe) {
      probe.sourceId = detailed.adapterId;
      probe.servedFrom = "fresh";
    }
    return detailed.info;
  }

  const cached = await readAddressInfoCache<ExplorerAddressInfo>(address);
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt.getTime();
    // A future-dated row (clock skew) has a negative age; treat it as fresh
    // rather than as infinitely stale, but never as a reason to refuse a read.
    if (ageMs < ttl * 60_000) {
      // Counted with the in-scan dedupe: both answer "explorer reads served
      // without touching the network", which is the number that says whether
      // any of this is earning its keep.
      recordExplorerDedupe();
      // The cache row does not record its origin adapter, so a hit cannot name
      // one — saying so honestly beats guessing (L39).
      if (probe) probe.servedFrom = "cache";
      return cached.payload;
    }
  }

  const detailed = await explorer.addressInfoDetailed(address);
  const fresh = detailed.info;
  // null is either a domain 404 or a fault; neither is a fact worth storing.
  if (fresh !== null) await writeAddressInfoCache(address, fresh);
  if (probe) {
    probe.sourceId = detailed.adapterId;
    probe.servedFrom = "fresh";
  }
  return fresh;
}
