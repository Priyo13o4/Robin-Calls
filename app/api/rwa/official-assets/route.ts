import { NextResponse } from "next/server";
import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";
import { fetchEquityRegistry } from "@/lib/market/equity-reference";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchEquityRegistry();
  if (!result.ok) {
    return NextResponse.json({ error: "Robinhood assets are unavailable" }, { status: 503 });
  }

  const raw = result.data as { assets?: unknown };
  if (!Array.isArray(raw.assets)) {
    return NextResponse.json({ error: "Robinhood assets are unavailable" }, { status: 503 });
  }

  const assets: Array<{ address: string; symbol: string; name: string }> = [];
  const seen = new Set<string>();
  for (const item of raw.assets) {
    if (!item || typeof item !== "object") continue;
    const asset = item as Record<string, unknown>;
    if (asset.status !== "ASSET_STATUS_ACTIVE" ||
      typeof asset.tokenSymbol !== "string" ||
      typeof asset.tokenName !== "string" ||
      !Array.isArray(asset.deployments)) continue;
    const deployment = asset.deployments.find((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const row = entry as Record<string, unknown>;
      return Number(row.chainId) === ROBINHOOD_CHAIN_ID &&
        typeof row.contractAddress === "string" && /^0x[a-fA-F0-9]{40}$/.test(row.contractAddress);
    }) as { contractAddress: string } | undefined;
    if (!deployment) continue;
    const address = deployment.contractAddress.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    assets.push({
      address,
      symbol: asset.tokenSymbol.slice(0, 16),
      name: asset.tokenName.slice(0, 100),
    });
  }

  return NextResponse.json({ assets }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600" },
  });
}
