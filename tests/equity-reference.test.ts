import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRegistryEntry,
  resolvePrice,
  readEquityReference,
  _resetEquityReferenceCache,
  parseTradingCapabilities,
  isSessionTradable,
  getEasternTradingSession,
  getTradingSessionForTime,
  evaluateSessionCapability,
  checkEquitySessionCapability,
  SESSION_REGISTRY_TTL_MS,
  TRADING_STATUS_TRADABLE,
  TRADING_STATUS_UNTRADABLE,
  type EquityRegistryEntry,
} from "../lib/market/equity-reference";

const CRWD_REAL_ADDRESS = "0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931";
const CRWD_IMPERSONATOR_ADDRESS = "0x1111111111111111111111111111111111111111";

const REGISTRY_CRWD_FIXTURE = {
  assets: [
    {
      tokenSymbol: "CRWD",
      deployments: [
        {
          contractAddress: CRWD_REAL_ADDRESS,
          chainId: 4663,
        },
      ],
      currentMultiplier: "4.000000000000000000",
      pendingMultiplier: "",
      status: "ASSET_STATUS_ACTIVE",
    },
  ],
};

const PRICE_CRWD_FIXTURE = {
  quotes: [
    {
      tokenSymbol: "CRWD",
      deployments: [
        {
          contractAddress: CRWD_REAL_ADDRESS,
          chainId: 4663,
        },
      ],
      bid: "239.1",
      ask: "239.6",
      isTradingHalt: false,
      generatedAt: "2026-09-16T11:41:12.016276086Z",
    },
  ],
};

test("resolveRegistryEntry returns malformed on invalid body or non-array assets", () => {
  assert.equal(resolveRegistryEntry(null, CRWD_REAL_ADDRESS), "malformed");
  assert.equal(resolveRegistryEntry(undefined, CRWD_REAL_ADDRESS), "malformed");
  assert.equal(resolveRegistryEntry("not-an-object", CRWD_REAL_ADDRESS), "malformed");
  assert.equal(resolveRegistryEntry({ assets: "not-array" }, CRWD_REAL_ADDRESS), "malformed");
  assert.equal(resolveRegistryEntry({}, CRWD_REAL_ADDRESS), "malformed");
});

test("resolveRegistryEntry: match on CONTRACT ADDRESS only, never on symbol (R)", () => {
  // Impersonator ERC-20 has the symbol 'CRWD' but different address.
  const impersonatorResolved = resolveRegistryEntry(REGISTRY_CRWD_FIXTURE, CRWD_IMPERSONATOR_ADDRESS);
  assert.equal(impersonatorResolved, null, "impersonator address must resolve to null (not-equity)");

  // Real address matches regardless of casing.
  const realResolved = resolveRegistryEntry(REGISTRY_CRWD_FIXTURE, CRWD_REAL_ADDRESS.toLowerCase());
  assert.ok(realResolved && typeof realResolved === "object", "real address must resolve to entry");
  assert.equal(realResolved.tokenSymbol, "CRWD");
  assert.equal(realResolved.contractAddress, CRWD_REAL_ADDRESS.toLowerCase());
});

test("resolveRegistryEntry: only deployments with chainId === 4663 count (R)", () => {
  const otherChainFixture = {
    assets: [
      {
        tokenSymbol: "AAPL",
        deployments: [
          {
            contractAddress: "0x2222222222222222222222222222222222222222",
            chainId: 1, // Ethereum mainnet, not Robinhood Chain
          },
        ],
        currentMultiplier: "1.000000000000000000",
        pendingMultiplier: "",
        status: "ASSET_STATUS_ACTIVE",
      },
    ],
  };
  const resolved = resolveRegistryEntry(otherChainFixture, "0x2222222222222222222222222222222222222222");
  assert.equal(resolved, null, "deployments on chains other than 4663 must resolve to null");
});

