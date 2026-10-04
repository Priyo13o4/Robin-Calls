import test from "node:test";
import assert from "node:assert/strict";
import { readTokenMarket } from "../lib/internal/reads";
import { callParallelMcpTool, clearRwaMarketBriefCache, getRwaMarketBrief, refreshRwaMarketBrief } from "../lib/mcp/parallel-search-client";

const TOKEN = "0x1111111111111111111111111111111111111111";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

test("internal DexScreener market read is fixed-host, exact-address and chain scoped", async () => {
  const urls: string[] = [];
  const got = await readTokenMarket({ address: TOKEN }, async (input) => {
    urls.push(String(input));
    return response(200, { pairs: [
      { chainId: "robinhood", pairAddress: "0xpool", baseToken: { address: TOKEN }, dexId: "uniswap" },
      { chainId: "ethereum", pairAddress: "0xother", baseToken: { address: TOKEN } },
      { chainId: "robinhood", pairAddress: "0xwrong", baseToken: { address: "0x2222222222222222222222222222222222222222" } },
    ] });
  });
  assert.equal(urls[0], `https://api.dexscreener.com/latest/dex/tokens/${TOKEN}`);
  const pairs = got.pairs;
  assert(Array.isArray(pairs));
  assert.equal(pairs.length, 1);
  const pair = pairs[0];
  assert(pair && typeof pair === "object" && !Array.isArray(pair));
  const pairRecord = pair as Record<string, unknown>;
  assert.equal(pairRecord.pairAddress, "0xpool");
  const baseToken = pairRecord.baseToken;
  assert(baseToken && typeof baseToken === "object" && !Array.isArray(baseToken));
  assert.equal((baseToken as Record<string, unknown>).address, TOKEN);
  assert.equal(got.source, "dexscreener");
  assert.equal(got.completeness, "complete");
});

test("internal market provider failures remain transient read failures", async () => {
  await assert.rejects(() => readTokenMarket({ address: TOKEN }, async () => response(503, {})), /HTTP 503/);
  await assert.rejects(() => readTokenMarket({ address: TOKEN }, async () => response(200, "x".repeat(1_000_001))), /size limit/);
});

test("Parallel Search MCP isError is a failure, not an empty result", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response(200, { result: { isError: true, content: [{ type: "text", text: "provider down" }] } })) as typeof fetch;
  try {
    await assert.rejects(() => callParallelMcpTool("web_search", { objective: "x", search_queries: ["x"] }), /could not complete/);
  } finally { globalThis.fetch = original; }
});

