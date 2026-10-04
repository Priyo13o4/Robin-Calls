# contracts

Every Solidity contract RobinCalls deploys. Self-contained Foundry project — nothing
here is imported by the Next.js app, and `contracts/` is excluded from the Docker
build context. **See "What lives here" below for which contract is which.**

## What lives here

One directory per product. Anything under `shared/` is used by more than one.

| Product | Directory | What it is | Status |
| --- | --- | --- | --- |
| **swap-router** | `src/swap-router/` | `RobinCallsRouter` — the cross-DEX trade executor (WAYS-OF-WORK §5 Phase 2). Non-custodial, fee-taking, wraps whitelisted routers. | Built + fork-tested. **Not deployed.** |
| **token-sale** | `src/token-sale/` | `TokenSale` — fair-launch sale. Holds a fixed slice of supply, takes ETH while open, pays that slice out pro-rata by contribution once closed. Deployed by hand via Remix. | Built + tested. **Not deployed.** |
| _(shared)_ | `src/shared/` | Interfaces to third-party contracts every product may need — currently `IPermit2`. | — |

Each product has matching directories in `test/`, `proof/` and `script/`:

```
src/token/RobinCalls.sol           ← the ROBINCALLS ERC-20 token contract
src/swap-router/RobinCallsRouter.sol   ← the contract
src/swap-router/IRobinCallsRouter.sol  ← its types/events/errors, for off-chain callers
src/token-sale/TokenSale.sol           ← the contract, edit here
src/token-sale/ITokenSale.sol          ← state machine, events, errors, views
src/shared/IPermit2.sol                ← canonical Permit2, shapes copied from upstream
test/token-sale/TokenSale.t.sol        ← 96 tests, 2 fuzz invariants
flat/RobinCalls.flat.sol               ← GENERATED — RobinCalls token, for Remix/verification
flat/RobinCallsRouter.flat.sol         ← GENERATED — swap-router, for Remix/verification
flat/TokenSale.flat.sol                ← GENERATED — token-sale's deployment artifact
test/swap-router/*.t.sol               ← invariant suite + live-chain fork suite
test/mocks/                            ← shared across products
proof/swap-router/Attacks.t.sol        ← adversarial PoCs
script/swap-router/Deploy.s.sol        ← deployment
```

**Adding a product**: make `src/<name>/`, `test/<name>/`, and (if it needs them)
`proof/<name>/` and `script/<name>/`, then add a row to the table above. Nothing
in `foundry.toml` needs changing — the paths are recursive.

### Deployed addresses

Record every deploy here: chain, address, and the commit it was built from.

| Contract | Chain | Address | Commit |
| --- | --- | --- | --- |
| RobinCalls (`ROBINCALLS`) | 4663 | `0xf53c0ec24A6e2AE4bbD58e32746aDD7E3eb6c71B` | uncommitted working tree, 2026-09-29 |

RobinCalls was deployed from Remix, not forge: solc 0.8.34, optimizer OFF, cancun,
OpenZeppelin 5.4 to 5.6 as fetched by Remix (not the 5.1.0 in `lib/`). Owner and
full supply: `0xAE05BE602f7332b4560A9Ca2A1Fd4a484b40AC7d`. Exact match on Blockscout,
Sourcify and robin.etherscan.io. Re-verify from Remix's Standard JSON input, never
from `flat/RobinCalls.flat.sol`, which is built against the older OpenZeppelin.

### Vesting locks (PinkLock02 `0xBE0b139ABc90723Af76a89D3051f60Ba1B64c8d9`)

Each lock releases its first slice at TGE, then one slice every cycle. Read terms
with `getLockById(uint256)`; percentages there are basis points.

