import test from "node:test";
import assert from "node:assert/strict";
import {
  computePlanFingerprint,
  comparePlansForReview,
  getTaxDisclosure,
  formatVenueDisplay,
  formatPriceImpact,
  formatBaseUnits,
  calculateMaxNativeAmount,
  serializeTokenForStorage,
  deserializeTokenFromStorage,
  validateExactRawBalance,
  measuredGasReserveWei,
} from "../lib/trade/quote-review";
import type { PlanView, PlanStep, Address } from "../lib/swap/types";
import type { SelectableToken } from "../lib/trade/types";

const TOKEN_A = "0x0000000000000000000000000000000000000000" as Address; // NATIVE
const TOKEN_B = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address; // USDG
const POOL_A = "0x1111111111111111111111111111111111111111" as Address;
const POOL_B = "0x2222222222222222222222222222222222222222" as Address;
const ROUTER_A = "0x3333333333333333333333333333333333333333" as Address;
const ROUTER_B = "0x4444444444444444444444444444444444444444" as Address;
const FEE_RECIPIENT = "0x5555555555555555555555555555555555555555" as Address;

const samplePlan: PlanView = {
  venue: "uniswap-ur",
  family: "uniswap",
  pool: POOL_A,
  protocol: "v3",
  feeTier: 500,
  tokenIn: TOKEN_A,
  tokenOut: TOKEN_B,
  tokenInDisplay: { symbol: "ETH", decimals: 18 },
  tokenOutDisplay: { symbol: "USDG", decimals: 6 },
  amountIn: "1000000000000000000", // 1 ETH
  feeBps: 50,
  feeAmount: "5000000000000000", // 0.005 ETH
  feeAsset: TOKEN_A,
  feeRecipient: FEE_RECIPIENT,
  quotedOut: "2500000000", // 2,500 USDG
  minOut: "2487500000", // 2,487.50 USDG
  slippageBps: 50,
  slippageMode: "auto",
  priceImpactBps: 12,
  searchComplete: true,
  alternatives: [],
  excluded: [],
  deadline: 1700001000,
  expiresAt: 1700000045,
  steps: [
    {
      kind: "swap",
      tx: {
        to: ROUTER_A,
        data: "0x123456",
        value: "1000000000000000000",
        chainId: 4663,
      },
    },
  ],
  simulation: {
    status: "ok",
    measuredOut: "2498000000",
    feePaid: "5000000000000000",
    gasUsed: "125000",
  },
};

// ---------------------------------------------------------------------------
// 1. Truthful Review Fingerprint & Material Change Detection (A03 / Req 2)
// ---------------------------------------------------------------------------

test("computePlanFingerprint: deterministic string representation", () => {
  const fp1 = computePlanFingerprint(samplePlan);
  const fp2 = computePlanFingerprint({ ...samplePlan });
  assert.equal(fp1, fp2);
  assert.match(fp1, /uniswap-ur/);
  assert.match(fp1, /2498000000/); // measuredOut
});

test("comparePlansForReview: returns materiallyChanged false for identical plans", () => {
  const comparison = comparePlansForReview(samplePlan, { ...samplePlan });
  assert.equal(comparison.materiallyChanged, false);
  assert.equal(comparison.reasons.length, 0);
});

test("comparePlansForReview: detects material venue change", () => {
  const freshPlan: PlanView = {
    ...samplePlan,
    venue: "pancake-v3-ur",
  };
  const diff = comparePlansForReview(samplePlan, freshPlan);
  assert.equal(diff.materiallyChanged, true);
  assert.match(diff.reasons[0], /Venue changed/);
});

test("comparePlansForReview: detects material pool change", () => {
  const freshPlan: PlanView = {
    ...samplePlan,
    pool: POOL_B,
  };
  const diff = comparePlansForReview(samplePlan, freshPlan);
  assert.equal(diff.materiallyChanged, true);
  assert.match(diff.reasons[0], /Pool changed/);
});

