import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// React #418 on /night-market: state initializers read sessionStorage, so a revisit's first
// client render differed from the server HTML. Saved values must be restored in an effect.
test("NightMarketClient never reads storage in a useState initializer", () => {
  const src = readFileSync("app/night-market/NightMarketClient.tsx", "utf8");
  const inits = src.match(/useState<[^>]*>\([^;]*\);/g) ?? [];
  assert.ok(inits.length > 10, "extracted the state declarations");
  for (const init of inits) {
    assert.doesNotMatch(init, /getSaved|sessionStorage|localStorage|window\./, init);
  }
  assert.match(src, /useEffect\(\(\) => \{\s*setPrimaryTab\(getSavedInitialTab\(\)\);/);
});
