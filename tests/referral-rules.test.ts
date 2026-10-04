import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMISSION_BPS,
  DEFAULT_REFERRAL_RULES,
  applyBps,
  bindWindowState,
  commissionsFor,
  earnsBuyerBonus,
  qualifiesAsReferrer,
  saleAllocation,
} from "@/lib/referrals/rules";
import { TOKENOMICS } from "@/lib/sale/tokenomics";
import { SALE_TOKENS, TOTAL_SUPPLY } from "@/lib/sale/projection";

const ETH = 1_000_000_000_000_000_000n;
const rules = DEFAULT_REFERRAL_RULES;

test("both gates must clear — neither one alone qualifies a referrer", () => {
  const enoughPeople = { wallet: "0xa", referredCount: 3, referredWei: ETH / 100n };
  const enoughEth = { wallet: "0xb", referredCount: 1, referredWei: ETH };
  const both = { wallet: "0xc", referredCount: 3, referredWei: ETH / 5n };

  assert.equal(qualifiesAsReferrer(enoughPeople, rules), false, "3 people but under 0.1 ETH");
  assert.equal(qualifiesAsReferrer(enoughEth, rules), false, "plenty of ETH but only 1 person");
  assert.equal(qualifiesAsReferrer(both, rules), true);
});

test("the gates are inclusive — exactly at the bar qualifies", () => {
  assert.equal(
    qualifiesAsReferrer({ wallet: "0xa", referredCount: 3, referredWei: rules.minReferredWei }, rules),
    true,
  );
  assert.equal(
    qualifiesAsReferrer(
      { wallet: "0xa", referredCount: 3, referredWei: rules.minReferredWei - 1n },
      rules,
    ),
    false,
    "one wei short is short",
  );
});


/* ── the allocation, and the commissions on top of it ────────────────────── */

test("saleAllocation is the contract's own arithmetic, multiplied before divided", () => {
  // TokenSale.allocationOf: TOKENS_FOR_SALE * contributed / totalRaised. The
  // failure this pins is computing a "tokens per wei" first, which truncates to
  // zero under integer division and silently zeroes every allocation.
  const tokensForSale = 3_000_000n * 10n ** 18n;
  const totalRaisedWei = 100n * ETH;

  assert.equal(
    saleAllocation({ contributedWei: 10n * ETH, totalRaisedWei, tokensForSale }),
    300_000n * 10n ** 18n,
    "10 of 100 ETH buys a tenth of the pool",
  );
  // tokensForSale / totalRaisedWei is 0 under integer division. If the
  // implementation divided first, this would be 0.
  assert.ok(saleAllocation({ contributedWei: 1n, totalRaisedWei, tokensForSale }) > 0n);
});

test("an unraised sale allocates nothing rather than dividing by zero", () => {
  assert.equal(saleAllocation({ contributedWei: ETH, totalRaisedWei: 0n, tokensForSale: 1000n }), 0n);
});

test("the three commission rates are 2%, 4% and 4%", () => {
  // The published copy on /token-sale is built from these, so a change here
  // changes a promise a buyer spent money on.
  assert.equal(COMMISSION_BPS.buyerBonus, 200);
  assert.equal(COMMISSION_BPS.referrerTokens, 400);
  assert.equal(COMMISSION_BPS.referrerEth, 400);
});

test("applyBps truncates down, never up, as the contract does", () => {
  assert.equal(applyBps(1000n, 200), 20n);
  assert.equal(applyBps(1n, 200), 0n, "2% of one base unit rounds to nothing, not to one");
  assert.equal(applyBps(0n, 400), 0n);
  // Multiply-before-divide again: 999 * 400 / 10000 = 39, not 0.
  assert.equal(applyBps(999n, 400), 39n);
});

