import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeAbiParameters, type Hex } from "viem";
import {
  RpcBudget, V2_SWAP, V3_SWAP, V4_SWAP, mergeRows, poolsFromPairs, rowFromGtTrade, rowsFromLogs, swapperDeltas, fetchPools, fetchHistory, rpc, startTradeFeed,
  type FeedPool, type FeedRow,
} from "../lib/trade/trade-feed";

const TOKEN = "0x2c05c1083ee39fa6de12984e0bd4d0311511b777";
const ETH = "0x0000000000000000000000000000000000000000";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const V4_ID = `0x${"ab".repeat(32)}`;
const V3_POOL = "0x00000000000000000000000000000000000000c3";

const pool = (o: Partial<FeedPool>): FeedPool => ({ id: V4_ID, isV4: true, other: ETH, otherSymbol: "ETH", otherDecimals: 18, otherUsd: 2000, volume24h: 0, ...o });
const log = (topic0: Hex, data: Hex, address = "0x8366a39cc670b4001a1121b8f6a443a643e40951", tx = "0x01") =>
  ({ address, topics: [topic0, V4_ID as Hex], data, blockNumber: "0x64" as Hex, transactionHash: tx as Hex });

test("stalled pool discovery and RPC time out while caller cancellation remains effective", async (t) => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", () => timeout(5));
  t.mock.method(globalThis, "fetch", async (_input: unknown, options: RequestInit) => {
    const signal = options.signal!;
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchPools(TOKEN, undefined, new AbortController().signal), { name: "TimeoutError" });
    await assert.rejects(rpc(new RpcBudget(1, 6), "eth_blockNumber", [], new AbortController().signal), { name: "TimeoutError" });
    const controller = new AbortController();
    const pending = fetchPools(TOKEN, undefined, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  } finally { clearTimeout(keepAlive); }
});

test("a failed initial feed lookup recovers after backoff without polling hidden tabs", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const documentMock = { hidden: false, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  let retry!: () => void;
  t.mock.method(globalThis, "setInterval", (callback: () => void) => { retry = callback; return 1; });
  t.mock.method(globalThis, "clearInterval", () => {});
  let poolCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    if (String(input).includes("token-pairs")) {
      poolCalls += 1;
      if (poolCalls === 1) throw new Error("temporary outage");
      documentMock.hidden = true; // Keep live RPC polling out of this bootstrap test.
      return Response.json([{ pairAddress: V4_ID, baseToken: { address: TOKEN }, quoteToken: { address: ETH, symbol: "ETH" }, priceUsd: "1", priceNative: "0.001" }]);
    }
    return Response.json({ data: [] });
  });
  const statuses: string[] = [];
  const stop = startTradeFeed({ address: TOKEN }, (state) => statuses.push(state.status));
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    await flush();
    assert.equal(statuses.at(-1), "unavailable");
    retry();
    assert.equal(poolCalls, 1, "the first failure cannot immediately burst another request");
    now += 30_000;
    documentMock.hidden = true;
    retry();
    assert.equal(poolCalls, 1, "hidden tabs must not retry");
    documentMock.hidden = false;
    retry();
    await flush();
    assert.equal(poolCalls, 2);
    assert.equal(statuses.at(-1), "live");
  } finally {
    stop();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("the budget refuses past its rate and a 429 pause blocks every call until it ends", () => {
  let now = 0;
  const b = new RpcBudget(1, 3, () => now);
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false]);
  now = 1_000;
  assert.equal(b.take(), true);
  b.pause(60_000);
  now = 50_000;
  assert.equal(b.take(), false);
  now = 61_001;
  assert.equal(b.take(), true);
});

test("pools: side read from the pair, primary first, then busiest; other side's USD from priceUsd/priceNative", () => {
  const pools = poolsFromPairs(TOKEN, [
    { pairAddress: "0xAA", baseToken: { address: TOKEN }, quoteToken: { address: USDG, symbol: "USDG" }, priceUsd: "2", priceNative: "2", volume: { h24: 5 } },
    { pairAddress: V4_ID, baseToken: { address: TOKEN }, quoteToken: { address: ETH, symbol: "ETH" }, priceUsd: "4", priceNative: "0.002", volume: { h24: 50 } },
    { pairAddress: "0xBB", baseToken: { address: USDG, symbol: "USDG" }, quoteToken: { address: TOKEN }, priceUsd: "1", priceNative: "0.5", volume: { h24: 1 } },
    { pairAddress: "0xCC", baseToken: { address: "0xother" }, quoteToken: { address: USDG }, volume: { h24: 999 } },
  ], "0xaa");
  assert.deepEqual(pools.map((p) => p.id), ["0xaa", V4_ID, "0xbb"], "unrelated pair dropped, primary pinned first");
  assert.equal(pools[1].otherUsd, 2000);
  assert.equal(pools[1].otherDecimals, 18);
  assert.equal(pools[1].isV4, true);
  assert.equal(pools[2].other, USDG);
  assert.equal(pools[2].otherUsd, 1, "token is the quote: the base's priceUsd is the other side's price");
});

