import test from "node:test";
import assert from "node:assert/strict";
import { explorer, deps as routerDeps, selectAdapter } from "../lib/explorer/router";
import { robinscanAdapter, deps as robinscanDeps } from "../lib/explorer/robinscan";
import type { ExplorerAdapter } from "../lib/explorer/adapter";
import { ExplorerFault } from "../lib/explorer/http";
import { createScanContext, runWithScanContext, explorerFaulted } from "../lib/observability/context";

test("explorer router - weighted selection distributes across both adapters", () => {
  // tokenInfo, not addressInfo: addressInfo is pinned to Blockscout (see the
  // dedicated test below) and would not exercise the weighted path at all.
  const capable: ExplorerAdapter[] = [
    { id: "blockscout", capabilities: { methods: ["tokenInfo"] } } as any,
    { id: "robinscan", capabilities: { methods: ["tokenInfo"] } } as any,
  ];

  // The weight now DEFAULTS to 0 (robinscan is opt-in, 2026-08-26), so this
  // test has to configure it or it is asserting the default rather than the
  // distribution it is named for.
  const prev = process.env.EXPLORER_ROBINSCAN_WEIGHT;
  process.env.EXPLORER_ROBINSCAN_WEIGHT = "30";
  try {
    // Force random to select blockscout (random >= weight)
    const adapterB = selectAdapter(capable, "tokenInfo", 80);
    assert.equal(adapterB.id, "blockscout");

    // Force random to select robinscan (random < weight)
    const adapterR = selectAdapter(capable, "tokenInfo", 20);
    assert.equal(adapterR.id, "robinscan");
  } finally {
    if (prev === undefined) delete process.env.EXPLORER_ROBINSCAN_WEIGHT;
    else process.env.EXPLORER_ROBINSCAN_WEIGHT = prev;
  }
});

test("robinscan is opt-in: with the flag unset, Blockscout is the only adapter", () => {
  const prev = process.env.EXPLORER_ROBINSCAN_ENABLED;
  delete process.env.EXPLORER_ROBINSCAN_ENABLED;
  try {
    // Force the lazy registry to rebuild under the current env.
    routerDeps.adapters = undefined as never;
    assert.deepEqual(routerDeps.adapters.map((a) => a.id), ["blockscout"]);
  } finally {
    if (prev !== undefined) process.env.EXPLORER_ROBINSCAN_ENABLED = prev;
    routerDeps.adapters = undefined as never;
  }
});

test("the weight defaults to 0 — enabling the adapter must not make it the first ask", () => {
  const prev = process.env.EXPLORER_ROBINSCAN_WEIGHT;
  delete process.env.EXPLORER_ROBINSCAN_WEIGHT;
  try {
    const capable2: ExplorerAdapter[] = [
      { id: "blockscout", capabilities: { methods: ["tokenInfo"] } } as any,
      { id: "robinscan", capabilities: { methods: ["tokenInfo"] } } as any,
    ];
    // Even the lowest possible draw must not reach a zero-weight adapter.
    assert.equal(selectAdapter(capable2, "tokenInfo", 0).id, "blockscout");
  } finally {
    if (prev !== undefined) process.env.EXPLORER_ROBINSCAN_WEIGHT = prev;
  }
});

test("explorer router - addressInfo is pinned to Blockscout regardless of weight/draw", () => {
  const capable: ExplorerAdapter[] = [
    { id: "blockscout", capabilities: { methods: ["addressInfo"] } } as any,
    { id: "robinscan", capabilities: { methods: ["addressInfo"] } } as any,
  ];

  // Even a draw that would pick Robinscan on a weighted method must not here —
  // addressInfo feeds checkExplorerScamFlag (CRITICAL), and Robinscan has no
  // is_scam/public_tags to answer it with.
  const adapter = selectAdapter(capable, "addressInfo", 0);
  assert.equal(adapter.id, "blockscout");
});

test("explorer router - fault falls through to other adapter and returns non-null", async () => {
  let blockscoutCalled = false;
  let robinscanCalled = false;
  
  const mockBlockscout = {
    id: "blockscout",
    capabilities: { methods: ["addressInfo"] },
    addressInfo: async () => {
      blockscoutCalled = true;
      throw new ExplorerFault("Mock fault");
    },
  } as unknown as ExplorerAdapter;

  const mockRobinscan = {
    id: "robinscan",
    capabilities: { methods: ["addressInfo"] },
    addressInfo: async () => {
      robinscanCalled = true;
      return { is_contract: true };
    },
  } as unknown as ExplorerAdapter;

  const originalAdapters = routerDeps.adapters;
  routerDeps.adapters = [mockBlockscout, mockRobinscan];

  try {
    // Ensure blockscout is selected first for this test
    const oldMathRandom = Math.random;
    Math.random = () => 0.99; // 99 >= 30, so blockscout is picked

    const result = await explorer.addressInfo("0x123");
    
    Math.random = oldMathRandom;

    assert.equal(blockscoutCalled, true);
    assert.equal(robinscanCalled, true);
    assert.deepEqual(result, { is_contract: true } as any);
  } finally {
    routerDeps.adapters = originalAdapters;
  }
});

