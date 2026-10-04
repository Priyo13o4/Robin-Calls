import type { PlanView } from "@/lib/swap/types";

type BlockedRouteSignal = { poolId?: string; protocol?: string; reason: string };
type HoneypotSignal = {
  status: string;
  reason: string;
  sellCoverageIncomplete: boolean;
  sellCoverageReason?: string;
  evidence?: { poolId?: string };
  blockedRoutes?: BlockedRouteSignal[];
} | null;

export type TradeSecurityHighlight = { id: string; name: string; status: string; reason: string };

export type TradeSecuritySignal =
  | { kind: "unknown" }
  | { kind: "unscanned" }
  | {
      kind: "verdict";
      token: string;
      tier: string;
      score: number;
      scoreVersion: string;
      scannedAt: string;
      honeypot: HoneypotSignal;
      currentFormula: boolean;
      ownToken?: true;
      highlights?: TradeSecurityHighlight[];
    };

/** Match scanner route evidence to the selected execution route by pool identity. */
export function plannedBlockedRouteMatches(
  plan: Pick<PlanView, "pool" | "poolId" | "route"> | null | undefined,
  signal: TradeSecuritySignal | undefined,
): BlockedRouteSignal[] {
  if (!plan || signal?.kind !== "verdict" || !signal.honeypot?.blockedRoutes?.length) return [];
  const plannedPools = new Set([
    ...(plan.route?.pools ?? []),
    ...(plan.route?.hops.map((hop) => hop.pool) ?? []),
    ...(plan.pool ? [plan.pool] : []),
    ...(plan.poolId ? [plan.poolId] : []),
  ].filter((pool): pool is `0x${string}` => pool !== null).map((pool) => pool.toLowerCase()));
  return signal.honeypot.blockedRoutes.filter((route) =>
    typeof route.poolId === "string" && plannedPools.has(route.poolId.toLowerCase()));
}

export const TRADE_SECURITY_TIMEOUT_MS = 4_000;

