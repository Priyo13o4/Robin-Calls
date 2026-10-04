import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// §8 #9: with no database every band read returns its empty default, so the band
// must be told whether it looked, or it publishes "0" and "nothing crossed" as facts.
const root = join(import.meta.dirname, "..");
const band = readFileSync(join(root, "app/components/site/landing/NightMarketSection.tsx"), "utf8");
const page = readFileSync(join(root, "app/page.tsx"), "utf8");

test("the landing page tells the band whether the database is configured", () => {
  assert.match(page, /<NightMarketSection[\s\S]*?measured=\{isDatabaseConfigured\(\)\}[\s\S]*?\/>/);
});

test("an unmeasured band shows a placeholder, not zero tiles or an empty-market claim", () => {
  assert.match(band, /measured && t\.value !== null \? t\.value\.toLocaleString\("en-US"\) : "—"/);
  const claim = "Nothing has crossed the traction threshold right now.";
  assert.equal(band.split(claim).length - 1, 1, "extracted the empty-market sentence exactly once");
  assert.match(band, new RegExp(`measured\\s*\\?\\s*"${claim.replace(/\./g, "\\.")}"`));
});
