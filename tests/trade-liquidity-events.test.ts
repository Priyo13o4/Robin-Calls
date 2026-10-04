import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeAbiParameters, type Hex } from "viem";
import {
  liquidityRowsFromLogs, removalShare, v4OtherAmount, rowsFromLogs,
  V2_BURN, V3_BURN, V3_MINT, V4_MODIFY, V4_POOL_MANAGER, type FeedPool,
} from "../lib/trade/trade-feed";
import { warnableRemoval, type LiquidityWatch } from "../lib/trade/liquidity-watch";

const MEME = "0x22a74be525d7945240691ab28d5aeff85304a15a";
const MEME_POOL = "0x79c9079225c9b7f1cea3a2606a54912157a20df631ebeacfba978667d0a2e9c1";
const V3P = "0x3333333333333333333333333333333333333333";
const pool = (id: string, other = "0x0000000000000000000000000000000000000000"): FeedPool => ({
  id, isV4: id.length === 66, other, otherSymbol: "ETH", otherDecimals: 18, otherUsd: 4000, tokenUsd: 0.0002, volume24h: 1,
});
const log = (address: string, topics: Hex[], data: Hex, block = 100) =>
  ({ address, topics, data, blockNumber: `0x${block.toString(16)}` as Hex, transactionHash: `0x${"ab".repeat(32)}` as Hex });

test("MEME: the V4 pull is a removal row, and its ETH side solves to what the pool held", () => {
  // Measured 2026-09-29, tx 0xff5f3216: L 33218249502344340119344, full range, 108219692.27 MEME out.
  const data = encodeAbiParameters(
    [{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }],
    [-887200, 887200, -33218249502344340119344n, `0x${"00".repeat(32)}`],
  );
  const [row] = liquidityRowsFromLogs(MEME, 18, [pool(MEME_POOL)], [log(V4_POOL_MANAGER, [V4_MODIFY, MEME_POOL as Hex, `0x${"00".repeat(32)}`], data)], 100, 0);
  assert.equal(row.liquidity, "remove");
  assert.deepEqual(row.lp, { protocol: "v4", amount: 33218249502344340119344n });
  assert.ok(Number.isNaN(row.tokenAmount), "V4 amounts are unknown until the receipt is read, never 0");
  const eth = v4OtherAmount(33218249502344340119344, -887200, 887200, 108219692275945173169777732, false) / 1e18;
  assert.ok(Math.abs(eth - 10.196) < 0.01, `solved ${eth}`);
});

