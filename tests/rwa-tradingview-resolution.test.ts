import test from "node:test";
import assert from "node:assert/strict";
import {
  pickTvListing,
  stripEmTags,
  type TvSymbolRow,
} from "../lib/market/tradingview";

// L79 — the RWA page guessed `NASDAQ:<SYMBOL>` for every ticker not in a
// hardcoded 25-item map, publishing broken charts for NYSE/NYSE Arca listings
// (BA, XLK). The fix resolves from TV's search API; these tests pin the match
// rules that keep a fuzzy search from charting a different instrument.

const row = (over: Partial<TvSymbolRow>): TvSymbolRow => ({
  symbol: "BA",
  type: "stock",
  exchange: "NYSE",
  ...over,
});

test("stripEmTags removes the <em> highlight wrapping TV puts on matches", () => {
  assert.equal(stripEmTags("<em>BA</em>"), "BA");
  assert.equal(stripEmTags("plain"), "plain");
  assert.equal(stripEmTags("GL<em>D</em>"), "GLD");
  assert.equal(stripEmTags("<em>Ba</em>ngkok"), "Bangkok");
});

test("exact symbol match required — GLD must not match GLDI, VTI must not match VTIP", () => {
  // TV search is prefix/fuzzy; its first row for GLD is GLDI, for VTI is VTIP.
  const glResults: TvSymbolRow[] = [
    row({ symbol: "<em>GLDI</em>", type: "fund", exchange: "NYSE Arca" }),
    row({ symbol: "<em>GLD</em>", type: "fund", exchange: "NYSE Arca" }),
  ];
  const hit = pickTvListing(glResults, "GLD");
  assert.ok(hit, "GLD must resolve");
  assert.equal(hit.tvSymbol, "AMEX:GLD");
});

test("no exact US match → null (the disclosed no-benchmark state), never a guess", () => {
  // Real TV response for CUSO: only NASDAQ:CUSOX (a different fund) exists.
  const results: TvSymbolRow[] = [
    row({ symbol: "<em>CUSOX</em>", type: "fund", exchange: "NASDAQ" }),
  ];
  assert.equal(pickTvListing(results, "CUSO"), null);
});

test("ETF venues are eligible — NYSE Arca resolves XLK/SPY/SLV (L79 trap 2)", () => {
  const hit = pickTvListing(
    [row({ symbol: "<em>XLK</em>", type: "fund", exchange: "NYSE Arca" })],
    "XLK"
  );
  assert.ok(hit);
  // Widget prefix, not display name: "NYSE Arca:XLK" is not a real symbol.
  assert.equal(hit.tvSymbol, "AMEX:XLK");
});

test("prefix/source_id wins over display exchange for the widget symbol", () => {
  // Live GLD row: exchange "NYSE Arca", prefix "AMEX", source_id "AMEX".
  const hit = pickTvListing(
    [
      row({
        symbol: "<em>SPY</em>",
        type: "fund",
        exchange: "NYSE Arca",
        prefix: "AMEX",
        source_id: "AMEX",
      }),
    ],
    "SPY"
  );
  assert.equal(hit?.tvSymbol, "AMEX:SPY");
  const fromSourceId = pickTvListing(
    [row({ exchange: "NYSE Arca", source_id: "AMEX" })],
    "BA"
  );
  assert.equal(fromSourceId?.tvSymbol, "AMEX:BA");
});

test("ADR/DR rows count as US listings (BABA is a dr on NYSE, not a stock)", () => {
  const hit = pickTvListing(
    [
      row({ symbol: "<em>BABA</em>", type: "stock", exchange: "BSE", is_primary_listing: true }),
      row({ symbol: "<em>BABA</em>", type: "dr", exchange: "NYSE" }),
    ],
    "BABA"
  );
  assert.ok(hit);
  assert.equal(hit.tvSymbol, "NYSE:BABA");
});

test("primary listing preferred; first eligible row otherwise", () => {
  const primary = pickTvListing(
    [
      row({ exchange: "BMV" }),
      row({ exchange: "NYSE", is_primary_listing: true }),
      row({ exchange: "NASDAQ" }),
    ],
    "BA"
  );
  assert.equal(primary?.tvSymbol, "NYSE:BA");

  const firstEligible = pickTvListing(
    [row({ exchange: "NASDAQ" }), row({ exchange: "NYSE" })],
    "BA"
  );
  assert.equal(firstEligible?.tvSymbol, "NASDAQ:BA");
});

test("non-listing types (index, futures, crypto proxies) are skipped", () => {
  const hit = pickTvListing(
    [
      row({ symbol: "<em>SPY</em>", type: "index", exchange: "NYSE Arca" }),
      row({ symbol: "<em>SPY</em>", type: "futures", exchange: "CME" }),
      row({ symbol: "<em>SPY</em>", type: "stock", exchange: "Pyth" }),
    ],
    "SPY"
  );
  assert.equal(hit, null);
});

test("empty/partial rows never crash the picker", () => {
  assert.equal(pickTvListing([], "BA"), null);
  assert.equal(pickTvListing([{}], "BA"), null);
  assert.equal(pickTvListing([row({ symbol: undefined })], "BA"), null);
});
