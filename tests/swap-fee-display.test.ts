import test from "node:test";
import assert from "node:assert/strict";
import type { PlanView } from "../lib/swap/types";
import { formatPoolFeeTier, selectedPoolFeeSummary } from "../lib/swap/fee-display";

test("pool tiers render as percentages and V4 dynamic flag is not rendered as a rate", () => {
  assert.equal(formatPoolFeeTier(3_000), "0.3%");
  assert.equal(formatPoolFeeTier(10_000), "1%");
  assert.equal(formatPoolFeeTier(0x800000), "dynamic rate unavailable");
  assert.equal(formatPoolFeeTier(null), "rate unavailable");
});

test("fee summary exposes unknown V4 hook fees without treating them as zero", () => {
  const plan = {
    protocol: "v4",
    route: {
      hops: [{
        protocol: "v4",
        feeTier: 0,
        hookAddress: "0x0000000000000000000000000000000000000001",
        hookFeeStatus: "unknown",
        tokenIn: "0x0000000000000000000000000000000000000002",
        tokenOut: "0x0000000000000000000000000000000000000003",
        pool: null,
      }],
    },
  } as PlanView;

  assert.deepEqual(selectedPoolFeeSummary(plan), [
    { label: "V4 pool fee", value: "0%" },
    { label: "V4 hook fee", value: "unknown; unavailable" },
  ]);
});

test("aggregator quote does not claim a pool fee when route details are absent", () => {
  const plan = { protocol: "aggregator" } as PlanView;
  assert.deepEqual(selectedPoolFeeSummary(plan), [
    { label: "Underlying pool fees", value: "not provided by quote" },
  ]);
});