test("explorer router - both adapters faulting returns null", async () => {
  const mockBlockscout = {
    id: "blockscout",
    capabilities: { methods: ["addressInfo"] },
    addressInfo: async () => {
      throw new ExplorerFault("Mock fault B");
    },
  } as unknown as ExplorerAdapter;

  const mockRobinscan = {
    id: "robinscan",
    capabilities: { methods: ["addressInfo"] },
    addressInfo: async () => {
      throw new ExplorerFault("Mock fault R");
    },
  } as unknown as ExplorerAdapter;

  const originalAdapters = routerDeps.adapters;
  routerDeps.adapters = [mockBlockscout, mockRobinscan];

  try {
    const result = await explorer.addressInfo("0x123");
    assert.equal(result, null);
  } finally {
    routerDeps.adapters = originalAdapters;
  }
});

test("explorer router - method with 1 capable adapter never attempts the other", async () => {
  let blockscoutCalled = false;
  let robinscanCalled = false;

  const mockBlockscout = {
    id: "blockscout",
    capabilities: { methods: ["smartContractFull"] },
    smartContractFull: async () => {
      blockscoutCalled = true;
      return { is_verified: true } as any;
    },
  } as unknown as ExplorerAdapter;

  const mockRobinscan = {
    id: "robinscan",
    capabilities: { methods: [] }, // not capable
    smartContractFull: async () => {
      robinscanCalled = true;
      return null;
    },
  } as unknown as ExplorerAdapter;

  const originalAdapters = routerDeps.adapters;
  routerDeps.adapters = [mockBlockscout, mockRobinscan];

  try {
    const result = await explorer.smartContractFull("0x123");
    assert.equal(blockscoutCalled, true);
    assert.equal(robinscanCalled, false);
    assert.deepEqual(result, { is_verified: true } as any);
  } finally {
    routerDeps.adapters = originalAdapters;
  }
});

test("explorer router - one adapter's 404 is not the chain's answer", async () => {
  // Reversed 2026-08-13. A 404 is a fact about an INDEX, not about the chain:
  // the creator/tx Blockscout's indexer missed was never recovered because the
  // draw ended the lookup (DEPLOYER-IDENTITY-HANDOFF, "the two explorers do not
  // answer the same questions"). Cost is one extra request on a miss.
  let blockscoutCalled = 0;
  let robinscanCalled = 0;

  const mockBlockscout = {
    id: "blockscout",
    capabilities: { methods: ["addressInfo"] },
    addressInfo: async () => {
      blockscoutCalled++;
      return null; // A 404 is represented as null, NOT throwing ExplorerFault
    },
  } as unknown as ExplorerAdapter;

  const mockRobinscan = {
    id: "robinscan",
    capabilities: { methods: ["addressInfo"] },
    addressInfo: async () => {
      robinscanCalled++;
      return { is_contract: true };
    },
  } as unknown as ExplorerAdapter;

  const originalAdapters = routerDeps.adapters;
  routerDeps.adapters = [mockBlockscout, mockRobinscan];

  try {
    const result = await explorer.addressInfo("0x123");
    assert.equal(blockscoutCalled, 1);
    assert.equal(robinscanCalled, 1, "the second adapter must still be asked");
    assert.deepEqual(result, { is_contract: true });
  } finally {
    routerDeps.adapters = originalAdapters;
  }
});

test("explorer router - a 404 from EVERY adapter is null, and never trips the exhausted latch", async () => {
  // The half that must not change: silence and absence are different, and only
  // silence may latch the scan into a degraded verdict.
  const miss = (id: string) =>
    ({
      id,
      capabilities: { methods: ["addressInfo"] },
      addressInfo: async () => null,
    }) as unknown as ExplorerAdapter;

  const originalAdapters = routerDeps.adapters;
  routerDeps.adapters = [miss("blockscout"), miss("robinscan")];
  const ctx = createScanContext("router-404");

  try {
    const result = await runWithScanContext(ctx, () => explorer.addressInfo("0x123"));
    assert.equal(result, null);
    assert.deepEqual(ctx.providerStates, {}, "a 404 is an answer — nothing to record");
    assert.equal(explorerFaulted(ctx), false);
  } finally {
    routerDeps.adapters = originalAdapters;
  }
});