test("comparePlansForReview: detects material amountIn change", () => {
  const freshPlan: PlanView = {
    ...samplePlan,
    amountIn: "2000000000000000000",
  };
  const diff = comparePlansForReview(samplePlan, freshPlan);
  assert.equal(diff.materiallyChanged, true);
  assert.match(diff.reasons[0], /Input amount changed/);
});

test("comparePlansForReview: detects material fee change (bps, amount, or asset)", () => {
  const feeBpsPlan: PlanView = { ...samplePlan, feeBps: 100 };
  assert.equal(comparePlansForReview(samplePlan, feeBpsPlan).materiallyChanged, true);

  // L213 #7: a sell's fee follows its output, so a fee AMOUNT change alone is logged, never a stop.
  const feeAmtPlan: PlanView = { ...samplePlan, feeAmount: "10000000000000000" };
  const feeAmt = comparePlansForReview(samplePlan, feeAmtPlan);
  assert.equal(feeAmt.materiallyChanged, false);
  assert.equal(feeAmt.interrupt, null);
  assert.match(feeAmt.reasons[0], /Fee amount changed/);

  const feeAssetPlan: PlanView = { ...samplePlan, feeAsset: TOKEN_B };
  assert.equal(comparePlansForReview(samplePlan, feeAssetPlan).materiallyChanged, true);
});

test("comparePlansForReview: a price move stops only past half the slippage, in token units", () => {
  const small = comparePlansForReview(samplePlan, { ...samplePlan, minOut: "2486000000",
    simulation: { status: "ok", measuredOut: "2496000000", feePaid: "5000000000000000", gasUsed: "125000" } });
  assert.equal(small.interrupt, null, "8 bps against a 50 bps tolerance re-prices silently");
  assert.match(small.reasons.join(";"), /Minimum output changed/);

  const better = comparePlansForReview(samplePlan, { ...samplePlan,
    simulation: { status: "ok", measuredOut: "2600000000", feePaid: "5000000000000000", gasUsed: "125000" } });
  assert.equal(better.interrupt, null);

  const worse = comparePlansForReview(samplePlan, { ...samplePlan,
    simulation: { status: "ok", measuredOut: "2480000000", feePaid: "5000000000000000", gasUsed: "125000" } });
  assert.equal(worse.materiallyChanged, true);
  assert.equal(worse.interrupt, "The price moved. You now get about 2480 USDG, down from 2498. Review and confirm again.");
  assert.doesNotMatch(worse.interrupt ?? "", /\d{9,}|—/, "no raw base units, no em dash");
});

test("comparePlansForReview: detects measured output change and simulation status change", () => {
  const measuredChanged: PlanView = {
    ...samplePlan,
    simulation: {
      status: "ok",
      measuredOut: "2480000000",
      feePaid: "5000000000000000",
      gasUsed: "125000",
    },
  };
  const diff1 = comparePlansForReview(samplePlan, measuredChanged);
  assert.equal(diff1.materiallyChanged, true);
  assert.match(diff1.reasons[0], /Measured output changed/);

  const simReverted: PlanView = {
    ...samplePlan,
    simulation: { status: "reverted", reason: "STF" },
  };
  const diff2 = comparePlansForReview(samplePlan, simReverted);
  assert.equal(diff2.materiallyChanged, true);
  assert.match(diff2.reasons[0], /Simulation status changed/);
});

test("comparePlansForReview: detects slippage tolerance change", () => {
  const freshPlan: PlanView = {
    ...samplePlan,
    slippageBps: 100,
  };
  const diff = comparePlansForReview(samplePlan, freshPlan);
  assert.equal(diff.materiallyChanged, true);
  assert.match(diff.reasons[0], /Slippage changed/);
});