export function parseTradeSecuritySignal(value: unknown, address: string): TradeSecuritySignal {
  if (!value || typeof value !== "object") return { kind: "unknown" };
  const signal = value as Record<string, unknown>;
  if (signal.kind === "unknown" || signal.kind === "unscanned") return { kind: signal.kind };
  if (signal.kind !== "verdict" || typeof signal.token !== "string" || signal.token.toLowerCase() !== address.toLowerCase()) {
    return { kind: "unknown" };
  }
  if (
    typeof signal.tier !== "string" || !signal.tier.trim() ||
    typeof signal.score !== "number" || !Number.isFinite(signal.score) ||
    typeof signal.scoreVersion !== "string" || !signal.scoreVersion.trim() ||
    typeof signal.scannedAt !== "string" || !Number.isFinite(Date.parse(signal.scannedAt)) ||
    typeof signal.currentFormula !== "boolean"
  ) return { kind: "unknown" };

  let honeypot: HoneypotSignal;
  if (signal.honeypot === null) {
    honeypot = null;
  } else if (
    signal.honeypot && typeof signal.honeypot === "object" &&
    typeof (signal.honeypot as Record<string, unknown>).status === "string" &&
    typeof (signal.honeypot as Record<string, unknown>).reason === "string" &&
    typeof (signal.honeypot as Record<string, unknown>).sellCoverageIncomplete === "boolean"
  ) {
    const hp = signal.honeypot as Record<string, unknown>;
    if (hp.sellCoverageReason !== undefined && (typeof hp.sellCoverageReason !== "string" || hp.sellCoverageReason.length > 240)) return { kind: "unknown" };
    let evidence: { poolId?: string } | undefined;
    if (hp.evidence !== undefined) {
      if (!hp.evidence || typeof hp.evidence !== "object") return { kind: "unknown" };
      const rawEvidence = hp.evidence as Record<string, unknown>;
      if (rawEvidence.poolId !== undefined && (typeof rawEvidence.poolId !== "string" || rawEvidence.poolId.length > 80)) return { kind: "unknown" };
      evidence = typeof rawEvidence.poolId === "string" ? { poolId: rawEvidence.poolId } : {};
    }
    let blockedRoutes: BlockedRouteSignal[] | undefined;
    if (hp.blockedRoutes !== undefined) {
      if (!Array.isArray(hp.blockedRoutes) || hp.blockedRoutes.length > 8) return { kind: "unknown" };
      blockedRoutes = [];
      for (const value of hp.blockedRoutes) {
        if (!value || typeof value !== "object") return { kind: "unknown" };
        const route = value as Record<string, unknown>;
        if (typeof route.reason !== "string" || route.reason.length > 300) return { kind: "unknown" };
        if (route.poolId !== undefined && (typeof route.poolId !== "string" || route.poolId.length > 80)) return { kind: "unknown" };
        if (route.protocol !== undefined && (typeof route.protocol !== "string" || route.protocol.length > 40)) return { kind: "unknown" };
        blockedRoutes.push({
          ...(typeof route.poolId === "string" ? { poolId: route.poolId } : {}),
          ...(typeof route.protocol === "string" ? { protocol: route.protocol } : {}),
          reason: route.reason,
        });
      }
    }
    honeypot = {
      status: hp.status as string,
      reason: hp.reason as string,
      sellCoverageIncomplete: hp.sellCoverageIncomplete as boolean,
      ...(typeof hp.sellCoverageReason === "string" ? { sellCoverageReason: hp.sellCoverageReason } : {}),
      ...(evidence === undefined ? {} : { evidence }),
      ...(blockedRoutes === undefined ? {} : { blockedRoutes }),
    };
  } else {
    return { kind: "unknown" };
  }
  const highlights = parseHighlights(signal.highlights);
  return {
    kind: "verdict",
    token: signal.token,
    tier: signal.tier,
    score: signal.score,
    scoreVersion: signal.scoreVersion,
    scannedAt: signal.scannedAt,
    honeypot,
    currentFormula: signal.currentFormula,
    ...(signal.ownToken === true ? { ownToken: true as const } : {}),
    ...(highlights.length > 0 ? { highlights } : {}),
  };
}

/** Display-only extras: a malformed row is dropped, never allowed to void the honeypot signal. */
function parseHighlights(value: unknown): TradeSecurityHighlight[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const h = item as Record<string, unknown>;
    const ok = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
    return ok(h.id, 60) && ok(h.name, 60) && ok(h.status, 10) && ok(h.reason, 280)
      ? [{ id: h.id as string, name: h.name as string, status: h.status as string, reason: h.reason as string }]
      : [];
  });
}

export async function fetchTradeSecuritySignal(
  address: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = TRADE_SECURITY_TIMEOUT_MS,
): Promise<TradeSecuritySignal> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`/api/swap/security/${encodeURIComponent(address)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "unknown" };
    return parseTradeSecuritySignal(await response.json(), address);
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export function isSecuritySignalChangeForReview(
  previous: TradeSecuritySignal | undefined,
  next: TradeSecuritySignal,
): boolean {
  if (!previous) return false;
  if (previous.kind !== next.kind) return true;
  if (previous.kind !== "verdict" || next.kind !== "verdict") return false;
  return previous.tier !== next.tier ||
    previous.score !== next.score ||
    previous.scoreVersion !== next.scoreVersion ||
    previous.currentFormula !== next.currentFormula ||
    previous.honeypot?.status !== next.honeypot?.status ||
    previous.honeypot?.reason !== next.honeypot?.reason ||
    previous.honeypot?.sellCoverageIncomplete !== next.honeypot?.sellCoverageIncomplete ||
    previous.honeypot?.sellCoverageReason !== next.honeypot?.sellCoverageReason ||
    JSON.stringify(previous.honeypot?.blockedRoutes ?? []) !== JSON.stringify(next.honeypot?.blockedRoutes ?? []);
}
