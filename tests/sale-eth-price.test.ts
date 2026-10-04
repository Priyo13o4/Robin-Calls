import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicClient } from "viem";
import {
  ethUsdFromPools,
  raisedUsd,
  readEthUsd,
  usdPerEthFromSqrt,
} from "../lib/sale/eth-price";

test("rule 1: usdPerEthFromSqrt derives 2704.08 within 0.01 and 0n gives null", () => {
  const target = 2704.08;
  const sqrtPriceX96 = BigInt(Math.round(Math.sqrt(target / 1e12) * 2 ** 96));
  const price = usdPerEthFromSqrt(sqrtPriceX96);
  assert.ok(price !== null, "expected non-null price");
  assert.ok(Math.abs(price - target) <= 0.01, `expected ${price} within 0.01 of ${target}`);
  assert.equal(usdPerEthFromSqrt(0n), null);
});

test("rule 2: two pools 2% apart give null and 0.5% apart give the primary price", () => {
  const primaryTarget = 2704.08;
  const primarySqrt = BigInt(Math.round(Math.sqrt(primaryTarget / 1e12) * 2 ** 96));

  const check2PctSqrt = BigInt(Math.round(Math.sqrt((primaryTarget * 1.02) / 1e12) * 2 ** 96));
  assert.equal(ethUsdFromPools(primarySqrt, check2PctSqrt), null);

  const check05PctSqrt = BigInt(Math.round(Math.sqrt((primaryTarget * 1.005) / 1e12) * 2 ** 96));
  const result05 = ethUsdFromPools(primarySqrt, check05PctSqrt);
  const primaryPrice = usdPerEthFromSqrt(primarySqrt);
  assert.ok(result05 !== null, "expected non-null price within spread");
  assert.equal(result05, primaryPrice);
});

test("rule 3: either side null gives null", () => {
  const primarySqrt = BigInt(Math.round(Math.sqrt(2704.08 / 1e12) * 2 ** 96));
  assert.equal(ethUsdFromPools(null, primarySqrt), null);
  assert.equal(ethUsdFromPools(primarySqrt, null), null);
  assert.equal(ethUsdFromPools(null, null), null);
});

test("rule 4: raisedUsd(0, 2700) is 0 and null inputs give null", () => {
  assert.equal(raisedUsd(0, 2700), 0);
  assert.equal(raisedUsd(null, 2700), null);
  assert.equal(raisedUsd(1, null), null);
});

test("rule 5: readEthUsd returns null on failed entry and rejects on transport throw", async () => {
  const primarySqrt = BigInt(Math.round(Math.sqrt(2704.08 / 1e12) * 2 ** 96));

  const clientWithFailure = {
    multicall: async () => [
      { status: "success" as const, result: [primarySqrt, 0, 0, 0, 0, 0, true] },
      { status: "failure" as const, error: new Error("pool slot0 reverted") },
    ],
  } as unknown as Pick<PublicClient, "multicall">;

  const result = await readEthUsd(clientWithFailure);
  assert.equal(result, null);

  const clientWithThrow = {
    multicall: async () => {
      throw new Error("RPC network transport fault");
    },
  } as unknown as Pick<PublicClient, "multicall">;

  await assert.rejects(
    async () => {
      await readEthUsd(clientWithThrow);
    },
    { message: "RPC network transport fault" },
  );
});

test("rule 6: SalePageClient wiring extracts and asserts useEthUsd, labels, and no unset on ETH PRICE", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "app/token-sale/SalePageClient.tsx"), "utf8");
  assert.ok(src.length > 0, "SalePageClient.tsx source must not be empty");

  const hookCalls = src.match(/useEthUsd\(([^)]+)\)/g) ?? [];
  assert.ok(hookCalls.length > 0, "expected at least one useEthUsd call in SalePageClient.tsx");
  assert.match(hookCalls[0], /useEthUsd\(\s*client\s*\)/);

  const cells = src.match(/<Cell\b[\s\S]*?\/>/g) ?? [];
  assert.ok(cells.length >= 6, `expected at least 6 cells, extracted ${cells.length}`);

  const labels = cells.map((c) => c.match(/label="([^"]+)"/)?.[1]).filter(Boolean);
  assert.ok(labels.includes("RAISED IN USD"), "missing RAISED IN USD cell");
  assert.ok(labels.includes("ETH PRICE"), "missing ETH PRICE cell");

  const ethPriceCell = cells.find((c) => c.includes('label="ETH PRICE"'));
  assert.ok(ethPriceCell, "missing ETH PRICE cell tag");
  assert.doesNotMatch(ethPriceCell, /\bunset[=\s]/, "ETH PRICE cell must not carry unset prop");
});

test("rule 7: useEthUsd wiring extracts and asserts ETH_PRICE_MAX_AGE_MS and interval clearing", () => {
  const hookSrc = readFileSync(join(import.meta.dirname, "..", "lib/sale/useEthUsd.ts"), "utf8");
  assert.ok(hookSrc.length > 0, "useEthUsd.ts source must not be empty");

  const ageRefs = hookSrc.match(/\bETH_PRICE_MAX_AGE_MS\b/g) ?? [];
  assert.ok(ageRefs.length > 0, "useEthUsd.ts must reference ETH_PRICE_MAX_AGE_MS");

  const clearCalls = hookSrc.match(/\bclearInterval\s*\([^)]+\)/g) ?? [];
  assert.ok(clearCalls.length > 0, "useEthUsd.ts must call clearInterval");
});

test("useEthUsd keeps its in-flight guard inside the effect, never in a ref", () => {
  // A ref outlives Strict Mode's discarded first mount, so the live mount skipped its first read.
  const src = readFileSync(join(import.meta.dirname, "..", "lib/sale/useEthUsd.ts"), "utf8");
  const effect = src.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[client\]\);/)?.[0] ?? "";
  assert.ok(effect.length > 0, "extracted the polling effect");
  assert.match(effect, /let inFlight = false;/);
  assert.doesNotMatch(src, /useRef/);
});