test("comparePlansForReview: step progression handling", () => {
  const planWithApprove: PlanView = {
    ...samplePlan,
    steps: [
      {
        kind: "approve",
        token: TOKEN_A,
        spender: ROUTER_A,
        amount: "1000000000000000000",
        tx: { to: TOKEN_A, data: "0x095ea7b3", value: "0", chainId: 4663 },
      },
      samplePlan.steps[0],
    ],
  };

  // Without allowStepProgression: step count mismatch is a material change
  const diff1 = comparePlansForReview(planWithApprove, samplePlan, {
    allowStepProgression: false,
  });
  assert.equal(diff1.materiallyChanged, true);
  assert.match(diff1.reasons[0], /Step count changed/);

  // With allowStepProgression: normal step transition (approve completed -> swap) is accepted if core terms match
  const diff2 = comparePlansForReview(planWithApprove, samplePlan, {
    allowStepProgression: true,
  });
  assert.equal(diff2.materiallyChanged, false);

  // With allowStepProgression: a price that fell below the reviewed floor during approval still stops
  const driftedPlan: PlanView = {
    ...samplePlan,
    minOut: "2400000000",
    simulation: { status: "ok", measuredOut: "2420000000", feePaid: "5000000000000000", gasUsed: "125000" },
  };
  const diff3 = comparePlansForReview(planWithApprove, driftedPlan, {
    allowStepProgression: true,
  });
  assert.equal(diff3.materiallyChanged, true);
  assert.match(diff3.interrupt ?? "", /^The price moved/);
});

// ---------------------------------------------------------------------------
// 2. Taxed Output Disclosure (A01 / Requirement 3)
// ---------------------------------------------------------------------------

test("getTaxDisclosure: ERC20 output tokens disclose gross floor and estimate nature", () => {
  const disclosure = getTaxDisclosure({
    isNative: false,
    tokenSymbol: "MEME",
    tokenAddress: "0x9999999999999999999999999999999999999999",
  });

  assert.equal(disclosure.isTaxApplicable, true);
  assert.match(disclosure.recipientAmountLabel, /Estimate/);
  assert.match(disclosure.minOutLabel, /Router Gross Floor/);
  assert.match(disclosure.disclosureText, /recipient net received can fall below the displayed minimum/);
  assert.match(disclosure.warningText!, /not a guaranteed net recipient minimum/);
});

test("getTaxDisclosure: native ETH output clarifies direct transfer without token taxes", () => {
  const disclosure = getTaxDisclosure({
    isNative: true,
    tokenSymbol: "ETH",
    tokenAddress: TOKEN_A,
  });

  assert.equal(disclosure.isTaxApplicable, false);
  assert.match(disclosure.recipientAmountLabel, /Simulated Net Recipient Output/);
  assert.match(disclosure.minOutLabel, /Minimum Recipient Output/);
  assert.match(disclosure.disclosureText, /without token transfer taxes/);
  assert.equal(disclosure.warningText, undefined);
});

// ---------------------------------------------------------------------------
// 3. Max Native Gas Reserve (A02 / Requirement 5)
// ---------------------------------------------------------------------------

test("calculateMaxNativeAmount: uses measured simulation gas budget when available", () => {
  const result = calculateMaxNativeAmount({
    rawBalance: 1_000_000_000_000_000_000n, // 1 ETH
    measuredGasUsed: "120000",
    gasPriceWei: "1000000000", // 1 gwei
  });

  assert.equal(result.isMeasured, true);
  assert.equal(result.status, "measured");
  // reserve = SWAP_GAS_LIMIT (2M) * 1 gwei * maxFee x2 * 1.25 = 0.005 ETH
  const expectedReserve = 5_000_000_000_000_000n;
  assert.equal(result.gasReserveWei, expectedReserve);
  assert.equal(result.usableAmountWei, 1_000_000_000_000_000_000n - expectedReserve);
});

