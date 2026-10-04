import test from "node:test";
import assert from "node:assert/strict";
import { _saleSwapInternals } from "../app/token-sale/TokenSaleSwap";

/**
 * useMax's floor onto the contribution-step grid. The function under test is
 * THE component's own arithmetic, imported through the file's test seam — a
 * private copy here would keep passing after a change to the real one (§8 #10).
 * The bug this guards: balance - gas-reserve is essentially never a whole
 * multiple of CONTRIBUTION_STEP, so the raw value was rejected by the
 * contract's NotStepMultiple admission and the CONTRIBUTE button died on every
 * click.
 */
const { floorToStep } = _saleSwapInternals;

const ETH = 10n ** 18n;
const STEP = ETH / 1000n; // the chain's 0.001 ETH step

test("useMax floors the gas reserve onto the step grid", () => {
  // balance 1.234567 ETH − 0.01 reserve = 1.224567 → floors to 1.224
  const max = 1234567000000000000n - ETH / 100n;
  assert.equal(floorToStep(max, STEP), 1224000000000000000n);
});

test("useMax never emits a value the step rule rejects", () => {
  for (const balance of [ETH, 12345678901234567n * 1000n, (ETH * 3n) / 7n]) {
    const max = balance > ETH / 100n ? balance - ETH / 100n : 0n;
    const floored = floorToStep(max, STEP);
    if (floored > 0n) assert.equal(floored % STEP, 0n, `${floored} is off-grid`);
  }
});

test("a floored max that collapses to zero emits nothing", () => {
  // balance just above the reserve: raw max is positive but under one step
  // (reserve = 0.01 ETH, so the raw max here is 5 wei; one step is 0.001 ETH)
  assert.equal(floorToStep(ETH / 100n + 5n - ETH / 100n, STEP), 0n);
});

test("an unread step leaves the raw value standing (fails open)", () => {
  const max = 1224567000000000000n;
  assert.equal(floorToStep(max, undefined), max);
});

test("MAX spends the wallet down to a small measured gas reserve, on the step grid", () => {
  const { maxContribution, GAS_RESERVE_WEI } = _saleSwapInternals;
  assert.ok(GAS_RESERVE_WEI <= ETH / 10_000n, "the reserve stays a gas-sized amount, not a slice of the wallet");
  // The operator's wallet: 0.0151 ETH used to give 0.005 under the 0.01 reserve.
  assert.equal(maxContribution(15_100_000_000_000_000n, STEP), 15_000_000_000_000_000n);
  assert.equal(maxContribution(GAS_RESERVE_WEI, STEP), 0n, "nothing left after gas is nothing to send");
});
