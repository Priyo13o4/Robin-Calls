# Check explainers

One section per check id, served by the `lookup_check` tool. These are
**concepts only** — no weights, no point values, no thresholds. Numbers come
from `get_methodology`, which reads the live formula config, so this file can
never disagree with what the engine actually did.

The startup coverage gate fetches `get_methodology` and refuses to boot if any
live check id is missing a section here — across all three groups, including
the post-score rules. When a new check ships, this file is where it must be
documented before the agent will serve.

Section ids must match `verdict.checks[].id` exactly.

**Three of these are caps, not deductions**, and they arrive in a shape that
reads backwards if you do not know that. `prior_honeypot`, `prior_pump_dump`
and `active_wash_trading` appear in `verdict.checks[]` carrying `weight: null`
and `deduction: 0` — because they do not subtract points, they *ceiling* the
score. A FAIL on one of them is the most consequential thing in the payload,
not the least. Never describe one as having "no weight" or "not affecting the
score".

---

## impersonation

**Kill shot.** The token's name *and* symbol both match a canonical Robinhood
stock token or major asset that lives at a different address.

Why it is fatal rather than weighted: this is not a meme borrowing a ticker,
it is a deliberate counterfeit of a real asset, aimed at someone who searched
for the real thing and clicked the first result. There is no configuration of
other checks that makes a counterfeit acceptable.

Matching is on both fields together. A token called "Doge Tesla" is not
impersonating TSLA; a token called "Tesla" with symbol "TSLA" at an address
that is not the issuer's is.

## explorer_scam_flag

**Kill shot.** The chain explorer has independently tagged this contract as a
scam.

This is someone else's finding, not ours, and we treat it as decisive because
explorers do not apply that tag speculatively. If a user disputes it, the
dispute belongs with the explorer — we can say what the tag is and that we
honour it.

## honeypot

**Kill shot.** A token you can buy but cannot sell.

Detection is a layered sell simulation: a quoter pass first, then a deep pass
using `eth_call` with state overrides, which sells *as the user would*, from a
normal wallet, rather than as a contract. That distinction matters because many
traps allow contract sells and block wallet sells, or the reverse.

The failure mode to be careful about: the simulation library throws the same
exception for "the contract reverted, you genuinely cannot sell" and "the RPC
node never replied". Those are opposite meanings. The engine separates them and
defaults an unrecognised error to *transient*, because a wrong "transient"
costs a skipped check while a wrong "definite" publishes a honeypot accusation
against a perfectly tradeable token. If a honeypot result comes back marked
transient, the sell could not be tested — say that, and say nothing more.

A token confirmed as a honeypot is marked permanently. Disabling the trap later
does not clear the mark, though an admin can lift one for a verified false
positive, publicly and with a reason.

## deployer_pulled_liquidity

**Kill shot.** The deployer's own transaction history contains liquidity
removal — `removeLiquidity` or `decreaseLiquidity`.

This is the rug itself, already executed and recorded. Not a risk factor.

The one thing to watch: if this check reports it could not read the deployer's
history, that is emphatically **not** "no pull found". A false all-clear here
is a false all-clear on a completed kill shot, which is the worst error this
system can make. The check has an explicit unavailable state for exactly this
reason — respect it.

## token_confirmed_rug

**Kill shot.** This token itself is on the Wanted board as a confirmed rug.

Its pool was drained, or its buyers were left holding coins they could not
sell, matched against the published rug criteria with the evidence bundle kept
so any row can be re-checked against the chain.

This is a statement about the token in front of you, not about its creator's
past. `deployer_history` is the one that speaks about earlier launches, and
`funder_rug_history` about the wallet that paid for the deployer's gas.

## funder_rug_history

**Kill shot.** The deployer, or a wallet one hop away in its funding lineage,
carries an active stain from a confirmed rug.

We trace the gas that funded the deployer and walk the web of linked wallets.
One hop is close enough to be treated as the same operator: fresh wallets are
free, so a serial rugger's only real cost is the funding trail.

Two hops out is not a kill shot — that becomes the weighted `funding_lineage`
check instead.

## lp_custody

Can a single live wallet pull the liquidity holding up this price?

Asked of every pool the token sits in, across all supported venues and
versions, and answered from each pool's own records — the LP-token holder list
on V2-style pools, position-NFT ownership on V3-style pools, and per-position
liquidity events on V4.

Three things make this check subtler than it sounds:

- **It is not about the deployer.** A controlling stake in *any* live wallet is
  a pull vector, whoever holds it, and renouncing contract ownership does not
  touch it.
- **Only material pools count.** A whale sitting on a pool that holds a rounding
  error of the token's liquidity cannot rug anything. Such custody is recorded
  but not scored.
