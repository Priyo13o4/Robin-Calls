import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The static-media `headers()` rules in next.config.ts cache for a week. A rule
 * that also matched a PAGE route would freeze that page in every browser that
 * loaded it, with nothing failing at build or deploy to say so — the shape §8
 * is about. Two properties hold the line, and both are cheap to lose in an edit.
 */
const config = readFileSync("next.config.ts", "utf8");

const sources = [...config.matchAll(/\{ source: "([^"]+)", headers:/g)].map((m) => m[1]);

test("every static-media rule is one-or-more, so it cannot match its bare prefix", () => {
  assert.ok(sources.length > 0, "found no header rules — the regex above stopped matching");
  for (const s of sources) {
    assert.ok(
      s.endsWith("/:file+"),
      `${s} must end in /:file+ — :file* also matches the prefix itself, which is a page route for at least one of these`,
    );
  }
});

test("no static-media rule shadows a directory that is a page route on its own", () => {
  // `/tokenomics` is a page; only the art subtree under it may be cached hard.
  assert.ok(
    !sources.includes("/tokenomics/:file+"),
    "/tokenomics is a page route — scope the rule to /tokenomics/city/:file+",
  );
});
