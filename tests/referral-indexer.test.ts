import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeEventTopics, keccak256, toHex } from "viem";

import { tokenSaleEventsAbi } from "@/lib/sale/abi";
import { CONTRIBUTED_TOPIC0, matchContributionLog, verifyContributionClaim } from "@/lib/referrals/contribution";

/**
 * The event ABI the claim verifier reads is hand-written, and it is the one
 * shape in this feature whose failure is completely silent: a wrong
 * indexed-ness or a wrong parameter type does not throw, it just matches no
 * logs — and the airdrop is then computed over a sale that looks empty.
 *
 * The fixture the rest of the sale ABI is diffed against
 * (tests/fixtures/TokenSale.abi.json) carries functions and errors only, so
 * this pins the event against the CONTRACT SOURCE instead: the `event
 * Contributed(...)` declaration is read straight out of ITokenSale.sol.
 *
 * The walker this file used to cover (runBoundary and its truth table) is
 * gone: contributions are read from the contract's census plus verified
 * transaction hashes, so there is no range to bound. The ABI and log-matching
 * pins below are what survived, because the claim path decodes the same event.
 */

const SOURCE = join("contracts", "src", "token-sale", "ITokenSale.sol");

function contributedDeclaration(): string {
  // No existsSync-then-skip: a missing source must fail the suite, not quietly
  // pass. A skipped test proves nothing.
  const src = readFileSync(join(process.cwd(), SOURCE), "utf8");
  const match = src.match(/event\s+Contributed\s*\(([^)]*)\)\s*;/);
  assert.ok(match, `no 'event Contributed(...)' found in ${SOURCE}`);
  return match[1];
}

test("the Contributed ABI matches the declaration in ITokenSale.sol", () => {
  const params = contributedDeclaration()
    .split(",")
    .map((p) => p.trim().split(/\s+/));

  const abi = tokenSaleEventsAbi[0];
  assert.equal(abi.name, "Contributed");
  assert.equal(abi.inputs.length, params.length, "parameter count differs from the contract");

  params.forEach((parts, i) => {
    const type = parts[0];
    const indexed = parts.includes("indexed");
    const name = parts[parts.length - 1];
    const input = abi.inputs[i];
    assert.equal(input.type, type, `parameter ${i} type`);
    assert.equal(input.name, name, `parameter ${i} name`);
    // The one that fails silently: a wrong `indexed` puts the value in the
    // wrong half of the log, so the topic decode below reads garbage.
    assert.equal(input.indexed, indexed, `parameter ${i} indexed-ness`);
  });
});

test("the event topic is the signature the contract emits", () => {
  // A second, independent derivation: build topic0 from our ABI and from the
  // canonical signature string, and require them to agree. If the ABI drifted
  // in a way the parameter walk above missed, the topics stop matching and no
  // log is ever found.
  const [topic0] = encodeEventTopics({ abi: tokenSaleEventsAbi, eventName: "Contributed" });
  assert.equal(topic0, keccak256(toHex("Contributed(address,uint256,uint256)")));
  assert.equal(
    CONTRIBUTED_TOPIC0,
    topic0,
    "the runtime verifier's topic constant must be the same derivation",
  );
});

test("the events ABI is kept OUT of tokenSaleAbi", async () => {
  // tests/sale-abi-and-quote.test.ts diffs every name in `tokenSaleAbi` against
  // the compiled fixture, which holds functions and errors only. An event added
  // there would fail as "declared but not on the contract" — so the split is
  // load-bearing, not stylistic.
  const { tokenSaleAbi } = await import("@/lib/sale/abi");
  assert.ok(
    !tokenSaleAbi.some((e) => (e as { type: string }).type === "event"),
    "tokenSaleAbi must contain no events — use tokenSaleEventsAbi",
  );
});

/* ── matching a receipt's log to a claim ──────────────────────────────────
   The gate that protects "this wallet contributed": the log must come from
   THIS sale, be THIS event, and name THIS wallet as contributor. The wallet
   comes from the event, never tx.from (§8 #19 — a relayer's client must not
   be able to claim a contribution).                                          */

const SALE = "0xc490dc0f242cc0b1b3fd9b993d0dd83348803095";
const WALLET = "0xd665ff6df7a4218f7d5358c6c3d480825cbf3aa8";
const OTHER = "0x45ac915dedb243a3dbb53f85d6d7441f58841574";

/** A real Contributed log, the shape viem's receipt carries (hex fields). */
function contributedLog(args: {
  address?: string;
  contributor?: string;
  amount?: bigint;
  total?: bigint;
  topics?: `0x${string}`[];
}): { address: string; topics: `0x${string}`[]; data: `0x${string}` } {
  const amount = args.amount ?? 5_000_000_000_000_000n;
  const total = args.total ?? 5_000_000_000_000_000n;
  const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
  const address = (args.address ?? SALE).toLowerCase();
  return {
    address,
    topics: args.topics ?? [CONTRIBUTED_TOPIC0, pad(args.contributor ?? WALLET)],
    data: `0x${amount.toString(16).padStart(64, "0")}${total.toString(16).padStart(64, "0")}` as `0x${string}`,
  };
}

