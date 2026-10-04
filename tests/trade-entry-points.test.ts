import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { between, codeOf } from "./helpers/source";

// Wiring assertions for trade entry points on Night Market feed and scan page.

const tradeLinkRaw = readFileSync(join(import.meta.dirname, "../app/components/site/TradeLink.tsx"), "utf8");
const tradeLinkCode = codeOf(tradeLinkRaw);

const nightMarketTabsRaw = readFileSync(join(import.meta.dirname, "../app/components/site/NightMarketTabs.tsx"), "utf8");
const nightMarketTabsCode = codeOf(nightMarketTabsRaw);

const nightMarketPageRaw = readFileSync(join(import.meta.dirname, "../app/night-market/page.tsx"), "utf8");
const nightMarketPageCode = codeOf(nightMarketPageRaw);

const scanPageRaw = readFileSync(join(import.meta.dirname, "../app/scan/[address]/page.tsx"), "utf8");
const scanPageCode = codeOf(scanPageRaw);

test("TradeLink.tsx calls tradeWarning and links to swap with lowercase token", () => {
  assert.ok(tradeLinkCode.length > 200, "TradeLink.tsx length must be > 200");
  assert.ok(tradeLinkCode.includes("TradeLink"), "TradeLink.tsx must match known sample 'TradeLink'");

  assert.ok(tradeLinkCode.includes("tradeWarning("), "TradeLink.tsx must call tradeWarning(");
  // Calling it is not displaying it. Pin the RESULT into the rendered output, or a version
  // that computes the warning and drops it keeps this test green and shows the user nothing.
  assert.match(
    tradeLinkCode,
    /const warning = tradeWarning\(/,
    "the warning must be bound to a name the render can read",
  );
  assert.match(tradeLinkCode, /\{warning\.sentence\}/, "the warning sentence must be rendered");
  // Building `warningLine` is not rendering it. Both variants return JSX and BOTH must place
  // it, or one entry point silently loses its verdict warning.
  const placements = tradeLinkCode.match(/\{warningLine\}/g) ?? [];
  assert.equal(placements.length, 2, `both the card and inline variants must place the warning, found ${placements.length}`);
  assert.match(tradeLinkCode, /warning\.level === "danger"/, "the warning level must drive the styling");
  assert.ok(tradeLinkCode.includes("/trade/"), "TradeLink.tsx must link to /trade/");

  assert.ok(!tradeLinkCode.includes("scanned"), "TradeLink.tsx must not contain hard-coded 'scanned'");
  assert.ok(!tradeLinkCode.includes("rated"), "TradeLink.tsx must not contain hard-coded 'rated'");
  assert.ok(!tradeLinkCode.includes("risks"), "TradeLink.tsx must not contain hard-coded 'risks'");
});

test("NightMarketTabs.tsx renders TradeLink guarded by tradeEnabled", () => {
  assert.ok(nightMarketTabsCode.length > 200, "NightMarketTabs.tsx length must be > 200");
  assert.ok(
    nightMarketTabsCode.includes("NightMarketTabs"),
    "NightMarketTabs.tsx must match known sample 'NightMarketTabs'"
  );

  const tradeEnabledIdx = nightMarketTabsCode.indexOf("tradeEnabled &&");
  const tradeLinkIdx = nightMarketTabsCode.indexOf("<TradeLink");
  assert.ok(tradeEnabledIdx !== -1, "NightMarketTabs.tsx must contain 'tradeEnabled &&'");
  assert.ok(tradeLinkIdx !== -1, "NightMarketTabs.tsx must contain '<TradeLink'");
  assert.ok(tradeEnabledIdx < tradeLinkIdx, "'tradeEnabled &&' must appear before '<TradeLink'");

  assert.ok(
    nightMarketTabsCode.includes('kind: "unscanned"'),
    "NightMarketTabs.tsx must pass kind: 'unscanned' for a null verdict"
  );
});

test("night-market/page.tsx reads swap config and passes tradeEnabled prop", () => {
  assert.ok(nightMarketPageCode.length > 200, "night-market/page.tsx length must be > 200");
  assert.ok(
    nightMarketPageCode.includes("NightMarketPage"),
    "night-market/page.tsx must match known sample 'NightMarketPage'"
  );

  // The three substrings are all satisfied by the DECLARATION alone, so the config read could
  // be performed and thrown away. Pin the declaration and the prop that must carry it: a
  // hardcoded `tradeEnabled={true}` offers Trade on a deployment with no fee recipient set.
  assert.match(
    nightMarketPageCode,
    /const tradeEnabled = isTradingOpen\(await readSwapConfig\(\)\)/,
    "night-market/page.tsx must compute tradeEnabled from the swap config",
  );
  assert.match(
    nightMarketPageCode,
    /tradeEnabled=\{tradeEnabled\}/,
    "night-market/page.tsx must pass the COMPUTED value, not a literal",
  );
});

test("scan page renders TradeLink in latest branch only and gates on isTradingOpen", () => {
  assert.ok(scanPageCode.length > 200, "scan page length must be > 200");
  assert.ok(
    scanPageCode.includes("ScanAddressPage"),
    "scan page must match known sample 'ScanAddressPage'"
  );

  assert.ok(scanPageCode.includes("isTradingOpen("), "scan page must call isTradingOpen(");
  assert.ok(scanPageCode.includes("<TradeLink"), "scan page must render <TradeLink");

  // Ordering alone left the guard untested: replacing `{tradeEnabled && (` with `{true && (`
  // kept every assertion green. Take the wrapper itself and require TradeLink inside it.
  assert.match(
    scanPageCode,
    /const tradeEnabled = isTradingOpen\(await readSwapConfig\(\)\)/,
    "scan page must compute tradeEnabled from the swap config",
  );
  const guarded = between(scanPageCode, "{tradeEnabled && (", "\n              )}");
  assert.match(guarded, /<TradeLink/, "<TradeLink must sit INSIDE the tradeEnabled guard");

  const latestBarIdx = scanPageCode.indexOf("<LatestVerdictBar");
  const tradeLinkIdx = scanPageCode.indexOf("<TradeLink");
  assert.ok(latestBarIdx !== -1, "scan page must contain <LatestVerdictBar");
  assert.ok(tradeLinkIdx > latestBarIdx, "<TradeLink must appear after <LatestVerdictBar");

  const archivedStart = scanPageCode.indexOf("archived ? (");
  const archivedEnd = scanPageCode.indexOf(") : latest ? (");
  assert.ok(archivedStart !== -1, "archived branch start 'archived ? (' must be found");
  assert.ok(archivedEnd > archivedStart, ") : latest ? ( must appear after archived ? (");

  const archivedSlice = scanPageCode.slice(archivedStart, archivedEnd);
  assert.ok(archivedSlice.length > 0, "archived slice must be non-empty");
  assert.ok(!archivedSlice.includes("<TradeLink"), "<TradeLink must be absent from archived branch slice");
});
