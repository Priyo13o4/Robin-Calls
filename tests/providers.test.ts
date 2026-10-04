import test from "node:test";
import assert from "node:assert/strict";
import {
  isExecutionRevert,
  parseEndpointConfig,
  shouldFailover,
} from "../lib/rpc/provider-pool";
// Circuit-breaker primitives moved to the central admission gate.
import {
  circuitAllows,
  circuitOnFailure,
  circuitOnSuccess,
  newCircuit,
} from "../lib/rpc/admission";
import { selectPair } from "../lib/market/dexscreener";
import {
  mergeTraderCounts,
  shadowDiverges,
  shouldEnrichTraderData,
} from "../lib/market/registry";
import type { MarketFetch } from "../lib/market/provider";
import type { MarketSnapshot } from "../lib/types";

// ── §11.1 endpoint configuration ─────────────────────────────

test("RPC_ENDPOINTS_JSON parses an ordered pool", () => {
  const endpoints = parseEndpointConfig({
    RPC_ENDPOINTS_JSON: JSON.stringify([
      { id: "alchemy", url: "https://a.example/v2/key", maxCuPerSecond: 500 },
      { id: "public", url: "https://rpc.example" },
    ]),
  });
  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0].id, "alchemy");
  assert.equal(endpoints[1].id, "public");
});

test("malformed pools fail loudly: bad JSON, duplicate ids, bad URLs", () => {
  assert.throws(() => parseEndpointConfig({ RPC_ENDPOINTS_JSON: "{nope" }), /not valid JSON/);
  assert.throws(() => parseEndpointConfig({ RPC_ENDPOINTS_JSON: "[]" }), /non-empty/);
  assert.throws(
    () =>
      parseEndpointConfig({
        RPC_ENDPOINTS_JSON: JSON.stringify([
          { id: "a", url: "https://x.example" },
          { id: "a", url: "https://y.example" },
        ]),
      }),
    /duplicate provider id/
  );
  assert.throws(
    () =>
      parseEndpointConfig({
        RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "a", url: "ftp://x.example" }]),
      }),
    /http\(s\) url/
  );
});

test("legacy two-var config translates into the pool (deprecated path)", () => {
  const endpoints = parseEndpointConfig({
    ROBINHOOD_RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
    ROBINHOOD_RPC_FALLBACK_URL: "https://robinhood.g.alchemy.com/v2/key",
  });
  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0].id, "rpc.mainnet.chain.robinhood.com");
  assert.equal(endpoints[1].id, "robinhood.g.alchemy.com");
  // no env at all still yields the public default
  assert.equal(parseEndpointConfig({}).length, 1);
});

// ── §11.3 circuit breaker ────────────────────────────────────

const cfg = {
  requestTimeoutMs: 12_000,
  scanDeadlineMs: 45_000,
  circuitFailureThreshold: 3,
  circuitOpenSeconds: 60,
  recoveryProbeSeconds: 30,
};

test("circuit opens after the failure threshold and blocks while open", () => {
  const c = newCircuit();
  const t0 = 1_000_000;
  assert.equal(circuitAllows(c, cfg, t0), true);
  circuitOnFailure(c, cfg, t0);
  circuitOnFailure(c, cfg, t0);
  assert.equal(c.phase, "CLOSED", "below threshold stays closed");
  circuitOnFailure(c, cfg, t0);
  assert.equal(c.phase, "OPEN");
  assert.equal(circuitAllows(c, cfg, t0 + 30_000), false, "blocked inside the open window");
});

test("circuit half-opens for one probe, then closes on success or reopens on failure", () => {
  const c = newCircuit();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) circuitOnFailure(c, cfg, t0);
  const probeAt = t0 + 61_000;
  assert.equal(circuitAllows(c, cfg, probeAt), true, "recovery window admits one probe");
  assert.equal(c.phase, "HALF_OPEN");
  assert.equal(circuitAllows(c, cfg, probeAt + 1_000), false, "no second probe inside the interval");

  circuitOnFailure(c, cfg, probeAt + 2_000);
  assert.equal(c.phase, "OPEN", "failed probe reopens immediately");

  const secondProbeAt = probeAt + 2_000 + 61_000;
  assert.equal(circuitAllows(c, cfg, secondProbeAt), true);
  circuitOnSuccess(c);
  assert.equal(c.phase, "CLOSED");
  assert.equal(c.consecutiveFailures, 0);
});

// ── §11.3/§11.4 failover classification ──────────────────────

test("deterministic EVM results never fail over", () => {
  assert.equal(isExecutionRevert({ code: 3, message: "execution reverted" }), true);
  assert.equal(
    shouldFailover({ cause: { code: 3, message: "execution reverted" } }),
    false
  );
  assert.equal(shouldFailover({ code: -32601, message: "method not found" }), false);
  assert.equal(shouldFailover({ code: -32602, message: "invalid params" }), false);
});

