import { NextResponse } from "next/server";
import { normalizeAddress } from "@/lib/scanner/metadata";
import { readTradeSecuritySignal } from "@/lib/swap/trade-security";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return NextResponse.json(
      { error: "Not a valid contract address." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const signal = await readTradeSecuritySignal(normalized);
  return NextResponse.json(signal, { headers: { "Cache-Control": "no-store" } });
}
