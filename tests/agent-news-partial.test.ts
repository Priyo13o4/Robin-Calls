import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RwaMarketBriefCard } from "../app/components/rwa/RwaMarketBriefCard";
import {
  clearRwaMarketBriefCache,
  getRwaMarketBrief,
  refreshRwaMarketBrief,
  type RwaMarketBrief,
} from "../lib/mcp/parallel-search-client";

function mcpResponse(payload: unknown): Response {
  return new Response(JSON.stringify({
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("empty partial news retries on an ordinary load and recovers to cacheable evidence", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const options = {
    kind: "trade" as const,
    address: "0xaabbaabbaabbaabbaabbaabbaabbaabbaabbaabb",
    chainId: 4663,
  };
  clearRwaMarketBriefCache("AUDIT", "AuditProject", options);
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? mcpResponse({ results: [], errors: [{ error: "temporary source outage" }] })
      : mcpResponse({ results: [{
        title: "AuditProject announces a product release",
        url: "https://audit.example/news",
        excerpts: ["AuditProject announced a product release."],
      }] });
  };

  try {
    const partial = await getRwaMarketBrief("AUDIT", "AuditProject", undefined, options);
    assert.equal(partial.completeness, "partial");
    assert.deepEqual(partial.items, []);
    assert.equal(partial.emptyMessage, undefined);

    const recovered = await getRwaMarketBrief("AUDIT", "AuditProject", undefined, options);
    assert.equal(recovered.completeness, "complete");
    assert.equal(recovered.items.length, 1);
    assert.equal(calls, 2, "ordinary retry should reach the recovered provider");

    await getRwaMarketBrief("AUDIT", "AuditProject", undefined, options);
    assert.equal(calls, 2, "complete evidence should use the regular cache");
  } finally {
    globalThis.fetch = originalFetch;
    clearRwaMarketBriefCache("AUDIT", "AuditProject", options);
  }
});

test("partial empty and partial nonempty briefs render incomplete status", () => {
  const base: RwaMarketBrief = {
    symbol: "XYZ",
    name: "Example Issuer",
    fetchedAt: "2026-09-30T00:00:00.000Z",
    completeness: "partial",
    items: [],
  };
  const emptyHtml = renderToStaticMarkup(createElement(RwaMarketBriefCard, {
    symbol: base.symbol,
    name: base.name,
    kind: "trade",
    brief: base,
    loading: false,
    error: null,
    onRefresh: () => {},
  }));
  assert.match(emptyHtml, /Some news sources could not be reached/);
  assert.match(emptyHtml, /Retry search/);
  assert.doesNotMatch(emptyHtml, /No token-specific headlines found/);

  const populatedHtml = renderToStaticMarkup(createElement(RwaMarketBriefCard, {
    symbol: base.symbol,
    name: base.name,
    kind: "trade",
    brief: {
      ...base,
      items: [{
        title: "Example Issuer update",
        url: "https://example.com/update",
        domain: "example.com",
        publishDate: null,
        excerpt: "A dated issuer update.",
      }],
    },
    loading: false,
    error: null,
  }));
  assert.match(populatedHtml, /Partial search: some news sources could not be reached/);
  assert.match(populatedHtml, /Example Issuer update/);
});

test("unparseable headline dates are hidden instead of rendering Invalid Date", () => {
  const html = renderToStaticMarkup(createElement(RwaMarketBriefCard, {
    symbol: "XYZ",
    name: "Example Issuer",
    kind: "trade",
    brief: {
      symbol: "XYZ",
      name: "Example Issuer",
      fetchedAt: "2026-09-30T00:00:00.000Z",
      completeness: "complete",
      items: [{
        title: "A dated update",
        url: "https://example.com/update",
        domain: "example.com",
        publishDate: "not-a-date",
        excerpt: "A short update.",
      }],
    },
    loading: false,
    error: null,
  }));
  assert.doesNotMatch(html, /Invalid Date/);
  assert.match(html, /A dated update/);
});

test("complete empty news remains cacheable as a truthful no-results search", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  clearRwaMarketBriefCache("EMPTY", "Complete Empty Issuer");
  globalThis.fetch = async () => {
    calls += 1;
    return mcpResponse({ results: [] });
  };
  try {
    const first = await getRwaMarketBrief("EMPTY", "Complete Empty Issuer");
    const second = await getRwaMarketBrief("EMPTY", "Complete Empty Issuer");
    assert.equal(first.completeness, "complete");
    assert.equal(first.items.length, 0);
    assert.equal(second.completeness, "complete");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearRwaMarketBriefCache("EMPTY", "Complete Empty Issuer");
  }
});

test("forced partial empty refresh does not block a later ordinary recovery", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const options = { kind: "trade" as const, address: "0xccbbccbbccbbccbbccbbccbbccbbccbbccbbccbb", chainId: 4663 };
  clearRwaMarketBriefCache("FORCE", "ForcedProject", options);
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? mcpResponse({ results: [], errors: [{ error: "temporary source outage" }] })
      : mcpResponse({ results: [{
        title: "ForcedProject publishes a product release",
        url: "https://forced.example/release",
        excerpts: ["ForcedProject product release."],
      }] });
  };
  try {
    const partial = await refreshRwaMarketBrief("FORCE", "ForcedProject", options);
    assert.equal(partial.completeness, "partial");
    const recovered = await getRwaMarketBrief("FORCE", "ForcedProject", undefined, options);
    assert.equal(recovered.completeness, "complete");
    assert.equal(recovered.items.length, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearRwaMarketBriefCache("FORCE", "ForcedProject", options);
  }
});