test("Max leaves enough ETH for its own test run to fund gas (MEME 2026-09-29)", async () => {
  const { SWAP_GAS_LIMIT, SIM_MAX_FEE_MULTIPLIER } = await import("../lib/swap/types");
  // Measured on 4663: balance 0.149615859 ETH, swap used ~131k gas, base fee ~0.0201 gwei.
  const rawBalance = 149_615_859_047_586_622n;
  const gasPrice = 20_090_000n;
  const r = calculateMaxNativeAmount({ rawBalance, measuredGasUsed: "131000", gasPriceWei: gasPrice });
  const simNeeds = SWAP_GAS_LIMIT * gasPrice * SIM_MAX_FEE_MULTIPLIER;
  assert.ok(rawBalance - r.usableAmountWei >= simNeeds, "the validated simulation must be fundable at Max");
  // The old reserve (gasUsed * price * 1.2) left 0.00000315 ETH and failed every Max test run.
  assert.ok(r.gasReserveWei > 131_000n * gasPrice * 12n / 10n * 10n);
  // A huge swap still gets twice its measured gas.
  assert.equal(measuredGasReserveWei(5_000_000n, 1n), 10_000_000n * 2n * 125n / 100n);
});

test("calculateMaxNativeAmount: falls back to explicit conservative unmeasured reserve", () => {
  const result = calculateMaxNativeAmount({
    rawBalance: 1_000_000_000_000_000_000n, // 1 ETH
    // no measured gasUsed / gasPrice
  });

  assert.equal(result.isMeasured, false);
  assert.equal(result.status, "conservative_estimate");
  assert.match(result.label, /unmeasured/);
  assert.equal(result.gasReserveWei, 500_000_000_000_000n); // 0.0005 ETH
  assert.equal(result.usableAmountWei, 1_000_000_000_000_000_000n - 500_000_000_000_000n);
});

test("calculateMaxNativeAmount: refuses exact max when balance is below reserve", () => {
  const result = calculateMaxNativeAmount({
    rawBalance: 100_000_000_000_000n, // 0.0001 ETH
    // no measured gasUsed / gasPrice (conservative reserve = 0.0005 ETH)
  });

  assert.equal(result.status, "insufficient_balance");
  assert.equal(result.usableAmountWei, 0n);
  assert.match(result.reason!, /less than conservative gas reserve/);
});

// ---------------------------------------------------------------------------
// 4. Safe LocalStorage DTO Serialization (A02 / Requirement 5)
// ---------------------------------------------------------------------------

test("serializeTokenForStorage: serializes SelectableToken with BigInt rawBalance without throwing", () => {
  const tokenWithBigInt: SelectableToken = {
    symbol: "USDG",
    name: "Global Dollar",
    address: TOKEN_B,
    decimals: 6,
    priceUsd: 1.0,
    priceEth: 0.0004,
    balance: 1000,
    rawBalance: 1_000_000_000n, // BigInt
    category: "crypto",
  };

  // Direct JSON.stringify would throw: "TypeError: Do not know how to serialize a BigInt"
  assert.throws(
    () => JSON.stringify(tokenWithBigInt),
    /Do not know how to serialize a BigInt/
  );

  // serializeTokenForStorage converts BigInt to string safely
  const dto = serializeTokenForStorage(tokenWithBigInt);
  assert.equal(typeof dto.rawBalance, "string");
  assert.equal(dto.rawBalance, "1000000000");

  const json = JSON.stringify(dto);
  assert.ok(json.includes('"rawBalance":"1000000000"'));

  // Deserialization safely restores the token and recovers rawBalance as BigInt
  const recovered = deserializeTokenFromStorage(JSON.parse(json));
  assert.ok(recovered);
  assert.equal(recovered.symbol, "USDG");
  assert.equal(recovered.rawBalance, 1_000_000_000n);
  assert.equal(typeof recovered.rawBalance, "bigint");
});

test("deserializeTokenFromStorage: handles missing rawBalance or malformed data gracefully", () => {
  const recovered1 = deserializeTokenFromStorage({
    symbol: "ETH",
    address: TOKEN_A,
    decimals: 18,
  });
  assert.ok(recovered1);
  assert.equal(recovered1.rawBalance, undefined);
  assert.equal(recovered1.decimals, 18);

  const recoveredNull = deserializeTokenFromStorage(null);
  assert.equal(recoveredNull, null);

  const recoveredInvalid = deserializeTokenFromStorage("not an object");
  assert.equal(recoveredInvalid, null);
});

