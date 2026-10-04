import test from "node:test";
import assert from "node:assert/strict";
import { readCachedTokens, resetTokenApiCache } from "../lib/trade/tokens-api-cache";
import type { SelectableToken } from "../lib/trade/types";

test("searches normalize keys, share refills, and retry failures", async () => {
  resetTokenApiCache();
  let calls = 0;
  const load = async () => { calls++; return []; };
  await Promise.all([readCachedTokens(" ETH ", load), readCachedTokens("eth", load)]);
  assert.equal(calls, 1);
  await assert.rejects(readCachedTokens("failed", async () => { throw new Error("DB unavailable"); }));
  await readCachedTokens("failed", load);
  assert.equal(calls, 2);
});

test("distinct searches cannot retain more than 256 completed results", async () => {
  resetTokenApiCache();
  let calls = 0;
  const load = async () => { calls++; return []; };
  for (let i = 0; i < 300; i++) await readCachedTokens(`search-${i}`, load);
  await readCachedTokens("search-299", load);
  assert.equal(calls, 300, "recent results remain cached");
  await readCachedTokens("search-0", load);
  assert.equal(calls, 301, "the oldest search was evicted");
});

test("clearing searches prevents an older refill from restoring stale results", async () => {
  resetTokenApiCache();
  let finish!: (value: SelectableToken[]) => void;
  const old = readCachedTokens("eth", () => new Promise((resolve) => { finish = resolve; }));
  resetTokenApiCache();
  const fresh: SelectableToken[] = [];
  await readCachedTokens("eth", async () => fresh);
  finish([{ symbol: "OLD" } as SelectableToken]);
  await old;
  const result = await readCachedTokens("eth", async () => { throw new Error("fresh result should remain cached"); });
  assert.equal(result, fresh);
});