test("keyless Parallel Search decodes Streamable HTTP SSE responses", async () => {
  const original = globalThis.fetch;
  const captured = { requestHeaders: null as Headers | null };
  globalThis.fetch = (async (_input, init) => {
    captured.requestHeaders = new Headers(init?.headers);
    const rpc = JSON.parse(String(init?.body));
    return new Response(`event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: "search result" }] },
    })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  try {
    const result = await callParallelMcpTool("web_search", { objective: "latest catalyst", search_queries: ["company news"] });
    assert.equal(result.content?.[0]?.text, "search result");
    assert.equal(captured.requestHeaders?.get("accept"), "application/json, text/event-stream");
    assert.equal(captured.requestHeaders?.has("authorization"), false, "public research must not depend on a model/API key");
  } finally { globalThis.fetch = original; }
});

test("market brief single-flight key includes asset identity and failed refresh is not cached", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) return response(200, { result: { isError: true } });
    return response(200, { result: { content: [{ type: "text", text: JSON.stringify({ results: [{ title: "Same name token catalyst", url: "https://example.com/news", excerpts: ["Specific dated event"] }] }) }] } });
  }) as typeof fetch;
  try {
    const asset = { kind: "trade" as const, address: TOKEN, chainId: 4663 };
    await assert.rejects(() => getRwaMarketBrief("TOKEN", "Same name", undefined, asset));
    const brief = await getRwaMarketBrief("TOKEN", "Same name", undefined, asset);
    assert.equal(brief.items.length, 1);
    await getRwaMarketBrief("TOKEN", "Same name", undefined, { ...asset, address: "0x2222222222222222222222222222222222222222" });
    assert.equal(requests, 3, "different contract addresses must not share a brief");
  } finally { globalThis.fetch = original; }
});

test("forced brief refresh starts new provider work instead of joining ordinary refill", async () => {
  const original = globalThis.fetch;
  let release!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return await new Promise<Response>((resolve) => { release = resolve; });
    return response(200, { result: { content: [{ type: "text", text: JSON.stringify({ results: [{ title: "AssetName New", url: "https://example.com/new", excerpts: ["new"] }] }) }] } });
  }) as typeof fetch;
  try {
    const regular = getRwaMarketBrief("ABC", "AssetName", undefined, { kind: "trade", address: TOKEN });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const forced = refreshRwaMarketBrief("ABC", "AssetName", { kind: "trade", address: TOKEN });
    assert.equal((await forced).items[0]?.title, "AssetName New");
    release(response(200, { result: { content: [{ type: "text", text: JSON.stringify({ results: [{ title: "AssetName Old", url: "https://example.com/old", excerpts: ["old"] }] }) }] } }));
    await regular;
    const cached = await getRwaMarketBrief("ABC", "AssetName", undefined, { kind: "trade", address: TOKEN });
    assert.equal(cached.items[0]?.title, "AssetName New", "older refill must not overwrite forced refresh");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test("trade brief rejects ticker collisions and generic chain directories", async () => {
  const original = globalThis.fetch;
  const address = "0x8ff92566f2e81bdd68edfaa8cde73942a723796b";
  globalThis.fetch = (async () => response(200, { result: { content: [{ type: "text", text: JSON.stringify({ results: [
    { title: "Robinscan", url: "https://robinscan.io", excerpts: ["Robinhood Chain token explorer"] },
    { title: "Robinhood meme tokens see volume jump", url: "https://news.example/robinhood-vex", excerpts: ["VEX is trending across chain tokens."] },
    { title: "Project Vex: exact project update", url: "https://projectvex.example/news", excerpts: ["The ProjectVex team published this dated update."] },
    { title: "Contract analysis", url: "https://news.example/contract", excerpts: [`A specific event for ${address}.`] },
  ] }) }] } })) as typeof fetch;
  try {
    const brief = await getRwaMarketBrief("VEX", "ProjectVex", undefined, { kind: "trade", address, chainId: 4663 });
    assert.deepEqual(brief.items.map((item) => item.title), ["Project Vex: exact project update", "Contract analysis"]);
    assert.equal(brief.emptyMessage, undefined);
  } finally { globalThis.fetch = original; }
});

test("no matching trade news is labelled as no token-specific news, not a clean result", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response(200, { result: { content: [{ type: "text", text: JSON.stringify({ results: [
    { title: "Generic Robinhood Chain updates", url: "https://news.example/chain", excerpts: ["A broad chain ecosystem recap."] },
    { title: "VEX token discussion", url: "https://news.example/vex", excerpts: ["Ticker-only mention with no project identity."] },
  ] }) }] } })) as typeof fetch;
  try {
    const brief = await getRwaMarketBrief("VEX", "ProjectVex", undefined, { kind: "trade", address: "0x9999999999999999999999999999999999999999", chainId: 4663 });
    assert.deepEqual(brief.items, []);
    assert.equal(brief.emptyMessage, "No token-specific news found for this contract or project identity.");
  } finally { globalThis.fetch = original; }
});

test("trade brief drops exact-address quote and chart listings and never derives a valuation hint", async () => {
  const original = globalThis.fetch;
  const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  globalThis.fetch = (async () => response(200, { result: { content: [{ type: "text", text: JSON.stringify({ results: [
    {
      title: `VEX $0.0059464 (ProjectVex) | Trading & Price Chart on Robinhood`,
      url: `https://web3.okx.com/token/robinhood/${address}`,
      excerpts: [`Contract ${address}; live price $0.0059464 and market cap $5.9m.`],
    },
    {
      title: "ProjectVex announces a protocol release",
      url: "https://projectvex.example/blog/protocol-release",
      excerpts: ["The ProjectVex team announced a dated protocol release."],
    },
  ] }) }] } })) as typeof fetch;
  try {
    const brief = await getRwaMarketBrief("VEX", "ProjectVex", undefined, { kind: "trade", address, chainId: 4663 });
    assert.deepEqual(brief.items.map((item) => item.title), ["ProjectVex announces a protocol release"]);
    assert.equal(brief.valuationHint, undefined);
  } finally { globalThis.fetch = original; }
});

test("clearing a brief prevents an older refill from republishing it", async () => {
  const original = globalThis.fetch;
  let release!: (value: Response) => void;
  let calls = 0;
  const result = (title: string) => response(200, { result: { content: [{ type: "text", text: JSON.stringify({ results: [
    { title, url: "https://news.example/clear", excerpts: [title] },
  ] }) }] } });
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? await new Promise<Response>((resolve) => { release = resolve; }) : result("ClearProject new");
  }) as typeof fetch;
  try {
    const options = { kind: "trade" as const, address: "0x8888888888888888888888888888888888888888" };
    const old = getRwaMarketBrief("CLR", "ClearProject", undefined, options);
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearRwaMarketBriefCache("CLR", "ClearProject", options);
    const next = await getRwaMarketBrief("CLR", "ClearProject", undefined, options);
    assert.equal(next.items[0]?.title, "ClearProject new");
    release(result("ClearProject old"));
    await old;
    assert.equal((await getRwaMarketBrief("CLR", "ClearProject", undefined, options)).items[0]?.title, "ClearProject new");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