test("the buyer bonus is 2% of the buyer's OWN allocation, and nothing else", () => {
  const amounts = commissionsFor({
    ownAllocation: 1_000n * 10n ** 18n,
    buyerBonusEligible: true,
    referrerQualified: false,
    referredAllocation: 0n,
    referredWei: 0n,
  });
  assert.equal(amounts.buyerBonusTokens, 20n * 10n ** 18n, "1,000 tokens bought earns 20 more");
  assert.equal(amounts.referrerCommissionTokens, 0n);
  assert.equal(amounts.referrerRebateWei, 0n);
});

test("the buyer bonus does NOT depend on the referrer qualifying", () => {
  // Operator decision, 2026-09-11. A buyer cannot see how many other people
  // their referrer brought in, so gating their bonus on it would make the
  // reward turn on a fact they have no access to.
  const base = {
    ownAllocation: 1_000n,
    buyerBonusEligible: true,
    referredAllocation: 0n,
    referredWei: 0n,
  };
  assert.equal(
    commissionsFor({ ...base, referrerQualified: false }).buyerBonusTokens,
    commissionsFor({ ...base, referrerQualified: true }).buyerBonusTokens,
  );
});

test("an unqualified referrer earns neither referrer leg, and both are zero not absent", () => {
  const amounts = commissionsFor({
    ownAllocation: 0n,
    buyerBonusEligible: false,
    referrerQualified: false,
    referredAllocation: 500_000n,
    referredWei: 50n * ETH,
  });
  assert.equal(amounts.referrerCommissionTokens, 0n);
  assert.equal(amounts.referrerRebateWei, 0n);
});

test("a qualified referrer earns 4% of the tokens AND 4% of the ETH", () => {
  const amounts = commissionsFor({
    ownAllocation: 0n,
    buyerBonusEligible: false,
    referrerQualified: true,
    referredAllocation: 500_000n * 10n ** 18n,
    referredWei: 40n * ETH,
  });
  assert.equal(amounts.referrerCommissionTokens, 20_000n * 10n ** 18n);
  assert.equal(amounts.referrerRebateWei, (40n * ETH * 4n) / 100n);
});

test("nobody's reward depends on anybody else's — there is no denominator left", () => {
  // The whole point of replacing the pools. Under the old design a second
  // qualifier halved the first one's award; under a commission it cannot.
  const one = commissionsFor({
    ownAllocation: 0n,
    buyerBonusEligible: false,
    referrerQualified: true,
    referredAllocation: 1_000n,
    referredWei: ETH,
  });
  assert.equal(one.referrerCommissionTokens, 40n);
  assert.equal(one.referrerRebateWei, ETH / 25n);
});

test("the airdrop allocation can still cover the most the commissions can pay", () => {
  // NOT a check that the table matches the rates. The operator's decision
  // (2026-09-11) is that the published GENESIS AIRDROP rows stay as they are:
  // they are a budget, not a forecast, and shrinking them to the commission
  // ceilings would invite "why is the referral supply so low" about a number
  // chosen for a different reason. Whatever goes unspent stays in hand.
  //
  // What MUST hold is the direction that can actually break: the bucket has to
  // be able to fund the maximum the code can ever pay out. If someone shrinks
  // the airdrop row below the ceiling, the sale promises rewards it cannot
  // cover, and nothing else in the repo would notice.
  const airdrop = TOKENOMICS.find((r) => r.label === "GENESIS AIRDROP");
  assert.ok(airdrop, "the airdrop row must exist");

  const tokenCeiling =
    (SALE_TOKENS * (COMMISSION_BPS.buyerBonus + COMMISSION_BPS.referrerTokens)) / 10_000;
  const ceilingPctOfSupply = (tokenCeiling / TOTAL_SUPPLY) * 100;

  assert.ok(
    airdrop.pct >= ceilingPctOfSupply,
    `GENESIS AIRDROP is ${airdrop.pct}% of supply but the commissions can pay up to ${ceilingPctOfSupply}%`,
  );

  // The ETH rebate is paid out of the raise, not out of supply, so it must
  // never be budgeted for here. A row for it would count the referrer twice.
  assert.equal(
    (airdrop.breakdown ?? []).filter((b) => /ETH/i.test(b.label)).length,
    0,
    "the ETH rebate must not appear in a table of token supply",
  );
});