test("GeckoTerminal side comes from which way the token moved, never from its kind", () => {
  const attrs = { block_number: 1, block_timestamp: "2026-09-28T00:00:00Z", tx_hash: "0x1", tx_from_address: "0xw", volume_in_usd: "10" };
  const p = pool({});
  const buy = rowFromGtTrade(TOKEN, p, { attributes: { ...attrs, kind: "sell", from_token_address: ETH, to_token_address: TOKEN, from_token_amount: "0.005", to_token_amount: "1000" } } as never)!;
  assert.equal(buy.type, "buy");
  assert.equal(buy.tokenAmount, 1000);
  assert.equal(buy.ethAmount, 0.005);
  assert.equal(rowFromGtTrade(TOKEN, p, { attributes: { ...attrs, from_token_address: ETH, to_token_address: USDG, from_token_amount: "1", to_token_amount: "1" } } as never), null);
});

test("swap deltas are the swapper's, for V2, V3 and V4, with the token on either side", () => {
  const u = (...v: bigint[]) => encodeAbiParameters(v.map(() => ({ type: "uint256" })), v);
  const i = (...v: bigint[]) => encodeAbiParameters(v.map(() => ({ type: "int256" })), v);
  // V2: 5 of currency1 in, 7 of currency0 out -> the swapper got 7 of currency0.
  assert.deepEqual(swapperDeltas(log(V2_SWAP, u(0n, 5n, 7n, 0n)), true), { token: 7n, other: -5n });
  assert.deepEqual(swapperDeltas(log(V2_SWAP, u(0n, 5n, 7n, 0n)), false), { token: -5n, other: 7n });
  // V3 reports the pool's side: +5 into the pool is -5 for the swapper.
  assert.deepEqual(swapperDeltas(log(V3_SWAP, i(5n, -7n, 1n, 1n, 1n)), true), { token: -5n, other: 7n });
  // V4 reports the swapper's side as is.
  const v4 = encodeAbiParameters([{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }], [-5n, 7n, 1n, 1n, 1, 0]);
  assert.deepEqual(swapperDeltas(log(V4_SWAP, v4), false), { token: 7n, other: -5n });
  assert.equal(swapperDeltas(log("0xdead" as Hex, v4), true), null);
});

test("logs: one row per tx per pool, side from the token, unknown decimals stay unknown", () => {
  const v4 = (a0: bigint, a1: bigint) => encodeAbiParameters(
    [{ type: "int128" }, { type: "int128" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }, { type: "uint24" }], [a0, a1, 1n, 1n, 1, 0]);
  // ETH (currency0) paid, TOKEN (currency1) received, split across two Swap logs in one tx.
  const logs = [log(V4_SWAP, v4(-(10n ** 15n), 500n * 10n ** 18n)), log(V4_SWAP, v4(-(10n ** 15n), 500n * 10n ** 18n))];
  const [row] = rowsFromLogs(TOKEN, 18, [pool({})], logs, 110, 1_000_000);
  assert.equal(row.type, "buy");
  assert.equal(row.tokenAmount, 1000);
  assert.equal(row.ethAmount, 0.002);
  assert.equal(row.usdAmount, 4);
  assert.equal(row.timestamp, 1_000_000 - 10 * 100);
  assert.equal(row.id, `0x01:${V4_ID}`);
  const [blind] = rowsFromLogs(TOKEN, 18, [pool({ otherDecimals: null })], logs, 110, 0);
  assert.ok(Number.isNaN(blind.ethAmount) && Number.isNaN(blind.usdAmount), "never a $0 trade from a missing read");
  const v3 = { ...log(V3_SWAP, encodeAbiParameters([{ type: "int256" }, { type: "int256" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }], [5n, -7n, 1n, 1n, 1])), address: V3_POOL };
  assert.equal(rowsFromLogs(TOKEN, 18, [pool({})], [v3], 110, 0).length, 0, "a log from a pool we did not ask about is dropped");
});