test("resolveRegistryEntry: multiplierText strips trailing zeros and trailing dot", () => {
  const fixture = {
    assets: [
      {
        tokenSymbol: "CRWD",
        deployments: [{ contractAddress: "0xaaa", chainId: 4663 }],
        currentMultiplier: "4.000000000000000000",
        pendingMultiplier: "",
        status: "ASSET_STATUS_ACTIVE",
      },
      {
        tokenSymbol: "TEST",
        deployments: [{ contractAddress: "0xbbb", chainId: 4663 }],
        currentMultiplier: "1.000566080061092436",
        pendingMultiplier: "1.000600000000000000",
        status: "ASSET_STATUS_ACTIVE",
      },
      {
        tokenSymbol: "TEN",
        deployments: [{ contractAddress: "0xccc", chainId: 4663 }],
        currentMultiplier: "10.0",
        pendingMultiplier: "",
        status: "ASSET_STATUS_ACTIVE",
      },
    ],
  };

  const crwd = resolveRegistryEntry(fixture, "0xaaa") as EquityRegistryEntry;
  assert.equal(crwd.multiplier, 4);
  assert.equal(crwd.multiplierText, "4");
  assert.equal(crwd.pendingMultiplier, false);

  const testAsset = resolveRegistryEntry(fixture, "0xbbb") as EquityRegistryEntry;
  assert.equal(testAsset.multiplier, 1.000566080061092436);
  assert.equal(testAsset.multiplierText, "1.000566", "six decimals is enough to read and still names the ratio");
  assert.equal(testAsset.pendingMultiplier, true);

  const ten = resolveRegistryEntry(fixture, "0xccc") as EquityRegistryEntry;
  assert.equal(ten.multiplier, 10);
  assert.equal(ten.multiplierText, "10");
});

test("resolveRegistryEntry returns malformed when matched entry has non-positive or invalid multiplier", () => {
  const invalidFixture = {
    assets: [
      {
        tokenSymbol: "ZERO",
        deployments: [{ contractAddress: "0x000", chainId: 4663 }],
        currentMultiplier: "0.0",
        pendingMultiplier: "",
      },
    ],
  };
  assert.equal(resolveRegistryEntry(invalidFixture, "0x000"), "malformed");
});

test("resolvePrice: price reply must contain a quote whose deployment equals token address (R)", () => {
  const entry: EquityRegistryEntry = {
    tokenSymbol: "CRWD",
    contractAddress: CRWD_REAL_ADDRESS.toLowerCase(),
    currentMultiplier: "4.0",
    multiplier: 4,
    multiplierText: "4",
    pendingMultiplier: false,
    status: "ASSET_STATUS_ACTIVE",
  };

  // Wrong contract address
  const wrongAddressBody = {
    quotes: [
      {
        tokenSymbol: "CRWD",
        deployments: [{ contractAddress: "0x9999999999999999999999999999999999999999", chainId: 4663 }],
        bid: "239.1",
        ask: "239.6",
        isTradingHalt: false,
        generatedAt: "2026-09-16T11:41:12.016276086Z",
      },
    ],
  };
  const res1 = resolvePrice(wrongAddressBody, entry, Date.parse("2026-09-16T11:41:12.016276086Z"));
  assert.equal(res1.kind, "unavailable");

  // Wrong symbol
  const wrongSymbolBody = {
    quotes: [
      {
        tokenSymbol: "OTHER",
        deployments: [{ contractAddress: CRWD_REAL_ADDRESS, chainId: 4663 }],
        bid: "239.1",
        ask: "239.6",
        isTradingHalt: false,
        generatedAt: "2026-09-16T11:41:12.016276086Z",
      },
    ],
  };
  const res2 = resolvePrice(wrongSymbolBody, entry, Date.parse("2026-09-16T11:41:12.016276086Z"));
  assert.equal(res2.kind, "unavailable");
});