- **Depth is measured where the price actually is.** Liquidity parked out of
  range is not holding up the price, so a pool is never credited for it.

An all-clear requires having accounted for the pool set, not just the part of
it that could be read. Incomplete discovery does not become a PASS.

## deployer_history

How the deployer's previous launches ended. A pool left with negligible
liquidity counts as dead.

The signal is repetition. One dead launch can be a failure; a pattern of them
is a business model. A deployer with no prior launches is *unknown*, not clean
— everyone is a first-time deployer exactly once, including every rugger.

## funding_lineage

The stained-funds web, at the distance that is suggestive rather than
conclusive.

Two shapes trip it: the deployer's funding trail reaching a confirmed rugger a
couple of hops out, and the classic pre-rug setup where a fresh wallet is
funded by another fresh wallet — a structure that exists to break the trail
back to an identity.

Closer links than that escalate to the `funder_rug_history` kill shot.

## holder_concentration

What share of the tradeable float the largest holders control.

The float is the supply minus what is locked in verified pools and minus what
is burned — because those cannot be dumped. Each large holder is classified by
reading its code, so a smart-contract wallet is counted as the dumpable wallet
it is rather than dismissed as "a contract".

High concentration is not proof of anything. It is a statement about how few
decisions it would take to collapse the price.

## ownership

Is the contract's owner key renounced, or still live?

A live owner is not automatically bad — plenty of legitimate tokens keep one.
It means the powers that owner has are still exercisable, which is why this
check reads alongside `dangerous_selectors`: ownership answers *who*, that one
answers *what they can do*.

## liquidity_depth

The USD depth of the deepest pool.

Thin liquidity means the price is easy to move in either direction, and that an
exit at the quoted price is unavailable at any meaningful size.

Zero is a real reading, not missing data. A pool drained to exactly nothing is
the most certain rug there is, and must never be reported as "no liquidity
information".

## upgradeability

Is this a proxy whose implementation can be swapped?

Read from the standard proxy storage slots: implementation, admin, beacon. A
proxy with a live admin key means the code someone audited can be replaced
afterwards, so the audit describes the past rather than the future.

Renounced or timelocked admin scores back up. An admin that resolves to the
chain's own bridge or system owner is infrastructure, not a rug vector.

**Known gap:** the trusted-admin logic does not currently inspect the beacon
slot, so beacon-proxy tokens — which includes essentially every Robinhood stock
token — draw a WARN they do not deserve. This is a defect in our engine. Say so
when it comes up.

## source_verification

Is the contract's source published and verified on the explorer?

Unverified source means nobody outside the deployer can read what the contract
actually does; every other static finding degrades to guessing from bytecode.
It is not itself malicious — it removes the ability to rule malice out.

## fdv_liquidity_ratio

Fully-diluted value measured against real liquidity.

A large notional valuation sitting on a small pool means the headline number
is an artefact of the last small trade, and that number of dollars does not
exist to be exited into.

## dangerous_selectors

Privileged powers the contract retains over holders after launch: minting,
pausing, blacklisting, fee and limit and route setters, asset rescue, upgrade.

When the contract-authority audit completes, it drives this check — capabilities
traced through verified source rather than guessed from bytecode selectors, and
graded by *who can reach them*. A power reachable by a live or unresolved
authority is a finding; the same power with every controlling authority
renounced is a lesser one. With no verified source available it falls back to a
static selector scan, which is a weaker instrument.

Note the shape: the presence of a function is not the finding. Reachability is.

## volume_turnover

Trading volume relative to liquidity, as a first signal of manufactured
activity.

Real demand and real depth grow together. Volume far out of proportion to the
pool holding it usually means the same money is going round in circles.

## wash_trading

The composite bot-volume signature, calibrated against real pump-and-dumps on
this chain: volume against liquidity, crossed with how many trades each unique
trader made, crossed with how symmetric the buying and selling is. Tightened
for very young pools, where the pattern is most common.

Unlike the permanent marks, this reflects the current window. When the bots
stop and the fake volume clears, it clears too.

## tax_manipulation

The deployer toggling fee or limit setter functions after launch.

The pattern this catches is a token that trades normally while it accumulates
holders and then has its sell tax raised to confiscatory levels — a honeypot
assembled after the fact, out of powers that were disclosed all along.

## paid_promotion

Active paid boosts and paid listing orders on the DEX screeners.

Organic demand does not buy its way onto a screener. Any active boost is worth
noting; a heavy campaign is a finding, because bought visibility at scale is
how coordinated pumps recruit exit liquidity. A paid token *profile* on its own
is routine and passes with a note.

Unreadable promotion data SKIPs. It never counts as a clean bill.

## serial_clone

The contract's bytecode fingerprint matched against the registry of templates
we have seen before.

