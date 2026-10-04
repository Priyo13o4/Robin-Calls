import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCustomSlippage,
  formatSlippagePercent,
  formatSelectedSlippageDisplay,
  formatTruthfulSlippageLabel,
  getEffectiveSlippageBps,
  getCustomExecuteSlippage,
  MIN_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  AUTO_SLIPPAGE_BPS,
  AUTO_SLIPPAGE_PERCENT,
  AUTO_SLIPPAGE_LABEL,
  DEFAULT_SLIPPAGE_PRESETS,
} from "../lib/trade/slippage";


test("constants match server-side plan and request validation invariants", () => {
  assert.equal(MIN_SLIPPAGE_BPS, 1, "MIN_SLIPPAGE_BPS must be 1 (0.01%)");
  assert.equal(MAX_SLIPPAGE_BPS, 5000, "MAX_SLIPPAGE_BPS must be 5000 (50.00%)");
  assert.equal(AUTO_SLIPPAGE_BPS, 50, "AUTO_SLIPPAGE_BPS must be 50 (0.50%)");
  assert.equal(AUTO_SLIPPAGE_PERCENT, 0.5, "AUTO_SLIPPAGE_PERCENT must be 0.5");
  assert.equal(AUTO_SLIPPAGE_LABEL, "Auto", "Auto has no figure until a plan resolves it");
  assert.deepEqual(DEFAULT_SLIPPAGE_PRESETS, [0.5, 1.0, 3.0]);
});

test("parseCustomSlippage accepts valid boundary inputs", () => {
  // Lower boundary: 0.01% -> 1 bps
  const minRes = parseCustomSlippage("0.01");
  assert.equal(minRes.valid, true);
  if (minRes.valid) {
    assert.equal(minRes.bps, 1);
    assert.equal(minRes.percent, 0.01);
    assert.equal(minRes.formatted, "0.01%");
  }

  // Upper boundary: 50.00% -> 5000 bps
  const maxRes = parseCustomSlippage("50.00");
  assert.equal(maxRes.valid, true);
  if (maxRes.valid) {
    assert.equal(maxRes.bps, 5000);
    assert.equal(maxRes.percent, 50);
    assert.equal(maxRes.formatted, "50%");
  }

  // Upper boundary with single decimal: 50.0%
  const maxOneDec = parseCustomSlippage("50.0");
  assert.equal(maxOneDec.valid, true);
  if (maxOneDec.valid) {
    assert.equal(maxOneDec.bps, 5000);
    assert.equal(maxOneDec.percent, 50);
  }

  // Upper boundary integer: 50%
  const maxInt = parseCustomSlippage("50");
  assert.equal(maxInt.valid, true);
  if (maxInt.valid) {
    assert.equal(maxInt.bps, 5000);
    assert.equal(maxInt.percent, 50);
  }
});

test("parseCustomSlippage converts exact integer bps without floating point rounding errors", () => {
  // In JS float math:
  // 0.29 * 100 = 28.999999999999996 -> Math.floor gives 28 (wrong!)
  // 0.07 * 100 = 7.000000000000001
  // 0.57 * 100 = 56.99999999999999 -> Math.floor gives 56 (wrong!)
  // 0.58 * 100 = 57.99999999999999 -> Math.floor gives 57 (wrong!)
  // 1.13 * 100 = 112.99999999999999 -> Math.floor gives 112 (wrong!)
  // 1.14 * 100 = 113.99999999999999 -> Math.floor gives 113 (wrong!)

  const cases: [string, number][] = [
    ["0.07", 7],
    ["0.29", 29],
    ["0.57", 57],
    ["0.58", 58],
    ["1.13", 113],
    ["1.14", 114],
    ["2.29", 229],
    ["4.57", 457],
    ["19.99", 1999],
    ["49.99", 4999],
  ];

  for (const [inputStr, expectedBps] of cases) {
    const res = parseCustomSlippage(inputStr);
    assert.equal(res.valid, true, `Expected ${inputStr} to be valid`);
    if (res.valid) {
      assert.equal(
        res.bps,
        expectedBps,
        `Expected ${inputStr}% to convert exactly to ${expectedBps} bps, got ${res.bps}`
      );
      assert.equal(res.percent, expectedBps / 100);
    }
  }
});

