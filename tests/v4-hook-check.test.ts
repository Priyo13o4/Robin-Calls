import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { auditHookBytecode, classifyPoolEvidence, extractPush4Selectors, parseCliArgs, quoteStatus, roundTripLabel } from "../scripts/v4-hook-check";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const NONZERO = "0x0000000000000000000000000000000000000001" as const;

test("PUSH4 extraction skips PUSH payload bytes instead of treating them as opcodes", () => {
  // PUSH1 embeds a fake PUSH4+selector byte sequence; only the later real PUSH4 counts.
  const code = "0x64636570f95663b387cb65" as const;
  assert.deepEqual(extractPush4Selectors(code), ["0xb387cb65"]);
});

test("CLI accepts a token and reference pool ID without confusing the pool ID for a token", () => {
  const parsed = parseCliArgs([
    "0xEB0cB580D8cD0f2848293C0d5DdaA0083f6924CD",
    "--buy-amount",
    "0.5",
    "--reference-pool",
    "0x9e1de6d57857cf69c908fcdedf327b83280b01c7ffcdc4e4213d2c1b37e7b88e",
  ]);
  assert.equal(parsed.error, null);
  assert.equal(parsed.token, "0xeb0cb580d8cd0f2848293c0d5ddaa0083f6924cd");
  assert.equal(parsed.buyAmount, "0.5");
  assert.equal(parsed.referencePoolId, "0x9e1de6d57857cf69c908fcdedf327b83280b01c7ffcdc4e4213d2c1b37e7b88e");
});

test("CLI rejects pool IDs as token addresses and malformed reference pool IDs", () => {
  assert.match(parseCliArgs(["0x" + "a".repeat(64)]).error ?? "", /token address/);
  assert.match(parseCliArgs([NONZERO, "--reference-pool", "0x1234"]).error ?? "", /32-byte/);
});

test("known selector presence is evidence only and cannot alone accuse a pool", () => {
  const audit = auditHookBytecode(NONZERO, "0x63b387cb65" as const);
  assert.equal(audit.state, "code-present");
  assert.deepEqual(audit.recognizedSelectors, [{ selector: "0xb387cb65", name: "setAuthorizedRouter(address,bool)" }]);
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "quoted", amountOut: "1" },
      sell: { state: "quoted", amountOut: "1" },
      liquidity: 1n,
      hook: audit.state,
    }),
    "sell-quote-returns-output",
  );
});

test("error selector hints are derived from the supplied signatures", () => {
  const audit = auditHookBytecode(NONZERO, "0x63ffa4e61863ab35696f" as const);
  assert.deepEqual(audit.recognizedSelectors, [
    { selector: "0xffa4e618", name: "Blacklisted(address)" },
    { selector: "0xab35696f", name: "ContractPaused()" },
  ]);
});

test("failed or missing hook bytecode remains unknown instead of becoming hookless", () => {
  assert.equal(auditHookBytecode(NONZERO, null, true).state, "read-failed");
  assert.equal(auditHookBytecode(NONZERO, "0x").state, "code-missing");
  assert.equal(auditHookBytecode(ZERO, null).state, "hookless");
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "quoted", amountOut: "1" },
      sell: { state: "reverted", reason: "revert" },
      liquidity: 1n,
      hook: "read-failed",
    }),
    "buy-only-quote-failure",
  );
});

test("buy quote plus a sell revert is pool-level asymmetric evidence", () => {
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "quoted", amountOut: "1" },
      sell: { state: "reverted", reason: "SellNotAllowed(address)" },
      liquidity: 10n,
      hook: "code-present",
    }),
    "buy-only-quote-failure",
  );
});

test("a successful zero-output sell quote is not treated as a viable exit", () => {
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "quoted", amountOut: "99" },
      sell: { state: "zero-output", amountOut: "0" },
      liquidity: 10n,
      hook: "hookless",
    }),
    "sell-quote-zero-output",
  );
});

test("positive quote output is not judged against a fixed raw-unit floor", () => {
  assert.equal(quoteStatus(994n), "quoted");
  assert.equal(quoteStatus(0n), "zero-output");
});

