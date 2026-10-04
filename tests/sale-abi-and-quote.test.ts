import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SALE_STATE, SALE_STATE_LABELS, tokenSaleAbi, tokenSaleErrorsAbi, tokenSaleFullAbi } from "@/lib/sale/abi";
import { SALE_ERRORS_WITHOUT_SENTENCE, sentenceFor, explainSaleFailure, _saleErrorInternals } from "@/lib/sale/errors";
import { allocationQuote } from "@/lib/sale/reads";

/**
 * §8 #10 applied to the ABI: `lib/sale/abi.ts` is hand-written and claims
 * ITokenSale.sol as its source of truth. This test asserts the WIRING between
 * the two via the checked-in fixture (tests/fixtures/TokenSale.abi.json,
 * generated from the compiled artifact — regen command in
 * contracts/README.md §TokenSale). The fixture, not `contracts/out/`, is what
 * CI reads: the artifact is gitignored and Foundry is not installed in the JS
 * suite's environment, so a test that needed either would SKIP there — and a
 * skipped test proves nothing. A missing fixture is a failure, not a skip.
 */

interface FixtureEntry {
  type: string;
  name: string;
  stateMutability: string;
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
}

const fixturePath = join(process.cwd(), "tests", "fixtures", "TokenSale.abi.json");
const fixture = JSON.parse(
  // No existsSync-then-skip: ENOENT must fail the suite loudly.
  readFileSync(fixturePath, "utf8"),
) as {
  saleStateEnum: string[];
  entries: FixtureEntry[];
  errors: { type: string; name: string; inputs: { name: string; type: string }[] }[];
  sourceFiles?: string[];
  sourceHash?: string;
};

/**
 * Functions on the contract that NO page calls, each with the reason. This list
 * is the point of the bidirectional test below: a new contract function cannot
 * pass silently, it has to be either wired up or excused here in one line.
 * Fails toward a DECISION, never toward silence (§8 #16).
 */
const NOT_EXPOSED: Record<string, string> = {
  // Ownable2Step writes. Owner rotation moves control of the whole raise and is
  // deliberately not one click away; `pendingOwner` IS read, so a rotation left
  // half-finished is still visible on the panel.
  acceptOwnership: "owner rotation — explorer, not a UI button",
  transferOwnership: "owner rotation — explorer, not a UI button",
  renounceOwnership: "reverts by design; never a UI action",
  // Plumbing with no UI meaning.
  BPS_DENOMINATOR: "constant 10000; fee bps are rendered as percentages already",
  FEE_ADDRESS_1_BPS: "constant 800; feeAddress1Bps is the camelCase view",
  FEE_ADDRESS_2_BPS: "constant 800; feeAddress2Bps is the camelCase view",
  FEE_ADDRESS_3_BPS: "constant 400; feeAddress3Bps is the camelCase view",
  REFERRAL_BPS: "constant 400; referralBps is the camelCase view",
};

test("fixture is current with the contract source (staleness guard)", () => {
  // A stale fixture makes every other assertion here vacuous: it would diff
  // lib/sale/abi.ts against the OLD contract and pass. The hash is what stops
  // "changed the .sol, forgot to regenerate" from being a silent green.
  assert.ok(fixture.sourceHash, "fixture has no sourceHash — regenerate it");
  const present = (fixture.sourceFiles ?? []).filter((f) => existsSync(join(process.cwd(), f)));
  assert.equal(present.length, (fixture.sourceFiles ?? []).length, "a recorded source file is missing");
  const h = createHash("sha256");
  for (const f of fixture.sourceFiles ?? []) h.update(readFileSync(join(process.cwd(), f)));
  assert.equal(
    h.digest("hex"),
    fixture.sourceHash,
    "contract source changed since the fixture was generated — run: cd contracts && forge build && cd .. && node scripts/gen-token-sale-abi-fixture.mjs",
  );
});

test("every contract function is either declared or explicitly not exposed", () => {
  const declared = new Set<string>(tokenSaleAbi.map((e) => e.name));
  const unexplained = fixture.entries
    .map((e) => e.name)
    .filter((n) => !declared.has(n) && !(n in NOT_EXPOSED));
  assert.deepEqual(
    unexplained,
    [],
    `contract functions neither declared in tokenSaleAbi nor listed in NOT_EXPOSED: ${unexplained.join(", ")}`,
  );
});

