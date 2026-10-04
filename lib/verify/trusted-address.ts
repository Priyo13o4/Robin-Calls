import type { Address, PublicClient } from "viem";
import { getAddress, isAddress, keccak256 } from "viem";
import { EIP1967_SLOTS } from "../rpc/abis";
import type { ChainReader } from "../rpc/client";

/** Canonical Robinhood RWA infrastructure, verified 2026-07-19. */
export const CANONICAL_RWA = {
  stockBeacon: "0xe10b6f6b275de231345c20d14ab812db62151b00",
  stockImpl: "0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2",
} as const;

/** Re-exported for callers that used to import the local constant. */
export const EIP1967_BEACON_SLOT = EIP1967_SLOTS.beacon;

export const beaconAbi = [{
  type: "function",
  name: "implementation",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}] as const;

export type TrustCategory =
  | "dex-factory" | "dex-router" | "dex-quoter" | "dex-position-manager"
  | "dex-pool-manager" | "dex-state-view" | "permit2" | "lp-locker"
  | "burn-address" | "infra-asset" | "rwa-beacon" | "rwa-impl"
  | "rwa-factory" | "rwa-vault" | "rwa-operator" | "bridge-system-owner"
  | "trusted-proxy"
  // Inert labelling bucket: named DEX auxiliary contracts (pool deployers,
  // migrators, tick lenses, smart/mixed routers, interface multicalls) that the
  // registry's role() lookup never queries. Present so a scan can name them
  // instead of reporting "unknown contract"; never selected for discovery/sim.
  | "dex-infra";

export interface ProbeResult {
  ok: boolean;
  status: "ok" | "failed" | "unprobeable";
  reason: string;
  evidence: Record<string, unknown>;
  /**
   * The probe could not reach a verdict because the RPC itself failed
   * (timeout, rate-limit, transport error) — NOT because the address failed
   * the authenticity check.
   *
   * Callers must never treat this as a definitive "untrusted". Swallowing
   * RPC errors into `status: "failed"` is what made /rwa show intermittent
   * "Review" labels on genuinely canonical tokens: a 25-way concurrent probe
   * burst rate-limited a few calls, and each one was laundered into a
   * confident negative and then cached for ten minutes.
   */
  transient?: boolean;
}

/**
 * The one correct shape for "the RPC failed, so we have no verdict". Never
 * `status: "failed"` — that reads to the admin UI as a definitive rejection
 * and gets persisted as `verify_status`.
 */
function unprobeable(reason: string, evidence: Record<string, unknown> = {}): ProbeResult {
  return { ok: false, status: "unprobeable", reason, evidence, transient: true };
}

/**
 * Throwing variant — the default choice. Prefer this over
 * `beaconImplementation` so the caller decides whether a fault is a negative
 * or an unknown, instead of having that decision made for it by a swallowed
 * `null` it cannot distinguish from "the beacon has no implementation()".
 */
export async function readBeaconImplementation(client: PublicClient, beacon: string): Promise<string | null> {
  const impl = await client.readContract({
    address: beacon as Address,
    abi: beaconAbi,
    functionName: "implementation",
  });
  return impl?.toLowerCase() ?? null;
}

async function readSlot(client: ChainReader, address: Address, slot: `0x${string}` = EIP1967_SLOTS.beacon): Promise<string | null> {
  const raw = await client.getStorageAt({ address, slot });
  if (!raw || /^0x0*$/.test(raw)) return null;
  return `0x${raw.slice(-40)}`.toLowerCase();
}

export async function readProxySlots(client: ChainReader, address: Address) {
  const [implementation, admin, beacon] = await Promise.all([
    readSlot(client, address, EIP1967_SLOTS.implementation),
    readSlot(client, address, EIP1967_SLOTS.admin),
    readSlot(client, address, EIP1967_SLOTS.beacon),
  ]);
  return { implementation, admin, beacon };
}

/**
 * Fault-swallowing variant. `null` is ambiguous here — it means EITHER "no
 * implementation()" OR "the read faulted" — so only use it where the caller
 * treats null as *unresolved*, never as a negative fact. `resolveProxyGraph`
 * is the one legitimate consumer; everything else wants
 * `readBeaconImplementation`.
 */
export async function beaconImplementation(client: ChainReader, beacon: string): Promise<string | null> {
  return (await client.readContract({
    address: beacon as Address,
    abi: beaconAbi,
    functionName: "implementation",
  }).catch(() => null))?.toLowerCase() ?? null;
}