test("same-pool recovery uses a relative 50 percent floor without ranking cross-pool quotes", () => {
  assert.equal(roundTripLabel("9940"), "NONZERO RETURN QUOTE");
  assert.equal(roundTripLabel("60"), "POOR RETURN / EXIT VALUE NOT ESTABLISHED");
  assert.equal(roundTripLabel(null), "UNAVAILABLE");
});

test("an unreadable liquidity observation cannot support a pool conclusion", () => {
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "unknown" },
      sell: { state: "unknown" },
      liquidity: null,
      hook: "code-present",
    }),
    "inconclusive",
  );
});

test("a zero-L hookless directional mismatch stays unconfirmed", () => {
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "quoted", amountOut: "100" },
      sell: { state: "reverted", reason: "revert" },
      liquidity: 0n,
      hook: "hookless",
    }),
    "asymmetric-quote-observation",
  );
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "quoted", amountOut: "100" },
      sell: { state: "quoted", amountOut: "1" },
      liquidity: 0n,
      hook: "hookless",
    }),
    "inconclusive",
  );
});

test("directional quoter evidence survives an independent liquidity-read failure", () => {
  assert.equal(
    classifyPoolEvidence({
      buy: { state: "quoted", amountOut: "1" },
      sell: { state: "reverted", reason: "SellNotAllowed(address)" },
      liquidity: null,
      hook: "code-present",
    }),
    "asymmetric-quote-observation",
  );
});

test("--dexscreener skips the block-0 census; the default keeps it and falls back only when refused", () => {
  assert.equal(parseCliArgs([NONZERO]).dexscreenerOnly, false);
  assert.equal(parseCliArgs([NONZERO, "--dexscreener"]).dexscreenerOnly, true);
  const src = readFileSync("scripts/v4-hook-check.ts", "utf8");
  assert.match(src, /catch \(error\) \{\s*await fromDexScreener\(`the block-0 census was refused/);
  assert.match(src, /if \(all\.length > MAX_CENSUS_POOLS\) \{\s*await fromDexScreener\(/, "a 15,770-pool census falls back instead of hanging");
});

test("the census walks 10M-block windows back to block 0, newest first, with no gap or overlap", async () => {
  const { spanWindows, LOG_SPAN } = await import("../scripts/v4-hook-check");
  const w = spanWindows(74_955_379n);
  assert.deepEqual(w[0], [64_955_380n, 74_955_379n]);
  assert.deepEqual(w.at(-1)![0], 0n);
  for (let i = 1; i < w.length; i++) assert.equal(w[i][1] + 1n, w[i - 1][0]);
  assert.ok(w.every(([f, t]) => t - f + 1n <= LOG_SPAN));
  assert.deepEqual(spanWindows(5n), [[0n, 5n]]);
});

test("pre-trade: look-alike holders are found, never promoted past a warning, and the burn address is a lock", async () => {
  const { largestCluster } = await import("../scripts/pre-trade-check");
  const supply = 1_000_000_000;
  const sniped = [12.4e6, 12.1e6, 11.7e6, 11.6e6, 11.5e6, 11.0e6, 10.8e6, 10.6e6, 3e6, 1e6];
  assert.equal(largestCluster(sniped, supply)?.count, 8);
  assert.equal(largestCluster([50e6, 20e6, 9e6, 4e6, 2e6, 1e6, 8e5, 5e5], supply), null);
  const src = readFileSync("scripts/pre-trade-check.ts", "utf8");
  assert.doesNotMatch(src, /add\("block", `[^`]*near-identical/, "a base-rate shape must not block (9 of 14 live tokens show it)");
  assert.match(src, /const BURN = new Set\(\["0x000000000000000000000000000000000000dead"/);
  assert.match(src, /hookCheck\(\[token\], \{ quiet: !verbose, onResult:/);
  assert.match(src, /functionName: "quoteExactInputSingle"/, "exit size is quoted on chain, not modelled");
});