test("merge dedupes GeckoTerminal and live rows on one key and only fills a missing wallet", () => {
  const r = (id: string, block: number, trader = ""): FeedRow => ({ id, block, traderAddress: trader, poolId: "p", quoteSymbol: "ETH", date: "", type: "buy", usdAmount: 1, tokenAmount: 1, ethAmount: 1, priceUsd: 1, txHash: id });
  const merged = mergeRows([r("a", 1, "0xw"), r("b", 2)], [r("a", 1, ""), r("b", 2, "0xv"), r("c", 3)]);
  assert.deepEqual(merged.map((x) => [x.id, x.traderAddress]), [["c", ""], ["b", "0xv"], ["a", "0xw"]]);
});

test("WIRING: the table runs the feed, reads holders from a host browsers can reach, and prints no verdict of its own", () => {
  const table = readFileSync("app/components/trade/TradingTransactionsTable.tsx", "utf8");
  assert.match(table, /startTradeFeed\(\{ address: token\.address, primaryPool: token\.pairAddress \}, setFeed\)/);
  assert.match(table, /marketSource\s*\?\s*startTradeFeed\(\{ address: token\.address, primaryPool: token\.pairAddress, marketSource \}, setFeed\)/);
  assert.match(table, /\$\{explorerApiUrl\}\/tokens\/\$\{token\.address\}/);
  assert.doesNotMatch(table, /robinscan\.io|createPublicClient|getLogs/);
  assert.doesNotMatch(table, />PASS</, "per-check status comes from TheRecord, not literals");
  assert.match(readFileSync("docker/nginx/nginx.conf", "utf8"), /connect-src[^"]*https:\/\/api\.geckoterminal\.com/);
});

test("RWA pools share the terminal pair observation and history reads are pooled, retryable, and caller-cancellable", async (t) => {
  const rwaToken = "0x1111111111111111111111111111111111111111";
  const rwaPool = "0x0000000000000000000000000000000000000011";
  let pairCalls = 0;
  const historyCalls = new Map<string, number>();
  let geckoActive = 0;
  let geckoMaxActive = 0;
  let canceledResolve!: (response: Response) => void;
  let cooldownNow = 200_000;
  t.mock.method(Date, "now", () => cooldownNow);
  t.mock.method(globalThis, "fetch", async (input: unknown, options?: RequestInit) => {
    const url = String(input);
    if (url.includes("token-pairs/v1/robinhood")) {
      pairCalls += 1;
      return Response.json([{
        chainId: "robinhood", pairAddress: rwaPool,
        baseToken: { address: rwaToken, symbol: "RWA" }, quoteToken: { address: ETH, symbol: "ETH" },
        priceUsd: "1", priceNative: "0.001", volume: { h24: 10 }, liquidity: { usd: 1000 },
      }, {
        chainId: "ethereum", pairAddress: "0x0000000000000000000000000000000000000099",
        baseToken: { address: rwaToken, symbol: "RWA" }, quoteToken: { address: ETH, symbol: "ETH" },
        priceUsd: "2", priceNative: "0.001", volume: { h24: 100000 }, liquidity: { usd: 900000 },
      }]);
    }
    const id = url.match(/pools\/(0x[\da-f]+)\/trades/i)?.[1] ?? "unknown";
    const calls = (historyCalls.get(id) ?? 0) + 1;
    historyCalls.set(id, calls);
    if (id.startsWith("0xaaaa")) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return Response.json({ data: [] });
    }
    if (id.endsWith("29") && calls === 1) return Response.json({ data: [{ attributes: {
      block_number: 5, block_timestamp: "2026-09-30T00:00:00Z", tx_hash: "0xmalformed", tx_from_address: "",
      from_token_address: ETH, to_token_address: TOKEN, from_token_amount: null, to_token_amount: "1", volume_in_usd: "1",
    } }] });
    if (["26", "27", "28"].some((suffix) => id.endsWith(suffix))) {
      geckoActive += 1;
      geckoMaxActive = Math.max(geckoMaxActive, geckoActive);
      await new Promise((resolve) => setTimeout(resolve, 0));
      geckoActive -= 1;
      return Response.json({ data: [] });
    }
    if (id.endsWith("21") && calls === 1) return new Response("", { status: 503 });
    if (id.endsWith("22")) return new Response("", { status: 429 });
    if (id.endsWith("24")) return new Promise<Response>((resolve) => { canceledResolve = resolve; });
    assert.ok(options?.signal, "shared provider fetch has its own bounded timeout signal");
    return Response.json({ data: [] });
  });

  const [firstPools, secondPools] = await Promise.all([
    fetchPools(rwaToken, undefined, new AbortController().signal, "rwa"),
    fetchPools(rwaToken, undefined, new AbortController().signal, "rwa"),
  ]);
  assert.equal(pairCalls, 1, "both feed starts use the terminal's cached pair read");
  assert.equal(firstPools[0]?.id, rwaPool);
  assert.deepEqual(secondPools, firstPools);
  assert.ok(firstPools.every((feedPool) => feedPool.id !== "0x0000000000000000000000000000000000000099"), "a foreign-chain high-volume pair cannot enter the feed");

  const failurePool = pool({ id: `0x${"0".repeat(38)}21`, isV4: false });
  await fetchHistory(TOKEN, [failurePool], new AbortController().signal);
  await fetchHistory(TOKEN, [failurePool], new AbortController().signal);
  assert.equal(historyCalls.get(failurePool.id), 2, "an HTTP failure is not cached and can retry");
  const malformedPool = pool({ id: `0x${"0".repeat(38)}29`, isV4: false });
  assert.equal((await fetchHistory(TOKEN, [malformedPool], new AbortController().signal)).failed, 1);
  assert.equal((await fetchHistory(TOKEN, [malformedPool], new AbortController().signal)).failed, 0);
  assert.equal(historyCalls.get(malformedPool.id), 2, "malformed rows are rejected without caching the response");

  const sharedPool = pool({ id: `0x${"0".repeat(38)}24`, isV4: false });
  const abandoned = new AbortController();
  const abandonedRead = fetchHistory(TOKEN, [sharedPool], abandoned.signal);
  const retainedRead = fetchHistory(TOKEN, [sharedPool], new AbortController().signal);
  abandoned.abort();
  await assert.rejects(abandonedRead, { name: "AbortError" });
  canceledResolve(Response.json({ data: [] }));
  await retainedRead;
  assert.equal(historyCalls.get(sharedPool.id), 1, "an aborted waiter cannot cancel the shared provider refill");

  await fetchHistory(TOKEN, [26, 27, 28].map((suffix) => pool({ id: `0x${"0".repeat(38)}${suffix}`, isV4: false })), new AbortController().signal);
  assert.equal(geckoMaxActive, 2, "GeckoTerminal requests are bounded to two across the module");

  const saturatedPools = Array.from({ length: 36 }, (_, i) => pool({ id: `0xaaaa${i.toString(16).padStart(36, "0")}`, isV4: false }));
  const saturated = await Promise.all(Array.from({ length: 12 }, (_, i) => fetchHistory(TOKEN, saturatedPools.slice(i * 3, i * 3 + 3), new AbortController().signal)));
  assert.equal([...historyCalls].filter(([id]) => id.startsWith("0xaaaa")).reduce((sum, [, count]) => sum + count, 0), 34, "only the two active and 32 queued cold requests are sent");
  assert.equal(saturated.reduce((sum, result) => sum + result.failed, 0), 2, "the 32-entry pending queue rejects excess cold requests instead of growing without bound");

  const throttled = pool({ id: `0x${"0".repeat(38)}22`, isV4: false });
  const afterThrottle = pool({ id: `0x${"0".repeat(38)}25`, isV4: false });
  await fetchHistory(TOKEN, [throttled], new AbortController().signal);
  await fetchHistory(TOKEN, [afterThrottle], new AbortController().signal);
  assert.equal(historyCalls.get(throttled.id), 1);
  assert.equal(historyCalls.has(afterThrottle.id), false, "a 429 suppresses the next request during shared cooldown");
  cooldownNow += 60_001;
  await fetchHistory(TOKEN, [afterThrottle], new AbortController().signal);
  assert.equal(historyCalls.get(afterThrottle.id), 1, "requests resume after cooldown expires");
});

test("WIRING: wallets the RPC budget cannot reach are backfilled from GeckoTerminal, not left as '...'", () => {
  const src = readFileSync("lib/trade/trade-feed.ts", "utf8");
  assert.match(src, /Date\.now\(\) - backfilledAt >= WALLET_BACKFILL_MS/);
  assert.match(src, /void fetchHistory\(token\.address, pools, signal\)\s*\n?\s*\.then\(\(h\) => emit\(\{ rows: mergeRows\(state\.rows, h\.rows\) \}\)\)/);
});
