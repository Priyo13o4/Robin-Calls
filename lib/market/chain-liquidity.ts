import { readV4PoolKeys } from "@/lib/data/v4-pools";
import { isDrained, readV4Reserves } from "@/lib/dex/v4-reserves";
import { reportError } from "@/lib/observability/reporter";

/**
 * L212: DexScreener keeps a V4 pool's last liquidity after it is emptied, so a
 * detector reading only its figure can never see that pull. Returns the tokens
 * whose pinned V4 pool the PoolManager reads as empty. One multicall per call;
 * a failed read leaves the provider's figure standing, never a false zero.
 */
export async function chainEmptiedTokens(
  readings: readonly { tokenAddress: string; poolAddress: string | null; liquidityUsd: number | null }[],
  operation: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  const live = readings.filter((r) => r.poolAddress?.length === 66 && (r.liquidityUsd ?? 0) > 0);
  if (!live.length) return out;
  try {
    const keys = await readV4PoolKeys(live.map((r) => r.poolAddress!));
    const known = live.filter((r) => keys.has(r.poolAddress!.toLowerCase()));
    const reserves = await readV4Reserves(known.map((r) => keys.get(r.poolAddress!.toLowerCase())!));
    known.forEach((r, i) => {
      if (isDrained(reserves[i])) out.add(r.tokenAddress.toLowerCase());
    });
  } catch (error) {
    await reportError({
      code: "RC_CURVE_POOL_CHECK_FAILED",
      message: "chain check of pinned V4 pools failed; provider liquidity stands",
      operation,
      error,
    });
  }
  return out;
}