test("resolvePrice: isTradingHalt === true produces halted", () => {
  const entry: EquityRegistryEntry = {
    tokenSymbol: "CRWD",
    contractAddress: CRWD_REAL_ADDRESS.toLowerCase(),
    currentMultiplier: "4.0",
    multiplier: 4,
    multiplierText: "4",
    pendingMultiplier: false,
    status: "ASSET_STATUS_ACTIVE",
  };
  const haltedBody = {
    quotes: [
      {
        tokenSymbol: "CRWD",
        deployments: [{ contractAddress: CRWD_REAL_ADDRESS, chainId: 4663 }],
        bid: "239.1",
        ask: "239.6",
        isTradingHalt: true,
        generatedAt: "2026-09-16T11:41:12.016276086Z",
      },
    ],
  };
  const res = resolvePrice(haltedBody, entry, Date.parse("2026-09-16T11:41:12.016276086Z"));
  assert.equal(res.kind, "halted");
  if (res.kind === "halted") {
    assert.equal(res.symbol, "CRWD");
  }
});

test("resolvePrice: bid/ask finite > 0 and shareMidUsd / tokenReferenceUsd calculation (R)", () => {
  const entry: EquityRegistryEntry = {
    tokenSymbol: "CRWD",
    contractAddress: CRWD_REAL_ADDRESS.toLowerCase(),
    currentMultiplier: "4.000000000000000000",
    multiplier: 4,
    multiplierText: "4",
    pendingMultiplier: false,
    status: "ASSET_STATUS_ACTIVE",
  };

  // Zero / negative bid or ask
  const invalidBidBody = {
    quotes: [
      {
        tokenSymbol: "CRWD",
        deployments: [{ contractAddress: CRWD_REAL_ADDRESS, chainId: 4663 }],
        bid: "0",
        ask: "239.6",
        isTradingHalt: false,
        generatedAt: "2026-09-16T11:41:12.016276086Z",
      },
    ],
  };
  assert.equal(
    resolvePrice(invalidBidBody, entry, Date.parse("2026-09-16T11:41:12.016276086Z")).kind,
    "unavailable",
  );

  // CRWD numbers: bid 239.1, ask 239.6 -> mid 239.35, multiplier 4 -> ref 957.40
  const validRes = resolvePrice(
    PRICE_CRWD_FIXTURE,
    entry,
    Date.parse("2026-09-16T11:41:12.016276086Z") + 10_000,
  );
  assert.equal(validRes.kind, "ok");
  if (validRes.kind === "ok") {
    assert.equal(validRes.symbol, "CRWD");
    assert.equal(validRes.multiplier, 4);
    assert.equal(validRes.multiplierText, "4");
    assert.equal(validRes.shareMidUsd, 239.35);
    assert.equal(validRes.tokenReferenceUsd, 957.4);
    assert.equal(validRes.stale, false);
  }
});

test("resolvePrice: stale threshold (R) - generatedAt unparseable or > 120_000 ms before now", () => {
  const entry: EquityRegistryEntry = {
    tokenSymbol: "CRWD",
    contractAddress: CRWD_REAL_ADDRESS.toLowerCase(),
    currentMultiplier: "4.0",
    multiplier: 4,
    multiplierText: "4",
    pendingMultiplier: false,
    status: "ASSET_STATUS_ACTIVE",
  };

  const quoteTime = Date.parse("2026-09-16T11:41:12.016276086Z");

  // Fresh: 60s later
  const freshRes = resolvePrice(PRICE_CRWD_FIXTURE, entry, quoteTime + 60_000);
  assert.equal(freshRes.kind, "ok");
  if (freshRes.kind === "ok") {
    assert.equal(freshRes.stale, false);
  }

  // Stale: 120_001 ms later
  const staleRes = resolvePrice(PRICE_CRWD_FIXTURE, entry, quoteTime + 120_001);
  assert.equal(staleRes.kind, "ok");
  if (staleRes.kind === "ok") {
    assert.equal(staleRes.stale, true);
  }

  // Stale: unparseable generatedAt
  const unparseableBody = {
    quotes: [
      {
        ...PRICE_CRWD_FIXTURE.quotes[0],
        generatedAt: "invalid-time",
      },
    ],
  };
  const unparseableRes = resolvePrice(unparseableBody, entry, quoteTime);
  assert.equal(unparseableRes.kind, "ok");
  if (unparseableRes.kind === "ok") {
    assert.equal(unparseableRes.stale, true);
  }
});