// ---------------------------------------------------------------------------
// 5. Exact Base-Unit Formatting & Venue/Impact Display
// ---------------------------------------------------------------------------

test("formatBaseUnits: handles 0, 6, 18 decimals and null decimals fallback", () => {
  // 18 decimals (ETH)
  assert.equal(formatBaseUnits("1500000000000000000", 18), "1.5");
  // 6 decimals (USDG)
  assert.equal(formatBaseUnits("2500000000", 6), "2500");
  // 0 decimals
  assert.equal(formatBaseUnits("100", 0), "100");
  // Null decimals fallback (A02: panel shows base units rather than guessing)
  assert.equal(formatBaseUnits("123456789", null), "123456789 (base units)");
});

test("formatVenueDisplay: formats canonical venue names truthfully", () => {
  assert.equal(formatVenueDisplay("uniswap-ur", "v3"), "Uniswap Universal Router (V3)");
  assert.equal(
    formatVenueDisplay("pancake-infinity-ur"),
    "PancakeSwap Infinity Universal Router"
  );
  assert.equal(formatVenueDisplay("sushi-redsnwapper"), "Sushi RedSnwapper");
});

test("formatPriceImpact: truthfully returns Unknown when backend has null/undefined", () => {
  const unknown1 = formatPriceImpact(null);
  assert.equal(unknown1.isKnown, false);
  assert.equal(unknown1.formatted, "Unknown");

  const unknown2 = formatPriceImpact(undefined);
  assert.equal(unknown2.isKnown, false);
  assert.equal(unknown2.formatted, "Unknown");

  const known = formatPriceImpact(25); // 0.25%
  assert.equal(known.isKnown, true);
  assert.equal(known.formatted, "0.25%");
});

// ---------------------------------------------------------------------------
// 6. Exact Raw Balance & Decimal Validation (A02 Pure Test Seam)
// ---------------------------------------------------------------------------

test("validateExactRawBalance: 0 decimals token exact validation and sub-unit precision", () => {
  // Valid integer amount with 0 decimals
  const res1 = validateExactRawBalance({
    amount: "150",
    decimals: 0,
    rawBalance: 200n,
    tokenSymbol: "NFT",
  });
  assert.equal(res1.valid, true);
  assert.equal(res1.baseAmountIn, 150n);

  // Sub-unit precision rejected (decimals = 0, but user passed fraction)
  const res2 = validateExactRawBalance({
    amount: "150.5",
    decimals: 0,
    rawBalance: 200n,
    tokenSymbol: "NFT",
  });
  assert.equal(res2.valid, false);
  assert.match(res2.errorMsg!, /exceeds maximum precision of 0 decimal places/);
});

test("validateExactRawBalance: 6 decimals token (e.g. USDG) exact validation and precision", () => {
  // Valid 6-decimal amount
  const res1 = validateExactRawBalance({
    amount: "2500.123456",
    decimals: 6,
    rawBalance: 3_000_000_000n,
    tokenSymbol: "USDG",
  });
  assert.equal(res1.valid, true);
  assert.equal(res1.baseAmountIn, 2_500_123_456n);

  // Sub-unit precision rejected (7 decimals on a 6 decimal token)
  const res2 = validateExactRawBalance({
    amount: "2500.1234567",
    decimals: 6,
    rawBalance: 3_000_000_000n,
    tokenSymbol: "USDG",
  });
  assert.equal(res2.valid, false);
  assert.match(res2.errorMsg!, /exceeds maximum precision of 6 decimal places/);
});

test("validateExactRawBalance: 18 decimals token (e.g. ETH/WETH) exact validation and precision", () => {
  // Valid 18-decimal amount
  const res1 = validateExactRawBalance({
    amount: "1.5",
    decimals: 18,
    rawBalance: 2_000_000_000_000_000_000n,
    tokenSymbol: "WETH",
    isNative: false,
  });
  assert.equal(res1.valid, true);
  assert.equal(res1.baseAmountIn, 1_500_000_000_000_000_000n);

  // Sub-unit precision rejected (19 decimals on an 18 decimal token)
  const res2 = validateExactRawBalance({
    amount: "1.1234567890123456789",
    decimals: 18,
    rawBalance: 2_000_000_000_000_000_000n,
    tokenSymbol: "WETH",
  });
  assert.equal(res2.valid, false);
  assert.match(res2.errorMsg!, /exceeds maximum precision of 18 decimal places/);
});

