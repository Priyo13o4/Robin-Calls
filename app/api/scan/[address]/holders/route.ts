import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";
import { normalizeAddress } from "@/lib/scanner/metadata";
import { explorer } from "@/lib/explorer/router";

export interface CleanHolder {
  rank: number;
  address: string;
  tag?: string;
  percentage: number;
  amount: number;
  valueUsd: number;
  raw: string;
}

export interface HolderResult {
  holders: CleanHolder[];
  total: number;
}

/** Uses the configured explorer router, including its opt-in provider settings. */
export async function resolveHolders(rawAddress: string): Promise<HolderResult | null> {
  const normalized = normalizeAddress(rawAddress);
  if (!normalized) return null;

  try {
    const [res, token] = await Promise.all([
      explorer.tokenHolders(normalized),
      explorer.tokenInfo(normalized),
    ]);
    if (!res || !Array.isArray(res.items) || !token) return null;
    const decimals = Number(token.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
    const supplyText = token.total_supply;
    if (!supplyText || !/^\d+$/.test(supplyText)) return null;
    const supply = BigInt(supplyText);
    if (supply <= 0n) return null;

    const holders = res.items.map((item, idx) => {
      const raw = BigInt(item.value || "0");
      const computedPct = Number((raw * 1_000_000n) / supply) / 10_000;
      const amount = Number(formatUnits(raw, decimals));
      return {
        rank: idx + 1,
        address: item.address.hash,
        tag: item.label || undefined,
        percentage: Number((item.shareOfSupply !== undefined ? item.shareOfSupply * 100 : computedPct).toFixed(2)),
        amount: Number.isFinite(amount) ? Math.round(amount) : 0,
        valueUsd: Number.isFinite(Number(item.valueUsd)) ? Math.round(Number(item.valueUsd)) : 0,
        raw: raw.toString(),
      };
    });
    const total = Number(token.holders);
    return { holders, total: Number.isFinite(total) && total >= 0 ? total : holders.length };
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const result = await resolveHolders(address);
  if (!result) {
    return NextResponse.json(
      { state: "unavailable", holders: null, total: null },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
  return NextResponse.json(
    { state: "ok", holders: result.holders, total: result.total },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } },
  );
}
