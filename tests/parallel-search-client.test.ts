import test from "node:test";
import assert from "node:assert/strict";
import { isClientTool, CLIENT_TOOLS } from "../lib/agent/client-tools";
import { clientWebFetch, getRwaMarketBrief } from "../lib/mcp/parallel-search-client";

test("CLIENT_TOOLS exports web_search and web_fetch executors", () => {
  assert.equal(isClientTool("web_search"), true);
  assert.equal(isClientTool("web_fetch"), true);
  assert.equal(typeof CLIENT_TOOLS.web_search, "function");
  assert.equal(typeof CLIENT_TOOLS.web_fetch, "function");
});

test("web_search executor accepts objective and search_queries", async () => {
  // We can pass a mock client and args
  const mockClient = {} as any;
  const originalFetch = globalThis.fetch;

  // Mock fetch response from Parallel MCP
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [
                  {
                    title: "Apple Reports Strong Q2 2026 Earnings",
                    url: "https://www.cnbc.com/apple-earnings",
                    publish_date: "2026-04-30",
                    excerpts: ["Apple announced record services revenue and 14% growth."],
                  },
                ],
              }),
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const outcome = (await CLIENT_TOOLS.web_search(mockClient, {
      objective: "Apple earnings",
      search_queries: ["AAPL stock news"],
    }, { chainId: 4663, endpoints: [], maxBlockLag: 0 })) as any;

    assert.ok(outcome);
    assert.equal(outcome.source, "parallel-mcp");
    assert.equal(outcome.objective, "Apple earnings");
    assert.equal(outcome.results.length, 1);
    assert.equal(outcome.results[0].title, "Apple Reports Strong Q2 2026 Earnings");
    assert.equal(outcome.results[0].domain, "cnbc.com");
    assert.equal(outcome.results[0].publishDate, "2026-04-30");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web_fetch executor extracts pages content", async () => {
  const mockClient = {} as any;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [
                  {
                    title: "CNBC Apple Report",
                    url: "https://www.cnbc.com/apple-earnings",
                    excerpts: ["Revenue guidance exceeds estimates."],
                  },
                ],
              }),
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const outcome = (await CLIENT_TOOLS.web_fetch(mockClient, {
      urls: ["https://www.cnbc.com/apple-earnings"],
      objective: "Guidance",
    }, { chainId: 4663, endpoints: [], maxBlockLag: 0 })) as any;

    assert.ok(outcome);
    assert.equal(outcome.source, "parallel-mcp");
    assert.equal(outcome.pages.length, 1);
    assert.equal(outcome.pages[0].title, "CNBC Apple Report");
    assert.equal(outcome.pages[0].content, "Revenue guidance exceeds estimates.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web_fetch bounds its objective to Parallel's 200-character limit", async () => {
  const originalFetch = globalThis.fetch;
  let postedObjective = "";
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    postedObjective = request.params.arguments.objective;
    return new Response(JSON.stringify({
      result: { content: [{ type: "text", text: JSON.stringify({ results: [] }) }] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const objective = `Summarize exact issuer filing dates and recent catalyst changes. ${"Additional detail. ".repeat(30)}`;
    await clientWebFetch(["https://example.com/filing"], objective);
    assert.ok(postedObjective.length <= 200);
    assert.ok(postedObjective.startsWith("Summarize exact issuer filing dates and recent catalyst changes."));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getRwaMarketBrief: constructs deterministic brief and extracts valuation hint", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [
                  {
                    title: "Apple Valuation & P/E Ratio Analysis",
                    url: "https://stockanalysis.com/articles/aapl-pe-ratio-analysis",
                    publish_date: "2026-09-18",
                    excerpts: ["The forward P/E ratio for Apple stock is 32.05."],
                  },
                  {
                    title: "Apple Intelligence rollout spurs iPhone upgrade cycle",
                    url: "https://reuters.com/apple-ai",
                    publish_date: "2026-09-19",
                    excerpts: ["Strong initial demand reported across US and Europe."],
                  },
                ],
              }),
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const brief = await getRwaMarketBrief("AAPL", "Apple Inc");
    assert.equal(brief.symbol, "AAPL");
    assert.equal(brief.name, "Apple Inc");
    assert.equal(brief.items.length, 2);
    assert.ok(brief.valuationHint?.includes("forward P/E"));
    assert.equal(brief.items[0].domain, "reuters.com", "freshest dated catalyst is shown first");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RWA brief filters stock-news directories and issuer IR homepages, retaining dated releases", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    result: { content: [{ type: "text", text: JSON.stringify({ results: [
      {
        title: "AAPL - Apple Inc News | Morningstar",
        url: "https://www.morningstar.com/stocks/xnas/aapl/news",
        publish_date: "2026-09-27",
        excerpts: ["Read about Apple Inc (AAPL:XNAS) stock and today latest news and financial updates"],
      },
      {
        title: "Apple Inc. (AAPL) Latest Stock News & Headlines - Yahoo Finance",
        url: "https://finance.yahoo.com/quote/AAPL/news",
        publish_date: "2026-09-27",
        excerpts: ["Latest stock news and headlines for Apple Inc."],
      },
      {
        title: "Investor Relations - Apple",
        url: "https://investor.apple.com/",
        publish_date: null,
        excerpts: ["Welcome to Apple Investor Relations."],
      },
      {
        title: "Investor Relations - Apple",
        url: "https://investor.apple.com/investor-relations/default.aspx",
        publish_date: null,
        excerpts: ["Apple Investor Relations home page."],
      },
      {
        title: "Apple: Trending News, Latest Updates, Analysis - Bloomberg.com",
        url: "https://www.bloomberg.com/latest/apple",
        publish_date: "2026-09-27",
        excerpts: ["Trending news, latest updates and analysis for Apple."],
      },
      {
        title: "Apple announces new product availability on September 29",
        url: "https://www.apple.com/newsroom/2026/09/new-product-availability/",
        publish_date: "2026-09-29",
        excerpts: ["Apple today announced that the new product will be available September 29."],
      },
    ] }) }] },
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const brief = await getRwaMarketBrief("AAPL", "Apple Inc directory-filter test");
    assert.deepEqual(brief.items.map((item) => item.title), ["Apple announces new product availability on September 29"]);
    assert.equal(brief.items[0].title, "Apple announces new product availability on September 29");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RWA brief drops stale and generic SEC results, keeps recent dated releases, and asks MCP for the freshness window", async () => {
  const originalFetch = globalThis.fetch;
  let postedArguments: Record<string, unknown> | null = null;
  const freshDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.params.name === "web_search") postedArguments = request.params.arguments;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ results: [
      {
        title: "EX-99.1 Micron Updates First Quarter Fiscal 2024 Guidance",
        url: "https://investors.micron.com/news/press-release/2023/Micron-Updates-First-Quarter-Fiscal-2024-Guidance-11-28-2023/default.aspx",
        publish_date: "2023-11-28",
        excerpts: ["Micron announced updated revenue and EPS guidance on Nov. 28, 2023."],
      },
      {
        title: "Micron Technology, Inc. Form 8-K Current Report",
        url: "https://www.sec.gov/Archives/edgar/data/723125/mu-20260318.htm",
        publish_date: "2026-03-18",
        excerpts: ["Current report filed March 18, 2026."],
      },
      {
        title: "Form 10-Q Quarterly report",
        url: "https://www.sec.gov/Archives/edgar/data/723125/mu-20260528.htm",
        publish_date: "2026-06-25",
        excerpts: ["Form 10-Q for the quarter ended May 28, 2026."],
      },
      {
        title: "EDGAR Entity Landing Page - SEC.gov",
        url: "https://www.sec.gov/edgar/browse/?CIK=723125",
        publish_date: freshDate,
        excerpts: ["Hidden document icon SEC Logo EDGAR Company Search Results."],
      },
      {
        title: "EX-99.1 2 mu-20260930.htm EXHIBIT 99.1 Micron reports fourth quarter fiscal 2026 results",
        url: "https://investors.micron.com/news/press-release/2026/micron-reports-fourth-quarter-results",
        publish_date: freshDate,
        excerpts: [
          "UNITED STATES SECURITIES AND EXCHANGE COMMISSION | FORM 8-K CURRENT REPORT",
          "Micron reported fourth quarter fiscal 2026 revenue of $11.3 billion and record data center demand. Home sales improved.",
        ],
      },
      {
        title: "Micron current press release",
        url: "https://investors.micron.com/news/press-release/2026/current-release",
        publish_date: null,
        excerpts: ["Micron announced a product update today."],
      },
      {
        title: "Future dated issuer announcement",
        url: "https://investors.micron.com/news/press-release/2026/future-release",
        publish_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        excerpts: ["A future dated announcement."],
      },
      {
        title: "mu-q42026.htm",
        url: "https://investors.micron.com/news/press-release/2026/current-product-announcement",
        publish_date: freshDate,
        excerpts: ["Micron announces a current product update."],
      },
    ] }) }] } }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const brief = await getRwaMarketBrief("MU", "Micron Technology, Inc", undefined, { kind: "rwa" });
    assert.deepEqual(brief.items.map((item) => item.title), ["Micron reports fourth quarter fiscal 2026 results", "Micron announces a current product update."]);
    assert.ok(!brief.items.some((item) => item.title.includes("Future dated")), "tomorrow's date cannot be treated as recent published news");
    assert.match(brief.items[0].excerpt, /\$11\.3 billion/);
    assert.match(brief.items[0].excerpt, /Home sales improved/);
    assert.doesNotMatch(brief.items[0].excerpt, /SEC|FORM 8-K|·/);
    const posted = postedArguments as Record<string, unknown> | null;
    assert.ok(posted);
    assert.match(String(posted.objective), /published \d{4}-\d{2}-\d{2} through \d{4}-\d{2}-\d{2}/);
    assert.ok((posted.search_queries as string[]).some((query) => query.includes("after:")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RWA brief verifies undated issuer items from explicit source publication labels only", async () => {
  const originalFetch = globalThis.fetch;
  const verifiedUrl = "https://issuer.example/news/current-results";
  const periodOnlyUrl = "https://issuer.example/filings/quarterly-report";
  const today = new Date().toISOString().slice(0, 10);
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const args = request.params.arguments;
    if (request.params.name === "web_fetch") {
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ results: [
        { url: verifiedUrl, title: "Quarterly results", full_content: `Published: ${today}\nThe issuer reported a record quarter.` },
        { url: periodOnlyUrl, title: "Quarterly filing", full_content: "Quarter ended September 29, 2026. Revenue increased." },
      ] }) }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(request.params.name, "web_search");
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ results: [
      { title: "Issuer reports a record quarter", url: verifiedUrl, publish_date: null, excerpts: ["Record quarterly results."] },
      { title: "Issuer quarterly filing", url: periodOnlyUrl, publish_date: null, excerpts: ["Quarter ended September 29, 2026."] },
    ] }) }] } }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const brief = await getRwaMarketBrief("ISS", "Issuer Corp", undefined, { kind: "rwa" });
    assert.deepEqual(brief.items.map((item) => item.url), [verifiedUrl]);
    assert.equal(brief.items[0].publishDate, today);
    assert.equal(brief.completeness, "complete");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RWA brief retains and uses fetch publication metadata when content has no label", async () => {
  const originalFetch = globalThis.fetch;
  const articleUrl = "https://retained.example/news/major-announcement";
  const today = new Date().toISOString().slice(0, 10);
  let webFetchCalled = false;

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.params.name === "web_search") {
      return new Response(JSON.stringify({
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: [
                {
                  title: "Retain Corp Announces New Platform",
                  url: articleUrl,
                  publish_date: null,
                  excerpts: ["The company introduced its next-generation platform today."],
                },
              ],
            }),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.params.name === "web_fetch") {
      webFetchCalled = true;
      return new Response(JSON.stringify({
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: [
                {
                  url: articleUrl,
                  title: "Retain Corp Announces New Platform",
                  publish_date: today,
                  full_content: "The company introduced its next-generation platform. User adoption increased by 200 percent.",
                },
              ],
            }),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected tool call: ${request.params.name}`);
  };

  try {
    const brief = await getRwaMarketBrief("RETAIN", "Retain Corp", undefined, { kind: "rwa" });
    assert.equal(webFetchCalled, true, "web_fetch should be called for undated candidate");
    assert.equal(brief.items.length, 1);
    assert.equal(brief.items[0].url, articleUrl);
    assert.equal(brief.items[0].publishDate, today);
    assert.equal(brief.items[0].title, "Retain Corp Announces New Platform");
    assert.match(brief.items[0].excerpt, /next-generation platform/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RWA brief rejects malformed, future, and stale fetch metadata", async () => {
  const originalFetch = globalThis.fetch;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const futureStr = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const staleStr = new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const malformedUrl = "https://reject.example/malformed";
  const futureUrl = "https://reject.example/future";
  const staleUrl = "https://reject.example/stale";
  const fallbackUrl = "https://reject.example/fallback";

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.params.name === "web_search") {
      return new Response(JSON.stringify({
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: [
                { title: "Malformed Item", url: malformedUrl, publish_date: null, excerpts: ["Malformed date test"] },
                { title: "Future Item", url: futureUrl, publish_date: null, excerpts: ["Future date test"] },
                { title: "Stale Item", url: staleUrl, publish_date: null, excerpts: ["Stale date test"] },
                { title: "Fallback Item", url: fallbackUrl, publish_date: null, excerpts: ["Fallback date test"] },
              ],
            }),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.params.name === "web_fetch") {
      return new Response(JSON.stringify({
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: [
                { url: malformedUrl, title: "Malformed Item", publish_date: "not-a-date", full_content: "Content with no date label." },
                { url: futureUrl, title: "Future Item", publish_date: futureStr, full_content: "Future announcement with no date label." },
                { url: staleUrl, title: "Stale Item", publish_date: staleStr, full_content: "Stale report with no date label." },
                { url: fallbackUrl, title: "Fallback Item", publish_date: "not-a-date", full_content: `Published: ${todayStr}\nValid content label after malformed provider date.` },
              ],
            }),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected tool call: ${request.params.name}`);
  };

  try {
    const brief = await getRwaMarketBrief("REJECT", "Reject Corp", undefined, { kind: "rwa" });
    assert.equal(brief.items.some((item) => item.url === malformedUrl), false, "malformed metadata must be rejected");
    assert.equal(brief.items.some((item) => item.url === futureUrl), false, "future metadata must be rejected");
    assert.equal(brief.items.some((item) => item.url === staleUrl), false, "stale metadata must be rejected");
    assert.equal(brief.items.some((item) => item.url === fallbackUrl), true, "fallback to explicit publication date in content succeeds");
    const fallbackItem = brief.items.find((item) => item.url === fallbackUrl);
    assert.equal(fallbackItem?.publishDate, todayStr);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RWA search queries omit site:sec.gov, use at most two focused queries, and objective prioritizes asset news", async () => {
  const originalFetch = globalThis.fetch;
  let capturedSearchArgs: Record<string, unknown> | null = null;

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.params.name === "web_search") {
      capturedSearchArgs = request.params.arguments;
      return new Response(JSON.stringify({
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({ results: [] }),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected tool call: ${request.params.name}`);
  };

  try {
    await getRwaMarketBrief("NOSEC", "No SEC Corp", undefined, { kind: "rwa" });
    assert.ok(capturedSearchArgs, "web_search must be called");
    const queries = capturedSearchArgs.search_queries as string[];
    assert.ok(Array.isArray(queries));
    assert.ok(queries.length <= 2, `expected at most 2 queries, got ${queries.length}`);
    assert.equal(queries.length, 2);
    // SEC-directed query absent
    assert.ok(!queries.some((q) => q.toLowerCase().includes("site:sec.gov")), "must not contain site:sec.gov query");
    assert.ok(!queries.some((q) => q.toLowerCase().includes("sec.gov")), "no forced SEC queries");
    // Verify expected focused queries
    assert.ok(queries.every(q => q.includes("NOSEC") && /after:\d{4}-\d{2}-\d{2}/.test(q)));
    assert.ok(queries.some(q => /news [A-Za-z]+ \d{4}/.test(q)), "calendar-month news hint avoids quote-directory searches");
    // Verify objective prioritizes asset-specific reporting and ETF macro/flows, regulatory filing optional
    const objective = String(capturedSearchArgs.objective);
    assert.ok(objective.includes("asset-specific reporting"), "objective must prioritize asset-specific reporting");
    assert.ok(objective.includes("ETF macro/flows"), "objective must include ETF macro/flows");
    assert.ok(objective.toLowerCase().includes("regulatory filing") || objective.toLowerCase().includes("regulatory filings"), "regulatory filing optional");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RWA verification: directory candidates do not consume four URL fetch budget slots", async () => {
  const originalFetch = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  const validArticleUrl = "https://slots.example/news/record-results";
  let fetchedUrls: string[] = [];

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.params.name === "web_search") {
      return new Response(JSON.stringify({
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: [
                {
                  title: "Slots News | Morningstar",
                  url: "https://www.morningstar.com/stocks/xnas/slots/news",
                  publish_date: null,
                  excerpts: ["Read about SLOTS stock and latest news"],
                },
                {
                  title: "Slots Latest Stock News & Headlines - Yahoo Finance",
                  url: "https://finance.yahoo.com/quote/SLOTS/news",
                  publish_date: null,
                  excerpts: ["Latest stock news and headlines for SLOTS"],
                },
                {
                  title: "Investor Relations - Slots Corp",
                  url: "https://investor.slots.example/",
                  publish_date: null,
                  excerpts: ["Welcome to Slots Investor Relations."],
                },
                {
                  title: "EDGAR Entity Landing Page - SEC.gov",
                  url: "https://www.sec.gov/edgar/browse/?CIK=0001234567",
                  publish_date: null,
                  excerpts: ["EDGAR Company Search Results"],
                },
                {
                  title: "Slots Corp Reports Record Q3 Results",
                  url: validArticleUrl,
                  publish_date: null,
                  excerpts: ["Slots Corp announced record third quarter revenue and earnings."],
                },
              ],
            }),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.params.name === "web_fetch") {
      fetchedUrls = (request.params.arguments.urls as string[]) ?? [];
      return new Response(JSON.stringify({
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: [
                {
                  url: validArticleUrl,
                  title: "Slots Corp Reports Record Q3 Results",
                  publish_date: today,
                  full_content: "Slots Corp announced record third quarter revenue and earnings.",
                },
              ],
            }),
          }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected tool call: ${request.params.name}`);
  };

  try {
    const brief = await getRwaMarketBrief("SLOTS", "Slots Directory Corp", undefined, { kind: "rwa" });
    assert.deepEqual(fetchedUrls, [validArticleUrl], "only the non-directory candidate should be fetched");
    assert.equal(brief.items.length, 1);
    assert.equal(brief.items[0].url, validArticleUrl);
    assert.equal(brief.items[0].publishDate, today);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test("RWA stale or future provider dates cannot be replaced by fresh prose dates", async () => {
  const originalFetch = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  const dates = [new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10),
    new Date(Date.now() + 86400000).toISOString().slice(0, 10)];
  const urls = dates.map((_, i) => `https://dates.example/news/article-${i}`);
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const results = request.params.name === "web_search"
      ? urls.map(url => ({ url, title: "Issuer announcement", publish_date: null, excerpts: ["Issuer announcement."] }))
      : urls.map((url, i) => ({ url, title: "Issuer announcement", publish_date: dates[i], full_content: `Published: ${today} Other recent article in navigation.` }));
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ results }) }] } }),
      { headers: { "content-type": "application/json" } });
  };
  try {
    const brief = await getRwaMarketBrief("AUTHDATE", "Date Issuer", undefined, { kind: "rwa" });
    assert.equal(brief.items.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});