test("readEquityReference: failed or malformed registry read is unavailable, NEVER not-equity (R)", async () => {
  _resetEquityReferenceCache();

  const mockFailFetch: typeof fetch = async () => {
    return new Response("Internal Server Error", { status: 500 });
  };

  const ref = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFailFetch,
    assertUrl: async () => ({ ok: true }),
  });

  assert.equal(ref.kind, "unavailable", "registry failure must be unavailable");
  assert.notEqual(ref.kind, "not-equity", "registry failure must NEVER be not-equity");
});

test("readEquityReference: redirect 3xx returns unavailable", async () => {
  _resetEquityReferenceCache();

  const mockRedirectFetch: typeof fetch = async () => {
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.com" },
    });
  };

  const ref = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockRedirectFetch,
    assertUrl: async () => ({ ok: true }),
  });

  assert.equal(ref.kind, "unavailable");
});

test("readEquityReference: payload exceeding byte limit returns unavailable", async () => {
  _resetEquityReferenceCache();

  const bigBody = JSON.stringify({ assets: new Array(50000).fill(REGISTRY_CRWD_FIXTURE.assets[0]) });
  const mockBigFetch: typeof fetch = async () => {
    return new Response(bigBody, {
      headers: { "content-length": String(3 * 1024 * 1024) },
    });
  };

  const ref = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockBigFetch,
    assertUrl: async () => ({ ok: true }),
  });

  assert.equal(ref.kind, "unavailable");
});

test("readEquityReference: address not in registry returns not-equity", async () => {
  _resetEquityReferenceCache();

  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes("/rhj/assets")) {
      return new Response(JSON.stringify(REGISTRY_CRWD_FIXTURE));
    }
    return new Response("not found", { status: 404 });
  };

  const ref = await readEquityReference("0x9999999999999999999999999999999999999999", {
    fetchImpl: mockFetch,
    assertUrl: async () => ({ ok: true }),
  });

  assert.equal(ref.kind, "not-equity");
});

test("readEquityReference: successful fetch, single-flight, and price caching", async () => {
  _resetEquityReferenceCache();

  let registryFetches = 0;
  let priceFetches = 0;

  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes("/rhj/assets")) {
      registryFetches += 1;
      return new Response(JSON.stringify(REGISTRY_CRWD_FIXTURE));
    }
    if (u.includes("/rhj/prices/CRWD")) {
      priceFetches += 1;
      return new Response(JSON.stringify(PRICE_CRWD_FIXTURE));
    }
    return new Response("not found", { status: 404 });
  };

  const nowMs = Date.parse("2026-09-16T11:41:12.016276086Z") + 10_000;

  // Concurrent calls join the same in-flight promise (single-flight)
  const [ref1, ref2] = await Promise.all([
    readEquityReference(CRWD_REAL_ADDRESS, {
      fetchImpl: mockFetch,
      now: () => nowMs,
      assertUrl: async () => ({ ok: true }),
    }),
    readEquityReference(CRWD_REAL_ADDRESS, {
      fetchImpl: mockFetch,
      now: () => nowMs,
      assertUrl: async () => ({ ok: true }),
    }),
  ]);

  assert.equal(ref1.kind, "ok");
  assert.equal(ref2.kind, "ok");
  assert.equal(registryFetches, 1, "registry must be fetched exactly once");
  assert.equal(priceFetches, 1, "price must be fetched exactly once");

  // Subsequent call within 15s TTL hits the cache
  const ref3 = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => nowMs + 5_000,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(ref3.kind, "ok");
  assert.equal(priceFetches, 1, "cached price must not trigger a second network fetch");

  // After cache reset, fetches again
  _resetEquityReferenceCache();
  const ref4 = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => nowMs + 6_000,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(ref4.kind, "ok");
  assert.equal(priceFetches, 2, "price must be refetched after cache reset");
});

