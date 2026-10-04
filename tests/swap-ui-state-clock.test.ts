import test from "node:test";
import assert from "node:assert/strict";
import {
  toLocalClock,
  canExecuteStep,
  describePlanStatus,
  planResponseFromHttp,
  type StepGateInput,
} from "../lib/swap/ui-state";
import type { SwapPlanResponse, PlanView } from "../lib/swap/types";

function makeBasePlan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    venue: "direct",
    family: "direct-dex",
    pool: "0x0000000000000000000000000000000000000001",
    protocol: "v3",
    feeTier: 3000,
    tokenIn: "0x00000000000000000000000000000000000000aa",
    tokenOut: "0x00000000000000000000000000000000000000bb",
    tokenInDisplay: { symbol: "TOKENA", decimals: 18 },
    tokenOutDisplay: { symbol: "TOKENB", decimals: 18 },
    amountIn: "1000000000000000000",
    feeBps: 0,
    feeAmount: "0",
    feeAsset: "0x0000000000000000000000000000000000000000",
    feeRecipient: "0x0000000000000000000000000000000000000000",
    quotedOut: "990000000000000000",
    minOut: "980000000000000000",
    slippageBps: 50,
    slippageMode: "auto",
    priceImpactBps: 10,
    searchComplete: true,
    alternatives: [],
    excluded: [],
    deadline: 1_700_001_200, // Unix seconds (~20 min ahead of 1_700_000_000s)
    expiresAt: 1_700_000_045_000, // 45s in future (local ms)
    steps: [
      {
        kind: "swap",
        to: "0x0000000000000000000000000000000000000002",
        data: "0x",
        value: "0",
      },
    ],
    simulation: {
      status: "ok",
      measuredOut: "990000000000000000",
      gasEstimate: 100000n,
    },
    ...overrides,
  };
}