test("transport-class faults do fail over", () => {
  assert.equal(shouldFailover({ name: "TimeoutError", message: "took too long" }), true);
  assert.equal(shouldFailover({ name: "HttpRequestError", status: 503 }), true);
  assert.equal(shouldFailover({ status: 429 }), true);
  assert.equal(shouldFailover({ code: -32603, message: "internal error" }), true);
});

// ── §11.8 DexScreener pair selection ─────────────────────────

const TOKEN = "0x1111111111111111111111111111111111111111";

test("selectPair keeps base-token pairs only and picks the deepest", () => {
  const pair = selectPair(
    [
      { baseToken: { address: TOKEN }, pairAddress: "0xshallow", liquidity: { usd: 100 } },
      { baseToken: { address: TOKEN.toUpperCase().replace("0X", "0x") }, pairAddress: "0xdeep", liquidity: { usd: 9_000 } },
      // token on the quote side describes the counter-asset, not our token
      { baseToken: { address: "0x2222222222222222222222222222222222222222" }, pairAddress: "0xquote", liquidity: { usd: 50_000 } },
    ],
    TOKEN
  );
  assert.equal(pair?.pairAddress, "0xdeep");
});

test("selectPair returns null when the token is never the base token", () => {
  const pair = selectPair(
    [{ baseToken: { address: "0x3333333333333333333333333333333333333333" } }],
    TOKEN
  );
  assert.equal(pair, null);
});

// ── §11.8 shadow comparison ──────────────────────────────────

test("shadow divergence: state, pool, or ±25% liquidity disagreement", () => {
  const base = { state: "OK", poolAddress: "0xpool", liquidityUsd: 1000, priceUsd: 1 };
  assert.equal(shadowDiverges(base, { ...base }), false);
  assert.equal(shadowDiverges(base, { ...base, liquidityUsd: 1200 }), false, "20% is agreement");
  assert.equal(shadowDiverges(base, { ...base, liquidityUsd: 1600 }), true, "60% is divergence");
  assert.equal(shadowDiverges(base, { ...base, state: "NOT_FOUND" }), true);
  assert.equal(shadowDiverges(base, { ...base, poolAddress: "0xother" }), true);
  assert.equal(
    shadowDiverges(base, { ...base, liquidityUsd: null }),
    true,
    "one-sided liquidity is divergence"
  );
});

// ── hybrid wash-density enrichment (Wave C part 2) ───────────

function snap(partial: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    priceUsd: 1,
    poolDexId: null,
    liquidityUsd: 20_000,
    volume24hUsd: 500_000,
    buys24h: 1_900,
    sells24h: 2_000,
    buyers24h: null,
    sellers24h: null,
    fdvUsd: null,
    poolAddress: "0xpair",
    poolCreatedAt: null,
    ...partial,
  };
}

test("enrichment fires only for turnover-suspicious pools lacking trader data", () => {
  // 25× turnover on a $20k pool, no trader counts → worth a GT call.
  assert.equal(shouldEnrichTraderData(snap({})), true);
  // already has trader counts → never spend a call.
  assert.equal(shouldEnrichTraderData(snap({ buyers24h: 10, sellers24h: 12 })), false);
  // shallow pool → turnover is meaningless, skip.
  assert.equal(shouldEnrichTraderData(snap({ liquidityUsd: 1_000 })), false);
  // calm turnover (2×) on a mature pool → not suspicious, skip.
  assert.equal(shouldEnrichTraderData(snap({ volume24hUsd: 40_000 })), false);
  // 2× would clear the young (10×) bar? No — still below. Young pool, 12× → fire.
  assert.equal(
    shouldEnrichTraderData(
      snap({ volume24hUsd: 240_000, poolCreatedAt: new Date(Date.now() - 3_600_000).toISOString() })
    ),
    true
  );
  assert.equal(shouldEnrichTraderData(null), false);
});

test("mergeTraderCounts fills only the missing side/trader fields", () => {
  const base: MarketFetch = { provider: "dexscreener", state: "OK", snapshot: snap({}) };
  const gt = snap({ buyers24h: 193, sellers24h: 235, buys24h: 9_999, sells24h: 9_999 });
  const merged = mergeTraderCounts(base, gt);
  assert.equal(merged.snapshot?.buyers24h, 193, "trader counts come from GT");
  assert.equal(merged.snapshot?.sellers24h, 235);
  // DexScreener already had buys/sells — GT must not overwrite them.
  assert.equal(merged.snapshot?.buys24h, 1_900);
  assert.equal(merged.snapshot?.sells24h, 2_000);
  // liquidity/volume stay DexScreener's (the chosen scan provider).
  assert.equal(merged.snapshot?.liquidityUsd, 20_000);
});