test("total token exposure is bounded at 6% of what the sale sold, not of supply", () => {
  // §10.6. If every ETH in the sale arrived through a qualifying code, buyers
  // take 2% of the pool and referrers 4% of the same pool. The old design paid
  // a fixed 600,000 tokens whatever happened; this is the ceiling that replaced
  // it, and it only reaches the ceiling at 100% referral penetration.
  const pool = 3_000_000n * 10n ** 18n;
  const buyers = applyBps(pool, COMMISSION_BPS.buyerBonus);
  const referrers = applyBps(pool, COMMISSION_BPS.referrerTokens);
  assert.equal(buyers + referrers, (pool * 6n) / 100n);
});

test("only a credited wallet that actually paid earns the buyer bonus", () => {
  assert.equal(earnsBuyerBonus("credited", ETH), true);
  // `pending` is a wallet that applied a code and has not paid.
  assert.equal(earnsBuyerBonus("pending", ETH), false);
  assert.equal(earnsBuyerBonus("missed", ETH), false);
  assert.equal(earnsBuyerBonus("none", ETH), false);
  assert.equal(earnsBuyerBonus("credited", 0n), false, "credited but paid nothing earns nothing");
});

/* ── the binding window ───────────────────────────────────────────────────
   The single rule the whole 2% pool rests on is that the code comes first, so
   "can this wallet still bind one" has to be right in all three states. The
   two-state version read only our own mirror, which is written by a cron a
   minute behind the chain, and told a wallet that had already paid that its
   code would count.                                                          */

test("the binding window is open only when the CHAIN says nothing has been paid", () => {
  assert.equal(
    bindWindowState({ mirrorSaysOpen: true, contributedOnChain: 0n }),
    "open",
    "mirror open and chain at zero is the only combination that means open",
  );
});

test("a contribution the mirror has not caught up with still closes the window", () => {
  // The exact bug: paid at 12:00:00, presses Contribute again at 12:00:20. The
  // indexer has not run, so the mirror still says the binding is open.
  assert.equal(
    bindWindowState({ mirrorSaysOpen: true, contributedOnChain: 1n }),
    "closed",
    "the chain outranks the mirror, which can only ever be behind it",
  );
});

test("a closure the mirror HAS seen is authoritative on its own", () => {
  // No chain read needed: the mirror is never ahead of the chain, so a
  // contribution it has recorded is one that definitely happened.
  for (const contributedOnChain of [undefined, 0n, 5n]) {
    assert.equal(
      bindWindowState({ mirrorSaysOpen: false, contributedOnChain }),
      "closed",
      `mirror-recorded contribution should close the window (chain read ${String(contributedOnChain)})`,
    );
  }
});

test("an unread chain is unknown, never open", () => {
  // §4: an unread value is not a zero. Treating it as one is how a wallet that
  // had already paid got invited to add a code.
  assert.equal(bindWindowState({ mirrorSaysOpen: true, contributedOnChain: undefined }), "unknown");
});

test("an unread mirror is unknown, whatever the chain says", () => {
  for (const contributedOnChain of [undefined, 0n, 9n]) {
    assert.equal(
      bindWindowState({ mirrorSaysOpen: null, contributedOnChain }),
      "unknown",
      `no referral state loaded yet should be unknown (chain read ${String(contributedOnChain)})`,
    );
  }
});

test("zero on chain is a real answer and is never confused with an unread one", () => {
  // Both directions of §8 #3. A wallet that has genuinely contributed nothing
  // must get the prompt; one we could not read must not.
  assert.notEqual(
    bindWindowState({ mirrorSaysOpen: true, contributedOnChain: 0n }),
    bindWindowState({ mirrorSaysOpen: true, contributedOnChain: undefined }),
  );
});
