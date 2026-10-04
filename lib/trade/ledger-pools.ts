/**
 * Which pool a ledger row reads on chain, taken from the pools its own verdict
 * assessed. Shared by the server (which adds V4 keys from `v4_pools`) and the
 * browser (which reads them), so it imports nothing.
 */
export type LedgerPoolRef =
  | { kind: "v2" | "v3"; address: string }
  | { kind: "v4"; poolId: string };

export type LedgerPoolTarget =
  | { kind: "v2" | "v3"; address: string }
  | { kind: "v4"; poolId: string; currency0: string; currency1: string; hooks: string };

/** Per token: the pool to read, and how many other assessed pools we did not. */
export interface LedgerPools {
  target: LedgerPoolTarget | null;
  otherPools: number;
}

interface AssessedPool {
  pool?: unknown;
  poolId?: unknown;
  protocol?: unknown;
  poolShareOfLiquidity?: unknown;
}

const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL_ID = /^0x[0-9a-f]{64}$/;

function refOf(p: AssessedPool): LedgerPoolRef | null {
  const protocol = typeof p.protocol === "string" ? p.protocol : "";
  if (protocol.endsWith("v4")) {
    const id = typeof p.poolId === "string" ? p.poolId.toLowerCase() : "";
    return POOL_ID.test(id) ? { kind: "v4", poolId: id } : null;
  }
  const address = typeof p.pool === "string" ? p.pool.toLowerCase() : "";
  if (!ADDRESS.test(address)) return null;
  if (protocol.endsWith("v2")) return { kind: "v2", address };
  // Slipstream CL shares V3's slot0 head and balance model.
  if (protocol.endsWith("v3") || protocol.endsWith("-cl")) return { kind: "v3", address };
  return null;
}

/**
 * The verdict's assessed pools, deepest first by the scan's own share measure
 * (§8 #18: rank by the deciding quantity before taking one). A pool with no
 * share sorts last rather than being dropped.
 */
export function assessedPoolRefs(checks: unknown): LedgerPoolRef[] {
  if (!Array.isArray(checks)) return [];
  const custody = checks.find((c) => (c as { id?: unknown })?.id === "lp_custody") as
    | { evidence?: { poolsAssessed?: unknown } }
    | undefined;
  const assessed = custody?.evidence?.poolsAssessed;
  if (!Array.isArray(assessed)) return [];
  const share = (p: AssessedPool) =>
    typeof p.poolShareOfLiquidity === "number" && Number.isFinite(p.poolShareOfLiquidity) ? p.poolShareOfLiquidity : -1;
  const seen = new Set<string>();
  const out: LedgerPoolRef[] = [];
  for (const p of [...(assessed as AssessedPool[])].sort((a, b) => share(b) - share(a))) {
    const ref = refOf(p);
    if (!ref) continue;
    const key = ref.kind === "v4" ? ref.poolId : ref.address;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}
