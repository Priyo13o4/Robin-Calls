import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getEffectiveSlippageBps,
  getCustomExecuteSlippage,
  parseCustomSlippage,
  formatTruthfulSlippageLabel,
} from "../lib/trade/slippage";
import type { PlanView } from "../lib/swap/types";

const modernTradingCardPath = join(
  import.meta.dirname,
  "../app/components/trade/ModernTradingCard.tsx"
);
const cardSource = readFileSync(modernTradingCardPath, "utf8");

test("getEffectiveSlippageBps rejects invalid/blank custom input and never silently falls back to Auto", () => {
  // When isCustom is true, invalid or blank input must fail closed (NaN), NEVER return "auto"
  const blankResult = getEffectiveSlippageBps("auto", true, undefined);
  assert.ok(
    Number.isNaN(blankResult),
    `Expected blank custom slippage to return NaN, got ${String(blankResult)}`
  );

  const invalidBpsResult = getEffectiveSlippageBps("auto", true, 0);
  assert.ok(
    Number.isNaN(invalidBpsResult),
    `Expected 0 bps custom slippage to return NaN, got ${String(invalidBpsResult)}`
  );

  const outOfRangeResult = getEffectiveSlippageBps("auto", true, 5001);
  assert.ok(
    Number.isNaN(outOfRangeResult),
    `Expected >5000 bps custom slippage to return NaN, got ${String(outOfRangeResult)}`
  );

  // Valid custom input returns exact integer bps
  assert.equal(getEffectiveSlippageBps("auto", true, 100), 100);
  assert.equal(getEffectiveSlippageBps(1.0, true, 250), 250);

  // Only when isCustom is false does "auto" return "auto"
  assert.equal(getEffectiveSlippageBps("auto", false), "auto");
});

test("getCustomExecuteSlippage rejects invalid/blank custom input and never silently returns Auto 0.5%", () => {
  const blankCustom = getCustomExecuteSlippage("auto", true, undefined);
  assert.ok(
    Number.isNaN(blankCustom),
    `Expected blank custom slippage in customExecute to return NaN, got ${String(blankCustom)}`
  );

  // Valid custom input passes through
  assert.equal(getCustomExecuteSlippage("auto", true, 1.0), 1.0);
  assert.equal(getCustomExecuteSlippage("auto", true, 0.01), 0.01);

  // Non-custom Auto returns 0.5
  assert.equal(getCustomExecuteSlippage("auto", false), 0.5);
});

test("formatTruthfulSlippageLabel shows Manual mode with exact bps for manual selections and plans", () => {
  // 1. Auto mode without plan: no figure yet
  assert.equal(
    formatTruthfulSlippageLabel({ isManual: false, activePlan: null }),
    "Auto"
  );

  // 2. Auto mode with plan: the figure the server resolved
  assert.equal(
    formatTruthfulSlippageLabel({
      isManual: false,
      activePlan: { slippageMode: "auto", slippageBps: 175 },
    }),
    "Auto (1.75%)"
  );

  // 3. Manual mode before plan (e.g. 100 bps / 1% chosen): Manual (1% / 100 bps)
  assert.equal(
    formatTruthfulSlippageLabel({ isManual: true, manualBps: 100, activePlan: null }),
    "Manual (1% / 100 bps)"
  );

  // 4. Manual mode with served plan (100 bps): Manual (1% / 100 bps)
  assert.equal(
    formatTruthfulSlippageLabel({
      isManual: true,
      manualBps: 100,
      activePlan: { slippageMode: "manual", slippageBps: 100 },
    }),
    "Manual (1% / 100 bps)"
  );

  // 5. Manual mode with served plan (29 bps / 0.29%): Manual (0.29% / 29 bps)
  assert.equal(
    formatTruthfulSlippageLabel({
      isManual: true,
      manualBps: 29,
      activePlan: { slippageMode: "manual", slippageBps: 29 },
    }),
    "Manual (0.29% / 29 bps)"
  );

  // 6. Manual mode must never masquerade as Auto
  const label = formatTruthfulSlippageLabel({
    isManual: true,
    manualBps: 100,
    activePlan: { slippageMode: "manual", slippageBps: 100 },
  });
  assert.ok(!label.startsWith("Auto"), "Manual plan must never have label starting with Auto");
  assert.ok(label.startsWith("Manual"), "Manual plan must have label starting with Manual");
  assert.ok(label.includes("100 bps"), "Manual plan must include exact bps chosen");
});

test("ModernTradingCard does not unconditionally format manual activePlan as Auto", () => {
  // In the original buggy code:
  // {!isCustomSlippage ? (
  //   <span>{activePlan ? `Auto (${activePlan.slippageBps / 100}%)` : "Auto (-)"}</span>
  // ) : ...}
  // Even when activePlan.slippageMode === "manual", it printed "Auto (...)".
  // The fix must distinguish activePlan.slippageMode or use formatTruthfulSlippageLabel.
  assert.ok(
    cardSource.includes("Manual (") || cardSource.includes("formatTruthfulSlippageLabel"),
    "ModernTradingCard must display 'Manual (' or call formatTruthfulSlippageLabel for manual plans"
  );
});

test("Manual slippage state is preserved across pair changes and review cancel", () => {
  // Verify toggleMode does not wipe manual slippage state
  const toggleModeIdx = cardSource.indexOf("const toggleMode = () => {");
  assert.ok(toggleModeIdx !== -1, "toggleMode must be defined");
  const toggleModeEnd = cardSource.indexOf("};", toggleModeIdx);
  const toggleModeBody = cardSource.slice(toggleModeIdx, toggleModeEnd);
  assert.ok(
    !toggleModeBody.includes("setSlippage('auto')") &&
    !toggleModeBody.includes('setSlippage("auto")') &&
    !toggleModeBody.includes("setIsCustomSlippage(false)"),
    "toggleMode must not reset slippage to 'auto' or setIsCustomSlippage(false)"
  );

  // Verify handleSelectToken does not wipe manual slippage state
  const selectTokenIdx = cardSource.indexOf("const handleSelectToken = (selected: SelectableToken) => {");
  assert.ok(selectTokenIdx !== -1, "handleSelectToken must be defined");
  const selectTokenEnd = cardSource.indexOf("setSearchedTokens([]);", selectTokenIdx);
  const selectTokenBody = cardSource.slice(selectTokenIdx, selectTokenEnd);
  assert.ok(
    !selectTokenBody.includes("setSlippage('auto')") &&
    !selectTokenBody.includes('setSlippage("auto")') &&
    !selectTokenBody.includes("setIsCustomSlippage(false)"),
    "handleSelectToken must not reset slippage to 'auto' or setIsCustomSlippage(false)"
  );

  // Verify cancel review does not wipe manual slippage state
  const cancelReviewIdx = cardSource.indexOf("Cancel review and edit trade");
  assert.ok(cancelReviewIdx !== -1, "Cancel review button must exist");
  const cancelBlockStart = cardSource.lastIndexOf("<button", cancelReviewIdx);
  const cancelBlock = cardSource.slice(cancelBlockStart, cancelReviewIdx);
  assert.ok(
    !cancelBlock.includes("setSlippage('auto')") &&
    !cancelBlock.includes('setSlippage("auto")') &&
    !cancelBlock.includes("setIsCustomSlippage(false)"),
    "Cancel review must not reset slippage to 'auto' or setIsCustomSlippage(false)"
  );
});
