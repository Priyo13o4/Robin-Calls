import { rpc } from "./client";

/**
 * The gas price a real transaction on this chain would carry.
 *
 * `eth_call` defaults `tx.gasprice` to **0** when the field is omitted, so a
 * contract gating on `require(tx.gasprice < N)` passes every simulation and
 * reverts for every user — KNOWN-PROBLEMS L14, where we published
 * `honeypot: PASS` on a live sell-blocked token.
 *
 * `gasPrice` is a TRANSACTION field, not a venue one, so this is read once and
 * shared by every simulator (V2/V3 router swaps, the direct transfer probe,
 * the V4 quoter). No adapter gets its own number.
 *
 * **Never substitute a literal on failure** (§8 #11 — a hardcoded value where a
 * measurement belongs). Two independent chain sources are tried, and if both
 * fault the answer is `null`, which callers must publish as "the probe was not
 * representative" rather than silently re-running the optimistic sim.
 */
export interface GasPriceRead {
  wei: bigint;
  source: "eth_gasPrice" | "baseFeePerGas" | "baseFeeHeadroom";
}

/**
 * Headroom over the base fee, because the price must still be valid when the
 * call lands, not only when it was read.
 *
 * Measured on this chain 2026-08-18: `eth_gasPrice` returned 20,006,000 wei
 * while the pending block's base fee was ALREADY higher, and every `eth_call`
 * carrying that price failed `max fee per gas less than block base fee`. Using
 * the raw quote would therefore have faulted every sell simulation on the
 * chain — not false CRITICALs (`isInsufficientFundsError` catches this string),
 * but a total loss of honeypot coverage, which is L14 again in a new costume.
 *
 * 2x is the standard EIP-1559 wallet headroom and stays orders of magnitude
 * below any plausible anti-sniper gas cap, so it cannot manufacture a
 * `gas-conditional` finding.
 */
const BASE_FEE_HEADROOM = 2n;

const TTL_MS = 60_000;

let cached: { value: GasPriceRead | null; at: number } | null = null;
let inFlight: Promise<GasPriceRead | null> | null = null;

/** Injectable seam for tests. Defaults to the real chain read. */
export const gasPriceDeps = {
  read: async (): Promise<GasPriceRead | null> => {
    const client = rpc();
    const [quoted, base] = await Promise.all([
      client.getGasPrice().catch(() => null),
      client
        .getBlock({ blockTag: "latest" })
        .then((b) => b.baseFeePerGas ?? null)
        .catch(() => null),
    ]);
    // Both sources, then the MAX — a quote below the base fee is not a price a
    // transaction can carry, and a base fee without headroom expires within a
    // block or two. Neither source alone is sufficient, which is why both are
    // read rather than one being a fallback for the other.
    const floor = base !== null && base > 0n ? base * BASE_FEE_HEADROOM : null;
    if (floor !== null && (quoted === null || quoted < floor)) {
      return { wei: floor, source: "baseFeeHeadroom" };
    }
    if (quoted !== null && quoted > 0n) return { wei: quoted, source: "eth_gasPrice" };
    if (base !== null && base > 0n) return { wei: base, source: "baseFeePerGas" };
    // Both faulted, or the chain genuinely prices gas at zero. The caller must
    // hedge, not guess (§8 #11 — never a literal where a measurement belongs).
    return null;
  },
};

/**
 * Cached, single-flight (§5: a cold cache is hit by every concurrent scan at
 * once). A null read is cached too — otherwise a node outage turns one failure
 * into a retry storm across every sell leg of every scan.
 */
export async function currentGasPrice(): Promise<GasPriceRead | null> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  if (inFlight) return inFlight;
  inFlight = gasPriceDeps
    .read()
    .then((value) => {
      cached = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function _resetGasPriceCacheForTests(): void {
  cached = null;
  inFlight = null;
}