test("NOT_EXPOSED lists nothing stale — every name is still on the contract, and none is also declared", () => {
  // Otherwise the excuse list rots into a second thing nobody reads: a removed
  // function keeps its alibi, and a since-wired one keeps a note saying it is not.
  const onChain = new Set(fixture.entries.map((e) => e.name));
  const declared = new Set<string>(tokenSaleAbi.map((e) => e.name));
  for (const name of Object.keys(NOT_EXPOSED)) {
    assert.ok(onChain.has(name), `NOT_EXPOSED lists "${name}", which is no longer on the contract`);
    assert.ok(!declared.has(name), `"${name}" is BOTH declared and excused — delete its NOT_EXPOSED entry`);
  }
});

test("fixture is the compiled contract's functions, non-trivially", () => {
  assert.ok(fixture.entries.length > 25, `fixture has ${fixture.entries.length} entries`);
  const names = fixture.entries.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, "fixture names must be unique");
});

test("every tokenSaleAbi entry matches the compiled ABI (name, inputs, outputs, stateMutability)", () => {
  const byName = new Map(fixture.entries.map((e) => [e.name, e]));
  const seen = new Set<string>();
  for (const entry of tokenSaleAbi) {
    assert.ok(!seen.has(entry.name), `duplicate entry in tokenSaleAbi: ${entry.name}`);
    seen.add(entry.name);
    const real = byName.get(entry.name);
    assert.ok(real, `tokenSaleAbi declares "${entry.name}", which is not in the compiled contract`);
    assert.equal(entry.type, "function", `${entry.name}: only functions belong here`);
    assert.equal(entry.stateMutability, real.stateMutability, `${entry.name}: stateMutability drifted`);
    // Compared by TYPE, not by parameter name: public mapping getters
    // (`contributed(address)`) compile to unnamed params while the hand-written
    // ABI documents them, and viem encodes/decodes positionally — the type
    // list is the wiring, names are prose.
    assert.deepEqual(
      entry.inputs.map((i) => i.type),
      real.inputs.map((i) => i.type),
      `${entry.name}: inputs drifted from the compiled ABI`,
    );
    assert.deepEqual(
      entry.outputs.map((o) => o.type),
      real.outputs.map((o) => o.type),
      `${entry.name}: outputs drifted from the compiled ABI`,
    );
  }
});

test("SALE_STATE_LABELS matches the contract's enum order", () => {
  // The fixture's enum names are capitalized Solidity identifiers; the UI
  // renders SCREAMING. The ORDER is the claim under test — index N of one must
  // be index N of the other.
  assert.deepEqual(
    [...SALE_STATE_LABELS],
    fixture.saleStateEnum.map((s) => s.toUpperCase()),
  );
});

test("SALE_STATE values are the indices of their names in SALE_STATE_LABELS", () => {
  for (const [name, index] of Object.entries(SALE_STATE)) {
    assert.equal(SALE_STATE_LABELS[index], name, `${name} is not at index ${index} of the labels`);
  }
});

/* ------------------------------------------------------------------ */

test("allocationQuote reduces to the contract's allocationOf at extra = 0", () => {
  // allocationOf (TokenSale.sol): if (totalRaised == 0) return 0;
  //                          return (TOKENS_FOR_SALE * contributed[account]) / totalRaised;
  const cases: Array<[bigint, bigint, bigint]> = [
    [1_000_000n, 500n, 5_000_000n],
    [7n, 1n, 2n], // integer truncation must match Solidity's, not round
    [0n, 0n, 42n],
    [10n ** 27n, 3n * 10n ** 24n, 11n],
  ];
  for (const [pool, contributed, totalRaised] of cases) {
    const q = allocationQuote({ extra: 0n, contributed, totalRaised, tokensForSale: pool });
    assert.ok(q);
    const contract = totalRaised === 0n ? 0n : (pool * contributed) / totalRaised;
    assert.equal(q.tokens, contract, `tokens mismatch for pool=${pool} c=${contributed} r=${totalRaised}`);
  }
});

