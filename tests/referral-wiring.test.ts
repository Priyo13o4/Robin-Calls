import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fs from "node:fs";

/**
 * Wiring, not logic (CLAUDE.md §8 #10).
 *
 * `bindWindowState` has a truth table pinned in referral-rules.test.ts, and
 * every one of those assertions stays green if nothing ever calls it, or if it
 * is called without the chain read it exists to consult. That is the exact
 * shape of the `primeTrustedLockers` outage: a correct function, a passing
 * test, and a caller that never wired it up.
 *
 * So these read the source and assert the CONNECTIONS.
 */

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const SALE_PAGE = "app/token-sale/SalePageClient.tsx";
const HOOK = "lib/referrals/useReferral.ts";
const COMPONENTS = [
  "app/components/referrals/ReferralCodeBox.tsx",
  "app/components/referrals/ReferralGate.tsx",
  "app/components/referrals/ReferralPanel.tsx",
];

test("the sale page hands useReferral the chain's own contributed reading", () => {
  // Without this argument the window falls back to "unknown" forever and the
  // prompt never opens for anyone. The bug it fixes is invisible either way.
  const src = read(SALE_PAGE);
  assert.match(
    src,
    // With no sale contract configured the read never runs, so that case must answer 0n itself.
    /useReferral\(\{[\s\S]{0,600}?contributedOnChain:\s*unset\s*\?\s*0n\s*:\s*mine\?\.contributed/,
    `${SALE_PAGE} must pass mine?.contributed (0n when no sale contract is configured) into useReferral`,
  );
});

test("the hook feeds that reading to bindWindowState", () => {
  const src = read(HOOK);
  assert.match(src, /bindWindowState\(\{[\s\S]{0,300}?contributedOnChain/, `${HOOK} must pass the chain read through`);
});

test("nothing outside the hook decides the binding window from the mirror alone", () => {
  // `canBind` is our indexer's answer and it runs a minute behind the chain. It
  // is a legitimate INPUT to bindWindowState and nothing else. A component that
  // reads it directly has routed around the fix (§8 #7).
  for (const file of [SALE_PAGE, ...COMPONENTS]) {
    assert.doesNotMatch(
      read(file),
      /\bcanBind\b/,
      `${file} reads canBind directly; use the bindWindow prop from useReferral`,
    );
  }
});

test("the contribution prompt opens only on a known-open window", () => {
  const src = read(SALE_PAGE);
  assert.match(
    src,
    /bindWindow === "open"/,
    `${SALE_PAGE} must gate the prompt on an explicitly open window, never on "not closed"`,
  );
});

test("the code field closes only on a known-closed window", () => {
  // "not open" would hide the field whenever a read failed, and a missed
  // binding cannot be undone after the first contribution.
  const src = read("app/components/referrals/ReferralCodeBox.tsx");
  assert.match(src, /bindWindow === "closed"/);
});

/* ── the walker is gone, and stays gone ─────────────────────────────────────
   The log-walking indexer died 2026-09-09: it walked mainnet while the sale
   lived on testnet, so no contribution was ever seen. Contributions are now
   mirrored from the contract's own census plus browser-submitted tx hashes.
   These pins keep the door shut — a reintroduced cursor is a reintroduced
   silent-wrong-chain bug.                                                    */

test("no module walks Contributed logs to build the mirror", () => {
  // The claim verifier DECODES the event from a receipt it was handed (a
  // bounded, single-tx read). What must not come back is an unbounded
  // getLogs walker over block ranges.
  for (const file of ["lib/referrals/reconcile.ts", "lib/referrals/census.ts", "lib/referrals/contribution.ts"]) {
    const src = read(file);
    assert.doesNotMatch(src, /getLogs/, `${file} walks logs — the walker was deleted for cause`);
  }
});

test("the reconciler verifies pending claims with the same check the endpoint ran", () => {
  // §8 #7: a guard is only real if every caller can reach it. The endpoint
  // and the reconciler must share ONE verifier, not two copies that drift.
  const reconcileSrc = read("lib/referrals/reconcile.ts");
  const routeSrc = read("app/api/referrals/contribute/route.ts");
  assert.match(reconcileSrc, /verifyContributionClaim\(/, "the reconciler must use the shared verifier");
  assert.match(routeSrc, /verifyContributionClaim\(/, "the claim endpoint must use the shared verifier");
  assert.match(
    reconcileSrc, /from "@\/lib\/referrals\/contribution"/,
    "the verifier must be imported from its own module, not inlined",
  );
});

test("the reconciler walks the census, not a block cursor", () => {
  const src = read("lib/referrals/reconcile.ts");
  assert.match(src, /readCensusHead\(/, "the pass must read the contract's census head");
  assert.match(src, /recordCensusEntry\(/, "new census entries must be recorded");
  assert.doesNotMatch(src, /sale_indexer_cursor/, "the retired cursor must not come back");
});

/* ── the census getter is ON the ABI the census reads through ─────────────
   `contributors(i)` lived in NOT_EXPOSED's excuse list ("the array getter is
   not the useful read") when the walker died. The reconciler now reads it
   index-by-index, and an undeclared function does not throw in viem's
   allowFailure envelope — every read comes back a silent miss, so the census
   pass records NOTHING while reporting success. Found live, 2026-09-09: the
   trace's slice came back empty. §8 #10, the function nobody wired.        */

test("the census array getter is declared on tokenSaleAbi, not excused", async () => {
  const { tokenSaleAbi } = await import("@/lib/sale/abi");
  assert.ok(
    tokenSaleAbi.some((e) => e.name === "contributors"),
    "lib/referrals/census.ts reads contributors(i) through tokenSaleAbi — the entry must stay declared",
  );
  const test = read("tests/sale-abi-and-quote.test.ts");
  assert.doesNotMatch(
    test,
    /contributors:\s*"/,
    "'contributors' is back in NOT_EXPOSED while the census reads it — the excuse and the reader contradict each other",
  );
});

test("the census slice maps balances onto wallets through the same filter that built the calls", () => {
  // The pairing rule from lib/rpc/multicall.ts: an undefined contributor slot
  // must not shift anybody's balance onto the wallet before it.
  const src = read("lib/referrals/census.ts");
  const filter = src.indexOf(".filter((a): a is Address => a !== undefined)");
  const use = src.indexOf("balances[b++]");
  assert.ok(filter > 0 && use > 0, "expected both the filter and the re-zip");
  assert.ok(filter < use, "the balances must be mapped back through the same filter, in order");
});

test("the claim endpoint records the row before any RPC work", () => {
  // An RPC outage must cost a delay, never a place in the queue.
  const src = read("app/api/referrals/contribute/route.ts");
  const record = src.indexOf("recordContributionClaim(");
  const verify = src.indexOf("verifyContributionClaim(");
  assert.ok(record > 0 && verify > 0, "expected both call sites");
  assert.ok(record < verify, "the claim row must exist before the chain is asked anything");
});

test("no give-up cap turns a pending claim into a refused one", () => {
  const src = read("lib/data/sale-referrals.ts");
  const fn = src.slice(src.indexOf("export async function readPendingClaims"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.doesNotMatch(body, /refused/, "the pending read must never write verdicts");
  // And nothing anywhere marks a claim refused on attempt count.
  assert.doesNotMatch(src, /attempts > \d+.*refused/, "no attempt cap may refuse a claim");
});

/* ── the snapshot's gates ─────────────────────────────────────────────────
   `is_final` is the one flag in this system that cannot be taken back: a unique
   partial index allows exactly one final row, and every downstream payout reads
   it. A gate that is computed but not counted is worse than no gate.          */

test("every snapshot gate is counted before is_final is decided", () => {
  const src = read("lib/referrals/snapshot.ts");
  const decide = src.indexOf("const isFinal =");
  assert.ok(decide > 0, "expected the is_final decision");
  // Not "at least one blocker exists": each gate has to be able to fire.
  for (const gate of [
    "readSaleSnapshot(",
    "readUnsettledContributorCount(",
    "mirroredWei !== contractTotal",
  ]) {
    const at = src.indexOf(gate);
    assert.ok(at > 0, `gate missing entirely: ${gate}`);
    assert.ok(at < decide, `${gate} runs after is_final is decided, so it cannot block it`);
  }
});

test("is_final requires an empty blocker list, not a count of the ones we like", () => {
  const src = read("lib/referrals/snapshot.ts");
  assert.match(src, /const isFinal = args\.final && blockers\.length === 0;/);
});

test("the unsettled check faults rather than reading as zero", () => {
  // A count that returns 0 on a database fault is an all-clear (§8 #9), and
  // this particular all-clear licenses the one snapshot that gets frozen.
  const src = read("lib/data/sale-referrals.ts");
  const fn = src.slice(src.indexOf("export async function readUnsettledContributorCount"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.doesNotMatch(body, /return \{ kind: "found", count: 0 \}/);
  assert.match(body, /catch \{\s*return \{ kind: "unavailable" \};/);
});

test("the snapshot refuses to be final when it cannot read the rules", () => {
  // The indexer keeps its fallback on purpose; the snapshot must not, because
  // the fallback also lands in the `rules` column the sweep checks rows
  // against, making the run agree with itself about the wrong thresholds.
  const src = read("lib/referrals/snapshot.ts");
  const decide = src.indexOf("const isFinal =");
  const check = src.indexOf('config.source !== "stored"');
  assert.ok(check > 0, "the snapshot must check where its rules came from");
  assert.ok(check < decide, "the rules check must run before is_final is decided");
  assert.match(src, /config\.invalidKeys\.length > 0/, "a set-but-unparseable dial must block too");
});

test("the reconciler does NOT block on a config read", () => {
  // Deliberate asymmetry. A config blip must not stop the mirror from being
  // written; it must only stop a payout from being frozen. (The walker
  // version of this rule carried over unchanged.)
  const src = read("lib/referrals/reconcile.ts");
  assert.doesNotMatch(src, /config\.source/, "the reconciler should keep running on the fallbacks");
});

/* ── an empty board is a claim ────────────────────────────────────────────
   "Nobody is on this board yet" is a statement about the sale. A read that
   faulted must never be able to produce it.                                  */

test("neither leaderboard read can answer with a bare empty array", () => {
  const src = read("lib/data/sale-referrals.ts");
  for (const fn of ["readContributionLeaderboard", "readReferrerLeaderboard"]) {
    const start = src.indexOf(`export async function ${fn}`);
    assert.ok(start > 0, `${fn} not found`);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.doesNotMatch(body, /return \[\];/, `${fn} still degrades to an empty board`);
    assert.match(body, /catch \{\s*return \{ kind: "unavailable" \};/, `${fn} must report a fault`);
  }
});

test("the leaderboard route 503s rather than serving an empty board", () => {
  const src = read("app/api/referrals/leaderboard/route.ts");
  const guard = src.indexOf('read.kind !== "found"');
  const respond = src.indexOf("return NextResponse.json({\n    board,");
  assert.ok(guard > 0, "the route must check the read's state");
  assert.ok(guard < respond, "the check must run before the 200 is built");
  assert.match(src, /status: 503/);
});

test("a final snapshot cannot be replaced by re-running its id", () => {
  // The unique partial index makes sure only one row IS final. It does nothing
  // to protect that row from a delete, and the cascade takes every row and draw
  // result under it.
  const src = read("lib/data/sale-referrals.ts");
  const start = src.indexOf("export async function writeAirdropSnapshot");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const guard = body.indexOf("SnapshotIsFinalError");
  const del = body.indexOf("delete from sale_airdrop_snapshots");
  assert.ok(guard > 0, "the writer must refuse an already-final id");
  assert.ok(guard < del, "the refusal must come before the delete, not after");
  assert.match(body, /for update/, "the check must lock the row against a concurrent re-run");
});

test("a refused overwrite is a 409, not a 500", () => {
  const src = read("app/api/jobs/sale-snapshot/route.ts");
  assert.match(src, /error instanceof SnapshotIsFinalError/);
  assert.match(src, /status: 409/);
});

/* ── one clock, not two ───────────────────────────────────────────────────
   `referral_bound_at` is this server's clock and `first_contribution_at` is the
   chain's. Comparing them decides an irreversible eligibility on the drift
   between two machines, in both directions.                                  */

test("eligibility is settled on binding existence, never on clocks or block order", () => {
  const src = read("lib/data/sale-referrals.ts");
  const start = src.indexOf("export async function settleFirstContributions");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.match(body, /referred_by_code is not null/);
  assert.doesNotMatch(body, /referral_bound_block/);
  assert.doesNotMatch(
    body.replace(/--[^\n]*/g, ""),
    /referral_bound_at\s*<\s*excluded\.first_contribution_at/,
    "the clock comparison must be gone",
  );
});

test("a binding is frozen once first_contribution_block is set", () => {
  const src = read("lib/data/sale-referrals.ts");
  const start = src.indexOf("export async function bindReferralCode");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.match(body, /where sale_participants\.first_contribution_block is null/);
  assert.doesNotMatch(body, /boundBlock/);
});

/* ── the schema decides what a claim row may look like ────────────────────
   `sale_contribution_claims_verdict_paired` checks
   `(verdict = 'pending') = (verified_at is null)`, so `verified_at` is really
   DECIDED-at and every statement that decides a claim must stamp it in the
   SAME statement. `markClaimRefused` once omitted it: the update threw on
   every refusal, both callers swallowed the throw, no row could reach
   'refused', and the reclaim branch keying on that value became unreachable
   dead code. Nothing here touches Postgres (§7), so a check constraint can
   never fail a unit test; the contract is pinned against the source instead. */

test("every statement that decides a claim stamps verified_at in the same statement", () => {
  const src = read("lib/data/sale-referrals.ts");
  const statements = src.match(/sql`[^`]*`/g) ?? [];

  // Only what the statement WRITES. A `where verdict = 'refused'` is a filter,
  // not an assignment, and reading it as one flips this test's subject.
  const assigned = (s: string) => {
    const set = s.search(/\bset\b/);
    if (set === -1) return "";
    const where = s.search(/\bwhere\b/);
    return where === -1 ? s.slice(set) : s.slice(set, where);
  };

  const deciding = statements.filter((s) => /verdict = '(refused|verified)'/.test(assigned(s)));
  assert.ok(deciding.length >= 2, "expected both the refuse and the verify writer to be found");
  for (const s of deciding) {
    assert.match(
      assigned(s),
      /verified_at = now\(\)/,
      `decides a claim without stamping verified_at, which verdict_paired rejects:\n${s}`,
    );
  }

  // The mirror: returning a row TO pending must clear the stamp, or the same
  // constraint rejects it from the other side.
  const reopening = statements.filter((s) => /verdict = 'pending'/.test(assigned(s)));
  assert.ok(reopening.length >= 1, "expected the reclaim writer to be found");
  for (const s of reopening) {
    assert.match(
      assigned(s),
      /verified_at = null/,
      `reopens a claim without clearing verified_at:\n${s}`,
    );
  }
});

test("censusSlice is called, not just declared (§8 #10)", () => {
  // A view added to the contract for a cost cut that nothing calls is bytecode
  // paying for nothing. The reader must reach for it AND keep the index walk,
  // because a contract deployed before it exists answers a failure here.
  const abi = read("lib/sale/abi.ts");
  assert.match(abi, /name: "censusSlice"/, "the ABI must declare it");

  const census = read("lib/referrals/census.ts");
  assert.match(census, /functionName: "censusSlice"/, "nothing reads censusSlice");
  assert.match(
    census,
    /functionName: "contributors"/,
    "the index-by-index fallback is gone, so an older deployment cannot reconcile",
  );

  // The refund flag has no batched getter, so it must still be read per wallet.
  assert.match(census, /functionName: "refunded"/);
});

test("the bind route checks contributed(wallet) preflight", () => {
  const src = read("app/api/referrals/bind/route.ts");
  assert.match(src, /readContributed/);
  assert.doesNotMatch(src, /getBlockNumber/);
});

test("the ordering rule is retired by a NEW migration, not by editing 0087", () => {
  // 0087 is applied. Editing it changes nothing in a database that already ran
  // it — the column and both constraints stay, and a bind that omits the block
  // then raises `sale_participants_binding_has_block` on every single call.
  // Verified against prod 2026-09-09: both constraints were still there.
  const applied = read("supabase/migrations/0087_sale_referrals.sql");
  assert.match(applied, /sale_participants_credited_needs_ordering/, "0087 must not be rewritten in place");

  const rework = read("supabase/migrations/0090_referral_plane.sql");
  assert.match(rework, /drop constraint if exists sale_participants_binding_has_block/);
  assert.match(rework, /drop constraint if exists sale_participants_credited_needs_ordering/);
  assert.match(rework, /drop column if exists referral_bound_block/);

  // The rule that survives: credited still needs a binding.
  assert.match(applied, /sale_participants_credited_needs_binding/);
  assert.doesNotMatch(rework, /drop constraint if exists sale_participants_credited_needs_binding/);
});

test("nothing in the app reads or writes referral_bound_block any more", () => {
  for (const f of [
    "lib/data/sale-referrals.ts",
    "lib/db/schema.ts",
    "app/api/referrals/bind/route.ts",
    "scripts/referral-invariants.sql",
  ]) {
    assert.doesNotMatch(read(f), /referral_bound_block|referralBoundBlock/, `${f} still names the dropped column`);
  }
});

test("the invariant sweep checks that credited has binding", () => {
  const sweep = read("scripts/referral-invariants.sql");
  assert.match(sweep, /credited_without_binding/);
  assert.doesNotMatch(sweep, /referral_bound_block/);
});

/* ── the reason sentence reaches the wallet ────────────────────────────────
   docs/prds/REFERRALS.md promises "every wallet gets a plain-English sentence
   saying why it got what it got" as THE answer to a dispute. A correct
   `reason` column and a correct reader are both worthless unconnected — the
   exact shape of issue 11, and of §8 #10 before it.                          */

test("the airdrop route serves the final snapshot's reason to the wallet", () => {
  const src = read("app/api/referrals/airdrop/route.ts");
  assert.match(src, /readFinalSnapshotRow/, "the route must read the final snapshot row");
  assert.match(src, /reason: row\.reason/, "the sentence must travel in the response");
  assert.doesNotMatch(
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""),
    /reason.*\bmight\b|reason.*maybe/,
    "no hedging around the reason",
  );
});

test("the airdrop route never claims snapshotFinal without reading it (issue 17)", () => {
  // `true` as a literal told every wallet a final snapshot exists when the read
  // had faulted. The literal must be gone, the fault must be a 503, and the
  // reader must carry the three states.
  const route = read("app/api/referrals/airdrop/route.ts");
  assert.doesNotMatch(route, /snapshotFinal:\s*true/, "a literal snapshotFinal is a claim nobody measured");
  assert.match(route, /kind === "unavailable"/, "a fault must 503, not read as an absence");
  assert.match(route, /snapshotFinal: read\.snapshotFinal/, "snapshotFinal must come from the reader");
  const reader = read("lib/data/sale-referrals.ts");
  const fnStart = reader.indexOf("export async function readFinalSnapshotRow");
  const fnBody = reader.slice(fnStart, reader.indexOf("\n}\n", fnStart));
  assert.match(fnBody, /kind: "unavailable"/, "the reader must report faults");
  assert.match(fnBody, /exists\(select 1 from sale_airdrop_snapshots where is_final\)/, "snapshotFinal must be measured");
});

test("a smart-contract wallet signature verifies on chain, not only offline", () => {
  // Issue 10. recoverAddress alone cannot validate an ERC-1271 signature, so
  // the verifier must fall through to wallet code. The 401 this prevented is
  // permanent on the referral surface: there is no code after contributing.
  const src = read("lib/referrals/verify.ts");
  assert.match(src, /getCode/, "the verifier must read the wallet's code");
  assert.match(src, /isValidSignature/, "the verifier must run the ERC-1271 check");
  assert.match(src, /ERC1271_MAGIC_VALUE/, "the magic value must come from the shared constant");
});

/* ── the verifier is server only, and the shipped path is the tested one ───
   Issue 10 shipped twice because the browser-safe file and the chain-backed
   verifier shared one module: the dynamic fallback was a path alias Node
   cannot resolve, both production callers passed three arguments, and every
   test injected a client, so the broken path had zero coverage. These assert
   the SPLIT, not just the logic.                                             */

test("proof.ts stays browser safe: message building only, no chain access", () => {
  const src = read("lib/referrals/proof.ts");
  // The things the browser needs must live here.
  assert.match(src, /export function referralMessage/);
  // The things that would drag the RPC pool (and pg) into the client bundle
  // must not. `rpc`, `getCode`, `readContract`, `recoverAddress` all belong to
  // the server half.
  for (const marker of [/rpc\(\)/, /getCode/, /readContract/, /recoverAddress/, /import\(/]) {
    assert.doesNotMatch(src, marker, `proof.ts must not contain ${marker} — move it to verify.ts`);
  }
});

test("the server verifier lives in its own module with a static rpc import", () => {
  const src = read("lib/referrals/verify.ts");
  assert.match(src, /import \{ rpc \} from "@\/lib\/rpc\/client"/, "the rpc import must be STATIC, not dynamic");
  assert.doesNotMatch(src, /import\(/, "no dynamic import fallbacks: the first fix shipped one Node cannot resolve");
  assert.match(src, /export async function verifyWalletSignature/);
  assert.match(src, /export async function verifyReferralProof/);
  assert.match(src, /export const UNAVAILABLE_SENTENCE/);
});

test("both referral write routes import the SERVER verifier", () => {
  // If a route imports proof.ts for the verifier it either fails to typecheck
  // or, worse, gets the pre-split module back. Name the module.
  for (const route of ["app/api/referrals/bind/route.ts", "app/api/referrals/profile/route.ts"]) {
    const src = read(route);
    assert.match(src, /from "@\/lib\/referrals\/verify"/, `${route} must import from referrals/verify`);
  }
});

test("the whitelist route imports the server verifier too", () => {
  const src = read("app/api/whitelist/route.ts");
  assert.match(src, /from '@\/lib\/referrals\/verify'/);
});

test("no 'use client' module imports the server-only verifier", () => {
  // verify.ts statically imports the RPC pool. Anything "use client" that
  // imported it would put pg and the provider pool in the browser bundle — the
  // problem the alias-import hack was dodging when it broke the runtime path.
  // Scan every client module that imports anything from lib/referrals.
  const referralsDir = join(import.meta.dirname, "..", "lib", "referrals");
  const appDirs = [
    join(import.meta.dirname, "..", "app", "components", "referrals"),
    join(import.meta.dirname, "..", "app", "token-sale"),
    join(import.meta.dirname, "..", "app", "leaderboard"),
  ];
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
    );
  const files = [walk(referralsDir), ...appDirs.map(walk)].flat();
  const offenders: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!/^["']use client["']/m.test(src)) continue;
    if (/referrals\/verify/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "use client modules must not import the server verifier: use referrals/proof");
});

test("bind pre-checks the code before it asks the wallet to sign", () => {
  // The bind route can only check a code AFTER verifying the proof, so without
  // this call a typo costs a signature and comes back refused. The route's own
  // docstring claimed a hand-typed code was checked here long before anything
  // did — CLAUDE.md §8 #10, a caller that does not exist.
  const src = read(HOOK);
  const bind = src.slice(src.indexOf("const bind = useCallback"));
  assert.ok(bind.length > 0, `${HOOK} must define bind`);
  const check = bind.indexOf("fetchCode(");
  const sign = bind.indexOf('"/api/referrals/bind"');
  assert.notEqual(check, -1, "bind must pre-check the code against /api/referrals/code");
  assert.notEqual(sign, -1, "bind must POST to the bind route");
  assert.ok(check < sign, "the pre-check must run BEFORE the signature is requested");
});

test("only an unknown code stops the bind, never an unreadable one", () => {
  // `uncheckable` is a fault on OUR side. Refusing a real code because our own
  // read failed is unrecoverable once the first contribution lands (§4), so the
  // guard must key on "unknown" alone.
  const src = read(HOOK);
  const bind = src.slice(src.indexOf("const bind = useCallback"));
  const guard = bind.slice(0, bind.indexOf('"/api/referrals/bind"'));
  assert.match(guard, /kind === "unknown"/, "the pre-check guard must key on unknown");
  assert.doesNotMatch(
    guard,
    /kind === "uncheckable"/,
    "an uncheckable code must still be allowed to sign",
  );
});

test("an unverified link code prefills the field but never locks it", () => {
  // The field's value was `lockedCode ?? typed`, so a link code that came back
  // uncheckable emptied the box at the moment we said we could not check it,
  // and the user had to retype a code they may not have kept.
  const src = read(HOOK);
  const lockedStart = src.indexOf("const lockedCode = useMemo");
  assert.notEqual(lockedStart, -1, `${HOOK} must define lockedCode`);
  const locked = src.slice(lockedStart, src.indexOf(";", src.indexOf("[linkCode]", lockedStart)));
  assert.doesNotMatch(
    locked,
    /uncheckable|unknown/,
    `${HOOK} must not lock the field to a code it could not verify`,
  );
  assert.match(src, /const prefillCode = useMemo/, `${HOOK} must expose prefillCode`);

  const box = read("app/components/referrals/ReferralCodeBox.tsx");
  assert.match(
    box,
    /const value = lockedCode \?\? typed \?\? prefillCode/,
    "the field's value must fall back to the prefill",
  );
});

test("every ReferralCodeBox call site passes the prefill through", () => {
  for (const file of ["app/components/referrals/ReferralGate.tsx", "app/components/referrals/ReferralPanel.tsx"]) {
    assert.match(read(file), /prefillCode=\{/, `${file} must pass prefillCode to ReferralCodeBox`);
  }
  assert.match(
    read(SALE_PAGE),
    /prefillCode=\{referral\.prefillCode\}/,
    `${SALE_PAGE} must pass prefillCode into the gate`,
  );
});

/* ── contribution claims: squat-resistance (Defect 1) ───────────────────────
   A refused claim is proof that wallet did NOT own the tx. It must not keep
   holding the hash and locking the fast path against the real contributor.    */

test("recordContributionClaim releases a refused hash for a new claimant and locks pending/verified", async () => {
  const { recordContributionClaim } = await import("@/lib/data/sale-referrals");
  const g = globalThis as any;
  const prevUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  g.robincallsPgPool = { on: () => {} };

  const tx = "0x" + "a".repeat(64);
  const attacker = "0x1111111111111111111111111111111111111111";
  const victim = "0x2222222222222222222222222222222222222222";

  try {
    // 1. Refused row owned by attacker is reclaimed by victim
    let state = { wallet_address: attacker, verdict: "refused" };
    g.robincallsDb = {
      execute: async (q: any) => {
        const str = typeof q === "string" ? q : JSON.stringify(q);
        if (str.includes("update sale_contribution_claims")) {
          state = { wallet_address: victim, verdict: "pending" };
          return [];
        }
        return [state];
      },
    };

    const res1 = await recordContributionClaim(tx, victim);
    assert.deepEqual(res1, { kind: "recorded", verdict: "pending" }, "victim must reclaim refused row as pending");

    // 2. Pending row owned by attacker cannot be claimed by victim
    state = { wallet_address: attacker, verdict: "pending" };
    const res2 = await recordContributionClaim(tx, victim);
    assert.deepEqual(res2, { kind: "claimed-by-other" }, "pending row must not be stolen");

    // 3. Verified row owned by attacker cannot be claimed by victim
    state = { wallet_address: attacker, verdict: "verified" };
    const res3 = await recordContributionClaim(tx, victim);
    assert.deepEqual(res3, { kind: "claimed-by-other" }, "verified row must not be stolen");

    // 4. Attacker re-submitting their own refused row gets refused
    state = { wallet_address: attacker, verdict: "refused" };
    const res4 = await recordContributionClaim(tx, attacker);
    assert.deepEqual(res4, { kind: "recorded", verdict: "refused" }, "same wallet resubmitting refused stays refused");
  } finally {
    process.env.DATABASE_URL = prevUrl;
    delete g.robincallsPgPool;
    delete g.robincallsDb;
  }
});

test("recordContributionClaim wiring resets refused claims on reclaim", () => {
  const src = read("lib/data/sale-referrals.ts");
  const fn = src.slice(src.indexOf("export async function recordContributionClaim"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));

  assert.match(body, /verdict = 'refused'/, "must check for existing refused verdict");
  assert.match(body, /set wallet_address = \$\{wallet\}/, "must transfer ownership to the new claimant");
  assert.match(body, /verdict = 'pending'/, "must reset verdict to pending");
  assert.match(body, /refused_because = null/, "must clear refusal reason");
  assert.match(body, /verified_at = null/, "must ensure verified_at is null");
});

/* ── participant backfill for census-first rows (Defect 4) ─────────────────
   When the census records a participant first, first_contribution_at and tx
   are NULL. When the claim path verifies a receipt, settleFirstContributions
   must backfill both columns without weakening the guard against the census's
   over-estimated block overwriting the true block.                           */

test("settleFirstContributions candidates and update guard backfill census-first rows", () => {
  const src = read("lib/data/sale-referrals.ts");
  const fn = src.slice(src.indexOf("export async function settleFirstContributions"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));

  assert.match(
    body,
    /p\.first_contribution_at is null/,
    "candidates must include rows where first_contribution_at is null",
  );
  assert.match(
    body,
    /sale_participants\.first_contribution_at is null/,
    "update guard must permit updating rows where first_contribution_at is null",
  );
  assert.match(
    body,
    /first_contribution_at\s*=\s*coalesce\(sale_participants\.first_contribution_at,\s*excluded\.first_contribution_at\)/,
    "first_contribution_at must be backfilled from excluded",
  );
  assert.match(
    body,
    /first_contribution_tx\s*=\s*coalesce\(sale_participants\.first_contribution_tx,\s*excluded\.first_contribution_tx\)/,
    "first_contribution_tx must be backfilled from excluded",
  );
  assert.match(
    body,
    /least\(sale_participants\.first_contribution_block,\s*excluded\.first_contribution_block\)/,
    "first_contribution_block must adopt the true earliest block",
  );
});

test("recordCensusEntry backfills first_contribution_block but never overwrites it", () => {
  const src = read("lib/data/sale-referrals.ts");
  const fn = src.slice(src.indexOf("export async function recordCensusEntry"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));

  const updateSection = body.slice(body.indexOf("on conflict (wallet_address) do update"));

  // Two failures, opposite directions, and only one of them is loud.
  //
  // A bare assignment lets the census's head-at-observation block overwrite
  // the claim path's exact one. Omitting the column altogether leaves it NULL
  // for every wallet that bound a code before contributing directly — and two
  // consumers read that NULL as "has not paid": the bind freeze stays open
  // (`where first_contribution_block is null`) and issuePendingReferralCodes
  // never issues them a code. coalesce is the only form that is neither.
  assert.match(
    updateSection,
    /first_contribution_block\s*=\s*coalesce\(\s*sale_participants\.first_contribution_block,\s*excluded\.first_contribution_block\)/,
    "census on conflict must backfill first_contribution_block through coalesce",
  );
  // The census holds no receipt, so it has neither of these to offer.
  assert.doesNotMatch(
    updateSection,
    /first_contribution_at\s*=/,
    "census on conflict must never update first_contribution_at",
  );
  assert.doesNotMatch(
    updateSection,
    /first_contribution_tx\s*=/,
    "census on conflict must never update first_contribution_tx",
  );
});

test("the refunded mirror column is nullable, so 'unread' has somewhere to go", () => {
  // Comments stripped: the file EXPLAINS why it is not `not null default false`,
  // so asserting over the prose asserts the opposite of what is meant.
  // Comments stripped: the file EXPLAINS why it is not `not null default false`,
  // so asserting over the prose asserts the opposite of what is meant.
  const ddl = read("supabase/migrations/0090_referral_plane.sql").replace(/--[^\n]*/g, "");

  // Two sites, because the consolidated migration declares it in the CREATE for
  // a fresh database AND alters it in for the stack that already holds the
  // table. Both must be nullable; one of them being right is not enough.
  const inCreate = ddl.match(/refunded\s+boolean,/);
  const inAlter = ddl.match(/add column if not exists refunded boolean;/);
  assert.ok(inCreate, "the column must be declared in the create");
  assert.ok(inAlter, "the column must also be added for a table that predates it");

  for (const decl of [inCreate[0], inAlter[0]]) {
    assert.doesNotMatch(
      decl,
      /not null|default false/i,
      "a NOT NULL DEFAULT FALSE publishes a failed refunded() read as 'was not refunded'",
    );
  }
});

test("an unread refund flag is never written as 'not refunded'", () => {
  const src = read("lib/data/sale-referrals.ts");

  const census = src.slice(src.indexOf("export async function recordCensusEntry"));
  assert.doesNotMatch(
    census.slice(0, census.indexOf("\n}\n")),
    /Boolean\(args\.refunded\)/,
    "recordCensusEntry coerces an unread refunded() read into false",
  );

  const refresh = src.slice(src.indexOf("export async function refreshWalletTotals"));
  const body = refresh.slice(0, refresh.indexOf("\n}\n"));
  assert.match(
    body,
    /refunded\s*=\s*coalesce\(v\.ref,\s*t\.refunded\)/,
    "an unread refunded() read must leave the stored flag alone, not un-refund the wallet",
  );
});

test("the reconciler walks from a frontier, not a count", () => {
  const reconcileSrc = read("lib/referrals/reconcile.ts");
  assert.match(reconcileSrc, /readCensusFrontier\(\)/);

  const checkDir = (dir: string) => {
    const entries = fs.readdirSync(join(root, dir), { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        checkDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        const content = read(fullPath);
        assert.doesNotMatch(
          content,
          /\breadRecordedCensusCount\b/,
          `readRecordedCensusCount must not appear in ${fullPath}`,
        );
      }
    }
  };
  checkDir("lib");
});

test("the unreadable-sale probe is gated", () => {
  const src = read("lib/referrals/reconcile.ts");
  assert.match(src, /client\.getCode\(\{ address: sale \}\)/);
  assert.match(
    src,
    /head\.contributorCount === undefined\s*&&\s*head\.totalRaised === undefined\s*&&\s*head\.state === undefined[\s\S]{0,400}?client\.getCode/,
  );
  const matches = src.match(/client\.getCode/g);
  assert.equal(matches?.length, 1, "getCode must only be called once in reconcile.ts");
});

test("blockers reach the writer", () => {
  const snapshotSrc = read("lib/referrals/snapshot.ts");
  const dataSrc = read("lib/data/sale-referrals.ts");

  assert.match(
    snapshotSrc,
    /writeAirdropSnapshot\([\s\S]{0,500}?\bblockers\b/,
    "snapshot.ts must pass blockers into writeAirdropSnapshot",
  );

  assert.match(
    dataSrc,
    /insert into sale_airdrop_snapshots[\s\S]{0,400}?\bblockers\b/,
    "writeAirdropSnapshot must insert into blockers column",
  );
});

test("all three commission amounts reach the row, and the insert names their columns", () => {
  // §8 #1 and #10: Drizzle silently drops keys that do not match a column, and
  // a row builder that computes an amount nobody inserts typechecks, passes its
  // own unit test, and pays nobody. Assert the WIRING, not the value.
  const snapshotSrc = read("lib/referrals/snapshot.ts");
  const dataSrc = read("lib/data/sale-referrals.ts");

  for (const field of [
    "saleAllocationTokens",
    "buyerBonusTokens",
    "referredAllocationTokens",
    "referrerCommissionTokens",
    "referrerRebateWei",
  ]) {
    assert.match(
      snapshotSrc,
      new RegExp(`${field}[,:]`),
      `snapshot.ts must put ${field} on the row it writes`,
    );
  }

  const insert = /insert into sale_airdrop_snapshot_rows([\s\S]{0,600}?)values/.exec(dataSrc);
  assert.ok(insert, "writeAirdropSnapshot must still insert snapshot rows");
  for (const column of [
    "sale_allocation_tokens",
    "buyer_bonus_eligible",
    "buyer_bonus_tokens",
    "referred_allocation_tokens",
    "referrer_commission_tokens",
    "referrer_rebate_wei",
  ]) {
    assert.match(insert[1], new RegExp(`\\b${column}\\b`), `the row insert must name ${column}`);
  }
});

test("the pool-era columns are gone from every writer and reader", () => {
  // The commission design has no pool, so a share OF one is not a small stale
  // value, it is a quantity that does not exist. Leaving a writer behind would
  // insert into a column the migration drops and fail at runtime only.
  for (const file of [
    "lib/referrals/rules.ts",
    "lib/referrals/snapshot.ts",
    "lib/data/sale-referrals.ts",
    "app/api/referrals/airdrop/route.ts",
    // The standing SQL detector. It is not TypeScript, so nothing else in this
    // repo would notice it still selecting a dropped column, and ssm-psql.sh
    // runs without ON_ERROR_STOP: the sweep would print three errors, carry on,
    // and still look like a sweep (§8 #10, for a guard nobody reads).
    "scripts/referral-invariants.sql",
  ]) {
    const src = read(file);
    for (const dead of ["referral_share_bps", "referralShareBps", "draw_entrant\\b", "drawEntrant", "splitReferrerPool"]) {
      assert.doesNotMatch(src, new RegExp(dead), `${file} still references ${dead}`);
    }
  }
});

test("the payout ledger's double-payment guard is in the DATABASE, not a handler", () => {
  // Issue 44b. A uniqueness check in application code is one an operator can
  // route around by reloading mid-payout, which is exactly when it matters.
  const migration = read("supabase/migrations/0090_referral_plane.sql");
  assert.match(
    migration,
    /create table if not exists sale_referral_payments[\s\S]*?primary key \(snapshot_id, wallet_address, kind\)/,
    "sale_referral_payments must be keyed on (snapshot_id, wallet_address, kind)",
  );
  // RESTRICT, never cascade: re-running a snapshot id deletes and re-inserts it
  // (issue 6), and a cascade there would erase the record that money went out.
  assert.match(
    migration,
    /references sale_airdrop_snapshots\(id\) on delete restrict/,
    "the payment ledger must not cascade-delete with its snapshot",
  );
  // The three-state verdict, pinned. A NOT NULL here would force every unread
  // RPC to be recorded as a failed payment (§4).
  assert.doesNotMatch(
    migration,
    /chain_verified\s+boolean\s+not null/,
    "chain_verified must stay nullable: unread is not unpaid",
  );
});

test("the verification job never writes a verdict it could not read", () => {
  // §4 with money attached. writeVerificationVerdict takes a boolean, so the
  // only way to leave a payment unsettled is to NOT CALL IT. A null verdict
  // must therefore `continue` rather than fall through to the write.
  const src = read("lib/referrals/payout-verify.ts");
  assert.match(
    src,
    /if \(verdict === null\) \{[\s\S]{0,120}?continue;/,
    "an undetermined payment must skip the write, not write false",
  );
  const dataSrc = read("lib/data/sale-payouts.ts");
  assert.match(
    dataSrc,
    /verified: boolean/,
    "writeVerificationVerdict must not accept null, so absence cannot be written as a verdict",
  );
});

test("0087 is APPLIED, so the rework lands in a later file and never inside it", () => {
  // Issues 25 and 35 were both an applied migration edited in place, and both
  // would have shipped a database that silently disagreed with the one the
  // feature was tested against.
  //
  // The referral plane is two files on purpose. 0087 is committed and applied in
  // production (verified 2026-09-11: all six of its tables exist, all empty);
  // 0090 is everything it became, and was collapsed out of six uncommitted files
  // that had only ever run on the local stack. The line between them is the one
  // thing that cannot move: every column the rework introduces must appear in
  // 0090 and NOWHERE in 0087, or production ran text that no longer exists.
  const base = read("supabase/migrations/0087_sale_referrals.sql");
  const rework = read("supabase/migrations/0090_referral_plane.sql");

  const introduced = [
    "blockers",
    "final_requested",
    "sale_referral_payments",
    "sale_contribution_claims",
    "sale_wallet_totals",
    "buyer_bonus_tokens",
    "referrer_commission_tokens",
    "referrer_rebate_wei",
    "sale_allocation_tokens",
    "tokens_for_sale",
    "refunded",
  ];
  for (const name of introduced) {
    assert.doesNotMatch(base, new RegExp(`\\b${name}\\b`), `0087 is applied and must not mention ${name}`);
    assert.match(rework, new RegExp(`\\b${name}\\b`), `0090 must introduce ${name}`);
  }

  // The reverse direction, which is the one that rots quietly: 0087 still has to
  // contain the things 0090 DROPS, or the drops are aimed at nothing.
  for (const name of ["referral_bound_block", "draw_entrant", "referral_share_bps", "sale_draw_results"]) {
    assert.match(base, new RegExp(`\\b${name}\\b`), `0090 drops ${name}, which 0087 must have created`);
  }
});

test("the consolidated migration is idempotent, because it runs against a database that already has it", () => {
  // The local stack applied the six files this replaces. Under the new filename
  // the runner sees an unapplied migration and executes it against the finished
  // shape, so an unguarded CREATE or ADD COLUMN is a hard failure on the one
  // database the feature was developed against — and the failure lands mid-deploy.
  //
  // Checked per STATEMENT rather than by grepping the file, so a single guarded
  // statement cannot vouch for an unguarded sibling.
  const sql = read("supabase/migrations/0090_referral_plane.sql")
    .replace(/--[^\n]*/g, "")
    // The two DO blocks carry their own guards and contain semicolons.
    .replace(/do \$\$[\s\S]*?end \$\$;/g, "");

  for (const raw of sql.split(";")) {
    const stmt = raw.replace(/\s+/g, " ").trim().toLowerCase();
    if (!stmt) continue;
    if (stmt.startsWith("create table") || stmt.startsWith("create index") || stmt.startsWith("create unique index")) {
      assert.match(stmt, /if not exists/, `unguarded: ${stmt.slice(0, 80)}`);
    } else if (stmt.startsWith("drop ")) {
      assert.match(stmt, /if exists/, `unguarded: ${stmt.slice(0, 80)}`);
    } else if (stmt.includes("add column") || stmt.includes("drop column") || stmt.includes("drop constraint")) {
      assert.match(stmt, /if (not )?exists/, `unguarded: ${stmt.slice(0, 80)}`);
    }
  }

  // The rename has no IF EXISTS form at all, which is exactly why it is the one
  // statement wrapped in a catalog check rather than a keyword.
  assert.match(
    read("supabase/migrations/0090_referral_plane.sql"),
    /column_name = 'draw_entrant_count'[\s\S]*?rename column draw_entrant_count to buyer_bonus_count/,
    "the rename must be guarded on the old column still being there",
  );
});

test("the board cache is keyed on both tables with single-flight guard", () => {
  const src = read("lib/data/sale-referrals.ts");
  assert.match(
    src,
    /select[\s\S]*?max\(updated_at\) from sale_wallet_totals[\s\S]*?max\(updated_at\) from sale_participants/,
    "cache key read must query both sale_wallet_totals and sale_participants",
  );
  assert.match(src, /\binFlight\b/, "leaderboard module must contain an inFlight map");
  assert.match(src, /inFlight\.get\(/, "must check inFlight before running read");
});

test("a faulted board read is not cached", () => {
  const src = read("lib/data/sale-referrals.ts");
  const fn = src.slice(src.indexOf("export async function readLeaderboardCached"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(
    body,
    /if\s*\(\s*read\.kind === "found"\s*\)\s*\{[\s\S]{0,120}?cached\.set\(/,
    "cached.set must only execute on read.kind === 'found'",
  );
});

test("currentHead is called inside the census branch and not in the outer guard", () => {
  const src = read("lib/referrals/reconcile.ts");
  const frontierIdx = src.indexOf("totalNumber > frontier");
  const headCallIdx = src.indexOf("currentHead(client)", frontierIdx);
  assert.ok(frontierIdx > 0, "must check totalNumber > frontier");
  assert.ok(headCallIdx > frontierIdx, "currentHead must be called inside totalNumber > frontier branch");
  assert.doesNotMatch(
    src,
    /if\s*\(\s*count !== undefined && headBlock !== null\s*\)/,
    "outer guard must not test headBlock !== null",
  );
});

test("code issuance is set-based with fallback per-wallet loop for collisions", () => {
  const src = read("lib/data/sale-referrals.ts");
  const fn = src.slice(src.indexOf("export async function issuePendingReferralCodes"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(
    body,
    /update sale_participants[\s\S]*?from \(values/,
    "issuePendingReferralCodes must perform a batch update from (values ...)",
  );
  assert.match(
    body,
    /for\s*\(\s*let attempt = 1;\s*attempt < 8;\s*attempt\+\+\s*\)/,
    "must retain the per-wallet retry loop starting at attempt 1 for collisions",
  );
});

test("saleIndexerCursor is removed from schema and no migration contains drop table", () => {
  const schemaSrc = read("lib/db/schema.ts");
  assert.doesNotMatch(schemaSrc, /\bsaleIndexerCursor\b/, "saleIndexerCursor must not be declared in lib/db/schema.ts");

  const files = [
    "lib/db/schema.ts",
    "lib/data/sale-referrals.ts",
    "lib/referrals/reconcile.ts",
    "lib/referrals/census.ts",
    "lib/referrals/contribution.ts",
    "lib/referrals/snapshot.ts",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /\bsaleIndexerCursor\b/, `${file} must not reference saleIndexerCursor`);
  }

  // The table stays. Nothing reads it and nothing writes it, but 0087 is the
  // historical record and its rows are the only trace of what the walker saw.
  // Scoped to THIS table: 0090 does drop `sale_draw_results`, deliberately.
  const referralMigrations = [
    "supabase/migrations/0087_sale_referrals.sql",
    "supabase/migrations/0090_referral_plane.sql",
  ];
  for (const m of referralMigrations) {
    assert.doesNotMatch(read(m), /drop\s+table\s+(if exists\s+)?sale_indexer_cursor/i, `${m} must not drop sale_indexer_cursor`);
  }
});
