import test, { mock } from "node:test";
import assert from "node:assert/strict";

const TOKEN = "0x1111111111111111111111111111111111111111";
const WALLET_A = "0x2222222222222222222222222222222222222222";
const WALLET_B = "0x3333333333333333333333333333333333333333";
const CREATE_TX = `0x${"ab".repeat(32)}`;

const calls = {
  explorer: 0,
  receipt: 0,
  multicall: 0,
  txCounts: new Map<string, number>(),
  failNextTxCount: false,
  failNextMulticall: false,
};

const redis = {
  get: async () => null,
  mget: async (...keys: string[]) => keys.map(() => null),
  set: async () => "OK",
  pipeline() {
    return {
      set() { return this; },
      exec: async () => [],
    };
  },
};

mock.module("@/lib/redis/client", { namedExports: { redisClient: () => redis } });
mock.module("@/lib/rpc/client", {
  namedExports: {
    rpc: () => ({
      getTransactionReceipt: async () => {
        calls.receipt += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { from: WALLET_A, logs: [] };
      },
      getTransactionCount: async ({ address }: { address: string }) => {
        const key = address.toLowerCase();
        calls.txCounts.set(key, (calls.txCounts.get(key) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (calls.failNextTxCount) {
          calls.failNextTxCount = false;
          throw new Error("temporary RPC failure");
        }
        return 9;
      },
    }),
  },
});
mock.module("@/lib/explorer/router", {
  namedExports: {
    explorer: {
      addressInfo: async () => {
        calls.explorer += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { creation_tx_hash: CREATE_TX };
      },
    },
  },
});
mock.module("@/lib/rpc/multicall", {
  namedExports: {
    batchRead: async (reads: readonly { functionName: string }[]) => {
      calls.multicall += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (calls.failNextMulticall) {
        calls.failNextMulticall = false;
        throw new Error("temporary multicall failure");
      }
      return reads.map((read) => ({ status: "success", value: read.functionName === "totalSupply" ? 1000n : 100n }));
    },
  },
});

test("overlapping cold wallet-fact requests share launch, held-share, and nonce refills", async () => {
  const { readWalletFacts, _resetWalletFactsCachesForTests } = await import("../lib/trade/wallet-facts");
  _resetWalletFactsCachesForTests();
  calls.explorer = 0;
  calls.receipt = 0;
  calls.multicall = 0;
  calls.txCounts.clear();

  const args = { token: TOKEN, wallets: [WALLET_A, WALLET_B], pools: [] };
  const [first, second] = await Promise.all([readWalletFacts(args.token, args.wallets, args.pools), readWalletFacts(args.token, args.wallets, args.pools)]);

  assert.deepEqual(first, second);
  assert.equal(calls.explorer, 1, "one creation-transaction lookup for the token");
  assert.equal(calls.receipt, 1, "one creation receipt read for the token");
  assert.equal(calls.multicall, 1, "one batched held-share refill for overlapping wallets");
  assert.equal(calls.txCounts.get(WALLET_A), 1);
  assert.equal(calls.txCounts.get(WALLET_B), 1);
  assert.equal(first[WALLET_A]?.launch, "dev");
  assert.equal(first[WALLET_A]?.heldShare, 0.125);
  assert.equal(first[WALLET_A]?.txCount, 9);
});

test("a failed nonce read is shared only while in flight and can be retried", async () => {
  const { readWalletFacts, _resetWalletFactsCachesForTests } = await import("../lib/trade/wallet-facts");
  _resetWalletFactsCachesForTests();
  calls.txCounts.clear();
  calls.failNextTxCount = true;
  const args = { token: TOKEN, wallets: [WALLET_B], pools: [] };

  const [first, joined] = await Promise.all([
    readWalletFacts(args.token, args.wallets, args.pools),
    readWalletFacts(args.token, args.wallets, args.pools),
  ]);
  assert.equal(first[WALLET_B]?.txCount, null);
  assert.deepEqual(joined, first);
  assert.equal(calls.txCounts.get(WALLET_B), 1, "concurrent callers share the faulted RPC attempt");

  const retry = await readWalletFacts(args.token, args.wallets, args.pools);
  assert.equal(retry[WALLET_B]?.txCount, 9);
  assert.equal(calls.txCounts.get(WALLET_B), 2, "the faulted null is not retained as a fact");
});


test("held-share refills share canonical pool sets but separate distinct pool sets", async () => {
  const { readHeldShares, _resetWalletFactsCachesForTests } = await import("../lib/trade/wallet-facts");
  _resetWalletFactsCachesForTests();
  calls.multicall = 0;
  const poolA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const poolB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const [first, reordered] = await Promise.all([
    readHeldShares(TOKEN, [WALLET_A], [poolA, poolB]),
    readHeldShares(TOKEN, [WALLET_A], [poolB.toUpperCase(), poolA, poolA]),
  ]);
  assert.deepEqual(first, reordered);
  assert.equal(calls.multicall, 1, "case, order, and duplicate differences share one pool-set refill");

  const distinct = await readHeldShares(TOKEN, [WALLET_A], [poolA]);
  assert.equal(calls.multicall, 2, "a different pool set gets its own denominator read");
  assert.notEqual(distinct.get(WALLET_A), first.get(WALLET_A));
});

test("a failed held-share batch returns unread and retries instead of caching null", async () => {
  const { readHeldShares, _resetWalletFactsCachesForTests } = await import("../lib/trade/wallet-facts");
  _resetWalletFactsCachesForTests();
  calls.multicall = 0;
  calls.failNextMulticall = true;

  const failed = await readHeldShares(TOKEN, [WALLET_A], []);
  assert.equal(failed.get(WALLET_A), null);
  const retry = await readHeldShares(TOKEN, [WALLET_A], []);
  assert.equal(retry.get(WALLET_A), 0.125);
  assert.equal(calls.multicall, 2, "the unread result is not retained as a cached negative");
});