test("allocationQuote handles totalRaised = 0 without dividing", () => {
  // No raise, no extra: the share is undefined (nothing prices it) — null,
  // never a throw and never a zero laundered into "you'd get nothing".
  assert.equal(
    allocationQuote({ extra: 0n, contributed: 0n, totalRaised: 0n, tokensForSale: 1000n }),
    null,
  );
  // Sole contributor into an empty pool takes it (matches what the contract
  // would compute once the contribution lands): multiply-first, divide-once.
  const q = allocationQuote({ extra: 5n, contributed: 0n, totalRaised: 0n, tokensForSale: 1000n });
  assert.ok(q);
  assert.equal(q.tokens, 1000n);
  assert.equal(q.shareBps, 10_000n);
});

test("allocationQuote composes existing contribution with the new extra", () => {
  const q = allocationQuote({ extra: 100n, contributed: 100n, totalRaised: 100n, tokensForSale: 600n });
  assert.ok(q);
  assert.equal(q.tokens, 600n); // 600 * 200 / 200 — the extra lands in BOTH sides
  assert.equal(q.shareBps, 10_000n);
});

/* ------------------------------------------------------------------ */
/*  Errors — the layer that decides whether a revert reads as a        */
/*  sentence or as four bytes of hex.                                  */
/* ------------------------------------------------------------------ */

test("every error the contract can revert with is declared in tokenSaleErrorsAbi", () => {
  // Bidirectional on purpose, and with NO excuse list. An undeclared error is
  // not a style problem: viem cannot decode it, so it reaches an operator as a
  // raw selector at exactly the moment something has gone wrong. Inherited
  // OpenZeppelin errors count — OwnableUnauthorizedAccount is the single most
  // likely revert on the whole owner surface.
  const declared = new Set<string>(tokenSaleErrorsAbi.map((e) => e.name));
  const missing = fixture.errors.map((e) => e.name).filter((n) => !declared.has(n));
  assert.deepEqual(missing, [], `errors on the contract but not in tokenSaleErrorsAbi: ${missing.join(", ")}`);
});

test("tokenSaleErrorsAbi declares nothing the contract does not have, with matching argument types", () => {
  const byName = new Map(fixture.errors.map((e) => [e.name, e]));
  const seen = new Set<string>();
  for (const entry of tokenSaleErrorsAbi) {
    assert.ok(!seen.has(entry.name), `duplicate error in tokenSaleErrorsAbi: ${entry.name}`);
    seen.add(entry.name);
    const real = byName.get(entry.name);
    assert.ok(real, `tokenSaleErrorsAbi declares "${entry.name}", which the contract cannot revert with`);
    assert.equal(entry.type, "error", `${entry.name}: only errors belong here`);
    // Types, not names: decoding is positional, exactly as for functions.
    assert.deepEqual(
      entry.inputs.map((i) => i.type),
      real.inputs.map((i) => i.type),
      `${entry.name}: argument types drifted from the compiled ABI`,
    );
  }
});

test("every contract error has a written sentence, or an explicit note saying why not", () => {
  // The decision-forcing half. A new contract error cannot ship silently: it
  // either earns a sentence or one line in SALE_ERRORS_WITHOUT_SENTENCE.
  const written = new Set(Object.keys(_saleErrorInternals.SENTENCES));
  const unexplained = fixture.errors
    .map((e) => e.name)
    .filter((n) => !written.has(n) && !(n in SALE_ERRORS_WITHOUT_SENTENCE));
  assert.deepEqual(unexplained, [], `contract errors with no sentence: ${unexplained.join(", ")}`);
});

test("the sentence dictionary lists nothing stale", () => {
  const onChain = new Set(fixture.errors.map((e) => e.name));
  for (const name of Object.keys(_saleErrorInternals.SENTENCES)) {
    assert.ok(onChain.has(name), `errors.ts writes a sentence for "${name}", which is not on the contract`);
  }
  for (const name of Object.keys(SALE_ERRORS_WITHOUT_SENTENCE)) {
    assert.ok(onChain.has(name), `SALE_ERRORS_WITHOUT_SENTENCE lists "${name}", which is not on the contract`);
  }
});

