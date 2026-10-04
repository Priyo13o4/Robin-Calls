import { NextResponse } from "next/server";
import { readSwapConfig } from "@/lib/swap/config";
import { sharedRouteGraph } from "@/lib/swap/route-graph-store";
import { answerRoutesRequest } from "@/lib/swap/routes-api";

export const dynamic = "force-dynamic";

/** Candidate routes from the in-memory pool graph. Zero RPC: the browser prices them. */
export async function GET(req: Request) {
  const config = await readSwapConfig();
  if (!config.features.routeGraph.on) {
    return NextResponse.json(
      { status: "unavailable", reason: "Pool graph routes are disabled." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const body = await answerRoutesRequest(new URL(req.url).searchParams, sharedRouteGraph);
  const status = body.status === "invalid" ? 400 : body.status === "unavailable" ? 503 : 200;
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
