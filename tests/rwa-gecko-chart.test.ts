import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isUsableRwaPoolAddress, RwaGeckoChart, rwaGeckoChartUrl, rwaGeckoPoolPageUrl } from "../app/components/rwa/RwaGeckoChart";

const token = `0x${"a".repeat(40)}`;
const pool = `0x${"b".repeat(40)}`;

test("RWA chart only accepts a distinct EVM address as the pool", () => {
  assert.equal(isUsableRwaPoolAddress(pool, token), true);
  assert.equal(isUsableRwaPoolAddress(`0x${"B".repeat(64)}`, token), true);
  assert.equal(isUsableRwaPoolAddress(token.toUpperCase().replace("0X", "0x"), token), false);
  assert.equal(isUsableRwaPoolAddress(token, token), false);
  assert.equal(isUsableRwaPoolAddress("unknown", token), false);
  assert.equal(isUsableRwaPoolAddress(null, token), false);
});

test("RWA GeckoTerminal URL charts the selected token inside the validated pool", () => {
  const url = new URL(rwaGeckoChartUrl(pool, token));
  assert.equal(url.pathname, `/robinhood/pools/${pool}`);
  assert.equal(url.searchParams.get("token_address"), token);
  assert.equal(url.searchParams.get("resolution"), "1h");
  assert.equal(url.searchParams.get("display_currency"), "usd");
  assert.equal(url.searchParams.get("light_chart"), "0");
  assert.equal(url.searchParams.get("grayscale"), "0");
  assert.equal(url.searchParams.has("chart_type"), false);
  assert.equal(url.searchParams.get("embed"), "1");
});

test("Open chart uses the normal pool page with the selected token", () => {
  const url = new URL(rwaGeckoPoolPageUrl(pool, token));
  assert.equal(url.pathname, `/robinhood/pools/${pool}`);
  assert.equal(url.searchParams.get("token_address"), token);
  assert.equal(url.searchParams.has("embed"), false);
});

test("missing or token-shaped pool renders the unavailable state without an iframe", () => {
  for (const invalidPool of [null, token]) {
    const html = renderToStaticMarkup(createElement(RwaGeckoChart, {
      tokenAddress: token,
      symbol: "RWA",
      poolAddress: invalidPool,
    }));
    assert.match(html, /Pool unavailable/);
    assert.match(html, /Waiting for pool data\./);
    assert.doesNotMatch(html, /<iframe/);
  }
});

test("valid pool renders an embed whose pool and token identities are explicit", () => {
  const html = renderToStaticMarkup(createElement(RwaGeckoChart, {
    tokenAddress: token,
    symbol: "RWA",
    poolAddress: pool,
  }));
  assert.match(html, /<iframe/);
  assert.match(html, new RegExp(`pools%2F${pool}|pools/${pool}`));
  assert.match(html, new RegExp(`token_address%3D${token}|token_address=${token}`));
  assert.match(html, /resolution%3D1h|resolution=1h/);
  assert.match(html, /Reload chart/);
  assert.match(html, /Open chart/);
  assert.match(html, /display_currency%3Dusd|display_currency=usd/);
  assert.match(html, /light_chart%3D0|light_chart=0/);
});
