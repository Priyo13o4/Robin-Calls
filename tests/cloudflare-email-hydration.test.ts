import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Cloudflare rewrites an email address in served HTML to "[email protected]", so React's hydration sees
// different text and throws #418 on every page carrying it. Break the address across elements.
const EMAIL_IN_TEXT = />[^<{}]*[\w.+-]+@[\w-]+\.[a-z]{2,}[^<{}]*</i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

test("no rendered text holds a whole email address for Cloudflare to rewrite", () => {
  const files = walk(fileURLToPath(new URL("../app", import.meta.url)));
  assert.ok(files.length > 50, "found the app's components");
  assert.match("<a> social@robincalls.com</a>", EMAIL_IN_TEXT, "control: the old footer shape is caught");
  const hits = files.filter((f) => EMAIL_IN_TEXT.test(readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
});