test("parseCustomSlippage accepts valid standard presets and decimals", () => {
  const cases: [string, number, number][] = [
    ["0.1", 10, 0.1],
    ["0.5", 50, 0.5],
    ["1", 100, 1],
    ["1.0", 100, 1],
    ["1.00", 100, 1],
    ["2.5", 250, 2.5],
    ["3", 300, 3],
    ["5", 500, 5],
    ["10", 1000, 10],
  ];

  for (const [str, expectedBps, expectedPct] of cases) {
    const res = parseCustomSlippage(str);
    assert.equal(res.valid, true, `Expected ${str} to be valid`);
    if (res.valid) {
      assert.equal(res.bps, expectedBps);
      assert.equal(res.percent, expectedPct);
    }
  }
});

test("parseCustomSlippage trims whitespace", () => {
  const res = parseCustomSlippage("   0.5   ");
  assert.equal(res.valid, true);
  if (res.valid) {
    assert.equal(res.bps, 50);
    assert.equal(res.percent, 0.5);
  }
});

test("parseCustomSlippage accepts numeric inputs safely", () => {
  const res = parseCustomSlippage(0.5);
  assert.equal(res.valid, true);
  if (res.valid) {
    assert.equal(res.bps, 50);
    assert.equal(res.percent, 0.5);
  }

  const boundary = parseCustomSlippage(50);
  assert.equal(boundary.valid, true);
  if (boundary.valid) {
    assert.equal(boundary.bps, 5000);
    assert.equal(boundary.percent, 50);
  }
});

test("parseCustomSlippage rejects blank inputs", () => {
  const blanks = ["", "   ", "\t\n", null, undefined];
  for (const b of blanks) {
    const res = parseCustomSlippage(b);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.reason, "blank");
      assert.ok(res.error.length > 0);
    }
  }
});

test("parseCustomSlippage rejects exponent notation", () => {
  const exponents = ["1e-2", "1e2", "1E1", "0.5e1", "2.5e0", "1e0"];
  for (const exp of exponents) {
    const res = parseCustomSlippage(exp);
    assert.equal(res.valid, false, `Expected exponent ${exp} to be rejected`);
    if (!res.valid) {
      assert.equal(res.reason, "exponent");
      assert.ok(res.error.includes("Exponential") || res.error.includes("exponent"));
    }
  }
});

test("parseCustomSlippage rejects zero and negative zero", () => {
  const zeroes = ["0", "0.0", "0.00", "00", "00.00", 0];
  for (const z of zeroes) {
    const res = parseCustomSlippage(z);
    assert.equal(res.valid, false, `Expected zero ${z} to be rejected`);
    if (!res.valid) {
      assert.equal(res.reason, "zero");
      assert.ok(res.error.includes("0.01%"));
    }
  }
});

test("parseCustomSlippage rejects values above 50%", () => {
  const over = ["50.01", "50.1", "51", "100", "5000", "99999"];
  for (const o of over) {
    const res = parseCustomSlippage(o);
    assert.equal(res.valid, false, `Expected ${o} to be rejected`);
    if (!res.valid) {
      assert.equal(res.reason, "out_of_range");
      assert.ok(res.error.includes("50.00%") || res.error.includes("50%"));
    }
  }
});

test("parseCustomSlippage rejects more than 2 decimal places", () => {
  const highPrecision = ["0.001", "0.009", "0.500", "1.234", "12.345", "49.999", "0.0001"];
  for (const p of highPrecision) {
    const res = parseCustomSlippage(p);
    assert.equal(res.valid, false, `Expected ${p} to be rejected for >2 decimal places`);
    if (!res.valid) {
      assert.equal(res.reason, "precision");
      assert.ok(res.error.includes("2 decimal places"));
    }
  }
});

test("parseCustomSlippage rejects malformed inputs", () => {
  const malformed = [
    "abc",
    "-1",
    "-0.01",
    "-0.5",
    "+1",
    "+0.5",
    "1.2.3",
    "1..0",
    ".",
    ".5",
    "1.",
    "0x10",
    "NaN",
    "Infinity",
    "-Infinity",
    {},
    [],
  ];

  for (const m of malformed) {
    const res = parseCustomSlippage(m);
    assert.equal(res.valid, false, `Expected malformed ${JSON.stringify(m)} to be rejected`);
    if (!res.valid) {
      assert.equal(res.reason, "malformed");
    }
  }
});

test("formatSlippagePercent formats bps values cleanly", () => {
  assert.equal(formatSlippagePercent(1), "0.01%");
  assert.equal(formatSlippagePercent(50), "0.5%");
  assert.equal(formatSlippagePercent(100), "1%");
  assert.equal(formatSlippagePercent(250), "2.5%");
  assert.equal(formatSlippagePercent(300), "3%");
  assert.equal(formatSlippagePercent(5000), "50%");
});

