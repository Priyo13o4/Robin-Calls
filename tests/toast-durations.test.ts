import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Which toasts are allowed to count themselves down.
 *
 * The progress bar is not decoration — it is a promise that the row will be
 * gone when it empties. So it may only appear on a toast whose disappearance is
 * correct, and that is exactly the set whose condition has already resolved.
 *
 * The bug this pins: the "waiting for the chain to confirm it" row was raised
 * with a bare `toast({ variant: "loading" })`, which inherits the 5s default and
 * `showProgress: true`. It drew a countdown that had nothing to do with the
 * transaction and then dismissed itself, while `waitForTransactionReceipt` had
 * up to 60s still to run — so a pending transaction spent most of its life with
 * nothing on screen. `toast.loading` already existed with the right defaults
 * (`duration: null`, no bar) and simply was not the function being called.
 *
 * Source-text, because the claim is about which call form each site uses.
 */

const panel = readFileSync(
  join(process.cwd(), "app", "admin", "(dashboard)", "token-sale", "TokenSalePanel.tsx"),
  "utf8",
);
const salePage = readFileSync(
  join(process.cwd(), "app", "token-sale", "SalePageClient.tsx"),
  "utf8",
);
const store = readFileSync(join(process.cwd(), "components", "ui", "use-toast.ts"), "utf8");
const toastUi = readFileSync(join(process.cwd(), "components", "ui", "toast.tsx"), "utf8");

/**
 * The object literal that encloses `idx`, by brace matching.
 *
 * Slicing to the next `);` was wrong twice over: a template literal's own
 * `${...}` braces truncated the match, and a ternary's success branch ran on
 * into the destructive branch and borrowed ITS `duration: null`. Only the
 * literal that actually carries the variant can answer for it.
 */
function enclosingObject(src: string, idx: number): string {
  let depth = 0;
  let open = -1;
  for (let i = idx; i >= 0; i--) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) { open = i; break; }
      depth--;
    }
  }
  if (open === -1) return "";
  depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** Every toast object literal carrying `variant: "<name>"`. */
function toastsWithVariant(variant: string): string[] {
  const out: string[] = [];
  const needle = `variant: "${variant}"`;
  let i = panel.indexOf(needle);
  while (i !== -1) {
    out.push(enclosingObject(panel, i));
    i = panel.indexOf(needle, i + 1);
  }
  return out;
}

test("the store still defaults to an auto-dismissing toast with a bar", () => {
  // The premise of everything below. If these defaults change, the call sites
  // that rely on them silently change meaning.
  assert.match(store, /duration: options\.duration === undefined \? 5000 : options\.duration/);
  assert.match(store, /showProgress: options\.showProgress \?\? true/);
});

test("toast.loading pins itself open and draws no bar", () => {
  // The declaration wraps across lines, so take the whole statement.
  const start = store.indexOf("toast.loading =");
  assert.ok(start !== -1, "toast.loading no longer exists");
  const decl = store.slice(start, store.indexOf(");", start));
  assert.match(decl, /duration: o\.duration \?\? null/, "a loading toast must not inherit the 5s default");
  assert.match(decl, /showProgress: false/, "a loading toast has no deadline, so it must draw no bar");
});

test("the bar only renders for a real, finite countdown", () => {
  // A bar with no duration behind it would be a promise nothing keeps.
  assert.match(
    toastUi,
    /showProgress && duration !== null && duration > 0/,
    "the progress bar must be gated on an actual duration",
  );
});

