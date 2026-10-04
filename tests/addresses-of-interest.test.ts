import test from "node:test";
import assert from "node:assert/strict";
import { addressesOfInterest, ADDRESSES_OF_INTEREST_MAX } from "../app/components/site/addresses-of-interest";
import type { CheckResult } from "../lib/types";

const HOOK = "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044";
const LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
const FUNDER = "0x53091256ebd2d8aa37b45536a5fd864ca764f32f";
const WHALE = "0x3a1345bc81e8479438234826f52e885f6817e4ef";
const CREATOR = "0xae0cf72229e739d8fa85f6117cf62a5c3d5a52a9";
const FACTORY = "0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42";

const check = (id: string, status: string, evidence: Record<string, unknown>, reason = ""): CheckResult =>
  ({ id, name: id, status, deduction: 0, weight: null, reason, source: "live eth_call", evidence }) as unknown as CheckResult;

/** Verdict 295 (QUANTUMLAB), the shape that produced L130 in production. */
const quantumlab = (): CheckResult[] => [
  check(
    "honeypot",
    "PASS",
    { adapterSell: { hooks: HOOK, poolId: "0xaccb" } },
    `Sell quotes through the pool and its swap hook ${HOOK}, and a full round trip recovers 96.0%.`,
  ),
  check("funder_rug_history", "PASS", {
    funder: FUNDER,
    creator: FACTORY,
    deployer: CREATOR,
    subjectVia: "launchpad-record",
  }, `Nothing on record ties ${FUNDER}, the wallet that funded this deployer, to a past rug.`),
  check("lp_custody", "PASS", {
    deployer: FACTORY,
    deployerKind: "CONTRACT",
    largestPuller: null,
    lockersMatched: [{ address: LOCKER, label: "Launchpad V2 Launch Locker", kind: "permanent" }],
  }),
  check("holder_concentration", "WARN", { top10: [{ address: WHALE, class: "EOA" }] }),
  check("ownership", "PASS", { owner: null, renounced: null }),
];

test("an address is labelled by what it IS, never by the check that named it", () => {
  const rows = addressesOfInterest(quantumlab());
  const roleOf = (a: string) => rows.find((r) => r.address.toLowerCase() === a.toLowerCase())?.role;

  // L130: these two were published as "HONEYPOT" and "FUNDER RUG HISTORY".
  assert.notEqual(roleOf(HOOK), "HONEYPOT");
  assert.notEqual(roleOf(FUNDER), "FUNDER RUG HISTORY");
  // The trusted locker carries the registry's own label, so it reads as the
  // thing protecting the liquidity rather than a party to investigate.
  assert.equal(roleOf(LOCKER), "LAUNCHPAD V2 LAUNCH LOCKER");
  assert.equal(roleOf(CREATOR), "LAUNCH CREATOR");
  assert.equal(roleOf(FACTORY), "DEPLOYING CONTRACT");
  assert.equal(roleOf(WHALE), "LARGEST HOLDER");
});

test("nothing is harvested from reason prose", () => {
  // The only place these addresses appear is the sentence. Evidence is bare, so
  // an evidence-only reader must return nothing at all.
  const proseOnly = [
    check("honeypot", "PASS", {}, `Sell quotes through the pool and its swap hook ${HOOK}.`),
    check("funder_rug_history", "PASS", {}, `Nothing on record ties ${FUNDER} to a past rug.`),
  ];
  assert.deepEqual(addressesOfInterest(proseOnly), []);
});

test("the ranking is by consequence, and the cap can only drop the least consequential", () => {
  const rows = addressesOfInterest(quantumlab());
  assert.ok(rows.length <= ADDRESSES_OF_INTEREST_MAX);
  // The whale outranks the launch creator, which outranks the locker, which
  // outranks the factory. The hook and the cleared funder fall off the end.
  assert.deepEqual(rows.map((r) => r.role), [
    "LARGEST HOLDER",
    "LAUNCH CREATOR",
    "LAUNCHPAD V2 LAUNCH LOCKER",
    "DEPLOYING CONTRACT",
  ]);
  assert.deepEqual(rows.map((r) => r.rank), [...rows.map((r) => r.rank)].sort((a, b) => a - b));
});

test("the largest holder survives a CLEAR verdict", () => {
  // The old harvest ran over the five flags the page shows, and on CLEAR those
  // are sorted PASS-first, so the one address a reader needs was always cut.
  const rows = addressesOfInterest(quantumlab());
  assert.ok(rows.some((r) => r.address.toLowerCase() === WHALE.toLowerCase()));
});

test("one address holding two roles is merged, not split", () => {
  const selfDealt = [
    check("lp_custody", "FAIL", { deployer: WHALE, deployerKind: "EOA", largestPuller: WHALE }),
    check("holder_concentration", "FAIL", { top10: [{ address: WHALE }] }),
  ];
  const rows = addressesOfInterest(selfDealt);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "LIQUIDITY REMOVED BY · LARGEST HOLDER · DEPLOYER");
});

test("a rugger is named only from an adverse status", () => {
  const ev = { originDeployer: WHALE, funder: FUNDER, deployer: CREATOR, subjectVia: "creator" };
  const clean = addressesOfInterest([check("funding_lineage", "PASS", ev)]);
  assert.ok(!clean.some((r) => r.role === "CONFIRMED RUGGER"));
  const stained = addressesOfInterest([check("funding_lineage", "FAIL", ev)]);
  assert.equal(stained[0].role, "CONFIRMED RUGGER");
});

test("a renounced owner is not an active key", () => {
  const renounced = addressesOfInterest([check("ownership", "PASS", { owner: WHALE, renounced: true })]);
  assert.ok(!renounced.some((r) => r.role === "ACTIVE OWNER KEY"));
  const live = addressesOfInterest([check("ownership", "WARN", { owner: WHALE, renounced: false })]);
  assert.equal(live[0].role, "ACTIVE OWNER KEY");
});

test("the zero address is never shown", () => {
  const zero = "0x0000000000000000000000000000000000000000";
  assert.deepEqual(addressesOfInterest([check("ownership", "WARN", { owner: zero, renounced: false })]), []);
});

test("a locker's registry label overrides a quantity label, and never merges with one", () => {
  // Replaying this over all 289 published verdicts caught 47 rows where the
  // permanent locker also satisfied "LARGEST HOLDER" on older score versions.
  // A permanent locker cannot act on the position it holds, so labelling it by
  // the quantity is L130's accusation in a new coat.
  const rows = addressesOfInterest([
    check("lp_custody", "PASS", {
      lockersMatched: [{ address: LOCKER, label: "Launchpad V2 Launch Locker", kind: "permanent" }],
    }),
    check("holder_concentration", "FAIL", { top10: [{ address: LOCKER }] }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "LAUNCHPAD V2 LAUNCH LOCKER");
  // It keeps the rank it earned, so a locker holding the biggest position still
  // leads the panel rather than being demoted out of view.
  assert.equal(rows[0].rank, 2);
});

test("no hardcoded address list stands in for the registry", () => {
  // §8 #11 — a literal where a measurement belongs. The only source of a
  // locker label is the verdict's own `lockersMatched`, so a token whose
  // evidence never named a locker gets a quantity label, matching its own
  // published sentence rather than contradicting it.
  const noEvidence = addressesOfInterest([
    check("lp_custody", "FAIL", { lockersMatched: [] }),
    check("holder_concentration", "FAIL", { top10: [{ address: LOCKER }] }),
  ]);
  assert.equal(noEvidence[0].role, "LARGEST HOLDER");
});