function makeGateInput(
  planOverrides: Partial<PlanView> = {},
  gateOverrides: Partial<StepGateInput> = {}
): StepGateInput {
  const plan = makeBasePlan(planOverrides);
  return {
    res: { status: "ready", plan },
    connected: true,
    wrongChain: false,
    now: 1_700_000_000_000,
    inputs: {
      tokenIn: plan.tokenIn,
      tokenOut: plan.tokenOut,
      amountIn: plan.amountIn,
      slippageBps: "auto",
    },
    busy: false,
    ...gateOverrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. toLocalClock: clock reconciliation and rebasing
// ─────────────────────────────────────────────────────────────────────────────

test("toLocalClock: rebases expiresAt with positive clock skew (client ahead of server)", () => {
  const serverTime = 1_700_000_000_000;
  const serverExpiresAt = 1_700_000_015_000; // 15s in future on server
  const clientNow = 1_700_000_060_000; // Client clock is +60s ahead
  const plan = makeBasePlan({ expiresAt: serverExpiresAt });
  const res: SwapPlanResponse = { status: "ready", plan };

  const rebased = toLocalClock(res, String(serverTime), clientNow);
  assert.equal(rebased.status, "ready");
  if (rebased.status === "ready") {
    const expected = serverExpiresAt - serverTime + clientNow;
    assert.equal(rebased.plan.expiresAt, expected);
    assert.equal(rebased.plan.expiresAt, 1_700_000_075_000);
    assert.ok(rebased.plan.expiresAt > clientNow);
  }
});

test("toLocalClock: rebases expiresAt with negative clock skew (client behind server)", () => {
  const serverTime = 1_700_000_000_000;
  const serverExpiresAt = 1_700_000_015_000; // 15s in future on server
  const clientNow = 1_699_999_940_000; // Client clock is -60s behind
  const plan = makeBasePlan({ expiresAt: serverExpiresAt });
  const res: SwapPlanResponse = { status: "ready", plan };

  const rebased = toLocalClock(res, String(serverTime), clientNow);
  assert.equal(rebased.status, "ready");
  if (rebased.status === "ready") {
    const expected = serverExpiresAt - serverTime + clientNow;
    assert.equal(rebased.plan.expiresAt, expected);
    assert.equal(rebased.plan.expiresAt, 1_699_999_955_000);
    assert.ok(rebased.plan.expiresAt > clientNow);
  }
});

test("toLocalClock: preserves already expired state under positive skew", () => {
  const serverTime = 1_700_000_000_000;
  const serverExpiresAt = 1_699_999_995_000; // Expired 5s ago on server
  const clientNow = 1_700_000_060_000; // Client clock is +60s ahead
  const plan = makeBasePlan({ expiresAt: serverExpiresAt });
  const res: SwapPlanResponse = { status: "ready", plan };

  const rebased = toLocalClock(res, String(serverTime), clientNow);
  assert.equal(rebased.status, "ready");
  if (rebased.status === "ready") {
    assert.equal(rebased.plan.expiresAt, 1_700_000_055_000);
    assert.ok(rebased.plan.expiresAt < clientNow);
  }
});

test("toLocalClock: preserves non-ready statuses unmodified", () => {
  const responses: SwapPlanResponse[] = [
    { status: "disabled", detail: "Disabled" },
    { status: "fee-unconfigured", detail: "Fee error" },
    { status: "config-unavailable" },
    { status: "invalid", detail: "Invalid request" },
    { status: "unsupported-pair", detail: "Unsupported" },
    { status: "no-route", searchComplete: true, excluded: [] },
    { status: "quote-unavailable", detail: "Quote unavailable" },
  ];

  for (const resp of responses) {
    const result = toLocalClock(resp, "1700000000000", 1_700_000_000_000);
    assert.deepEqual(result, resp);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. toLocalClock: fail-closed (expiresAt=0) when clock cannot be reconciled
// ─────────────────────────────────────────────────────────────────────────────

test("toLocalClock: sets expiresAt=0 when x-server-time header is missing or empty", () => {
  const plan = makeBasePlan({ expiresAt: 1_700_000_015_000 });
  const res: SwapPlanResponse = { status: "ready", plan };
  const clientNow = 1_700_000_000_000;

  // null header
  const nullHeaderRes = toLocalClock(res, null, clientNow);
  assert.equal(nullHeaderRes.status, "ready");
  if (nullHeaderRes.status === "ready") {
    assert.equal(nullHeaderRes.plan.expiresAt, 0);
  }

  // empty string header
  const emptyHeaderRes = toLocalClock(res, "", clientNow);
  assert.equal(emptyHeaderRes.status, "ready");
  if (emptyHeaderRes.status === "ready") {
    assert.equal(emptyHeaderRes.plan.expiresAt, 0);
  }

  // whitespace string header
  const whitespaceHeaderRes = toLocalClock(res, "   ", clientNow);
  assert.equal(whitespaceHeaderRes.status, "ready");
  if (whitespaceHeaderRes.status === "ready") {
    assert.equal(whitespaceHeaderRes.plan.expiresAt, 0);
  }
});

test("toLocalClock: sets expiresAt=0 when x-server-time header is non-numeric or non-finite", () => {
  const plan = makeBasePlan({ expiresAt: 1_700_000_015_000 });
  const res: SwapPlanResponse = { status: "ready", plan };
  const clientNow = 1_700_000_000_000;

  const malformedHeaders = ["not-a-number", "NaN", "Infinity", "-Infinity", "123abc", "undefined", "null"];
  for (const hdr of malformedHeaders) {
    const result = toLocalClock(res, hdr, clientNow);
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.equal(result.plan.expiresAt, 0, `Expected expiresAt=0 for header "${hdr}"`);
    }
  }
});

test("toLocalClock: sets expiresAt=0 when x-server-time header is non-positive", () => {
  const plan = makeBasePlan({ expiresAt: 1_700_000_015_000 });
  const res: SwapPlanResponse = { status: "ready", plan };
  const clientNow = 1_700_000_000_000;

  const nonPositiveHeaders = ["0", "-1", "-1700000000000"];
  for (const hdr of nonPositiveHeaders) {
    const result = toLocalClock(res, hdr, clientNow);
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.equal(result.plan.expiresAt, 0, `Expected expiresAt=0 for header "${hdr}"`);
    }
  }
});

test("toLocalClock: sets expiresAt=0 when localNowMs is non-positive or non-finite", () => {
  const plan = makeBasePlan({ expiresAt: 1_700_000_015_000 });
  const res: SwapPlanResponse = { status: "ready", plan };
  const validHdr = "1700000000000";

  const invalidLocalTimes = [0, -1, NaN, Infinity, -Infinity];
  for (const localTime of invalidLocalTimes) {
    const result = toLocalClock(res, validHdr, localTime);
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.equal(result.plan.expiresAt, 0, `Expected expiresAt=0 for localNowMs=${localTime}`);
    }
  }
});

test("toLocalClock: sets expiresAt=0 when plan.expiresAt is missing, non-numeric, non-finite, or non-positive", () => {
  const clientNow = 1_700_000_000_000;
  const validHdr = "1700000000000";

  const invalidExpiries = [
    undefined as unknown as number,
    null as unknown as number,
    "1700000015000" as unknown as number,
    NaN,
    Infinity,
    -Infinity,
    0,
    -1000,
  ];

  for (const expiry of invalidExpiries) {
    const plan = makeBasePlan({ expiresAt: expiry });
    const res: SwapPlanResponse = { status: "ready", plan };
    const result = toLocalClock(res, validHdr, clientNow);
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.equal(result.plan.expiresAt, 0, `Expected expiresAt=0 for plan.expiresAt=${expiry}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. canExecuteStep: expiration rejection (absent, NaN, Infinity, <= 0, expired)
// ─────────────────────────────────────────────────────────────────────────────

test("canExecuteStep: permits execution for valid fresh plan with valid clock and deadline", () => {
  const input = makeGateInput();
  assert.equal(canExecuteStep(input), true);
});

test("canExecuteStep: rejects plan when expiresAt is 0 (unreconciled clock)", () => {
  const input = makeGateInput({ expiresAt: 0 });
  assert.equal(canExecuteStep(input), false);
});

test("canExecuteStep: rejects plan when expiresAt is absent (undefined or null)", () => {
  const inputUndefined = makeGateInput({ expiresAt: undefined as unknown as number });
  assert.equal(canExecuteStep(inputUndefined), false);

  const inputNull = makeGateInput({ expiresAt: null as unknown as number });
  assert.equal(canExecuteStep(inputNull), false);
});

test("canExecuteStep: rejects plan when expiresAt is NaN", () => {
  const input = makeGateInput({ expiresAt: NaN });
  assert.equal(canExecuteStep(input), false);
});

test("canExecuteStep: rejects plan when expiresAt is Infinity or -Infinity", () => {
  const inputPosInf = makeGateInput({ expiresAt: Infinity });
  assert.equal(canExecuteStep(inputPosInf), false);

  const inputNegInf = makeGateInput({ expiresAt: -Infinity });
  assert.equal(canExecuteStep(inputNegInf), false);
});

test("canExecuteStep: rejects plan when expiresAt is negative", () => {
  const input = makeGateInput({ expiresAt: -1000 });
  assert.equal(canExecuteStep(input), false);
});

test("canExecuteStep: rejects plan when expiresAt has passed (now >= expiresAt)", () => {
  const inputExact = makeGateInput({ expiresAt: 1_700_000_000_000 }, { now: 1_700_000_000_000 });
  assert.equal(canExecuteStep(inputExact), false);

  const inputPast = makeGateInput({ expiresAt: 1_699_999_999_000 }, { now: 1_700_000_000_000 });
  assert.equal(canExecuteStep(inputPast), false);
});

test("canExecuteStep: rejects when now timestamp is invalid (NaN, Infinity, non-positive)", () => {
  assert.equal(canExecuteStep(makeGateInput({}, { now: NaN })), false);
  assert.equal(canExecuteStep(makeGateInput({}, { now: Infinity })), false);
  assert.equal(canExecuteStep(makeGateInput({}, { now: 0 })), false);
  assert.equal(canExecuteStep(makeGateInput({}, { now: -1000 })), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. canExecuteStep: deadline rejection (absent, NaN, Infinity, <= 0, passed)
// ─────────────────────────────────────────────────────────────────────────────

test("canExecuteStep: rejects plan when deadline is absent (undefined or null)", () => {
  const inputUndefined = makeGateInput({ deadline: undefined as unknown as number });
  assert.equal(canExecuteStep(inputUndefined), false);

  const inputNull = makeGateInput({ deadline: null as unknown as number });
  assert.equal(canExecuteStep(inputNull), false);
});

test("canExecuteStep: rejects plan when deadline is NaN", () => {
  const input = makeGateInput({ deadline: NaN });
  assert.equal(canExecuteStep(input), false);
});

test("canExecuteStep: rejects plan when deadline is Infinity or -Infinity", () => {
  const inputPosInf = makeGateInput({ deadline: Infinity });
  assert.equal(canExecuteStep(inputPosInf), false);

  const inputNegInf = makeGateInput({ deadline: -Infinity });
  assert.equal(canExecuteStep(inputNegInf), false);
});

test("canExecuteStep: rejects plan when deadline is 0 or negative", () => {
  const inputZero = makeGateInput({ deadline: 0 });
  assert.equal(canExecuteStep(inputZero), false);

  const inputNeg = makeGateInput({ deadline: -100 });
  assert.equal(canExecuteStep(inputNeg), false);
});

test("canExecuteStep: rejects plan when deadline (seconds) has already passed", () => {
  // now is 1_700_000_000_000 ms (1_700_000_000 s)
  // deadline is 1_699_999_900 s (past)
  const inputPastSec = makeGateInput({ deadline: 1_699_999_900 }, { now: 1_700_000_000_000 });
  assert.equal(canExecuteStep(inputPastSec), false);

  // deadline exactly now in seconds
  const inputExactSec = makeGateInput({ deadline: 1_700_000_000 }, { now: 1_700_000_000_000 });
  assert.equal(canExecuteStep(inputExactSec), false);
});

test("canExecuteStep: rejects plan when deadline (milliseconds) has already passed", () => {
  // now is 1_700_000_000_000 ms
  // deadline is 1_699_999_900_000 ms (past)
  const inputPastMs = makeGateInput({ deadline: 1_699_999_900_000 }, { now: 1_700_000_000_000 });
  assert.equal(canExecuteStep(inputPastMs), false);
});

test("canExecuteStep: accepts plan when deadline is in the future (seconds and ms formats)", () => {
  // Future in seconds: 1_700_001_200 s > 1_700_000_000 s
  const inputSec = makeGateInput({ deadline: 1_700_001_200 }, { now: 1_700_000_000_000 });
  assert.equal(canExecuteStep(inputSec), true);

  // Future in milliseconds: 1_700_001_200_000 ms > 1_700_000_000_000 ms
  const inputMs = makeGateInput({ deadline: 1_700_001_200_000 }, { now: 1_700_000_000_000 });
  assert.equal(canExecuteStep(inputMs), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. End-to-End behavioral tests: HTTP response -> toLocalClock -> canExecuteStep
// ─────────────────────────────────────────────────────────────────────────────

test("pipeline: plan with missing x-server-time header fails closed and cannot execute", () => {
  const serverExpiresAt = 1_700_000_015_000;
  const clientNow = 1_700_000_000_000;
  const rawResponse: SwapPlanResponse = {
    status: "ready",
    plan: makeBasePlan({ expiresAt: serverExpiresAt }),
  };

  // Missing x-server-time header
  const reconciled = toLocalClock(rawResponse, null, clientNow);
  const gateResult = canExecuteStep(makeGateInput(reconciled.status === "ready" ? reconciled.plan : {}, { now: clientNow }));

  assert.equal(reconciled.status === "ready" && reconciled.plan.expiresAt, 0);
  assert.equal(gateResult, false, "Plan with missing x-server-time header must not execute");
});

test("pipeline: plan with malformed x-server-time header fails closed and cannot execute", () => {
  const serverExpiresAt = 1_700_000_015_000;
  const clientNow = 1_700_000_000_000;
  const rawResponse: SwapPlanResponse = {
    status: "ready",
    plan: makeBasePlan({ expiresAt: serverExpiresAt }),
  };

  for (const badHdr of ["not-a-number", "0", "-1000", "Infinity", "NaN", ""]) {
    const reconciled = toLocalClock(rawResponse, badHdr, clientNow);
    assert.equal(reconciled.status === "ready" && reconciled.plan.expiresAt, 0);

    const gateResult = canExecuteStep(makeGateInput(reconciled.status === "ready" ? reconciled.plan : {}, { now: clientNow }));
    assert.equal(gateResult, false, `Plan with bad header "${badHdr}" must not execute`);
  }
});

test("pipeline: plan with malformed server expiresAt fails closed and cannot execute", () => {
  const serverTime = "1700000000000";
  const clientNow = 1_700_000_000_000;

  for (const badExpiry of [NaN, Infinity, 0, -500, undefined as unknown as number]) {
    const rawResponse: SwapPlanResponse = {
      status: "ready",
      plan: makeBasePlan({ expiresAt: badExpiry }),
    };

    const reconciled = toLocalClock(rawResponse, serverTime, clientNow);
    assert.equal(reconciled.status === "ready" && reconciled.plan.expiresAt, 0);

    const gateResult = canExecuteStep(makeGateInput(reconciled.status === "ready" ? reconciled.plan : {}, { now: clientNow }));
    assert.equal(gateResult, false, `Plan with malformed expiry ${badExpiry} must not execute`);
  }
});

test("pipeline: valid response with clock skew correctly enables execution for fresh plan", () => {
  const serverTime = 1_700_000_000_000;
  const serverExpiresAt = 1_700_000_015_000; // 15s in future on server
  const clientNow = 1_700_000_060_000; // Browser clock is 60s ahead
  const rawResponse: SwapPlanResponse = {
    status: "ready",
    plan: makeBasePlan({ expiresAt: serverExpiresAt, deadline: 1_700_001_200 }),
  };

  const reconciled = toLocalClock(rawResponse, String(serverTime), clientNow);
  assert.equal(reconciled.status, "ready");
  if (reconciled.status === "ready") {
    assert.equal(rebasedRemainingMs(reconciled.plan.expiresAt, clientNow), 15_000);
    const gateResult = canExecuteStep(makeGateInput(reconciled.plan, { now: clientNow }));
    assert.equal(gateResult, true, "Fresh plan with rebased clock skew must be executable");
  }
});

test("pipeline: valid response with clock skew correctly blocks execution for expired plan", () => {
  const serverTime = 1_700_000_000_000;
  const serverExpiresAt = 1_699_999_995_000; // Expired 5s ago on server
  const clientNow = 1_700_000_060_000; // Browser clock is 60s ahead
  const rawResponse: SwapPlanResponse = {
    status: "ready",
    plan: makeBasePlan({ expiresAt: serverExpiresAt }),
  };

  const reconciled = toLocalClock(rawResponse, String(serverTime), clientNow);
  assert.equal(reconciled.status, "ready");
  if (reconciled.status === "ready") {
    const gateResult = canExecuteStep(makeGateInput(reconciled.plan, { now: clientNow }));
    assert.equal(gateResult, false, "Expired plan with rebased clock skew must not be executable");
  }
});

function rebasedRemainingMs(expiresAt: number, clientNow: number): number {
  return expiresAt - clientNow;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. quote-unavailable and HTTP status mapping
// ─────────────────────────────────────────────────────────────────────────────

test("describePlanStatus: maps simulation-failed reason to non-technical verification failure", () => {
  const res: SwapPlanResponse = {
    status: "quote-unavailable",
    detail: "The available route could not settle in simulation.",
    reason: "simulation-failed",
  };
  const desc = describePlanStatus(res);
  assert.equal(desc.tone, "warn");
  assert.equal(desc.sentence, "This route failed its test run on chain. Try again in a moment.");
});

// The copy follows the reason, never words inside detail: a node fault must not read as a failed route.
test("describePlanStatus: a transport fault says we could not check, and detail text is not parsed", () => {
  const transport = describePlanStatus({ status: "quote-unavailable", detail: "simulation settle 429", reason: "transport" });
  assert.equal(transport.sentence, "We couldn't check this trade just now. Try again in a moment.");
  const unlabelled = describePlanStatus({ status: "quote-unavailable", detail: "The available route could not settle in simulation." });
  assert.equal(unlabelled.sentence, "Could not get a quote. Try again.");
});

test("describePlanStatus: maps rate-limited reason to plain rate limit copy", () => {
  const resReason: SwapPlanResponse = {
    status: "quote-unavailable",
    detail: "Too many requests",
    reason: "rate-limited",
  };
  assert.equal(
    describePlanStatus(resReason).sentence,
    "Too many requests. Please wait a moment and try again."
  );
});

test("describePlanStatus: maps generic quote failure to plain retry sentence", () => {
  const res: SwapPlanResponse = {
    status: "quote-unavailable",
    detail: "Service error",
  };
  const desc = describePlanStatus(res);
  assert.equal(desc.tone, "warn");
  assert.equal(desc.sentence, "Could not get a quote. Try again.");
});

test("planResponseFromHttp: classifies 429 as rate-limited quote-unavailable", () => {
  const plan = planResponseFromHttp(429, null);
  assert.equal(plan.status, "quote-unavailable");
  if (plan.status === "quote-unavailable") {
    assert.equal(plan.reason, "rate-limited");
    assert.ok(plan.detail.includes("429"));
  }
});

test("planResponseFromHttp: classifies 500 as transport quote-unavailable", () => {
  const plan = planResponseFromHttp(500, null);
  assert.equal(plan.status, "quote-unavailable");
  if (plan.status === "quote-unavailable") {
    assert.equal(plan.reason, "transport");
    assert.ok(plan.detail.includes("500"));
  }
});