test("the pending-transaction toast never counts itself down", () => {
  // The regression, named. A bare toast({variant:"loading"}) here reintroduces
  // a 5s self-dismiss over a 60s wait.
  assert.doesNotMatch(
    panel,
    /toast\(\{[^}]*variant: "loading"/,
    'the pending-tx row is using the raw toast() form again — it will inherit the 5s default',
  );
  assert.match(panel, /toast\.loading\(/, "the pending-tx row must go through toast.loading");
});

/**
 * Refined 2026-09-08. The rule used to be "every destructive toast is pinned",
 * which was safe but made the operator dismiss every rejected signature by
 * hand. The sharper rule is about what we KNOW: a failure may count itself down
 * only when the transaction is known never to have left. A timeout or a dropped
 * connection can land after the broadcast, so those notices say "check the
 * explorer" and must stay up. `Failure.settled` in lib/wallet/failure.ts is the
 * single place that decides, and it is decided beside the sentence so the two
 * can never drift apart.
 */
test("a failure may only count down when it is known to be closed", () => {
  const risky = [...toastsWithVariant("destructive"), ...toastsWithVariant("warning")];
  assert.ok(risky.length >= 5, `expected several failure toasts, found ${risky.length}`);

  for (const t of risky) {
    // Omitting it entirely is the original bug: silent inheritance of the 5s
    // default onto a row that should have outlived it.
    assert.match(t, /duration:/, `a failure toast states no duration: ${t.slice(0, 90)}`);

    const pinned = /duration: null/.test(t);
    const oneShot = /duration: ONE_SHOT_MS/.test(t);
    const conditional = /duration: [A-Za-z.]*[Ss]ettled \? ONE_SHOT_MS : null/.test(t);
    assert.ok(
      pinned || oneShot || conditional,
      `a failure toast must be pinned, ONE_SHOT_MS, or gated on settled: ${t.slice(0, 110)}`,
    );

    // A hand-picked number here would drift from ONE_SHOT_MS and, worse, would
    // be chosen without asking whether the transaction might have landed.
    assert.doesNotMatch(t, /duration: \d/, `a failure toast hardcodes a duration: ${t.slice(0, 90)}`);
  }
});

test("anything that might already be on chain stays up until dismissed", () => {
  // Named by their copy, because these two are the cases where a countdown
  // would be a false all-clear about someone's money rather than a UI nit.
  for (const needle of [
    "The chain rejected this transaction",
    "we stopped waiting before the chain confirmed",
  ]) {
    const i = panel.indexOf(needle);
    assert.ok(i !== -1, `copy moved, update this test: ${needle}`);
    assert.match(
      enclosingObject(panel, i),
      /duration: null/,
      `"${needle}" may have landed on chain, so it must not auto-dismiss`,
    );
  }
});

test("the one-shot window is a shared constant, not a number per call site", () => {
  assert.match(store, /export const ONE_SHOT_MS = 10_000;/, "ONE_SHOT_MS is gone or changed shape");
});

/* ── the contribute flow's six moments (SalePageClient) ─────────────────────
   The old flow wrote an inline notice box. The moments are policy, not
   decoration: a countdown under a wait that has not resolved is a promise the
   page cannot keep, and "nothing was charged" is only true when the tx never
   left the wallet.                                                          */

/** Every toast call in sendTx, by moment, using the brace-matched literal. */
function saleToastAt(needle: string): string {
  const i = salePage.indexOf(needle);
  assert.ok(i !== -1, `copy moved, update this test: ${needle}`);
  return enclosingObject(salePage, i);
}

test("the wallet-prompt toast is pinned and draws no bar", () => {
  // toast.loading carries duration:null and no bar by construction (pinned
  // by the store tests above), so the page only has to USE that form.
  const i = salePage.indexOf("Confirm this in your wallet");
  assert.ok(i !== -1, "copy moved, update this test");
  assert.match(
    salePage.slice(Math.max(0, i - 120), i),
    /toast\.loading\(\s*`$/,
    "the prompt must go through toast.loading, never a raw toast() form",
  );
});

test("the signed-and-waiting toast goes through toast.loading", () => {
  // A bare toast({variant:"loading"}) inherits the 5s default — the exact
  // regression the admin panel already shipped once.
  assert.match(salePage, /toast\.loading\(/, "the waiting row must use toast.loading");
  assert.doesNotMatch(salePage, /toast\(\{[^}]*variant: "loading"/, "no raw loading toast form");
});

test("the confirmed toast is the only one-shot with a bar", () => {
  const t = saleToastAt("confirmed.");
  assert.match(t, /duration: ONE_SHOT_MS/, "a resolved success may count down");
});

test("a rejected send counts down only when known never broadcast", () => {
  const t = saleToastAt("awaitingSendError.current = false");
  assert.match(
    t,
    /duration: wallet\.errorSettled \? ONE_SHOT_MS : null/,
    "the duration must be gated on settled, not assumed",
  );
});

test("a failed send reads the wallet's FRESH error, never the pre-send copy", () => {
  // sendTx closes over this render's `wallet`; after the await its error is the
  // stale pre-send value, so the rejection reason never showed and the generic
  // row pinned open. The toast must come from an effect on wallet.error.
  const start = salePage.indexOf("const sendTx = useCallback(");
  assert.ok(start !== -1, "sendTx moved, update this test");
  const body = salePage.slice(start, salePage.indexOf("[configured, contract, client, wallet", start));
  assert.ok(body.includes("wallet.sendTransaction"), "extracted the wrong span");
  assert.doesNotMatch(body, /toast\.error\(wallet\.error/, "sendTx must not read wallet.error after the await");
  assert.match(body, /awaitingSendError\.current = true/, "sendTx must hand the failure to the effect");
  assert.match(
    salePage,
    /useEffect\(\(\) => \{\s*if \(!awaitingSendError\.current \|\| !wallet\.error\) return;/,
    "the effect must fire on the hook's fresh error",
  );
});

test("the reverted-on-chain toast is pinned — gas was spent", () => {
  const t = saleToastAt("Gas was spent");
  assert.match(t, /duration: null/, "a reverted tx spent gas; the row must not time out");
  // And the old lie must not come back.
  assert.doesNotMatch(salePage, /Nothing was charged beyond gas/);
});

test("the wait-timeout toast is pinned — the tx may still land", () => {
  const t = saleToastAt("Still confirming");
  assert.match(t, /duration: null/, "a timed-out wait is not a failed transaction");
  assert.match(salePage, /It may still go through/);
});

test("a resolved success DOES auto-dismiss, so the bar keeps its meaning", () => {
  // The other direction: if everything were pinned open, the operator would be
  // dismissing rows by hand forever and the bar would never be seen at all.
  const success = toastsWithVariant("success");
  assert.ok(success.length >= 1, "no success toast found");
  for (const t of success) {
    assert.doesNotMatch(t, /duration: null/, `a success toast should time out: ${t.slice(0, 90)}`);
  }
});