Two different findings share this check. Code identical to a token whose
deployer lineage is already stained is the serious one — the same operator,
running the same script again. The same public template redeployed by unrelated
wallets is a copycat, which is common and much weaker.

## pool_age

How long the pool has existed. Very young pools carry most of the rug risk on
this chain, simply because most rugs happen quickly.

Age is a base rate, not a finding. It never means a token is bad; it means the
evidence about it is thin.

## contract_age

Age taken from the contract's own creation transaction, dated by the explorer.

When that date cannot be read the check SKIPs. It is specifically **not**
inferred from pool age — a contract deployed long before its pool is a
different situation from one deployed the same hour, and guessing erases the
distinction.

## launchpad_provenance

Which bonding-curve launchpad the token came from, how far its raise got, and
how much of their own raise the creator bought.

A creator taking a large share of their own raise has manufactured the demand
and is the one obvious seller — the raise looks successful because they funded
it, and the exit is pre-loaded.

## bytecode_fingerprint

The deployed code compared against known templates: an exact match, a modified
copy, or something unrecognised.

A modification to a well-known safe template is where trapped code usually
hides, because the surrounding code reads as familiar.

An unreadable code fetch is not "no contract here". That confusion produced a
real wrong verdict — a live token reported as having no contract deployed —
and is why the read carries its own unavailable signal.

## prior_honeypot

**A cap, not a deduction.** Once a token has been caught as a honeypot it is
marked, and the mark is permanent. While it stands the score cannot rise above
the top of DANGER, no matter how well every other check scores.

The reasoning is that a trap which has been switched off is still a contract
whose owner switched it on once. Fixing the symptom does not buy back trust,
so a disabled trap can never earn a CLEAR.

The mark can be lifted by an admin for a verified false positive. A lifted mark
stays publicly visible with the reason it was lifted — it is a pardon on the
record, not an erasure. If the trap fires again the mark re-arms automatically.

In `verdict.checks[]` this appears with `weight: null` and `deduction: 0`. That
is the cap doing the work instead of a subtraction; it is not evidence that the
mark was harmless. An active mark is a FAIL. A lifted mark is a PASS that
carries the pardon note, and the pardon note is worth repeating to the user.

## prior_pump_dump

**A cap, not a deduction.** A permanent mark written when a token's price
collapses from its recent peak following a wash-inflated run — the pattern of
manufactured volume, a crowd arriving on it, and an exit.

While the mark stands the score is capped at the top of DANGER. A token cannot
relist or rebuild its way back to CLEAR after dumping on the people it drew in.

Same lifecycle as the honeypot mark: an admin can lift it for a verified false
positive, the lifted mark stays visible with its reason, and it re-arms if the
pattern repeats.

Like `prior_honeypot`, it arrives with `weight: null` and `deduction: 0`
because it ceilings the score rather than subtracting from it.

## active_wash_trading

**A cap, not a deduction — and unlike the other two it is not permanent.**

When the live wash-trading check fails — elevated volume against liquidity
*and* per-side bot density, on a pool with real depth — the conclusion is that
the volume is manufactured. A score built partly on trading activity cannot be
trusted while the activity is fake, so it is capped at the top of DANGER.

The difference from the two marks above is that this one reflects the current
24-hour window. It is a statement about what is happening now, not about what
happened once. When the bots stop and the fake volume clears, the next scan
lifts the cap on its own. No admin action, no pardon, nothing to lift.

So the honest sentence is "this token's volume is being manufactured right
now", not "this token is permanently marked".

## unread_surface

**A cap, not a deduction — and it is about us, not about the token.**

Most checks deduct points when they find something wrong. A check that cannot
run deducts nothing, which sounds neutral and is not: it means a scan that
managed to examine *less* comes out looking better than the same token on a day
when everything was readable. We measured this happening — a token moved from 49
to 62, out of DANGER and into CAUTION, across two scans where nothing about the
token itself changed. A market-data provider had simply stopped answering, and
four checks fell silent.

So when a material share of the scoring surface goes unread, the score is held
at the top of CAUTION. The token is not being accused of anything. We are
declining to certify something we did not manage to look at.

Only checks that wanted data and did not get it are counted. A check that stands
down because there is nothing of that kind to examine — a token still on a
bonding curve has no DEX pool to measure, a canonical infrastructure asset is
not judged on holder spread, a token whose creator is a contract has no single
person whose history could be looked up — is not ignorance, and does not count
toward the cap. Note that "we have no launchpad record for this token" is NOT
in that group: that is our own coverage gap, and it counts.
Confusing those two would cap almost every token on this chain, since most
tokens here are launched by a contract.

This row appears on every verdict whether or not the cap fired, and it lists
which checks went unread. If it says the cap applied, the honest reading is
"parts of this could not be checked", not "this token did something wrong".