/** The authenticity gate: canonical beacon proxy plus the expected implementation. */
export async function verifyRwaToken(client: PublicClient, address: string): Promise<ProbeResult> {
  if (!isAddress(address)) {
    return { ok: false, status: "failed", reason: "Malformed address.", evidence: {} };
  }
  const normalized = getAddress(address) as Address;

  // An RPC error here is "we don't know", not "not a beacon proxy". Only a
  // successful read that returns an empty slot is a real negative.
  let beacon: string | null;
  try {
    beacon = await readSlot(client, normalized);
  } catch (error) {
    return {
      ok: false,
      status: "unprobeable",
      reason: `Could not read the beacon slot: ${(error as Error)?.message ?? "RPC error"}.`,
      evidence: {},
      transient: true,
    };
  }

  if (!beacon) {
    return { ok: false, status: "failed", reason: "Not a beacon proxy — not a canonical Robinhood RWA.", evidence: { beacon: null } };
  }
  if (beacon !== CANONICAL_RWA.stockBeacon) {
    return { ok: false, status: "failed", reason: `Beacon ${beacon} is not the Robinhood stock beacon — possible impersonation.`, evidence: { beacon } };
  }

  // Same distinction for the implementation read.
  let implementation: string | null;
  try {
    implementation = (await client.readContract({
      address: beacon as Address,
      abi: beaconAbi,
      functionName: "implementation",
    }))?.toLowerCase() ?? null;
  } catch (error) {
    return {
      ok: false,
      status: "unprobeable",
      reason: `Beacon matches, but the implementation read failed: ${(error as Error)?.message ?? "RPC error"}.`,
      evidence: { beacon },
      transient: true,
    };
  }

  const ok = implementation === CANONICAL_RWA.stockImpl;
  return {
    ok,
    status: ok ? "ok" : "failed",
    reason: ok
      ? "Authentic Robinhood RWA: canonical beacon and Stock implementation."
      : `Beacon matches but implementation ${implementation} differs from the expected Stock implementation.`,
    evidence: { beacon, implementation },
  };
}

export async function verifyTrustedAddress(
  client: PublicClient,
  category: TrustCategory,
  address: string,
  knownToken?: Address,
): Promise<ProbeResult> {
  if (!isAddress(address)) return { ok: false, status: "failed", reason: "Malformed address.", evidence: {} };
  const normalized = getAddress(address) as Address;
  if (category === "burn-address") return { ok: true, status: "ok", reason: "Burn sink.", evidence: {} };
  if (category === "rwa-beacon") {
    // An RPC fault here must not read as "not the canonical beacon" — that is a
    // definitive accusation manufactured from a timeout, and the admin sees it
    // as a hard verification failure (§4). Only a successful read that returns
    // the wrong implementation is a real negative.
    let implementation: string | null;
    try {
      implementation = await readBeaconImplementation(client, normalized);
    } catch {
      return unprobeable("Could not read the beacon implementation, so canonicity is unconfirmed.");
    }
    const ok = normalized.toLowerCase() === CANONICAL_RWA.stockBeacon && implementation === CANONICAL_RWA.stockImpl;
    return { ok, status: ok ? "ok" : "failed", reason: ok ? "Canonical Robinhood stock beacon." : "Not the canonical stock beacon and implementation.", evidence: { implementation } };
  }
  if (category === "trusted-proxy") {
    let code: string | undefined;
    try {
      code = await client.getCode({ address: normalized });
    } catch {
      return unprobeable("Could not read the address bytecode, so contract status is unconfirmed.");
    }
    if (!code || code.length <= 2) return { ok: false, status: "failed", reason: "Not a contract.", evidence: { isContract: false } };
    let slots: Awaited<ReturnType<typeof readProxySlots>>;
    try {
      slots = await readProxySlots(client, normalized);
    } catch {
      return unprobeable("Could not read the EIP-1967 slots, so proxy status is unconfirmed.", { isContract: true });
    }
    const ok = !!(slots.implementation || slots.beacon);
    return {
      ok,
      status: ok ? "ok" : "failed",
      reason: ok ? "EIP-1967 proxy slot detected." : "Contract has no EIP-1967 implementation or beacon slot.",
      evidence: { isContract: true, ...slots },
    };
  }
  if (category === "lp-locker") {
    let code: `0x${string}` | undefined;
    try {
      code = (await client.getCode({ address: normalized })) as `0x${string}` | undefined;
    } catch {
      return unprobeable("Could not read the locker bytecode, so contract status is unconfirmed.");
    }
    if (!code || code.length <= 2) {
      return { ok: false, status: "failed", reason: "Locker address has no deployed bytecode.", evidence: { isContract: false } };
    }
    const codehash = keccak256(code);
    let slots: Awaited<ReturnType<typeof readProxySlots>> | null = null;
    try {
      slots = await readProxySlots(client, normalized);
    } catch {
      // proxy slot read failed or not a proxy
    }
    return {
      ok: true,
      status: "ok",
      reason: "LP Locker contract verified on-chain.",
      evidence: {
        isContract: true,
        codehash,
        proxySlots: slots,
      },
    };
  }
  if (["rwa-vault", "rwa-operator", "infra-asset"].includes(category) && knownToken) {
    const balance = await client.readContract({
      address: knownToken,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [normalized],
    }).catch(() => null);
    const ok = balance !== null && balance > 0n;
    return { ok, status: ok ? "ok" : "unprobeable", reason: ok ? "Holds a registered token." : "No registered-token balance found; verify manually.", evidence: { balance: balance?.toString() ?? null } };
  }
  let fallbackCode: string | undefined;
  try {
    fallbackCode = await client.getCode({ address: normalized });
  } catch {
    return unprobeable("Could not read the address bytecode, so contract status is unconfirmed.");
  }
  const contract = !!fallbackCode && fallbackCode.length > 2;
  return { ok: contract, status: contract ? "unprobeable" : "failed", reason: contract ? "Contract exists; confirm the labeled role before override." : "Not a contract.", evidence: { isContract: contract } };
}