test("explorer router - an adapter that cannot answer the field does not end the lookup", async () => {
  // robinscan's /txs has no sender. Before the `satisfied` predicate, a
  // robinscan draw made every creation-tx launcher unknowable for that scan.
  const mockRobinscan = {
    id: "robinscan",
    capabilities: { methods: ["transaction"] },
    transaction: async () => ({ timestamp: "2026-01-01T00:00:00Z" }),
  } as unknown as ExplorerAdapter;

  const mockBlockscout = {
    id: "blockscout",
    capabilities: { methods: ["transaction"] },
    transaction: async () => ({ timestamp: "2026-01-01T00:00:00Z", from: { hash: "0xabc" } }),
  } as unknown as ExplorerAdapter;

  const originalAdapters = routerDeps.adapters;
  const oldMathRandom = Math.random;
  routerDeps.adapters = [mockBlockscout, mockRobinscan];

  try {
    Math.random = () => 0.0; // draw robinscan first
    const result = await explorer.transaction("0xdead");
    assert.equal(result?.from?.hash, "0xabc", "the fuller answer must win");

    // And the thin answer is still returned when it is all there is — a
    // predicate must add information, never withhold what was read.
    routerDeps.adapters = [mockRobinscan];
    const only = await explorer.transaction("0xdead");
    assert.equal(only?.timestamp, "2026-01-01T00:00:00Z");
    assert.equal(only?.from, undefined);
  } finally {
    Math.random = oldMathRandom;
    routerDeps.adapters = originalAdapters;
  }
});

test("robinscan adapter - response mapping for addressInfo", async () => {
  const originalGet = robinscanDeps.get;
  robinscanDeps.get = async () => ({
    "address": "0x123",
    "isContract": true,
    "balance": "1000",
    "txCount": 5,
    "firstSeen": "abc",
    "lastSeen": "def",
    "contractCreator": "0xcreator",
    "contractCreationTx": "0xtx",
    "isVerified": false,
    "implementation": "",
    "lastBalanceUpdateBlock": 123,
    "tokenTransfersCount": 2
  } as any);

  try {
    const result = await robinscanAdapter.addressInfo("0x123");
    assert.deepEqual(result, {
      is_contract: true,
      is_verified: false,
      creation_tx_hash: "0xtx",
      creator_address_hash: "0xcreator",
    });
  } finally {
    robinscanDeps.get = originalGet;
  }
});

test("robinscan adapter - response mapping for tokenInfo", async () => {
  const originalGet = robinscanDeps.get;
  robinscanDeps.get = async () => ({
    "address": "0x123",
    "name": "Token",
    "symbol": "TKN",
    "decimals": 18,
    "totalSupply": "1000000",
    "tokenType": "ERC20",
    "holderCount": 50,
    "transferCount": 100,
    "priceUsd": 1.2,
    "marketCapUsd": 1200000
  } as any);

  try {
    const result = await robinscanAdapter.tokenInfo("0x123");
    assert.deepEqual(result, {
      name: "Token",
      symbol: "TKN",
      holders: "50",
      total_supply: "1000000",
      decimals: "18",
    });
  } finally {
    robinscanDeps.get = originalGet;
  }
});

test("robinscan adapter - response mapping for tokenHolders", async () => {
  const originalGet = robinscanDeps.get;
  robinscanDeps.get = async () => ({
    "items": [{
      "holder": "0xholder",
      "holderName": "Pool",
      "amount": "100",
      "balance": "1000",
      "share": 10.5,
      "valueUsd": 150.2
    }],
    "total": 1,
    "page": 1,
    "pageSize": 50,
    "status": "ok"
  } as any);

  try {
    const result = await robinscanAdapter.tokenHolders("0x123");
    assert.deepEqual(result, {
      items: [{
        address: { hash: "0xholder" },
        value: "1000",
        label: "Pool",
        shareOfSupply: 10.5,
        valueUsd: 150.2,
      }]
    });
  } finally {
    robinscanDeps.get = originalGet;
  }
});

test("robinscan adapter - response mapping for transaction", async () => {
  const originalGet = robinscanDeps.get;
  robinscanDeps.get = async () => ({
    "hash": "0xtx",
    "blockNumber": 1234,
    "from": "0xfrom",
    "to": "0xto",
    "value": "10",
    "method": "transfer",
    "timestamp": "2023-01-01T00:00:00Z",
    "status": "success",
    "input": "0x",
    "logs": []
  } as any);

  try {
    const result = await robinscanAdapter.transaction("0xtx");
    assert.deepEqual(result, {
      hash: "0xtx",
      method: "transfer",
      timestamp: "2023-01-01T00:00:00Z",
      from: { hash: "0xfrom" },
      to: { hash: "0xto" },
      value: "10",
      block_number: 1234,
      status: "success",
    });
  } finally {
    robinscanDeps.get = originalGet;
  }
});