test("formatSelectedSlippageDisplay shows correct labels for presets and custom boundaries", () => {
  // Auto
  assert.equal(
    formatSelectedSlippageDisplay("auto", false, ""),
    "Auto"
  );

  // Preset
  assert.equal(
    formatSelectedSlippageDisplay(1.0, false, ""),
    "1%"
  );

  // Custom boundary 0.01%
  const custom001 = parseCustomSlippage("0.01");
  assert.equal(
    formatSelectedSlippageDisplay(0.01, true, "0.01", custom001),
    "0.01%"
  );

  // Custom boundary 50.00%
  const custom50 = parseCustomSlippage("50.00");
  assert.equal(
    formatSelectedSlippageDisplay(50, true, "50.00", custom50),
    "50.00%"
  );

  // Invalid custom
  const invalidCustom = parseCustomSlippage("abc");
  assert.equal(
    formatSelectedSlippageDisplay(0, true, "abc", invalidCustom),
    "Invalid"
  );
});

test("getEffectiveSlippageBps produces exact bps for router requests", () => {
  // Auto returns literal "auto": the server resolves it per trade
  assert.equal(getEffectiveSlippageBps("auto", false), "auto");

  // Presets return exact bps
  assert.equal(getEffectiveSlippageBps(0.5, false), 50);
  assert.equal(getEffectiveSlippageBps(1.0, false), 100);
  assert.equal(getEffectiveSlippageBps(3.0, false), 300);

  // Custom input returns exact bps
  assert.equal(getEffectiveSlippageBps(0.01, true, 1), 1);
  assert.equal(getEffectiveSlippageBps(50, true, 5000), 5000);
  assert.equal(getEffectiveSlippageBps(0.29, true, 29), 29);
});

test("getCustomExecuteSlippage sends actual 0.5 for Auto, not 1.0", () => {
  // CRITICAL requirement: Auto must pass actual 0.5 to customExecute, NOT 1.0!
  assert.equal(
    getCustomExecuteSlippage("auto", false),
    0.5,
    "customExecute MUST receive actual 0.5 for Auto, not 1.0"
  );

  // Presets pass their numeric percentage
  assert.equal(getCustomExecuteSlippage(0.5, false), 0.5);
  assert.equal(getCustomExecuteSlippage(1.0, false), 1.0);
  assert.equal(getCustomExecuteSlippage(3.0, false), 3.0);

  // Custom passes the exact custom percent
  assert.equal(getCustomExecuteSlippage(0.01, true, 0.01), 0.01);
  assert.equal(getCustomExecuteSlippage(50, true, 50), 50);
  assert.equal(getCustomExecuteSlippage(2.5, true, 2.5), 2.5);
});

test("getEffectiveSlippageBps fails closed to NaN on invalid/blank custom inputs", () => {
  assert.ok(Number.isNaN(getEffectiveSlippageBps("auto", true, undefined)));
  assert.ok(Number.isNaN(getEffectiveSlippageBps(1.0, true, undefined)));
  assert.ok(Number.isNaN(getEffectiveSlippageBps("auto", true, 0)));
  assert.ok(Number.isNaN(getEffectiveSlippageBps("auto", true, -1)));
  assert.ok(Number.isNaN(getEffectiveSlippageBps("auto", true, 5001)));
});

test("getCustomExecuteSlippage fails closed to NaN on invalid/blank custom inputs", () => {
  assert.ok(Number.isNaN(getCustomExecuteSlippage("auto", true, undefined)));
  assert.ok(Number.isNaN(getCustomExecuteSlippage(1.0, true, undefined)));
  assert.ok(Number.isNaN(getCustomExecuteSlippage("auto", true, 0)));
  assert.ok(Number.isNaN(getCustomExecuteSlippage("auto", true, 51)));
});

test("formatTruthfulSlippageLabel produces correct truthful strings for Auto and Manual", () => {
  assert.equal(
    formatTruthfulSlippageLabel({ isManual: false, activePlan: null }),
    "Auto"
  );
  assert.equal(
    formatTruthfulSlippageLabel({
      isManual: false,
      activePlan: { slippageMode: "auto", slippageBps: 50 },
    }),
    "Auto (0.5%)"
  );
  assert.equal(
    formatTruthfulSlippageLabel({ isManual: true, manualBps: 100 }),
    "Manual (1% / 100 bps)"
  );
  assert.equal(
    formatTruthfulSlippageLabel({
      isManual: true,
      activePlan: { slippageMode: "manual", slippageBps: 100 },
    }),
    "Manual (1% / 100 bps)"
  );
  assert.equal(
    formatTruthfulSlippageLabel({
      isManual: true,
      activePlan: { slippageMode: "manual", slippageBps: 29 },
    }),
    "Manual (0.29% / 29 bps)"
  );
});