test("V3: a zero-liquidity Burn only settles fees and is not a removal", () => {
  const burn = (amount: bigint) => encodeAbiParameters([{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }], [amount, 5n, 7n]);
  const topics = [V3_BURN, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`] as Hex[];
  assert.equal(liquidityRowsFromLogs(MEME, 18, [pool(V3P)], [log(V3P, topics, burn(0n))], 100, 0).length, 0);
  const [row] = liquidityRowsFromLogs(MEME, 18, [pool(V3P)], [log(V3P, topics, burn(9n))], 100, 0);
  assert.equal(row.liquidity, "remove");
  assert.deepEqual(row.lp, { protocol: "v3", amount: 9n });
});

test("V3 Mint and V2 Burn carry their amounts; the token side is picked by address order", () => {
  const mint = encodeAbiParameters([{ type: "address" }, { type: "uint128" }, { type: "uint256" }, { type: "uint256" }], [V3P, 4n, 2n * 10n ** 18n, 3n * 10n ** 18n]);
  const other = "0xffffffffffffffffffffffffffffffffffffffff"; // MEME sorts first: MEME is currency0
  const [row] = liquidityRowsFromLogs(MEME, 18, [pool(V3P, other)], [log(V3P, [V3_MINT, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`] as Hex[], mint)], 100, 0);
  assert.equal(row.liquidity, "add");
  assert.equal(row.tokenAmount, 2);
  assert.equal(row.ethAmount, 3);
  const v2 = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [10n ** 18n, 5n * 10n ** 18n]);
  const [b] = liquidityRowsFromLogs(MEME, 18, [pool(V3P, other)], [log(V3P, [V2_BURN, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`] as Hex[], v2)], 100, 0);
  assert.deepEqual(b.lp, { protocol: "v2", amount: 10n ** 18n });
});

test("liquidity events never become trades", () => {
  const data = encodeAbiParameters([{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }], [-60, 60, 5n, `0x${"00".repeat(32)}`]);
  assert.deepEqual(rowsFromLogs(MEME, 18, [pool(MEME_POOL)], [log(V4_POOL_MANAGER, [V4_MODIFY, MEME_POOL as Hex], data)], 100, 0), []);
});

test("share and emptiness: V3/V4 read exactly zero; V2 keeps MINIMUM_LIQUIDITY dust", () => {
  assert.deepEqual(removalShare("v4", 100n, 0n), { share: 1, emptied: true });
  assert.deepEqual(removalShare("v3", 100n, 100n), { share: 0.5, emptied: false });
  assert.equal(removalShare("v2", 10n ** 18n, 1000n).emptied, true);
  assert.equal(removalShare("v2", 100n, 900n).emptied, false);
});

test("only the MAIN pool warns, and only for a real share of it", () => {
  const r = { poolId: "0xmain", txHash: "0x", block: 1, atMs: 1, share: 0.9, emptied: false, lastTradeBeforeMs: null };
  const w = (over: Partial<typeof r>, main = "0xmain"): LiquidityWatch => ({ mainPoolId: main, removal: { ...r, ...over } });
  assert.ok(warnableRemoval(w({})));
  assert.equal(warnableRemoval(w({}, "0xother")), null, "a decoy or dust pool never warns");
  assert.equal(warnableRemoval(w({ share: 0.2 })), null, "an LP trimming a position is not a pull");
  assert.ok(warnableRemoval(w({ share: null, emptied: true, atMs: null, txHash: null, block: null })), "empty now, removal too old to find");
});

test("WIRING: liquidity topics ride the existing swap log calls; the lookback is gated and bounded", () => {
  const src = readFileSync("lib/trade/trade-feed.ts", "utf8");
  assert.match(src, /topics: \[\[V2_SWAP, V3_SWAP, V2_MINT, V2_BURN, V3_MINT, V3_BURN\]\]/);
  assert.match(src, /topics: \[\[V4_SWAP, V4_MODIFY\], v4\]/);
  assert.match(src, /LIQUIDITY_LOOKBACK_BLOCKS = 10_000_000/, "the public node refuses more than 10M blocks per request");
  const look = src.slice(src.indexOf("const lookBack = async"), src.indexOf("const fillV4 = async"));
  assert.match(look, /if \(depth > 0n\) \{ lookedBack = true; return; \}/, "an older pool that still holds liquidity is never searched");
  assert.match(look, /range = Math\.ceil\(range \/ 2\)/, "a refused range is halved, not given up at once");
  assert.match(src, /const main = pools\[0\];/);
  for (const f of ["app/components/trade/TradingRightRail.tsx", "app/components/trade/TradingTransactionsTable.tsx"]) {
    assert.match(readFileSync(f, "utf8"), /warnableRemoval\(useLiquidityWatch\(/, `${f} must gate on the main pool`);
  }
  const banner = readFileSync("app/components/trade/LiquidityPullBanner.tsx", "utf8");
  assert.match(banner, /warnableRemoval\(watch\)/, "banner removal copy must stay scoped to the main pool");
  assert.match(banner, /pool: watch\.mainPoolId/, "live custody lookup must use the feed's main pool identity");
  assert.match(readFileSync("app/trade/[token]/TradePageClient.tsx", "utf8"), /<LiquidityPullBanner /);
});

test("DOTS: a pull in a sibling USDG pool is not a row on the ETH pool's page", () => {
  // 2026-09-29: four removals in DOTS/USDG pools showed as "LP remove" on the untouched DOTS/ETH page.
  const ETH_POOL = "0x2c157c7a7a05122e8dbaefd6c43c77d4e39f4b0e010688ebd6342332e8da42fa";
  const USDG_POOL = "0x09eb5db7e0ae04bf5c61b4ab9720f111b3e3eed02f905dc3ecea138d4312dfad";
  const data = encodeAbiParameters([{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }], [-60, 60, -5n, `0x${"00".repeat(32)}`]);
  const logs = [log(V4_POOL_MANAGER, [V4_MODIFY, USDG_POOL as Hex, `0x${"00".repeat(32)}`], data)];
  const pools = [pool(ETH_POOL), pool(USDG_POOL)];
  assert.equal(liquidityRowsFromLogs(MEME, 18, pools, logs, 100, 0).length, 1, "the builder itself reads any pool it is given");
  assert.equal(liquidityRowsFromLogs(MEME, 18, pools.slice(0, 1), logs, 100, 0).length, 0);
});

test("WIRING: every liquidity row source is scoped to the main pool", () => {
  const src = readFileSync("lib/trade/trade-feed.ts", "utf8");
  const calls = [...src.matchAll(/liquidityRowsFrom(?:Logs|Events)\(token\.address, tokenDecimals \?\? NaN, (\[main\]|pools(?:\.slice\(0, 1\))?),/g)].map((m) => m[1]);
  assert.equal(calls.length, 3, `expected the live poll and both lookbacks: ${calls.join(" | ")}`);
  for (const arg of calls) assert.ok(arg === "[main]" || arg === "pools.slice(0, 1)", `unscoped pool list: ${arg}`);
});
