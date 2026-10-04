import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_ACCENT } from "../app/components/site/landing/palette";
import { NAV_ACCENTS } from "../app/components/site/AppSidebar";

const root = join(import.meta.dirname, "..");
const SIDEBAR_PATH = "app/components/site/AppSidebar.tsx";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

test("the comment stripper works before tests rely on it", () => {
  const sample = "const x = 1; /* block comment */\n// line comment\nconst y = \"keep\";";
  const stripped = stripComments(sample);
  assert.ok(!stripped.includes("/* block comment */"), "block comment must be stripped");
  assert.ok(!stripped.includes("// line comment"), "line comment must be stripped");
  assert.ok(stripped.includes('"keep"'), "string literal must survive stripping");
});

test("NAV_ACCENTS extracts at least 10 hrefs and maps landing page product colours", () => {
  const rawSrc = readFileSync(join(root, SIDEBAR_PATH), "utf8");
  const src = stripComments(rawSrc);

  const mapMatch = src.match(/const\s+NAV_ACCENTS[^{]*\{([\s\S]*?)\};/);
  assert.ok(mapMatch, "NAV_ACCENTS definition must exist in AppSidebar.tsx");
  const body = mapMatch[1];

  const extractedEntries = new Map<string, string>();
  const entryRegex = /(["'](\/[a-z0-9-]+)["'])\s*:\s*([^,\n}]+)/g;
  for (const m of body.matchAll(entryRegex)) {
    extractedEntries.set(m[2], m[3].trim());
  }

  // CLAUDE.md section 8 #22: assert the extraction found the nav link list before asserting properties
  assert.ok(
    extractedEntries.size >= 10,
    `Extraction must find at least 10 nav link hrefs, found ${extractedEntries.size}`,
  );

  const productChecks: Array<{ href: string; prop: string }> = [
    { href: "/wanted", prop: "PRODUCT_ACCENT.wanted" },
    { href: "/night-market", prop: 'PRODUCT_ACCENT["night-market"]' },
    { href: "/rwa", prop: "PRODUCT_ACCENT.rwa" },
    { href: "/ledger", prop: "PRODUCT_ACCENT.ledger" },
    { href: "/ecosystem", prop: "PRODUCT_ACCENT.ecosystem" },
  ];

  for (const { href, prop } of productChecks) {
    const rawVal = extractedEntries.get(href);
    assert.ok(rawVal, `Expected entry for ${href}`);
    assert.ok(
      rawVal.includes(prop) || rawVal.includes(prop.replace(/"/g, "'")),
      `Entry for ${href} must reference ${prop} in source, found: ${rawVal}`,
    );
    assert.doesNotMatch(
      rawVal,
      /#[0-9a-fA-F]{3,8}/,
      `Entry for ${href} must not copy a hex literal directly, found: ${rawVal}`,
    );
  }

  assert.match(
    extractedEntries.get("/tokenomics") ?? "",
    /#ccff00/i,
    "Entry for /tokenomics must resolve to #ccff00",
  );
  assert.match(
    extractedEntries.get("/token-sale") ?? "",
    /#ccff00/i,
    "Entry for /token-sale must resolve to #ccff00",
  );

  assert.equal(NAV_ACCENTS["/wanted"], PRODUCT_ACCENT.wanted);
  assert.equal(NAV_ACCENTS["/night-market"], PRODUCT_ACCENT["night-market"]);
  assert.equal(NAV_ACCENTS["/rwa"], PRODUCT_ACCENT.rwa);
  assert.equal(NAV_ACCENTS["/ledger"], PRODUCT_ACCENT.ledger);
  assert.equal(NAV_ACCENTS["/ecosystem"], PRODUCT_ACCENT.ecosystem);
  assert.equal(NAV_ACCENTS["/tokenomics"], "#ccff00");
  assert.equal(NAV_ACCENTS["/token-sale"], "#ccff00");

  assert.equal(NAV_ACCENTS["/overview"], undefined);
  assert.equal(NAV_ACCENTS["/methodology"], undefined);
  assert.equal(NAV_ACCENTS["/compare"], undefined);
});

test("no template-literal Tailwind colour classes exist in AppSidebar.tsx", () => {
  const rawSrc = readFileSync(join(root, SIDEBAR_PATH), "utf8");
  const src = stripComments(rawSrc);

  assert.doesNotMatch(src, /text-\[\$\{/, "file must not contain template-literal text-[${...}] class");
  assert.doesNotMatch(src, /bg-\[\$\{/, "file must not contain template-literal bg-[${...}] class");
  assert.doesNotMatch(src, /border(-\w+)?-\[\$\{/, "file must not contain template-literal border-[${...}] class");
});

test("SidebarItem wiring: applies CSS variable and uses literal class strings", () => {
  const rawSrc = readFileSync(join(root, SIDEBAR_PATH), "utf8");
  const src = stripComments(rawSrc);

  assert.match(
    src,
    /--nav-accent/,
    "AppSidebar.tsx must define or use the --nav-accent CSS variable",
  );
  assert.match(
    src,
    /text-\[var\(--nav-accent\)\]/,
    "AppSidebar.tsx must use literal text-[var(--nav-accent)] class",
  );
  assert.match(
    src,
    /border-l-\[var\(--nav-accent\)\]/,
    "AppSidebar.tsx must use literal border-l-[var(--nav-accent)] class",
  );
  assert.match(
    src,
    /hover:text-\[var\(--nav-accent\)\]/,
    "AppSidebar.tsx must use literal hover:text-[var(--nav-accent)] class on the link",
  );
  assert.match(
    src,
    /focus-visible:text-\[var\(--nav-accent\)\]/,
    "AppSidebar.tsx must use literal focus-visible:text-[var(--nav-accent)] class on the link",
  );
});
