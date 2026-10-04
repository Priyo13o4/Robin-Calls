import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A launchpad card must never link to a URL we invented.
 *
 * `launchpadUrl` fell back to `https://${slug}`. A slug is an internal key, not
 * a hostname, so a pad shipped without a config produced **`https://ponsv2`** —
 * and every Pons V2 card on the Night Market carried it. §4 in the UI layer: the
 * unknown became a confident answer, and here the answer is something the
 * reader is invited to click.
 */
const root = join(import.meta.dirname, "..");
const src = readFileSync(join(root, "app/components/site/NightMarketTabs.tsx"), "utf8");
const fn = src.slice(src.indexOf("function launchpadUrl"), src.indexOf("function dexMarketUrl"));

test("launchpadUrl returns null rather than building a URL from the slug", () => {
  assert.ok(fn.includes("): string | null"), "must be able to say 'I don't know'");
  assert.ok(fn.trimEnd().endsWith("return null;\n}") || fn.includes("\n  return null;\n}"));
  assert.ok(!fn.includes("`https://${row.launchpad_slug"), "the invented-host fallback is back");
  assert.ok(!/https:\/\/\$\{/.test(fn), "no template-built host of any shape");
});

test("the card renders no link when the URL is unknown", () => {
  // The guard is what turns a null into an absent link instead of href={null}.
  assert.ok(src.includes("{row.launchpad_name && padUrl && ("));
  assert.ok(src.includes("href={padUrl}"));
});

test("a configured template still wins, and the website is the fallback", () => {
  assert.ok(fn.includes('template.replace("{token}", row.token_address)'));
  assert.ok(fn.includes("/^https?:\\/\\//i.test(website)"), "a website must be a real absolute URL");
});

test("the migration only fills an EMPTY config, so an operator edit survives", () => {
  const m = readFileSync(join(root, "supabase/migrations/0063_ponsv2_token_page.sql"), "utf8");
  assert.ok(m.includes("coalesce(config->>'tokenUrlTemplate', '') = ''"));
  assert.ok(m.includes("ponsfamily.com/launchpad/{token}"));
  // stonksafe stays empty on purpose — unverified front end, and empty is now safe.
  assert.ok(!m.includes("stonksafe'"), "stonksafe must not get a guessed URL");
});