test("validateExactRawBalance: exact precision for >2^53 raw units without float drift", () => {
  // 2^53 is 9_007_199_254_740_992 (~9e15).
  // An amount with 10^24 base units (> 2^53)
  const largeAmountStr = "1000000"; // 1,000,000 tokens with 18 decimals = 10^24 base units
  const exactUnits = 1_000_000_000_000_000_000_000_000n;

  // Exact match succeeds
  const res1 = validateExactRawBalance({
    amount: largeAmountStr,
    decimals: 18,
    rawBalance: exactUnits,
    tokenSymbol: "BIG",
    isNative: false,
  });
  assert.equal(res1.valid, true);
  assert.equal(res1.baseAmountIn, exactUnits);

  // Exactly 1 wei insufficient for >2^53 units fails closed (would be rounded to identical by IEEE 754 float!)
  const res2 = validateExactRawBalance({
    amount: largeAmountStr,
    decimals: 18,
    rawBalance: exactUnits - 1n,
    tokenSymbol: "BIG",
    isNative: false,
  });
  assert.equal(res2.valid, false);
  assert.match(res2.errorMsg!, /Insufficient BIG balance/);
});

test("validateExactRawBalance: insufficient by exactly one wei", () => {
  const amount = "1.0";
  const decimals = 18;
  const baseUnits = 1_000_000_000_000_000_000n; // 1 ETH

  // Raw balance is 1 wei short: 0.999999999999999999 ETH
  const rawBalance = baseUnits - 1n;

  const res = validateExactRawBalance({
    amount,
    decimals,
    rawBalance,
    tokenSymbol: "TOKEN",
    isNative: false,
  });

  assert.equal(res.valid, false);
  assert.match(res.errorMsg!, /Insufficient TOKEN balance/);
});

test("validateExactRawBalance: missing raw balance fails closed with wait/refresh message", () => {
  // undefined raw balance
  const res1 = validateExactRawBalance({
    amount: "1.0",
    decimals: 18,
    rawBalance: undefined,
    tokenSymbol: "ETH",
  });
  assert.equal(res1.valid, false);
  assert.match(res1.errorMsg!, /Token balance is still loading. Please wait or refresh/);

  // null raw balance
  const res2 = validateExactRawBalance({
    amount: "1.0",
    decimals: 18,
    rawBalance: null,
    tokenSymbol: "ETH",
  });
  assert.equal(res2.valid, false);
  assert.match(res2.errorMsg!, /Token balance is still loading. Please wait or refresh/);
});

test("validateExactRawBalance: raw balance 0n fails with insufficient balance", () => {
  const res = validateExactRawBalance({
    amount: "1.0",
    decimals: 18,
    rawBalance: 0n,
    tokenSymbol: "USDG",
    isNative: false,
  });
  assert.equal(res.valid, false);
  assert.match(res.errorMsg!, /Insufficient USDG balance/);
});

test("validateExactRawBalance: unknown or invalid decimals fails closed without guessing 18", () => {
  // undefined decimals
  const res1 = validateExactRawBalance({
    amount: "1.0",
    decimals: undefined,
    rawBalance: 1_000_000_000_000_000_000n,
    tokenSymbol: "UNKNOWN",
  });
  assert.equal(res1.valid, false);
  assert.match(res1.errorMsg!, /Token decimals metadata is unavailable/);

  // null decimals
  const res2 = validateExactRawBalance({
    amount: "1.0",
    decimals: null,
    rawBalance: 1_000_000_000_000_000_000n,
    tokenSymbol: "UNKNOWN",
  });
  assert.equal(res2.valid, false);
  assert.match(res2.errorMsg!, /Token decimals metadata is unavailable/);

  // negative decimals
  const res3 = validateExactRawBalance({
    amount: "1.0",
    decimals: -1,
    rawBalance: 1_000_000_000_000_000_000n,
    tokenSymbol: "UNKNOWN",
  });
  assert.equal(res3.valid, false);
  assert.match(res3.errorMsg!, /Token decimals metadata is unavailable/);
});

