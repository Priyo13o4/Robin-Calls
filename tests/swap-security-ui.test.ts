import test from "node:test";
import assert from "node:assert/strict";
import { plannedBlockedRouteMatches, type TradeSecuritySignal } from "../app/components/trade/security-signal";

const V4_POOL_ID = `0x${"ab".repeat(32)}` as const;
const V4_MANAGER = "0x0000000000000000000000000000000000000044" as const;
const TOKEN = "0x0000000000000000000000000000000000000055" as const;

function signal(poolId: string): TradeSecuritySignal {
  return {
    kind: "verdict",
    token: TOKEN,
    tier: "CAUTION",
    score: 55,
    scoreVersion: "1.52",
    scannedAt: "2026-09-24T00:00:00.000Z",
    currentFormula: true,
    honeypot: {
      status: "WARN",
      reason: "One sell route is blocked.",
      sellCoverageIncomplete: false,
      blockedRoutes: [{ poolId, protocol: "uniswap-v4", reason: "SellNotAllowed" }],
    },
  };
}

test("selected V4 blocked route matches its poolId, not the shared PoolManager", () => {
  const plan = { pool: V4_MANAGER, poolId: V4_POOL_ID, route: undefined };
  assert.equal(plannedBlockedRouteMatches(plan, signal(V4_POOL_ID.toUpperCase())).length, 1);
  assert.equal(plannedBlockedRouteMatches({ ...plan, poolId: `0x${"cd".repeat(32)}` }, signal(V4_POOL_ID)).length, 0);
});

test("selected V2/V3 route still matches its concrete pool address", () => {
  const pool = "0x00000000000000000000000000000000000000ab" as const;
  assert.equal(plannedBlockedRouteMatches({ pool, route: undefined }, signal(pool)).length, 1);
});
