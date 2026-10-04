import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits, parseUnits } from "viem";

/**
 * Every money figure on the admin sale panel says what unit it is in.
 *
 * Three scales live on that page and two of them look identical on screen: ETH
 * (18dp, `uint256` wei on chain), a token amount at the SALE token's own
 * decimals (`uint256` raw units), and plain counts. `tokensForSale_` is a
 * constructor argument in raw units and `start()` demands the funded balance
 * equal it EXACTLY — over the target every exit is shut and the contract is a
 * redeploy. So a figure rendered without its unit is a real hazard here, not a
 * documentation nicety.
 *
 * Source-text, because the claim is about rendered labels.
 */

const panel = readFileSync(
  join(process.cwd(), "app", "admin", "(dashboard)", "token-sale", "TokenSalePanel.tsx"),
  "utf8",
);

/** Every `<Stat …/>` and `<FundingCell …/>` occurrence, whole tag. */
function cells(tag: "Stat" | "FundingCell"): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(panel))) {
    // Walk to the tag's own close, tolerating the multi-line prop style.
    const end = panel.indexOf("/>", m.index);
    assert.ok(end !== -1, `unterminated <${tag}>`);
    out.push(panel.slice(m.index, end + 2));
  }
  return out;
}

test("the panel actually renders the cells this test is about", () => {
  // Guard against a vacuous pass: a renamed component would leave every
  // assertion below iterating an empty list and reporting success.
  assert.ok(cells("Stat").length >= 6, `found only ${cells("Stat").length} <Stat> cells`);
  assert.ok(cells("FundingCell").length >= 2, `found only ${cells("FundingCell").length} <FundingCell> cells`);
});

test("every figure on the panel declares its unit", () => {
  for (const tag of [...cells("Stat"), ...cells("FundingCell")]) {
    const label = tag.match(/label="([^"]+)"/)?.[1] ?? tag.slice(0, 60);
    assert.match(tag, /\bunit=/, `"${label}" renders a number with no unit line`);
  }
});

test("ETH figures name wei, token figures name raw units — and never the reverse", () => {
  for (const tag of [...cells("Stat"), ...cells("FundingCell")]) {
    const unit = tag.match(/unit=[{"]`?([^"`}]+)/)?.[1] ?? "";
    if (!unit) continue;
    if (unit.includes("wei")) {
      assert.match(unit, /^ETH/, `a wei-denominated figure must be labelled ETH: "${unit}"`);
      assert.ok(!unit.includes("raw units"), `"${unit}" claims both wei and raw units`);
    }
    if (unit.includes("raw units")) {
      assert.ok(
        !unit.includes("ETH"),
        `"${unit}" labels a token amount as ETH — the two scales are not the same`,
      );
    }
  }
});

test("the fields an operator types into say which scale is expected", () => {
  assert.match(panel, /decimal ETH — sent as wei/, "the contribute field must say it is decimal ETH");
  assert.match(panel, /contributors per call — a plain count/, "the chunk field must say it is a count");
  assert.match(panel, /RAW UNITS \(uint256\)/, "the converter must name the raw side as uint256");
});

test("the converter never silently assumes 18 decimals", () => {
  // A silent 18 is the exact mistake the converter exists to prevent: it is
  // right for most tokens and catastrophic for the rest, and looks identical
  // either way. When decimals are neither read nor typed, the UI must say so.
  assert.match(panel, /assuming 18 — unread/, "an unread decimals value must be disclosed, not applied quietly");
});

test("the conversion itself round-trips at the decimals it is given", () => {
  // The arithmetic the two fields perform, pinned at the scales that matter.
  for (const [whole, decimals, raw] of [
    ["3000000", 18, "3000000000000000000000000"],
    ["100", 6, "100000000"],
    ["1", 0, "1"],
    ["0.5", 18, "500000000000000000"],
  ] as const) {
    assert.equal(parseUnits(whole, decimals).toString(), raw, `${whole} @ ${decimals}dp`);
    assert.equal(formatUnits(BigInt(raw), decimals), whole, `${raw} back to whole @ ${decimals}dp`);
  }
});

test("the same number at 18dp and 6dp are not interchangeable", () => {
  // States the hazard as an assertion: the gap is 10^12, which is what made
  // recoverERC20 unusable for stablecoins before the decimals read landed.
  const at18 = parseUnits("100", 18);
  const at6 = parseUnits("100", 6);
  assert.notEqual(at18, at6);
  assert.equal(at18 / at6, 10n ** 12n);
});