test("a genuine contribution log matches", () => {
  const m = matchContributionLog({
    logs: [contributedLog({})],
    saleAddress: SALE,
    claimingWallet: WALLET,
  });
  assert.equal(m.kind, "matched", "the genuine log must match");
  if (m.kind === "matched") {
    assert.equal(m.contributor, WALLET);
    assert.equal(m.amountWei, 5_000_000_000_000_000n);
    assert.equal(m.totalRaisedWei, 5_000_000_000_000_000n);
    assert.equal(m.logIndex, 0);
  }
});

test("a log from a different contract never matches, even naming the wallet", () => {
  assert.deepEqual(
    matchContributionLog({
      logs: [contributedLog({ address: OTHER })],
      saleAddress: SALE,
      claimingWallet: WALLET,
    }),
    { kind: "not-found" },
  );
});

test("a log naming a different contributor never matches — tx.from cannot stand in", () => {
  // Someone pasting another wallet's hash. The receipt is real, the sale is
  // right, the amount is right: only the contributor is wrong, and that is
  // the one fact the gate exists to check (§8 #19).
  assert.deepEqual(
    matchContributionLog({
      logs: [contributedLog({ contributor: OTHER })],
      saleAddress: SALE,
      claimingWallet: WALLET,
    }),
    { kind: "not-found" },
  );
});

test("an unrelated event from the sale contract never matches", () => {
  const bogusTopic = keccak256(toHex("Claimed(address,uint256)"));
  assert.deepEqual(
    matchContributionLog({
      logs: [
        {
          address: SALE,
          topics: [bogusTopic, `0x${WALLET.slice(2).padStart(64, "0")}`] as `0x${string}`[],
          data: ("0x" + "0".repeat(126)) as `0x${string}`,
        },
      ],
      saleAddress: SALE,
      claimingWallet: WALLET,
    }),
    { kind: "not-found" },
  );
});

test("a malformed Contributed log is unparseable, not not-found or a throw", () => {
  // A recognition failure must not launder into a refusal (§8 #16): the shape
  // below is nonsense, and the answer is "unparseable", which the caller treats
  // as an unknown the reconciler retries — never as evidence the user lied.
  assert.deepEqual(
    matchContributionLog({
      logs: [
        {
          address: SALE,
          topics: [CONTRIBUTED_TOPIC0, `0x${WALLET.slice(2).padStart(64, "0")}`] as `0x${string}`[],
          data: "0xdeadbeef" as `0x${string}`,
        },
      ],
      saleAddress: SALE,
      claimingWallet: WALLET,
    }),
    { kind: "unparseable" },
  );
});

test("only the wallet's own log matches out of a busy receipt", () => {
  const m = matchContributionLog({
    logs: [
      contributedLog({ contributor: OTHER }),
      { address: OTHER, topics: [CONTRIBUTED_TOPIC0], data: "0x" as `0x${string}` },
      contributedLog({ contributor: WALLET, amount: 1n, total: 2n }),
    ],
    saleAddress: SALE,
    claimingWallet: WALLET,
  });
  assert.equal(m.kind, "matched", "the wallet's own log must be found among others");
  if (m.kind === "matched") {
    assert.equal(m.logIndex, 2, "the logIndex must be the log's own position, not the first hit");
    assert.equal(m.amountWei, 1n);
  }
});

test("verifyContributionClaim maps an unparseable log to unknown, never refused (§8 #16)", async () => {
  const mockClient = {
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 12345n,
      logs: [
        {
          address: SALE,
          topics: [CONTRIBUTED_TOPIC0, `0x${WALLET.slice(2).padStart(64, "0")}`] as `0x${string}`[],
          data: "0xdeadbeef" as `0x${string}`,
        },
      ],
    }),
    getBlock: async () => ({ timestamp: 1700000000n }),
  } as unknown as import("viem").PublicClient;

  const result = await verifyContributionClaim({
    client: mockClient,
    txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    saleAddress: SALE,
    claimingWallet: WALLET,
  });

  assert.equal(result.outcome.kind, "unknown", "unparseable log must yield unknown so reconciler retries");
});

test("verifyContributionClaim refuses when log is for a different wallet", async () => {
  const mockClient = {
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 12345n,
      logs: [contributedLog({ contributor: OTHER })],
    }),
    getBlock: async () => ({ timestamp: 1700000000n }),
  } as unknown as import("viem").PublicClient;

  const result = await verifyContributionClaim({
    client: mockClient,
    txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    saleAddress: SALE,
    claimingWallet: WALLET,
  });

  assert.equal(result.outcome.kind, "refused");
});

test("verifyContributionClaim verifies when log matches", async () => {
  const mockClient = {
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 12345n,
      logs: [contributedLog({ contributor: WALLET })],
    }),
    getBlock: async () => ({ timestamp: 1700000000n }),
  } as unknown as import("viem").PublicClient;

  const result = await verifyContributionClaim({
    client: mockClient,
    txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    saleAddress: SALE,
    claimingWallet: WALLET,
  });

  assert.equal(result.outcome.kind, "verified");
  if (result.outcome.kind === "verified") {
    assert.equal(result.outcome.contribution.walletAddress, WALLET);
  }
});
