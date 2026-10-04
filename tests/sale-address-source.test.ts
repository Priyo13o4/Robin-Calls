import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sale address has ONE source: site_config. A `TOKEN_SALE_ADDRESS` env
 * fallback used to sit behind it and was removed 2026-09-08 for two reasons
 * worth keeping written down, because both look like features until they bite:
 *
 *  1. It could not express "no sale configured". Clearing the DB row is how an
 *     operator says that, and a set env answered with an address anyway — the
 *     §8 #9 shape, where the absent value and the empty one are the same thing
 *     to the caller.
 *  2. Changing it needed a redeploy, which is precisely what a runtime config
 *     row exists to avoid.
 */

const src = readFileSync(join(process.cwd(), "lib", "sale", "address.ts"), "utf8");
const panel = readFileSync(
  join(process.cwd(), "app", "admin", "(dashboard)", "token-sale", "TokenSalePanel.tsx"),
  "utf8",
);
const action = readFileSync(
  join(process.cwd(), "app", "admin", "(dashboard)", "token-sale", "actions.ts"),
  "utf8",
);

test("the sale address is never read from an env var", () => {
  assert.doesNotMatch(
    src,
    /process\.env\.TOKEN_SALE_ADDRESS/,
    "the env fallback is back — a set env makes an unpublished sale look published",
  );
});

test("the three-way resolution survives, so an unreadable DB is not an unset address", () => {
  // §8 #9: "we could not look" and "nothing is set" must stay distinguishable,
  // or the panel reports a config problem when the real fault is the database.
  for (const kind of ["unavailable", "unconfigured"]) {
    assert.match(src, new RegExp(`kind: "${kind}"`), `the "${kind}" state is gone`);
  }
});

test("publishing the address revalidates the PUBLIC page, not just the panel", () => {
  // The key this action writes is the one /token-sale resolves. Revalidating
  // only the admin route would leave visitors on the previous contract.
  assert.match(action, /revalidatePath\("\/token-sale"\)/, "the public sale page is not revalidated on publish");
  assert.match(action, /requireAdmin/, "the publish action is unguarded");
});

test("the panel says when its target differs from the published address", () => {
  // The field is also the `to:` of every write, so a silent divergence sends
  // real transactions to a contract the live site knows nothing about.
  assert.match(panel, /const divergent =/, "the divergence check is gone");
  assert.match(
    panel,
    /The public sale page still uses/,
    "the panel no longer names the address visitors actually see",
  );
});