test("RWA excludes dated quote dashboards and earnings calendars", async () => {
  const originalFetch = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  const urls = ["https://www.zacks.com/stock/research/MU/earnings-calendar",
    "https://etf-radar.example/etf/GLD", "https://clearank.example/etf/spdr-gold-shares-gld/",
    "https://www.fool.com/quote/nasdaq/mu/", "https://businessquant.example/stocks/mu/sec-filings", "https://issuer.example/news/new-product"];
  globalThis.fetch = async () => new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
    results: urls.map(url => ({ url, title: "Issuer coverage", publish_date: today, excerpts: ["Issuer coverage."] })),
  }) }] } }), { headers: { "content-type": "application/json" } });
  try {
    const brief = await getRwaMarketBrief("DIRQUOTE", "Directory Issuer", undefined, { kind: "rwa" });
    assert.deepEqual(brief.items.map(i => i.url), [urls[5]]);
  } finally { globalThis.fetch = originalFetch; }
});


test("ETF news focuses on the named fund instead of company earnings queries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const args = JSON.parse(String(init?.body)).params.arguments;
    assert.equal(args.search_queries.length, 1);
    assert.match(args.search_queries[0], /^SPDR Gold Trust GLD news /);
    assert.ok(!args.search_queries[0].includes("announcements"));
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ results: [] }) }] } }),
      { headers: { "content-type": "application/json" } });
  };
  try { await getRwaMarketBrief("GLD", "SPDR Gold Trust", undefined, { address: "0xETFTEST", kind: "rwa" }); }
  finally { globalThis.fetch = originalFetch; }
});
