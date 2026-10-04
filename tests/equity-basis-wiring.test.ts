import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOf } from "./helpers/source";

// `includes("try") && includes("catch")` is satisfied by ANY try/catch in the file, and
// app/rwa/[address]/page.tsx has an unrelated one 30 lines above its readSwapConfig call.
// So locate the call and prove the nearest preceding `try {` has not already closed.
function assertEquityFlagGatesTheRead(src: string, file: string) {
  // Reading the flag is not obeying it. `features.equityBasis` appearing anywhere satisfied
  // the old assertion, so `if (equityGateOn)` could become `if (true)` and the panel would
  // render on a deployment with the feature switched off, with every test green.
  assert.match(src, /\bfeatures\.equityBasis\b/, `${file} must read features.equityBasis`);
  assert.match(
    src,
    /equityGateOn = Boolean\(config\.features\.equityBasis\.on\)/,
    `${file} must bind the flag to the name the branch reads`,
  );
  const branch = src.indexOf("if (equityGateOn)");
  assert.ok(branch > 0, `${file}: the equity read must sit behind the flag, not beside it`);
  assert.ok(
    branch < src.indexOf("readEquityReference("),
    `${file}: readEquityReference must run INSIDE the flag's branch`,
  );
}

function assertReadSwapConfigIsInsideATry(src: string, file: string) {
  const call = src.indexOf("readSwapConfig()");
  assert.ok(call > 0, `guard: ${file} must still call readSwapConfig()`);
  const opened = src.lastIndexOf("try {", call);
  assert.ok(opened > 0, `${file}: readSwapConfig must sit inside a try block`);
  assert.ok(
    !src.slice(opened, call).includes("catch"),
    `${file}: the nearest try already closed, so readSwapConfig is not covered by it`,
  );
  assert.match(
    src.slice(call, call + 600),
    /catch\s*[({]/,
    `${file}: that try must have a catch, so a config read failure fails closed`,
  );
}


const rwaPageRaw = readFileSync(
  join(import.meta.dirname, "../app/rwa/[address]/page.tsx"),
  "utf8",
);
const rwaPageCode = codeOf(rwaPageRaw);

test("WIRING: extraction guard (§8 #22) verifies page sources are non-empty and match known samples", () => {
  assert.ok(
    rwaPageRaw.length > 200,
    `app/rwa/[address]/page.tsx length must be > 200, got ${rwaPageRaw.length}`,
  );
  assert.ok(
    rwaPageRaw.includes("RwaDetailClient"),
    "app/rwa/[address]/page.tsx must contain known sample 'RwaDetailClient'",
  );
});

test("WIRING: app/rwa/[address]/page.tsx imports and calls equity basis components and reads feature flag", () => {
  assert.match(
    rwaPageCode,
    /import\s+.*?\breadEquityReference\b.*?from\s+["'].*lib\/market\/equity-reference["']/,
    "app/rwa/[address]/page.tsx must import readEquityReference",
  );
  assert.match(
    rwaPageCode,
    /import\s+.*?\bdescribeEquityBasis\b.*?from\s+["'].*lib\/market\/equity-basis["']/,
    "app/rwa/[address]/page.tsx must import describeEquityBasis",
  );

  assert.match(
    rwaPageCode,
    /\breadEquityReference\(/,
    "app/rwa/[address]/page.tsx must call readEquityReference",
  );
  assertEquityFlagGatesTheRead(rwaPageCode, "app/rwa/[address]/page.tsx");
  assert.match(
    rwaPageCode,
    /\bdescribeEquityBasis\(/,
    "app/rwa/[address]/page.tsx must call describeEquityBasis",
  );
  assert.match(
    rwaPageCode,
    /\bfeatures\.equityBasis\b/,
    "app/rwa/[address]/page.tsx must read features.equityBasis",
  );

  assert.match(rwaPageCode, /equityBasisView=\{equityBasisView\}/, "the structured reference summary must reach the RWA client");
  assert.doesNotMatch(rwaPageCode, /<EquityBasis\s+view=/, "the reference summary belongs inside the RWA side rail");

  assert.match(
    rwaPageCode,
    /\breadSwapConfig\(\)/,
    "app/rwa/[address]/page.tsx must call readSwapConfig",
  );
  assertReadSwapConfigIsInsideATry(rwaPageCode, "app/rwa/[address]/page.tsx");
});

test("WIRING: equity comparison reuses the validated page-load market price", () => {
  const page = readFileSync(join(import.meta.dirname, "..", "app/rwa/[address]/page.tsx"), "utf8");
  assert.match(page, /Number\.isFinite\(priceNum\)\s*&&\s*priceNum\s*>\s*0/);
  assert.match(page, /usd:\s*priceNum/);
  assert.doesNotMatch(page, /readRwaQuotes\s*\(/, "the banner must not fetch a second market quote");
  const basis = readFileSync(join(import.meta.dirname, "..", "lib/market/equity-basis.ts"), "utf8");
  const client = readFileSync(join(import.meta.dirname, "..", "app/components/site/RwaDetailClient.tsx"), "utf8");
  const rail = readFileSync(join(import.meta.dirname, "..", "app/components/rwa/RwaRightRail.tsx"), "utf8");
  assert.match(basis, /referencePriceUsd:\s*number \| null/);
  assert.match(basis, /referenceStatus:/);
  assert.match(basis, /referenceTime:/, "the summary retains its page-load quote timestamp");
  assert.match(basis, /shareRatio:/);
  assert.match(basis, /pendingCorporateAction:/);
  assert.match(client, /equityBasisView=\{equityBasisView\}/);
  assert.match(rail, /referenceStatus/);
  assert.match(rail, /snapshot \$\{equityBasisView\.referenceTime\}/, "the compact rail keeps snapshot context");
  assert.match(rail, /shareRatio/);
  assert.match(rail, /pendingCorporateAction/);
});
