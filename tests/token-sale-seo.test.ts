import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SALE_FAQ } from "../lib/sale/faq";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("token sale teaser: renders no zeroed sale numbers or unmeasured figures", () => {
  const teaser = read("app/token-sale/SaleTeaser.tsx");

  // CLAUDE.md §8 #3: a zero is a claim, not missing data.
  // The teaser must never display unmeasured raise figures or counts.
  assert.doesNotMatch(teaser, /0\.000/, "teaser must not contain 0.000");
  assert.doesNotMatch(teaser, /\b0\s+ETH\b/i, "teaser must not contain 0 ETH");
  assert.doesNotMatch(teaser, /Raised so far/i, "teaser must not say Raised so far");
  assert.doesNotMatch(teaser, /contributor/i, "teaser must not render contributor counts");
  assert.doesNotMatch(teaser, /progress/i, "teaser must not render a progress bar");

  // Also verify TokenSection flag-off branch deleted the fake number.
  const tokenSection = read("app/components/site/landing/TokenSection.tsx");
  assert.doesNotMatch(tokenSection, /0\.000/, "TokenSection must not render 0.000");
  assert.doesNotMatch(tokenSection, /Raised so far/i, "TokenSection must not say Raised so far");
});

test("token sale page: renders teaser without calling notFound when flag is off", () => {
  const page = read("app/token-sale/page.tsx");

  // The flag-off path must render SaleTeaser, not throw 404.
  assert.match(page, /if \(!flags\.tokenSale\) return <SaleTeaser \/>;/, "must return SaleTeaser when tokenSale is off");
  assert.doesNotMatch(page, /if \(!flags\.tokenSale\) notFound\(\);/, "must not call notFound on flag-off path");

  // The teaser path must not trigger contract resolution or cached RPC snapshot reads.
  const fnStart = page.indexOf("export default async function TokenSalePage");
  assert.ok(fnStart !== -1, "TokenSalePage function must exist");
  const body = page.slice(fnStart);
  const teaserReturnIdx = body.indexOf("return <SaleTeaser");
  const rpcCallIdx = body.indexOf("readSaleSnapshotCached");
  assert.ok(teaserReturnIdx !== -1, "return <SaleTeaser /> must exist in function body");
  assert.ok(rpcCallIdx !== -1, "readSaleSnapshotCached must exist in function body");
  assert.ok(teaserReturnIdx < rpcCallIdx, "teaser return must precede RPC reads in function body");
});

/**
 * Count RENDERED h1 elements, not the string "<h1".
 *
 * This distinction is the whole test. `/tokenomics` carries a comment that
 * literally reads "Not a second <h1>", written to stop someone miscounting.
 * A naive string count reads that comment as a second heading, reports two,
 * and the obvious "fix" is to edit the comment until the count agrees — which
 * deletes the note explaining the trap and changes no markup at all. Both of
 * those happened before this test existed.
 */
function countH1(src: string): number {
  const withoutComments = src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/^\s*\/\/.*$/gm, ""); // line comments
  return (withoutComments.match(/<h1[\s>]/g) ?? []).length;
}

test("h1 elements: exactly one rendered h1 in the teaser and in tokenomics", () => {
  const teaser = read("app/token-sale/SaleTeaser.tsx");
  // §8 #22: prove the counter works before trusting a count of 1.
  assert.equal(countH1("<h1>a</h1>"), 1, "countH1 cannot count a plain h1");
  assert.equal(countH1("{/* not a second <h1> */}"), 0, "countH1 counts commented markup");

  assert.equal(countH1(teaser), 1, "the teaser must have exactly one h1");
  assert.match(teaser, /<h1[^>]*>[\s\S]*?The RobinCalls token sale[\s\S]*?<\/h1>/);

  const tokenomics = read("app/tokenomics/page.tsx");
  assert.equal(countH1(tokenomics), 1, "tokenomics must have exactly one h1");
  assert.match(tokenomics, /<h1[^>]*>[\s\S]*?TOKEN[\s\S]*?OMICS[\s\S]*?<\/h1>/);
});