test("validateExactRawBalance: native balance covering tx value + measured gas budget", () => {
  const amount = "1.0"; // 1 ETH
  const baseUnits = 1_000_000_000_000_000_000n;
  const measuredGasUsed = "100000";
  const gasPriceWei = "1000000000"; // 1 gwei
  // gas budget = 2M gas limit * 1 gwei * 2 * 1.25 = 0.005 ETH
  const gasBudgetWei = 5_000_000_000_000_000n;

  // Case 1: Exactly covers amount + measured budget
  const res1 = validateExactRawBalance({
    amount,
    decimals: 18,
    rawBalance: baseUnits + gasBudgetWei,
    tokenSymbol: "ETH",
    isNative: true,
    measuredGasUsed,
    gasPriceWei,
  });
  assert.equal(res1.valid, true);
  assert.equal(res1.isGasMeasured, true);
  assert.equal(res1.gasReserveWei, gasBudgetWei);

  // Case 2: 1 wei short of amount + measured budget
  const res2 = validateExactRawBalance({
    amount,
    decimals: 18,
    rawBalance: baseUnits + gasBudgetWei - 1n,
    tokenSymbol: "ETH",
    isNative: true,
    measuredGasUsed,
    gasPriceWei,
  });
  assert.equal(res2.valid, false);
  assert.equal(res2.isGasMeasured, true);
  assert.match(res2.errorMsg!, /measured gas budget/);
});

test("validateExactRawBalance: native balance covering tx value + conservative unmeasured reserve", () => {
  const amount = "1.0"; // 1 ETH
  const baseUnits = 1_000_000_000_000_000_000n;
  const conservativeReserve = 500_000_000_000_000n; // 0.0005 ETH

  // Case 1: Exactly covers amount + conservative reserve
  const res1 = validateExactRawBalance({
    amount,
    decimals: 18,
    rawBalance: baseUnits + conservativeReserve,
    tokenSymbol: "ETH",
    isNative: true,
    // unmeasured
  });
  assert.equal(res1.valid, true);
  assert.equal(res1.isGasMeasured, false);
  assert.equal(res1.gasReserveWei, conservativeReserve);

  // Case 2: 1 wei short of amount + conservative reserve
  const res2 = validateExactRawBalance({
    amount,
    decimals: 18,
    rawBalance: baseUnits + conservativeReserve - 1n,
    tokenSymbol: "ETH",
    isNative: true,
  });
  assert.equal(res2.valid, false);
  assert.equal(res2.isGasMeasured, false);
  assert.match(res2.errorMsg!, /conservative gas reserve/);
});

test("validateExactRawBalance: rejects empty, zero, negative, and malformed amounts", () => {
  const validBalance = 1_000_000_000_000_000_000n;

  const empty = validateExactRawBalance({ amount: "", decimals: 18, rawBalance: validBalance });
  assert.equal(empty.valid, false);

  const zero = validateExactRawBalance({ amount: "0", decimals: 18, rawBalance: validBalance });
  assert.equal(zero.valid, false);
  assert.match(zero.errorMsg!, /greater than 0/);

  const zeroDot = validateExactRawBalance({ amount: "0.00", decimals: 18, rawBalance: validBalance });
  assert.equal(zeroDot.valid, false);
  assert.match(zeroDot.errorMsg!, /greater than 0/);

  const negative = validateExactRawBalance({ amount: "-1.5", decimals: 18, rawBalance: validBalance });
  assert.equal(negative.valid, false);

  const malformed = validateExactRawBalance({ amount: "abc", decimals: 18, rawBalance: validBalance });
  assert.equal(malformed.valid, false);
});
