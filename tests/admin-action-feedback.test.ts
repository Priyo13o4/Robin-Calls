import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every admin mutation reports back, and the sale address stays off the public
 * site.
 *
 * Two separate bugs, both silent:
 *
 *  1. `<form action={serverAction}>` renders nothing on success, so an operator
 *     pressing SAVE saw no difference between a write that landed and a dead
 *     button. And Next REDACTS the message of an uncaught Server Action error
 *     in production, so the validation text was the exact part stripped: the
 *     action has to RETURN its failure, not throw it past the boundary.
 *  2. The public sale page printed the sale contract address in its fine print.
 */

const adminDir = join(process.cwd(), "app", "admin", "(dashboard)");
const sections = readdirSync(adminDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

test("every admin action a form submits returns a result instead of throwing past the boundary", () => {
  let checked = 0;
  for (const name of sections) {
    let src: string;
    try {
      src = readFileSync(join(adminDir, name, "actions.ts"), "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(/export async function (\w+)\(([^)]*)\)(:[^{]*)?\{/g)) {
      const [, fn, , ret] = m;
      // saveTrustedAddressAction predates this and reports through
      // useActionState's own FormState, rendered inline by its form.
      if (fn === "saveTrustedAddressAction") continue;
      checked += 1;
      assert.match(
        ret ?? "",
        /Promise<(ActionResult|\{ ok: true)/,
        `${name}/actions.ts: ${fn} does not return a result, so its failure text is redacted in production`,
      );
    }
  }
  assert.ok(checked >= 20, `expected to check most admin actions, only saw ${checked}`);
});

test("no admin mutation form is left on the bare <form action={…}> path", () => {
  for (const name of sections) {
    let files: string[];
    try {
      files = readdirSync(join(adminDir, name)).filter((f) => f.endsWith(".tsx"));
    } catch {
      continue;
    }
    for (const f of files) {
      const src = readFileSync(join(adminDir, name, f), "utf8");
      for (const m of src.matchAll(/<form\b([^>]*)>/g)) {
        const attrs = m[1];
        // A GET form is a filter, not a mutation: nothing to report.
        if (/method="get"/.test(attrs)) continue;
        // useActionState forms carry their own inline feedback.
        if (/action=\{action\}/.test(attrs)) continue;
        assert.fail(`${name}/${f}: a mutating <form> is not an ActionForm, so its result is invisible`);
      }
    }
  }
});

test("the public sale page never prints the sale contract address", () => {
  const page = readFileSync(join(process.cwd(), "app", "token-sale", "SalePageClient.tsx"), "utf8");
  assert.doesNotMatch(page, /shortAddr\(contract\)/, "the sale address is being rendered again");
  assert.doesNotMatch(
    page,
    /\/address\/\$\{contract\}/,
    "an explorer link to the sale contract is back on the public page",
  );
  assert.doesNotMatch(page, /FINE PRINT/, "the fine print block that carried the address is back");
});
