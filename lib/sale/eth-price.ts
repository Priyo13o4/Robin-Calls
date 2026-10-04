import type { Address, PublicClient } from "viem";

export const ETH_PRICE_PRIMARY_POOL = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca" as Address;
export const ETH_PRICE_CHECK_POOL = "0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a" as Address;

export const ETH_PRICE_MAX_SPREAD = 0.01;
export const ETH_PRICE_POLL_MS = 30_000;
export const ETH_PRICE_MAX_AGE_MS = 300_000;

const slot0Abi = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      { internalType: "uint16", name: "observationCardinality", type: "uint16" },
      { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export function usdPerEthFromSqrt(sqrtPriceX96: bigint): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const price = ratio * ratio * 1e12;
  if (!Number.isFinite(price) || price <= 0) return null;
  return price;
}

export function ethUsdFromPools(primary: bigint | null, check: bigint | null): number | null {
  if (primary === null || check === null) return null;
  const p = usdPerEthFromSqrt(primary);
  const c = usdPerEthFromSqrt(check);
  if (p === null || c === null) return null;
  if (Math.abs(p - c) / p > ETH_PRICE_MAX_SPREAD) return null;
  return p;
}

function extractSqrtPrice(res: unknown): bigint | null {
  if (!res || typeof res !== "object") return null;
  const r = res as { status?: string; result?: unknown; value?: unknown };
  if (r.status !== "success") return null;
  const val = r.result ?? r.value;
  if (typeof val === "bigint") return val;
  if (Array.isArray(val) && typeof val[0] === "bigint") return val[0];
  if (val && typeof val === "object" && "sqrtPriceX96" in val) {
    const s = (val as { sqrtPriceX96: unknown }).sqrtPriceX96;
    if (typeof s === "bigint") return s;
  }
  return null;
}

export async function readEthUsd(client: Pick<PublicClient, "multicall">): Promise<number | null> {
  const results = await client.multicall({
    contracts: [
      { address: ETH_PRICE_PRIMARY_POOL, abi: slot0Abi, functionName: "slot0" },
      { address: ETH_PRICE_CHECK_POOL, abi: slot0Abi, functionName: "slot0" },
    ],
    allowFailure: true,
  });
  const primarySqrt = extractSqrtPrice(results?.[0]);
  const checkSqrt = extractSqrtPrice(results?.[1]);
  return ethUsdFromPools(primarySqrt, checkSqrt);
}

export function raisedUsd(raisedEth: number | null, ethUsd: number | null): number | null {
  if (raisedEth === null || ethUsd === null || !Number.isFinite(raisedEth) || !Number.isFinite(ethUsd)) {
    return null;
  }
  return raisedEth * ethUsd;
}