test("SALE_FAQ: extracted entries are non-empty and capture the full FAQ", () => {
  // §8 #22: assert the extraction found something before asserting properties on it.
  assert.ok(Array.isArray(SALE_FAQ), "SALE_FAQ must be an array");
  // SalePageClient.tsx defines 14 Q&A pairs (3 sale, 6 referral, 5 custody).
  assert.ok(SALE_FAQ.length >= 13, `expected at least 13 FAQ items, found ${SALE_FAQ.length}`);
  assert.equal(SALE_FAQ.length, 14, `expected 14 FAQ items, found ${SALE_FAQ.length}`);

  // Check known sample questions to prove content is present and not blank.
  const samplePrice = SALE_FAQ.find((f) => f.q.includes("find out my price"));
  assert.ok(samplePrice, "price question must be present");
  assert.ok(samplePrice.a.includes("At the close"), "price answer must be verbatim");

  const sampleRefund = SALE_FAQ.find((f) => f.q.includes("abandoned"));
  assert.ok(sampleRefund, "abandoned/refund question must be present");
  assert.ok(sampleRefund.a.includes("Every wei goes back"), "refund answer must be verbatim");

  for (const item of SALE_FAQ) {
    assert.ok(item.q && item.q.trim().length > 0, `empty question found: ${JSON.stringify(item)}`);
    assert.ok(item.a && item.a.trim().length > 0, `empty answer found for: ${item.q}`);
  }
});

test("FAQPage JSON-LD: entry count matches SALE_FAQ.length", () => {
  const teaser = read("app/token-sale/SaleTeaser.tsx");

  assert.match(teaser, /"@type":\s*"FAQPage"/, "must emit FAQPage schema");
  assert.match(teaser, /mainEntity:\s*SALE_FAQ\.map\(/, "mainEntity must map over SALE_FAQ");
  assert.match(teaser, /"@type":\s*"Question"/, "mainEntity must contain Question");
  assert.match(teaser, /"@type":\s*"Answer"/, "mainEntity must contain Answer");
});

/**
 * A sitemap entry and a robots directive have to agree. Listing a URL tells a
 * crawler to come and fetch it; `noindex` tells it to leave again. Shipping
 * both is a wasted crawl and a contradictory signal, so these are asserted
 * together rather than in two places that can drift apart.
 */
test("sitemap and robots agree: only indexable pages are listed", () => {
  const sitemapSrc = read("app/sitemap.ts");

  // /token-sale is indexed in BOTH states (teaser and live), so it is listed.
  assert.match(sitemapSrc, /\["\/token-sale",\s*"weekly",\s*0\.7\]/, "/token-sale must be in ROUTES");
  assert.match(
    read("app/token-sale/page.tsx"),
    /robots: \{ index: true, follow: true \}/,
    "/token-sale is in the sitemap, so it must be indexable",
  );

  // /tokenomics is deliberately noindex until a real contract exists to crawl,
  // so it must NOT be listed. Flipping that is an operator decision; when it
  // flips, both halves of this assertion change together.
  assert.doesNotMatch(sitemapSrc, /"\/tokenomics"/, "/tokenomics is noindex, so it must not be in the sitemap");
  assert.match(
    read("app/tokenomics/page.tsx"),
    /robots: \{ index: false, follow: false \}/,
    "/tokenomics must stay noindex while it is absent from the sitemap",
  );

  // /leaderboard is a ranked list of wallet addresses. Permanently neither.
  assert.doesNotMatch(sitemapSrc, /"\/leaderboard"/, "/leaderboard must never appear in sitemap");
  assert.match(read("app/leaderboard/page.tsx"), /robots: \{ index: false, follow: false \}/);
});

test("leaderboard metadata: permanently noindex", () => {
  const leaderboard = read("app/leaderboard/page.tsx");

  assert.match(leaderboard, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(leaderboard, /Permanently noindex/, "must include comment documenting permanent noindex");
});

test("internal links: TokenSection, nav-links and SiteFooter link to /token-sale and /tokenomics", () => {
  const tokenSection = read("app/components/site/landing/TokenSection.tsx");
  assert.match(tokenSection, /href="\/token-sale"/, "TokenSection must link to /token-sale");

  const navLinks = read("app/components/site/nav-links.ts");
  assert.match(navLinks, /href:\s*"\/token-sale"/, "nav-links must register /token-sale");
  assert.match(navLinks, /href:\s*"\/tokenomics"/, "nav-links must register /tokenomics");
  assert.doesNotMatch(navLinks, /href:\s*"\/leaderboard"/, "nav-links must NOT link /leaderboard");

  const footer = read("app/components/site/SiteFooter.tsx");
  assert.match(footer, /href="\/token-sale"/, "SiteFooter must link to /token-sale");
  assert.match(footer, /href="\/tokenomics"/, "SiteFooter must link to /tokenomics");
  assert.doesNotMatch(footer, /href="\/leaderboard"/, "SiteFooter must NOT link /leaderboard");
});