test("an unknown error still names itself rather than going quiet", () => {
  // The fail direction that matters: a gap in the dictionary must degrade to an
  // uglier TRUE sentence, never to silence or to a wrong reassurance.
  const s = sentenceFor("SomeErrorNobodyWroteYet", [1n, "0xabc"]);
  assert.match(s, /SomeErrorNobodyWroteYet/);
  // The decoded ARGUMENTS are raw uint256s and addresses. They go to the
  // console, never on screen: a reader cannot act on them, and a sentence
  // ending in "(1, 0xabc)" reads as broken software rather than a refusal.
  assert.doesNotMatch(s, /0xabc/, "raw decoded arguments are being shown to the reader again");
  assert.doesNotMatch(s, /\(/, "the fallback is printing a call-shaped argument list");
});

test("a transport fault never pastes the raw error text", () => {
  // viem's shortMessage carries URLs, provider versions and hex payloads. It
  // used to be interpolated straight into the sentence.
  const err = Object.assign(new Error("HTTP request failed. Status: 429 URL: https://rpc.example/key/SECRET"), {
    shortMessage: "HTTP request failed. Status: 429 URL: https://rpc.example/key/SECRET",
  });
  const s = explainSaleFailure(err).sentence;
  assert.doesNotMatch(s, /https?:\/\//, "a URL reached the reader");
  assert.doesNotMatch(s, /SECRET/, "the raw message reached the reader");
  assert.doesNotMatch(s, /429/, "a status code reached the reader");
  // And it must still be specific about WHAT happened, not "something went wrong".
  assert.match(s, /busy/i, "the rate-limit case lost its specific sentence");
});

/**
 * A transport fault can happen AFTER the transaction was broadcast: the tx
 * lands, we simply never hear back. Telling that reader "nothing was spent" is
 * a false all-clear about their own money, which is the one direction this
 * codebase never fails in. Those branches point at the explorer instead.
 */
/**
 * The flag that decides whether a notice may auto-dismiss. A closed failure
 * counts down; anything that might already be on chain stays up until dismissed.
 * If these two ever disagree, a "check the explorer" message vanishes on a
 * timer, which is the false all-clear in a different costume.
 */
test("only a failure known not to have been sent is marked settled", () => {
  const f = (raw: string) => {
    const err = Object.assign(new Error(raw), { shortMessage: raw });
    return explainSaleFailure(err);
  };
  for (const raw of ["insufficient funds for gas", "cannot estimate gas"]) {
    assert.equal(f(raw).settled, true, `"${raw}" never reached the chain and should be dismissable`);
  }
  for (const raw of ["fetch failed", "Timed out while waiting", "429 too many requests", "execution reverted"]) {
    assert.equal(f(raw).settled, false, `"${raw}" may have landed, so it must not auto-dismiss`);
  }
  // An unrecognised error is exactly where we must not promise the funds are safe.
  assert.equal(f("a brand new failure nobody has seen").settled, false);
});

test("a settled failure never says the transaction may still have gone through", () => {
  const err = Object.assign(new Error("insufficient funds for gas"), { shortMessage: "insufficient funds for gas" });
  const { sentence, settled } = explainSaleFailure(err);
  assert.equal(settled, true);
  assert.doesNotMatch(sentence, /may still have gone through|check the explorer/i);
});

test("no failure sentence promises the money is safe when it cannot know", () => {
  for (const raw of ["fetch failed", "Timed out while waiting", "execution reverted"]) {
    const err = Object.assign(new Error(raw), { shortMessage: raw });
    const s = explainSaleFailure(err).sentence;
    assert.doesNotMatch(
      s,
      /nothing was spent|nothing was charged/i,
      `"${raw}" claims the funds are safe, but the transaction may have landed`,
    );
  }
});

test("tokenSaleFullAbi is the union, and carries both halves", () => {
  assert.equal(tokenSaleFullAbi.length, tokenSaleAbi.length + tokenSaleErrorsAbi.length);
  assert.ok(tokenSaleFullAbi.some((e) => e.type === "function"));
  assert.ok(tokenSaleFullAbi.some((e) => e.type === "error"));
});