test("readEquityReference: never caches an unavailable outcome", async () => {
  _resetEquityReferenceCache();

  let callCount = 0;
  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes("/rhj/assets")) {
      return new Response(JSON.stringify(REGISTRY_CRWD_FIXTURE));
    }
    callCount += 1;
    if (callCount === 1) {
      return new Response("Service Unavailable", { status: 503 });
    }
    return new Response(JSON.stringify(PRICE_CRWD_FIXTURE));
  };

  const ref1 = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(ref1.kind, "unavailable");

  // Second call must NOT return a cached unavailable; it must re-fetch
  const ref2 = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(ref2.kind, "ok");
});

test("readEquityReference: a registry reply with no assets array is not cached for the hour", async () => {
  _resetEquityReferenceCache();
  let registryCalls = 0;
  let healthy = false;
  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes("/rhj/assets")) {
      registryCalls += 1;
      return new Response(JSON.stringify(healthy ? REGISTRY_CRWD_FIXTURE : { error: "maintenance" }));
    }
    return new Response(JSON.stringify({ ...PRICE_CRWD_FIXTURE }));
  };
  const deps = { fetchImpl: mockFetch, assertUrl: async () => ({ ok: true }) as const, now: () => Date.parse("2026-09-16T11:41:30Z") };

  assert.equal((await readEquityReference(CRWD_REAL_ADDRESS, deps)).kind, "unavailable");
  healthy = true;
  const recovered = await readEquityReference(CRWD_REAL_ADDRESS, deps);
  assert.equal(registryCalls, 2, "the malformed reply must not have been served from cache");
  assert.equal(recovered.kind, "ok");
});