| Allocation | Lock id | Amount | Claim wallet | First unlock (UTC) | Release | Fully unlocked |
| --- | --- | --- | --- | --- | --- | --- |
| Team & Contributors | [1001282](https://www.pinksale.finance/pinklock/robinhood/record/1001282) | 500,000 | `0xAE05BE602f7332b4560A9Ca2A1Fd4a484b40AC7d` | 2027-04-01 | 5% every 29 days | 2028-10-03 |
| Treasury | [1001284](https://www.pinksale.finance/pinklock/robinhood/record/1001284) | 500,000 | `0x596bF66512785daf78604d844c21b5B6dccb2310` | 2027-01-01 | 5% every 33 days | 2028-09-19 |
| Dev & Ecosystem | [1001285](https://www.pinksale.finance/pinklock/robinhood/record/1001285) | 1,350,000 | `0xc83f82eBaE1F01f0Fc7F52B39C97df7077f28BBF` | 2027-01-01 | 5% every 33 days | 2028-09-19 |
| Platform Reward (1 of 2) | [1001286](https://www.pinksale.finance/pinklock/robinhood/record/1001286) | 375,000 | `0x4E204b84C065b4d856036242b115cA61abFc9c96` | 2026-10-01 | 50% every 92 days | 2027-01-01 |
| Platform Reward (2 of 2) | [1001287](https://www.pinksale.finance/pinklock/robinhood/record/1001287) | 1,125,000 | `0x4E204b84C065b4d856036242b115cA61abFc9c96` | 2027-10-01 | 33.34%, then 33.33% every 183 days | 2028-10-01 |

Platform Reward's two locks together are `VESTING["PLATFORM REWARD"]` in
`lib/sale/tokenomics.ts`. The 33.34/33.33/33.33 split was fork-tested to release
exactly 1,125,000 (375,075 then 374,962.5 twice).

Dev & Ecosystem's other 150,000 (10% of 1.5M) is unlocked at TGE by design and is
paid to the dev wallet directly, not through PinkLock.

Team lock's claim wallet is the token owner wallet, not a dedicated team wallet;
move it with PinkLock's transfer-lock-ownership before launch.

## Setup

Foundry, then the two dependencies at pinned tags:

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

```bash
cd contracts && forge install --no-git foundry-rs/forge-std@v1.16.2 OpenZeppelin/openzeppelin-contracts@v5.1.0
```

`--no-git` matters: without it `forge install` writes submodule entries, and with no
git repo of its own under `contracts/` it reaches up and adds them to the main repo.
`lib/` is gitignored — the tags above are the version record.

## Running the suites

```bash
cd contracts && forge test
```

```bash
cd contracts && FOUNDRY_PROFILE=proof forge test
```

`forge test` is the invariant suite (`test/`); the `proof` profile is the adversarial
one (`proof/`), where each test is an attack that must fail.

**Fork tests need a real RPC and a real token, or they skip rather than pass** — a
skipped fork test proves nothing, so check the count:

```bash
cd contracts && ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com FORK_BLOCK=52348000 FORK_TOKEN=0x0e5f7772ab4717c9ce4cad0acd01de7bf17d442e FORK_V3_FEE=100 forge test --match-path 'test/swap-router/RobinCallsRouterFork.t.sol'
```

That exact line ran 8/8 green on 2026-09-02 — a real buy and sell through SwapRouter02
and a real buy through Universal Router, against `Marketplier` (17.9 WETH, fee tier 100).
It is recorded because "pick a token from a recent scan" is not reproducible, and a
skipped fork test proves nothing — always check the count, not just the exit code.

Pinning `FORK_BLOCK` matters twice over: it makes the run reproducible, and Foundry
caches the fetched state, so a repeat run stops hammering the public RPC (which
429s).

**Liquidity moves, so that token will not stay a valid choice.** To find a fresh one,
rank live pools by the WETH they actually hold rather than picking from a list —
`PoolCreated` on the V3 factory (`0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`) over
the last few hundred thousand blocks, then `WETH.balanceOf(pool)` on each. Two traps
when you do: the factory emits a WETH/WETH self-pair that tops the depth ranking and
is useless, and **some 4663 tokens are Arbitrum Stylus (WASM)** and cannot execute in
a Foundry fork at any `evm_version` — check `eth_getCode` does not begin `0xef`.

## Three findings this project paid for already

**1. `evm_version` must be `cancun` — and the cheap way to learn that is the
explorer, not experiments.** A verified contract's entry carries `compiler_version`
and `evm_version` outright (`GET /api/v2/smart-contracts/<addr>`). On 4663:
UniswapV3Factory and SwapRouter02 are `istanbul` (solc 0.7.6), Permit2 is `london`
(0.8.17), Universal Router is **`cancun`** (0.8.26). Read that as a floor, not a
menu: each row is what that deployer chose, so take the highest among contracts
demonstrably EXECUTING. The request is slow (~500KB); a 25s timeout is not an
answer, and treating one as "explorer unavailable" is what made the two settings
below get discovered by experiment instead.

Both wrong settings failed identically — REVM answering `EvmError: NotActivated`,
which reads like a broken contract and is actually the fork's own EVM spec refusing
an opcode:

- `paris` rejected live 4663 **tokens**, whose runtime uses `PUSH0` (one begins `0x5f`).
- `shanghai` rejected **Universal Router itself**, which uses Cancun transient storage.

That UR *needs* Cancun does not prove the *chain* allows it. What proves it: UR is
the `sender` on real V3 `Swap` events on 4663 (37 on the deepest WETH pool alone),
so Cancun bytecode demonstrably executes here — and the explorer's verified entry
for UR reports `evm_version: cancun` outright. `ArbSys.arbOSVersion()` answers 116.

**2. This chain's Universal Router is STOCK Uniswap, at a commit close to `main`.**
Its `V3_SWAP_EXACT_IN` input decodes as `(address,uint256,uint256,bytes,bool,uint256[])`
— **six** fields. The trailing `uint256[]` is a per-hop minimum price
(`minHopPriceX36`); an empty array means "no per-hop bound" and is explicitly
allowed, which is what we pass since our own `minAmountOut` is the real floor. A
five-field encode reverts with `SliceOutOfBounds()` and nothing about that error
explains why.

This entry previously called the deployment a fork, citing six-field V3,
`PAY_PORTION_FULL_PRECISION = 0x07` and `ACROSS_V4_DEPOSIT_V3 = 0x40`. All three are
stock on `Uniswap/universal-router@main` (verified 2026-09-15 by diffing the
deployed verified source against the repo). The fork reading came from comparing
against the repo's `deployed-commit` branch, which is the ancient v1 router with the
NFT command table. **Diff against `main`; the README's own branch pointer is a trap.**

**Read the deployed verified source for command BYTES, never the repo** — `main` has
since claimed `0x0f` as `UNWRAP_WETH_EXACT` where this deployment reverts
`InvalidCommandType(0x0f)`. Mainnet Blockscout has the source (slow, ~500KB, 110
files under `src/pkgs/universal-router/`; testnet's explorer does not have UR
verified, and the two deployments have different bytecode anyway). Upstream is the
right place to learn the SURFACE — `CONTRACT_BALANCE`, `SWEEP`, `PAY_PORTION` — and
the wrong place to take a byte from.

**3. Constant folding in tests.** `10 ether * FEE_BPS` computes in `uint16` and fails
the build with an arithmetic error, not a warning. Use the `_fee()` helper.

## Deploying

Testnet (46630) first, then mainnet (4663). Testnet runs the **same Nitro build and
the same ArbOS 116** as mainnet, and already has Permit2 and Universal Router at the
identical addresses — so it is a real rehearsal, not an approximation. What it does
NOT have at the mainnet addresses: SwapRouter02, WETH, the V3/V2 factories. Find the
testnet equivalents before expecting a fill there.

| | Mainnet | Testnet |
| --- | --- | --- |
| chain id | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com/rpc` |
| explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |


```bash
cd contracts && forge script script/swap-router/Deploy.s.sol:Deploy --rpc-url $ROBINHOOD_RPC_URL --broadcast --verify --verifier blockscout --verifier-url $EXPLORER_API_URL
```

Constructor values come from env (`ROUTER_OWNER`, `ROUTER_FEE_RECIPIENT`,
`ROUTER_FEE_BPS`, `ROUTER_FEE_ASSETS`, `ROUTER_TARGETS`, optional `ROUTER_PERMIT2`).
None is hardcoded: the fee number is D4's and still unpicked, and a wrong target entry
is the one input that turns the allowlist into an escape hatch.

**The target set is fixed at deploy** (D1). Adding a venue or a launchpad later means a
new deployment — get the list right before spending gas.

After deploying, in order: verify on Blockscout and check the constructor args; register
the address in `trusted_address` **before the first trade**, or the scanner reads our own
routed flows as whale activity on the tokens we route; confirm `owner()`.

## Using Remix

Fine for **deploying and poking a contract by hand**; it cannot run this repo's tests
(they are Foundry tests using `forge-std` cheatcodes, which Remix has no equivalent for).

If you do: copy `src/` in with its directory structure intact — the relative imports
(`./IRobinCallsRouter.sol`, `../shared/IPermit2.sol`) depend on it — and let Remix
resolve `@openzeppelin/contracts/…` from npm, pinning **5.1.0**. Then in the Solidity
compiler tab set compiler **0.8.28**, **EVM version `cancun`**, optimizer **on** at
**1000000** runs. Those are not cosmetic: a different EVM version or optimizer setting
produces different bytecode, so a Remix deployment will not match what `forge` builds
and its Blockscout verification will not reproduce. Deploy through Remix only as a
throwaway experiment — the real deployment goes through `script/swap-router/Deploy.s.sol`,
which also pre-flight-checks every constructor address for bytecode.

**token-sale is the exception**: Remix by hand IS its deployment path, and
the non-flat source pair or `flat/TokenSale.flat.sol` can be used. Its compiler is
**0.8.34**. See the TokenSale chapter below.

`flat/RobinCallsRouter.flat.sol` also exists, for poking the router by hand and for
Blockscout's single-file verifier — regenerate it with:

```bash
cd contracts && forge flatten src/swap-router/RobinCallsRouter.sol -o flat/RobinCallsRouter.flat.sol
```

It compiles standalone with no `lib/` present, and at **0.8.28 / cancun / optimizer on
/ 1000000 runs** it produces creation bytecode, runtime bytecode and an ABI byte-identical
to the project build (checked 2026-09-02) — so what you deploy from Remix is the same
contract the 72 tests ran against. **Change any one of those four settings and it is
not**, which is the whole reason the router's real deployment goes through
`script/swap-router/Deploy.s.sol` (it also pre-flight-checks every constructor address
for bytecode; Remix checks nothing).

---

## TokenSale

### What it does

The deployer funds it with a fixed slice of supply (the intended 30%). Anyone sends
ETH while the sale is open. When the owner closes it, each contributor is owed:

```
allocation(a) = tokensForSale × contributed[a] / totalRaised
```

That is the same thing as "average price = tokensForSale / totalRaised, then divide
each contribution by it" — but the average price must **never** be computed as an
intermediate, because integer division truncates it (usually to zero) before anything
uses it. The contract multiplies first and divides once, in one line every path goes
through.

### Lifecycle

One enum, `state`, answers every "may I?" question.

```
Pending ──start()──> Active <──resume()/pause()──> Paused
   │                   │                             │
   │                   └────────close()──────────────┤
   │                                                 │
   │                                          Closed (terminal)
   └──────────────abandon()───────────────────> Abandoned (terminal)
              (also from Active / Paused)
```

`Closed` opens claiming. `Abandoned` opens refunds. They are mutually exclusive, and
**abandon is unreachable from Closed by necessity, not preference**: once closed,
tokens start moving, so a later cancellation would leave some people holding tokens
and others owed ETH out of a pot that already paid tokens out.

Owner: `start`, `pause`, `resume`, `close`, `abandon`, `distribute`,
`withdrawProceeds`, `withdrawUnsoldTokens`, `sweepStray`, `recoverERC20`, and
`setFeeAddress1` / `setFeeAddress2` / `setFeeAddress3` (Pending only). Ownership is `Ownable2Step`.

Contributors: `contribute()` while Active, `claim()` once Closed, `claimRefund()` once
Abandoned, `claimStray()` any time. A first contribution must be at least
`minInitialContribution`; further contributions have no floor and only need to be whole
multiples of `contributionStep`. Both are storage, not constants: the constructor sets
0.005 ETH and 0.001 ETH, and `setContributionLimits` moves them in wei while Pending,
Active or Paused.

**Deployment order is deploy → fund → start()**, and `start()` enforces it.

### The UI's ABI copy

`lib/sale/abi.ts` in the Next app is a hand-written copy of this interface;
`tests/sale-abi-and-quote.test.ts` diffs it against a checked-in fixture and
fails on drift. After any change here, regenerate the fixture and commit it:

```bash
cd contracts && forge build && cd .. && node scripts/gen-token-sale-abi-fixture.mjs
```

### Two ETH pots, never mixed

`contribute()` fills `totalRaised`, which buys tokens.

A **plain ETH send** lands in `strayOf[sender]` instead. It buys nothing, moves no
allocation, touches no denominator, and the sender can pull it back at any time with
`claimStray()`. Participation goes through the UI, which calls `contribute()`;
recording direct sends keeps them refundable rather than stranded, without letting
them silently become a purchase.

Because the pots never mix, `withdrawProceeds` sends **exactly `totalRaised`** rather
than sweeping the balance — so no reserved-ETH accounting is needed, and the owner
withdrawal structurally cannot reach a stray sender's funds.

The accepted consequence: ETH force-sent by a `selfdestruct` belongs to neither pot
and is permanently stranded. That is the price of both exits paying exact,
pre-committed amounts instead of sweeping.

### Proceeds are split, not addressed

`withdrawProceeds()` takes **no recipient argument**. It runs in two steps.

First the **referral scoop**: `REFERRAL_BPS` (400, so 4% of the raise) comes off the top
and goes to `referralPotRecipient`, or to `owner()` if that is still unset. This is the
ETH the referral rebates are paid out of. It is taken before anything else so the
commission budget can never be short because a fee leg rounded first.

What is left is then split four ways:
- **Fee Address 1** (second admin / team): 8% (800 basis points, fixed)
- **Fee Address 2** (partner 1): 8% (800 basis points, fixed)
- **Fee Address 3** (partner 2): 4% (400 basis points, fixed)
- **Owner / Deployer**: remaining 80% (8000 basis points, dedicated to liquidity deployment)

Those percentages are of the **post-scoop** amount, so as a share of the whole raise the
legs are 4% referral, 7.68%, 7.68%, 3.84% and 76.8%.

Fee addresses 1, 2, and 3 are specified at deploy time (constructor) and can be updated
by the owner via `setFeeAddress1`, `setFeeAddress2`, and `setFeeAddress3` **in any state
until `proceedsWithdrawn` is true**. `setReferralPotRecipient` and `setFeeEnabled` carry
the same window. Once the raise has been paid out the split is settled and all four
refuse to move.

A destination field for the OWNER leg would be the one place a compromised owner key
could redirect the entire raise, which is why there isn't one.

Load-bearing details:

- Fee Address 1, Fee Address 2, and Fee Address 3 legs are computed by division and **the owner leg by subtraction**.
  Independent divisions would each round down and leave difference stranded in the
  contract forever; subtracting guarantees the legs sum to the raise exactly. Fuzzed.
- If a fee recipient address cannot receive ETH, its leg is **redirected to `owner()` in
  the same transaction** and `FeeShareRedirected` is emitted. A reverting recipient must
  never be able to strand 100% of the raise over its share, and the earlier design
  (deferring the leg to a later claim) meant one bad address left ETH parked in the
  contract until someone remembered it. The redirect settles everything at once.
- `setFeeEnabled(feeAddressId, false)` zeroes a leg deliberately. A disabled leg is not
  parked anywhere: the owner leg is computed by subtraction, so it simply falls to the
  owner. This is the escape hatch for a partner address the operator no longer holds.

**Nothing can strand a fee leg.** Every leg resolves inside the one transaction:
to its address if that address can receive, to `owner()` if it cannot. There is no
later claim to make and no balance left behind, which the tests assert directly
(`address(sale).balance == 0` after a rejecting fee address is redirected).

Sending 1 wei to each fee address before `withdrawProceeds()` is still worth doing,
but for a different reason than stranding: a redirect means that partner's share
lands with the OWNER instead, and you would rather find that out beforehand than
read it off a `FeeShareRedirected` event afterwards.

**The one call that can fail outright is an owner that cannot receive ETH.** The
owner is the last resort for every leg, so if it reverts there is nowhere left to
send and `_sendEth` reverts the whole call. That is the correct behaviour and it is
deliberate: `proceedsWithdrawn` rolls back with the revert, the raise stays in the
contract, and the call works on retry once ownership moves to an address that can
receive. Pinned by `test_withdrawProceeds_ownerThatRejectsEthRevertsAndStaysRetryable`.

### Unclaimed tokens can be burned, once, after 60 days

`burnUnclaimed()` destroys every sale token still held by the contract. `BURN_DELAY`
is 60 days from `closedAt`, which `close()` records, and `unclaimedBurned` makes it a
one-shot. It calls the token's real `burn()`, so total supply falls.

The gate is the **delay alone**, deliberately not `distributionComplete()`. Gating on
distribution would mean one contributor whose address cannot receive the token blocks
the burn forever, which hands a stranger a veto. 60 days is the window in which anyone
who wants their tokens can `claim()`; after it, `claim()` and `distribute()` revert with
`SaleTokensBurned` rather than failing on a bare balance shortfall.

### What it deliberately does not have

Decided, not overlooked: no hard cap, no soft cap, no deadline, no per-wallet limits,
no whitelist, no vesting. The sale runs until the owner closes it.

Claims are all-or-nothing — `claimed` is a flag, not a running balance — so **adding
vesting later means replacing it with a counter**, not adding a function.

The sale token must be a plain ERC20: a transfer fee or a rebase makes `tokensForSale`
a promise the contract cannot keep.

### The eleven things the tests exist to pin

These are the ways to ship a sale that looks like it works. Each has a named test.

**Run `forge test` before regenerating the flat file.** The flat file is what gets
deployed, and the suite is the only thing standing between an edit to `src/` and a
deployment of it — Remix compiles the flattened source but proves nothing about its
behaviour.

1. **`close()` is irreversible, and contributions stop dead at it.** `totalRaised` is
   the denominator of every allocation. If ETH could arrive after the first `claim()`,
   every earlier claimant would already have taken more than their share and the last
   ones would find an empty contract — with no revert anywhere to say so. A raw send
   after close cannot move it either: it lands in the stray pot.
2. **`start()` asserts the contract is funded.** Without that check an underfunded sale
   opens, takes real ETH, and the first claimants drain it while the rest revert.
3. **A fee-on-transfer or rebasing sale token breaks the invariant.** `start()`'s
   balance check catches the funding leg; nothing catches a rebase mid-sale.
4. **`claimed[addr]` is set before the transfer** — checks-effects-interactions, with
   `ReentrancyGuard` on top. Tested with a sale token that re-enters `claim()` from
   inside its own `transfer`.
5. **`distribute()` is chunked, never one unbounded loop.** A loop over every
   contributor runs out of gas at a few thousand entries and is then permanently
   unusable. `claim()` is the guarantee; `distribute()` is convenience, and the two are
   idempotent against each other. Refunds are pull for the same reason.
6. **The two ETH pots never mix.** `withdrawProceeds` moves exactly the raise and
   leaves stray ETH behind; the stray sender can still pull theirs afterwards.
7. **`straySwept` blocks `claimStray` after a sweep.** Without that flag a post-sweep
   claim would pay out of ETH the sweep already removed, i.e. out of the proceeds. The
   sweep itself is **repeatable**: `receive()` is not gated on the flag, so ETH that
   turns up after the sale is over is still booked and the owner can still collect it.
   A sweep with nothing new reverts `NoStray`, not `StrayAlreadySwept`, so the revert
   tells an operator whether to come back later.
8. **Integer division only ever loses.** `sum(allocationOf) ≤ tokensForSale`, fuzzed
   over random contribution sets. The dust stays in the contract and is meant to.
9. **The proceeds legs sum to the raise exactly** — three divisions, one subtraction. Four
   divisions strand wei in the contract permanently.
10. **A fee address that rejects ETH cannot block the owner's leg.** Its share is
    redirected to `owner()` in the same transaction, so no ETH is left parked and the
    other three legs still pay. The referral scoop redirects the same way.
11. **The sale token has exactly one gated exit.** `withdrawUnsoldTokens` requires
   Abandoned, or Closed-with-zero-raised; `recoverERC20` refuses the sale token in
   every state. Any broader sweep is a switch that empties the contract out from under
   people who are owed tokens.

---

### Deploying TokenSale with Remix

**Use non-flat `src/token-sale/TokenSale.sol` and `ITokenSale.sol` side by side in Remix.**
Pin the five OpenZeppelin import prefixes to `@openzeppelin/contracts@5.1.0/`; Remix
fetches the dependencies. Compile and deploy `TokenSale`, not the interface. For
verification, export the actual Remix compilation Standard JSON input, preserving
the sources, compiler settings and constructor arguments.

`flat/TokenSale.flat.sol` remains an alternative generated artifact. It is the whole contract plus
its OpenZeppelin dependencies in one file, generated by:

```bash
cd contracts && forge flatten src/token-sale/TokenSale.sol -o flat/TokenSale.flat.sol
```

**Regenerate and commit it on every change to `TokenSale.sol`** — a stale flat file is
a deployment of code nobody reviewed.

In Remix, Solidity Compiler tab → **0.8.34**, Advanced Configurations → EVM version
**`cancun`**, optimizer **on**, **200** runs. Then Deploy & Run → **CONTRACT
dropdown → `TokenSale`** (a flattened file contains ~12 contracts; the dropdown is
alphabetical, so the default selection is not the one you want).

Constructor takes `owner_`, `token_`, `tokensForSale_`, `feeAddress1_`, `feeAddress2_`, `feeAddress3_`.
All three fee addresses must be non-zero (reverts `FeeAddressRequired`). Fee basis points are fixed constants
(Fee Address 1 = 800 bps / 8%, Fee Address 2 = 800 bps / 8%, Fee Address 3 = 400 bps / 4%, Owner = 8000 bps / 80%).

At those exact settings the flattened file compiles to **byte-identical creation
bytecode** to `forge build`'s — checked, not assumed. Change any of them and that stops
being true.

One caveat for explorer verification: Remix appends a metadata hash to the bytecode by
default, which `bytecode_hash = "none"` strips. That difference is the line between a
**full match** and a **partial match** on Blockscout. Turn metadata off in Remix's
advanced compiler configuration if you want a full match.

`flat/MockERC20.flat.sol` is a test token for exercising the sale on the Remix VM —
deploy `MockERC20` from its dropdown, `mint` yourself supply, then `transfer` the sale
allocation to the deployed sale.

### TokenSale compiler settings, and why they are not negotiable

**solc 0.8.34, `evm_version = "cancun"`, optimizer on at 200 runs.** Pinned, not
a caret range: the deployed bytecode has to be reproducible for explorer verification.

`cancun` specifically, and not something newer:

- Robinhood Chain is Arbitrum Nitro at **ArbOS 116, whose EVM spec is Cancun**. Two
  earlier settings were tried on this project and both failed identically, with REVM
  answering `EvmError: NotActivated` — which reads like a broken contract and is really
  the fork's own EVM spec refusing an opcode. `paris` rejected live 4663 tokens (their
  runtime uses `PUSH0`); `shanghai` rejected Universal Router (Cancun transient storage).
- Nothing in this contract uses a post-Cancun opcode, and Cancun bytecode is valid on a
  post-Pectra Ethereum too. It costs nothing anywhere.

The cheap way to establish this on a new chain is the explorer, not experiments: a
verified contract's entry carries `compiler_version` and `evm_version` outright
(`GET /api/v2/smart-contracts/<addr>`).

### Running the TokenSale suite, and regenerating the flat file

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts && forge install --no-git foundry-rs/forge-std@v1.16.2 OpenZeppelin/openzeppelin-contracts@v5.1.0
```

`--no-git` matters: without it `forge install` writes submodule entries, and with no git
repo of its own under `contracts/` it reaches up and adds them to the main repo. `lib/`
is gitignored — the tags above are the version record.

After **any** change to `src/`, in this order:

```bash
cd contracts && forge test
cd contracts && forge flatten src/token-sale/TokenSale.sol -o flat/TokenSale.flat.sol
```

**Edit `src/`, never `flat/`.** The flat file is generated; a hand-edit there is lost on
the next regeneration and silently diverges from the source everyone reviews. A stale
flat file is a deployment of code nobody tested.

If this lands on Robinhood Chain, register the sale address in `trusted_address` before
it is funded, or the scanner reads the sale's own holdings as whale concentration on
the token.
