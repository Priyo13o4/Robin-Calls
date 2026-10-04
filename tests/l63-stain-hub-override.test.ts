import test, { mock } from "node:test";
import assert from "node:assert/strict";

// ── KNOWN-PROBLEMS L63 — fanout alone cannot tell a bundler's funding wallet
// from a CEX hot wallet. Both fan out wide, so `hubFanoutThreshold` blocked
// both. Reproduces the DOOM shape: an operator wallet funds the deployer,
// funds a wide fleet of sniper wallets, and the deployer later sweeps ETH
// back to it post-rug. Before the fix, that operator hub-blocked at hop 1
// (candidateIsSafeToStain) or hop 2 (the neighbors.length gate), and the
// sniper fleet — the half of the rug with the money — was never stained.
//
// The override: a fanout node whose own neighbor set contains the origin (it
// funded the rug, or was funded back by it) is walked through instead.

const DEPLOYER = "0x8cb61878f45bc0711c808397dff60f575feff999";
const OPERATOR = "0x9fdd8ceab2de4fa2d9b0f1f37475a47baff8cd9a";
const SNIPER = "0x8d80ca049336441a109a328d27f26beb8368d619";
const FILLERS = Array.from({ length: 25 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "f")}`);

const FUNDING_VALUE = "20000000000000000"; // 0.02 ETH, above MIN_FUNDING_WEI (0.01 ETH)

const txTo = (from: string, to: string): any => ({
  hash: `0xtx-${from}-${to}`,
  method: null,
  from: { hash: from },
  to: { hash: to },
  value: FUNDING_VALUE,
  block: 1,
});

/** Whether the operator's own outbound history includes a payment to the origin. */
let operatorReturnsToOrigin = true;

const classified: Record<string, string> = {
  [DEPLOYER]: "EOA",
  [OPERATOR]: "EOA",
  [SNIPER]: "EOA",
  ...Object.fromEntries(FILLERS.map((f) => [f, "EOA"])),
};

const stainCalls: { address: string; hops: number; direction: string }[] = [];
const hubMarks: string[] = [];

mock.module("../lib/scanner/entity", {
  namedExports: {
    classifyAddress: async (a: string) => classified[a.toLowerCase()] ?? "EOA",
  },
});

mock.module("../lib/lineage/trace", {
  namedExports: {
    findFunder: async (addr: string) =>
      addr.toLowerCase() === DEPLOYER
        ? { funder: OPERATOR, txHash: "0xfund", block: 1, valueEth: 7.1 }
        : null,
    cacheEdge: async () => {},
  },
});

mock.module("../lib/data/lineage", {
  namedExports: {
    markHubRecord: async (address: string) => {
      hubMarks.push(address.toLowerCase());
    },
    isHubRecord: async () => false,
    writeStainRecord: async (args: { address: string; hops: number; direction: string }) => {
      stainCalls.push({ address: args.address.toLowerCase(), hops: args.hops, direction: args.direction });
      return true;
    },
    readActiveStainAddresses: async () => [],
    retireStainsForAddress: async () => 0,
  },
});

mock.module("../lib/explorer/blockscout", {
  namedExports: {
    explorer: {
      // candidateIsSafeToStain's fanout check
      addressTxs: async (address: string) => {
        const a = address.toLowerCase();
        if (a === OPERATOR) {
          const recipients = [SNIPER, ...FILLERS, ...(operatorReturnsToOrigin ? [DEPLOYER] : [])];
          return { items: recipients.map((to) => txTo(OPERATOR, to)) };
        }
        if (a === DEPLOYER) return { items: [txTo(DEPLOYER, OPERATOR)] };
        return { items: [] };
      },
      // downstream()'s fanout check, same shape as addressTxs for these addresses
      addressTxHistory: async (address: string, filter: "to" | "from") => {
        const a = address.toLowerCase();
        if (filter !== "from") return { items: [], complete: true };
        if (a === OPERATOR) {
          const recipients = [SNIPER, ...FILLERS, ...(operatorReturnsToOrigin ? [DEPLOYER] : [])];
          return { items: recipients.map((to) => txTo(OPERATOR, to)), complete: true };
        }
        if (a === DEPLOYER) return { items: [txTo(DEPLOYER, OPERATOR)], complete: true };
        return { items: [], complete: true };
      },
    },
  },
});

const load = () => import("../lib/lineage/stains");

test("L63: an operator that returns funds to the origin is walked through, reaching the sniper it funded", async () => {
  const { propagateStains } = await load();
  operatorReturnsToOrigin = true;
  stainCalls.length = 0;
  hubMarks.length = 0;

  const result = await propagateStains({ rugId: 1, deployer: DEPLOYER });

  assert.ok(
    stainCalls.some((c) => c.address === SNIPER),
    "the sniper the operator funded at hop 2 must be reached — this is the half of the rug with the money",
  );
  assert.ok(
    stainCalls.some((c) => c.address === OPERATOR),
    "the operator itself must still be staked at hop 1",
  );
  assert.ok(result.hubsOverridden > 0, "the override must be visible on the result, for job-log auditing");
  assert.equal(hubMarks.includes(OPERATOR), false, "an overridden node must not be permanently marked a hub");
});

test("L63 control: without a returned payment, the SAME fanout genuinely hub-blocks (proves the override is doing real work)", async () => {
  const { propagateStains } = await load();
  operatorReturnsToOrigin = false;
  stainCalls.length = 0;
  hubMarks.length = 0;

  const result = await propagateStains({ rugId: 1, deployer: DEPLOYER });

  assert.ok(
    !stainCalls.some((c) => c.address === SNIPER),
    "with no money returned, a wide-fanout wallet is correctly treated as a hub and the walk stops there",
  );
  assert.ok(result.hubs > 0);
  assert.equal(result.hubsOverridden, 0);
});