test("resolveRegistryEntry: parses tradingCapabilities and handles malformed non-object", () => {
  const fixtureWithCaps = {
    assets: [
      {
        tokenSymbol: "AAPL",
        deployments: [{ contractAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", chainId: 4663 }],
        currentMultiplier: "1.000000000000000000",
        pendingMultiplier: "",
        status: "ASSET_STATUS_ACTIVE",
        tradingCapabilities: {
          market: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_TRADABLE" },
          extended: { whole: "TRADING_STATUS_TRADABLE", fractional: "TRADING_STATUS_UNTRADABLE" },
          overnight: { whole: "TRADING_STATUS_UNTRADABLE", fractional: "TRADING_STATUS_UNTRADABLE" },
        },
      },
    ],
  };

  const entry = resolveRegistryEntry(fixtureWithCaps, "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9") as EquityRegistryEntry;
  assert.ok(entry && typeof entry === "object");
  assert.equal(entry.tokenSymbol, "AAPL");
  assert.ok(entry.tradingCapabilities);
  assert.equal(entry.tradingCapabilities?.market?.whole, TRADING_STATUS_TRADABLE);
  assert.equal(entry.tradingCapabilities?.extended?.fractional, TRADING_STATUS_UNTRADABLE);

  // Non-object tradingCapabilities returns malformed
  const malformedFixture = {
    assets: [
      {
        tokenSymbol: "AAPL",
        deployments: [{ contractAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", chainId: 4663 }],
        currentMultiplier: "1.0",
        tradingCapabilities: "invalid-string",
      },
    ],
  };
  assert.equal(resolveRegistryEntry(malformedFixture, "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9"), "malformed");
});

test("isSessionTradable: distinguishes market, extended, overnight with whole/fractional", () => {
  const caps = {
    market: { whole: TRADING_STATUS_TRADABLE, fractional: TRADING_STATUS_UNTRADABLE },
    extended: { whole: TRADING_STATUS_UNTRADABLE, fractional: TRADING_STATUS_TRADABLE },
    overnight: { whole: TRADING_STATUS_UNTRADABLE, fractional: TRADING_STATUS_UNTRADABLE },
  };

  assert.equal(isSessionTradable(caps, "market"), true, "whole tradable makes session tradable");
  assert.equal(isSessionTradable(caps, "extended"), true, "fractional tradable makes session tradable");
  assert.equal(isSessionTradable(caps, "overnight"), false, "both untradable makes session untradable");
  assert.equal(isSessionTradable(null, "market"), false, "null caps is not tradable");
  assert.equal(isSessionTradable(caps, "unknown"), false, "missing session is not tradable");
});

test("getTradingSessionForTime and getEasternTradingSession: exact boundary behavior at 04:00, 09:30, 16:00, 20:00", () => {
  // Test time windows directly
  assert.equal(getTradingSessionForTime(3, 59), "overnight");
  assert.equal(getTradingSessionForTime(4, 0), "extended");
  assert.equal(getTradingSessionForTime(9, 29), "extended");
  assert.equal(getTradingSessionForTime(9, 30), "market");
  assert.equal(getTradingSessionForTime(15, 59), "market");
  assert.equal(getTradingSessionForTime(16, 0), "extended");
  assert.equal(getTradingSessionForTime(19, 59), "extended");
  assert.equal(getTradingSessionForTime(20, 0), "overnight");

  // Wednesday in EDT (UTC-4): 2026-09-23
  // 03:59:59 EDT = 07:59:59 UTC -> overnight
  assert.equal(getEasternTradingSession(Date.parse("2026-09-23T07:59:59Z")).session, "overnight");
  // 04:00:00 EDT = 08:00:00 UTC -> extended
  assert.equal(getEasternTradingSession(Date.parse("2026-09-23T08:00:00Z")).session, "extended");
  // 09:29:59 EDT = 13:29:59 UTC -> extended
  assert.equal(getEasternTradingSession(Date.parse("2026-09-23T13:29:59Z")).session, "extended");
  // 09:30:00 EDT = 13:30:00 UTC -> market
  assert.equal(getEasternTradingSession(Date.parse("2026-09-23T13:30:00Z")).session, "market");
  // 15:59:59 EDT = 19:59:59 UTC -> market
  assert.equal(getEasternTradingSession(Date.parse("2026-09-23T19:59:59Z")).session, "market");
  // 16:00:00 EDT = 20:00:00 UTC -> extended
  assert.equal(getEasternTradingSession(Date.parse("2026-09-23T20:00:00Z")).session, "extended");
  // 19:59:59 EDT = 23:59:59 UTC -> extended
  assert.equal(getEasternTradingSession(Date.parse("2026-09-23T23:59:59Z")).session, "extended");
  // 20:00:00 EDT = 00:00:00 UTC (2026-09-24) -> overnight
  assert.equal(getEasternTradingSession(Date.parse("2026-09-24T00:00:00Z")).session, "overnight");

  // Weekend: Saturday 2026-09-26 12:00 UTC -> weekend
  const sat = getEasternTradingSession(Date.parse("2026-09-26T16:00:00Z"));
  assert.equal(sat.session, "weekend");
  assert.equal(sat.isWeekend, true);
});

test("evaluateSessionCapability: handles weekend and normal weekday sessions", () => {
  const caps = {
    market: { whole: TRADING_STATUS_TRADABLE, fractional: TRADING_STATUS_TRADABLE },
    extended: { whole: TRADING_STATUS_TRADABLE, fractional: TRADING_STATUS_TRADABLE },
    overnight: { whole: TRADING_STATUS_TRADABLE, fractional: TRADING_STATUS_TRADABLE },
  };

  // Saturday (weekend) is unavailable even when capabilities are tradable, unless weekend is documented
  const satRes = evaluateSessionCapability(caps, Date.parse("2026-09-26T16:00:00Z"));
  assert.equal(satRes.tradable, false);
  assert.equal(satRes.session, "weekend");

  // Weekend with documented weekend capability
  const capsWithWeekend = {
    ...caps,
    weekend: { whole: TRADING_STATUS_TRADABLE },
  };
  const satResTradable = evaluateSessionCapability(capsWithWeekend, Date.parse("2026-09-26T16:00:00Z"));
  assert.equal(satResTradable.tradable, true);

  // Weekday market session (Wednesday 10:00 EDT)
  const wedRes = evaluateSessionCapability(caps, Date.parse("2026-09-23T14:00:00Z"));
  assert.equal(wedRes.tradable, true);
  assert.equal(wedRes.session, "market");
});

test("session check refreshes after 60 seconds while reference reads remain cached for one hour", async () => {
  _resetEquityReferenceCache();

  let registryCalls = 0;
  let currentTradingStatus = TRADING_STATUS_TRADABLE;

  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes("/rhj/assets")) {
      registryCalls += 1;
      return new Response(
        JSON.stringify({
          assets: [
            {
              tokenSymbol: "CRWD",
              deployments: [{ contractAddress: CRWD_REAL_ADDRESS, chainId: 4663 }],
              currentMultiplier: "4.000000000000000000",
              pendingMultiplier: "",
              status: "ASSET_STATUS_ACTIVE",
              tradingCapabilities: {
                market: { whole: currentTradingStatus, fractional: currentTradingStatus },
                extended: { whole: currentTradingStatus, fractional: currentTradingStatus },
                overnight: { whole: currentTradingStatus, fractional: currentTradingStatus },
              },
            },
          ],
        }),
      );
    }
    if (u.includes("/rhj/prices/CRWD")) {
      return new Response(JSON.stringify(PRICE_CRWD_FIXTURE));
    }
    return new Response("not found", { status: 404 });
  };

  const T0 = Date.parse("2026-09-23T14:00:00Z"); // Wednesday 10:00 EDT (market session)

  // 1. Initial call to checkEquitySessionCapability at T0
  const session1 = await checkEquitySessionCapability(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => T0,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(session1.kind, "tradable");
  assert.equal(registryCalls, 1, "first session check fetches registry");

  // 2. Initial call to readEquityReference at T0
  const ref1 = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => T0,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(ref1.kind, "ok");
  assert.equal(registryCalls, 2, "first equity reference check fetches reference registry (separate cache)");

  // 3. At T0 + 30 seconds (within 60s session TTL)
  const session2 = await checkEquitySessionCapability(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => T0 + 30_000,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(session2.kind, "tradable");
  assert.equal(registryCalls, 2, "session check at T0 + 30s hits session cache without network fetch");

  const ref2 = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => T0 + 30_000,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(ref2.kind, "ok");
  assert.equal(registryCalls, 2, "reference check at T0 + 30s hits reference cache without network fetch");

  // 4. At T0 + 61 seconds:
  // Server-side status flips to UNTRADABLE (e.g. trading halt)
  currentTradingStatus = TRADING_STATUS_UNTRADABLE;

  const session3 = await checkEquitySessionCapability(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => T0 + 61_000,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(session3.kind, "disabled", "session check after 60s must observe new untradable status");
  assert.equal(registryCalls, 3, "session check after 60s must trigger network refresh");

  // Meanwhile, readEquityReference at T0 + 61 seconds remains cached under its 1-hour TTL
  const ref3 = await readEquityReference(CRWD_REAL_ADDRESS, {
    fetchImpl: mockFetch,
    now: () => T0 + 61_000,
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(ref3.kind, "ok");
  assert.equal(registryCalls, 3, "reference check remains cached under 1-hour TTL and does not refetch");

  // 5. Test no stale fallback: if session cache expires and next fetch fails, it must fail closed
  const failFetch: typeof fetch = async () => new Response("Service Unavailable", { status: 503 });
  const sessionFail = await checkEquitySessionCapability(CRWD_REAL_ADDRESS, {
    fetchImpl: failFetch,
    now: () => T0 + 130_000, // expired past second cache window
    assertUrl: async () => ({ ok: true }),
  });
  assert.equal(sessionFail.kind, "unavailable", "session check must not fall back to stale cached response on error");
});


