import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", p), "utf8");

test("WIRING: ledger rows get the launch's stored icon on the first page and on every fetched page", () => {
  const route = read("app/api/ledger/route.ts");
  assert.match(route, /launchIconsForTokens\(entries\.map/);
  assert.match(route, /pools, icons \}/, "the API returns icons");
  assert.match(read("app/ledger/page.tsx"), /initialIcons=\{icons\}/);
  const feed = read("app/components/site/LedgerFeed.tsx");
  const icon = feed.slice(feed.indexOf("<TokenIcon"), feed.indexOf("/>", feed.indexOf("<TokenIcon")));
  assert.ok(icon.length > 0, "found the ledger TokenIcon");
  assert.match(icon, /metadataUri=\{icons\[e\.token_address\.toLowerCase\(\)\] \?\? null\}/);
  assert.equal(feed.match(/addIcons\(page\.icons\)/g)?.length, 2, "search and load-more both merge icons");
});
