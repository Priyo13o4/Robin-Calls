import { after, NextResponse } from "next/server";
import { getLiveLpCustody } from "@/lib/trade/lp-custody-live";
import { getPoolIdentity } from "@/lib/data/lp-positions";
import { trackingRefused, trackPool } from "@/lib/trade/lp-hydrate";

export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NO_STORE = { "Cache-Control": "no-store" };
const COMPLETE_CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 1_000;

type LiveResult = Awaited<ReturnType<typeof getLiveLpCustody>>;
const completeCache = new Map<string, { expiresAt: number; result: Extract<LiveResult, { status: "complete" }> }>();

function remember(key: string, result: Extract<LiveResult, { status: "complete" }>) {
  if (completeCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = completeCache.keys().next().value;
    if (oldestKey) completeCache.delete(oldestKey);
  }
  completeCache.set(key, { result, expiresAt: Date.now() + COMPLETE_CACHE_MS });
}

/** GET /api/trades/<token>/lp-custody?pool=<address-or-pool-id> */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.trim().toLowerCase();
  const pool = (new URL(req.url).searchParams.get("pool") ?? "").trim().toLowerCase();
  if (!ADDRESS.test(token) || !POOL.test(pool)) {
    return NextResponse.json({ status: "faulted", error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }

  const key = `${token}:${pool}`;
  const cached = completeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.result, { headers: { "Cache-Control": "private, max-age=60" } });
  }
  if (cached) completeCache.delete(key);

  try {
    const result = await getLiveLpCustody({ poolId: pool, token });
    if (result.status === "checking" && trackingRefused(pool)) {
      return NextResponse.json({ status: "not-checked", pool, reason: "This pool's position history could not be fully read." }, { headers: NO_STORE });
    }
    if (result.status === "checking") {
      after(async () => {
        const identity = await getPoolIdentity(pool);
        // trackPool maps its own faults to "not-tracked"; the next visit simply asks again.
        if (identity?.protocol === "v3" || identity?.protocol === "v4") await trackPool(pool, identity.protocol, "visit");
      });
    }
    if (result.status === "complete") {
      remember(key, result);
      return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
    }
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    // A read fault is reported as faulted, never as a custody answer (CLAUDE.md §4).
    return NextResponse.json({ status: "faulted", pool, reason: "The pool could not be read." }, { headers: NO_STORE });
  }
}