test("an existing session partial-empty cache is ignored and removed", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  } satisfies Storage;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });

  let calls = 0;
  const symbol = "OLDPARTIAL";
  const name = "Old Partial Issuer";
  clearRwaMarketBriefCache(symbol, name);
  globalThis.fetch = async () => {
    calls += 1;
    return mcpResponse(calls === 1
      ? { results: [] }
      : { results: [{ title: "Old Partial Issuer release", url: "https://old.example/release", publish_date: new Date().toISOString().slice(0, 10), excerpts: ["Issuer release."] }] });
  };

  try {
    await getRwaMarketBrief(symbol, name);
    assert.equal(calls, 1);
    const cacheKey = Array.from(values.keys()).find((key) => key.startsWith("rc_mcp_brief_"));
    assert.ok(cacheKey, "the seed complete response should have written a session entry");

    clearRwaMarketBriefCache(symbol, name);
    storage.setItem(cacheKey, JSON.stringify({
      cachedAt: Date.now(),
      brief: { symbol, name, fetchedAt: "2026-09-30T00:00:00.000Z", completeness: "partial", emptyMessage: "No news", items: [] },
    }));

    const recovered = await getRwaMarketBrief(symbol, name);
    assert.equal(calls, 2, "the old partial-empty entry must not suppress a new provider read");
    assert.equal(recovered.completeness, "complete");
    assert.equal(recovered.items.length, 1);
    assert.notEqual(JSON.parse(storage.getItem(cacheKey) ?? "null").brief.completeness, "partial");
  } finally {
    globalThis.fetch = originalFetch;
    clearRwaMarketBriefCache(symbol, name);
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("partial evidence expires after 60 seconds while complete empty results last 15 minutes", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 2_000_000_000_000;
  Date.now = () => now;
  let calls = 0;
  clearRwaMarketBriefCache("PARTIALTTL", "Partial TTL Issuer");
  clearRwaMarketBriefCache("COMPLETETTL", "Complete TTL Issuer");
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1 || calls === 3) {
      return mcpResponse({
        results: [{ title: "Partial TTL Issuer update", url: "https://partial.example/update", publish_date: new Date(now).toISOString().slice(0, 10), excerpts: ["A partial update."] }],
        errors: [{ error: "one source failed" }],
      });
    }
    return mcpResponse({ results: [] });
  };

  try {
    const partial = await getRwaMarketBrief("PARTIALTTL", "Partial TTL Issuer");
    const complete = await getRwaMarketBrief("COMPLETETTL", "Complete TTL Issuer");
    assert.equal(partial.completeness, "partial");
    assert.equal(complete.completeness, "complete");

    now += 61_000;
    await getRwaMarketBrief("PARTIALTTL", "Partial TTL Issuer");
    await getRwaMarketBrief("COMPLETETTL", "Complete TTL Issuer");
    assert.equal(calls, 3, "partial evidence should refill after 60 seconds; complete empty should still be cached");

    now += 14 * 60_000;
    await getRwaMarketBrief("COMPLETETTL", "Complete TTL Issuer");
    assert.equal(calls, 4, "complete empty should refill after the 15-minute TTL");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    clearRwaMarketBriefCache("PARTIALTTL", "Partial TTL Issuer");
    clearRwaMarketBriefCache("COMPLETETTL", "Complete TTL Issuer");
  }
});
