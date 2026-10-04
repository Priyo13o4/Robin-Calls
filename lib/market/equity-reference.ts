import { assertPublicHttpsUrl, type SafeUrlResult } from "../security/ssrf";
import { reportError } from "../observability/reporter";
import { ROBINHOOD_CHAIN_ID } from "../config/chain";
import { CANONICAL_STOCK_TOKENS } from "../trade/canonical-stocks";
import { CANONICAL_STOCK_ADDRESSES } from "../trade/types";

export const CANONICAL_RWA_ADDRESSES: ReadonlySet<string> = new Set([
  ...Array.from(CANONICAL_STOCK_ADDRESSES).map((a) => a.toLowerCase()),
  ...CANONICAL_STOCK_TOKENS.map((t) => t.address.toLowerCase()),
]);

export function isCanonicalRwa(address: string): boolean {
  return CANONICAL_RWA_ADDRESSES.has(address.trim().toLowerCase());
}

export type EquityReference =
  | { kind: "not-equity" }
  | { kind: "unavailable"; detail: string }
  | { kind: "halted"; symbol: string }
  | {
      kind: "ok";
      symbol: string;
      multiplier: number;
      multiplierText: string;
      pendingMultiplier: boolean;
      shareMidUsd: number;
      tokenReferenceUsd: number;
      generatedAt: string;
      stale: boolean;
    };

export const TRADING_STATUS_TRADABLE = "TRADING_STATUS_TRADABLE";
export const TRADING_STATUS_UNTRADABLE = "TRADING_STATUS_UNTRADABLE";

export type TradingSession = "market" | "extended" | "overnight";

export interface SessionCapabilityStatus {
  whole?: string | null;
  fractional?: string | null;
}

export interface TradingCapabilities {
  market?: SessionCapabilityStatus | null;
  extended?: SessionCapabilityStatus | null;
  overnight?: SessionCapabilityStatus | null;
  [session: string]: SessionCapabilityStatus | null | undefined;
}

export interface EquityRegistryEntry {
  tokenSymbol: string;
  contractAddress: string;
  currentMultiplier: string;
  multiplier: number;
  multiplierText: string;
  pendingMultiplier: boolean;
  status: string;
  tradingCapabilities?: TradingCapabilities | null;
}

export function parseTradingCapabilities(raw: unknown): TradingCapabilities | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const parseSession = (val: unknown): SessionCapabilityStatus | null => {
    if (!val || typeof val !== "object" || Array.isArray(val)) return null;
    const s = val as Record<string, unknown>;
    return {
      whole: typeof s.whole === "string" ? s.whole : null,
      fractional: typeof s.fractional === "string" ? s.fractional : null,
    };
  };

  const result: TradingCapabilities = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = parseSession(val);
  }
  return result;
}

export function isSessionTradable(
  caps: TradingCapabilities | null | undefined,
  session: TradingSession | string,
): boolean {
  if (!caps) return false;
  const s = caps[session];
  if (!s) return false;
  return (
    s.whole === TRADING_STATUS_TRADABLE ||
    s.fractional === TRADING_STATUS_TRADABLE
  );
}

export function getTradingSessionForTime(hour: number, minute: number): TradingSession {
  const totalMinutes = hour * 60 + minute;
  if (totalMinutes >= 240 && totalMinutes < 570) {
    return "extended";
  }
  if (totalMinutes >= 570 && totalMinutes < 960) {
    return "market";
  }
  if (totalMinutes >= 960 && totalMinutes < 1200) {
    return "extended";
  }
  return "overnight";
}

export function getEasternTradingSession(nowMs: number | Date = Date.now()): {
  session: TradingSession | "weekend";
  isWeekend: boolean;
  hour: number;
  minute: number;
} {
  const date = typeof nowMs === "number" ? new Date(nowMs) : nowMs;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekday = map.weekday;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);

  const isWeekend = weekday === "Sat" || weekday === "Sun";
  if (isWeekend) {
    return { session: "weekend", isWeekend: true, hour, minute };
  }

  const session = getTradingSessionForTime(hour, minute);
  return { session, isWeekend: false, hour, minute };
}

export interface SessionEvaluationResult {
  tradable: boolean;
  session: TradingSession | "weekend";
  isWeekend: boolean;
  reason?: string;
}

export function evaluateSessionCapability(
  caps: TradingCapabilities | null | undefined,
  nowMs: number | Date = Date.now(),
): SessionEvaluationResult {
  const { session, isWeekend } = getEasternTradingSession(nowMs);
  if (isWeekend) {
    const weekendTradable = isSessionTradable(caps, "weekend");
    return {
      tradable: weekendTradable,
      session: "weekend",
      isWeekend: true,
      reason: weekendTradable
        ? undefined
        : "Trading is unavailable during the weekend session.",
    };
  }

  const tradable = isSessionTradable(caps, session);
  return {
    tradable,
    session,
    isWeekend: false,
    reason: tradable
      ? undefined
      : `Trading is unavailable during the ${session} session.`,
  };
}

const REGISTRY_URL = "https://api.robinhood.com/rhj/assets";
const PRICE_URL_PREFIX = "https://api.robinhood.com/rhj/prices/";

const REGISTRY_MAX_BYTES = 2 * 1024 * 1024;
const PRICE_MAX_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const REGISTRY_TTL_MS = 60 * 60 * 1_000;
export const SESSION_REGISTRY_TTL_MS = 60 * 1_000;
const PRICE_TTL_MS = 15 * 1_000;
const STALE_THRESHOLD_MS = 120_000;

/** Display only, at most 6 decimals: "4.000…" reads "4", "1.000566080061092436" reads "1.000566". */
function cleanDecimal(raw: string): string {
  const [whole, frac = ""] = raw.trim().split(".");
  const kept = frac.slice(0, 6).replace(/0+$/, "");
  // A ratio below 0.000001 would round to "0 shares"; print it whole instead.
  if (!kept && Number(whole) === 0) return raw.trim();
  return kept ? `${whole}.${kept}` : whole;
}

export function resolveRegistryEntry(
  body: unknown,
  address: string,
): EquityRegistryEntry | null | "malformed" {
  if (!body || typeof body !== "object") return "malformed";
  const assets = (body as Record<string, unknown>).assets;
  if (!Array.isArray(assets)) return "malformed";

  const target = address.trim().toLowerCase();

  for (const item of assets) {
    if (!item || typeof item !== "object") continue;
    const asset = item as Record<string, unknown>;
    const deployments = Array.isArray(asset.deployments) ? asset.deployments : [];

    const hasDeployment = deployments.some((dep) => {
      if (!dep || typeof dep !== "object") return false;
      const d = dep as Record<string, unknown>;
      return (
        Number(d.chainId) === ROBINHOOD_CHAIN_ID &&
        typeof d.contractAddress === "string" &&
        d.contractAddress.toLowerCase() === target
      );
    });

    if (hasDeployment) {
      if (
        typeof asset.tokenSymbol !== "string" ||
        !asset.tokenSymbol ||
        typeof asset.currentMultiplier !== "string"
      ) {
        return "malformed";
      }

      if (
        asset.tradingCapabilities !== undefined &&
        asset.tradingCapabilities !== null &&
        (typeof asset.tradingCapabilities !== "object" || Array.isArray(asset.tradingCapabilities))
      ) {
        return "malformed";
      }

      const multiplier = Number(asset.currentMultiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0) {
        return "malformed";
      }

      const multiplierText = cleanDecimal(asset.currentMultiplier);
      const pendingMultiplier =
        typeof asset.pendingMultiplier === "string" &&
        asset.pendingMultiplier.trim().length > 0;

      const tradingCapabilities = parseTradingCapabilities(asset.tradingCapabilities);

      return {
        tokenSymbol: asset.tokenSymbol,
        contractAddress: target,
        currentMultiplier: asset.currentMultiplier,
        multiplier,
        multiplierText,
        pendingMultiplier,
        status: typeof asset.status === "string" ? asset.status : "",
        tradingCapabilities,
      };
    }
  }

  return null;
}

// Pure quote validator: matches deployment contractAddress and symbol, enforces finite prices.
export function resolvePrice(
  body: unknown,
  entry: EquityRegistryEntry,
  nowMs: number,
): EquityReference {
  if (!body || typeof body !== "object") {
    return { kind: "unavailable", detail: "the price API returned no object" };
  }
  const quotes = (body as Record<string, unknown>).quotes;
  if (!Array.isArray(quotes)) {
    return { kind: "unavailable", detail: "the price API returned no quotes array" };
  }

  const matchingQuote = quotes.find((q) => {
    if (!q || typeof q !== "object") return false;
    const quote = q as Record<string, unknown>;
    if (quote.tokenSymbol !== entry.tokenSymbol) return false;
    const deps = Array.isArray(quote.deployments) ? quote.deployments : [];
    return deps.some((d) => {
      if (!d || typeof d !== "object") return false;
      const dep = d as Record<string, unknown>;
      return (
        Number(dep.chainId) === ROBINHOOD_CHAIN_ID &&
        typeof dep.contractAddress === "string" &&
        dep.contractAddress.toLowerCase() === entry.contractAddress.toLowerCase()
      );
    });
  }) as Record<string, unknown> | undefined;

  if (!matchingQuote) {
    return { kind: "unavailable", detail: "no matching quote for token address" };
  }

  if (matchingQuote.isTradingHalt === true) {
    return { kind: "halted", symbol: entry.tokenSymbol };
  }

  const bid =
    typeof matchingQuote.bid === "string" || typeof matchingQuote.bid === "number"
      ? Number(matchingQuote.bid)
      : NaN;
  const ask =
    typeof matchingQuote.ask === "string" || typeof matchingQuote.ask === "number"
      ? Number(matchingQuote.ask)
      : NaN;

  if (!Number.isFinite(bid) || bid <= 0 || !Number.isFinite(ask) || ask <= 0) {
    return { kind: "unavailable", detail: "invalid bid or ask price" };
  }

  if (!Number.isFinite(entry.multiplier) || entry.multiplier <= 0) {
    return { kind: "unavailable", detail: "invalid multiplier" };
  }

  const shareMidUsd = (bid + ask) / 2;
  const tokenReferenceUsd = shareMidUsd * entry.multiplier;

  const generatedAt =
    typeof matchingQuote.generatedAt === "string" ? matchingQuote.generatedAt : "";
  const genTime = Date.parse(generatedAt);
  const stale = !Number.isFinite(genTime) || nowMs - genTime > STALE_THRESHOLD_MS;

  return {
    kind: "ok",
    symbol: entry.tokenSymbol,
    multiplier: entry.multiplier,
    multiplierText: entry.multiplierText,
    pendingMultiplier: entry.pendingMultiplier,
    shareMidUsd,
    tokenReferenceUsd,
    generatedAt,
    stale,
  };
}

async function fetchBoundedJson(
  url: string,
  maxBytes: number,
  revalidateSeconds: number,
  fetchImpl: typeof fetch,
  assertUrlImpl: (url: string) => Promise<SafeUrlResult>,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  const safe = await assertUrlImpl(url);
  if (!safe.ok) {
    return { ok: false, detail: safe.reason ?? "SSRF check failed" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      redirect: "manual",
      next: { revalidate: revalidateSeconds },
    } as RequestInit);

    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      return { ok: false, detail: "the API redirected" };
    }
    if (!res.ok) {
      return { ok: false, detail: `the API answered ${res.status}` };
    }

    const contentLength = res.headers?.get?.("content-length");
    if (contentLength !== null && contentLength !== undefined) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > maxBytes) {
        return { ok: false, detail: "the API answered with too much data" };
      }
    }

    if (!res.body) {
      return { ok: false, detail: "the API returned no body" };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            return { ok: false, detail: "the API answered with too much data" };
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader may already be released or closed
      }
    }

    const totalBuffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      totalBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(totalBuffer);
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}

interface RegistryCacheEntry {
  body: unknown;
  expiresAt: number;
}

interface PriceCacheEntry {
  ref: EquityReference;
  expiresAt: number;
}

let registryCache: RegistryCacheEntry | null = null;
let registryInFlight: Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> | null = null;

let sessionRegistryCache: RegistryCacheEntry | null = null;
let sessionRegistryInFlight: Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> | null = null;

const priceCache = new Map<string, PriceCacheEntry>();
const priceInFlight = new Map<string, Promise<EquityReference>>();

export function _resetEquityReferenceCache(): void {
  registryCache = null;
  registryInFlight = null;
  sessionRegistryCache = null;
  sessionRegistryInFlight = null;
  priceCache.clear();
  priceInFlight.clear();
}

export async function fetchEquityRegistry(deps?: {
  fetchImpl?: typeof fetch;
  now?: () => number;
  assertUrl?: (url: string) => Promise<SafeUrlResult>;
}): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const now = deps?.now ? deps.now() : Date.now();

  if (registryCache && now < registryCache.expiresAt) {
    return { ok: true, data: registryCache.body };
  }
  if (registryInFlight) {
    return registryInFlight;
  }

  registryInFlight = fetchBoundedJson(
    REGISTRY_URL,
    REGISTRY_MAX_BYTES,
    60,
    fetchImpl,
    deps?.assertUrl ?? assertPublicHttpsUrl,
  )
    .then((result) => {
      // A reply without an assets array is not a registry: caching it would answer
      // "unavailable" for an hour after Robinhood recovered.
      if (result.ok && Array.isArray((result.data as { assets?: unknown } | null)?.assets)) {
        const exp = (deps?.now ? deps.now() : Date.now()) + REGISTRY_TTL_MS;
        registryCache = { body: result.data, expiresAt: exp };
      }
      return result;
    })
    .finally(() => {
      registryInFlight = null;
    });

  return registryInFlight;
}

export async function fetchSessionRegistry(deps?: {
  fetchImpl?: typeof fetch;
  now?: () => number;
  assertUrl?: (url: string) => Promise<SafeUrlResult>;
}): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const now = deps?.now ? deps.now() : Date.now();

  if (sessionRegistryCache && now < sessionRegistryCache.expiresAt) {
    return { ok: true, data: sessionRegistryCache.body };
  }
  // Clear any expired cache entry to enforce strictly no stale fallback
  sessionRegistryCache = null;

  if (sessionRegistryInFlight) {
    return sessionRegistryInFlight;
  }

  sessionRegistryInFlight = fetchBoundedJson(
    REGISTRY_URL,
    REGISTRY_MAX_BYTES,
    60,
    fetchImpl,
    deps?.assertUrl ?? assertPublicHttpsUrl,
  )
    .then((result) => {
      if (result.ok && Array.isArray((result.data as { assets?: unknown } | null)?.assets)) {
        const exp = (deps?.now ? deps.now() : Date.now()) + SESSION_REGISTRY_TTL_MS;
        sessionRegistryCache = { body: result.data, expiresAt: exp };
      }
      return result;
    })
    .finally(() => {
      sessionRegistryInFlight = null;
    });

  return sessionRegistryInFlight;
}

export type EquitySessionCheckResult =
  | { kind: "tradable"; entry: EquityRegistryEntry; session: TradingSession | "weekend" }
  | { kind: "disabled"; symbol: string; session: TradingSession | "weekend"; reason: string }
  | { kind: "not-equity" }
  | { kind: "unavailable"; detail: string; malformed?: boolean };

export async function checkEquitySessionCapability(
  address: string,
  deps?: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    assertUrl?: (url: string) => Promise<SafeUrlResult>;
    fetchRegistry?: (deps?: {
      fetchImpl?: typeof fetch;
      now?: () => number;
      assertUrl?: (url: string) => Promise<SafeUrlResult>;
    }) => Promise<{ ok: true; data: unknown } | { ok: false; detail: string }>;
  },
): Promise<EquitySessionCheckResult> {
  const target = address.trim().toLowerCase();
  const fetcher = deps?.fetchRegistry ?? fetchSessionRegistry;
  const regResult = await fetcher(deps);

  if (!regResult.ok) {
    return { kind: "unavailable", detail: regResult.detail };
  }

  const entry = resolveRegistryEntry(regResult.data, target);
  if (entry === "malformed") {
    return { kind: "unavailable", detail: "Equity registry entry was malformed", malformed: true };
  }

  if (entry === null) {
    return { kind: "not-equity" };
  }

  const nowMs = deps?.now ? deps.now() : Date.now();
  const evalResult = evaluateSessionCapability(entry.tradingCapabilities, nowMs);

  if (!evalResult.tradable) {
    return {
      kind: "disabled",
      symbol: entry.tokenSymbol,
      session: evalResult.session,
      reason: `${entry.tokenSymbol} is unavailable for trading during the ${evalResult.session} session.`,
    };
  }

  return {
    kind: "tradable",
    entry,
    session: evalResult.session,
  };
}

export async function readEquityReference(
  address: string,
  deps?: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    assertUrl?: (url: string) => Promise<SafeUrlResult>;
  },
): Promise<EquityReference> {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const now = deps?.now ? deps.now() : Date.now();
  const target = address.trim().toLowerCase();

  const cachedPrice = priceCache.get(target);
  if (cachedPrice && now < cachedPrice.expiresAt) {
    return cachedPrice.ref;
  }

  const inFlightPrice = priceInFlight.get(target);
  if (inFlightPrice) {
    return inFlightPrice;
  }

  const pricePromise = (async (): Promise<EquityReference> => {
    const regResult = await fetchEquityRegistry(deps);

    if (!regResult.ok) {
      await reportError({
        code: "RC_MARKET_UNAVAILABLE",
        message: `Equity registry fetch failed: ${regResult.detail}`,
        operation: "market.readEquityReference",
        details: { address: target },
      }).catch(() => {});
      return { kind: "unavailable", detail: regResult.detail };
    }

    const entry = resolveRegistryEntry(regResult.data, target);
    if (entry === "malformed") {
      await reportError({
        code: "RC_MARKET_UNAVAILABLE",
        message: "Equity registry entry was malformed",
        operation: "market.readEquityReference",
        details: { address: target },
      }).catch(() => {});
      return { kind: "unavailable", detail: "malformed registry entry" };
    }

    if (entry === null) {
      return { kind: "not-equity" };
    }

    const priceUrl = `${PRICE_URL_PREFIX}${encodeURIComponent(entry.tokenSymbol)}`;
    const priceResult = await fetchBoundedJson(
      priceUrl,
      PRICE_MAX_BYTES,
      15,
      fetchImpl,
      deps?.assertUrl ?? assertPublicHttpsUrl,
    );

    if (!priceResult.ok) {
      await reportError({
        code: "RC_MARKET_UNAVAILABLE",
        message: `Equity price fetch failed: ${priceResult.detail}`,
        operation: "market.readEquityReference",
        details: { address: target, symbol: entry.tokenSymbol },
      }).catch(() => {});
      return { kind: "unavailable", detail: priceResult.detail };
    }

    const currentNow = deps?.now ? deps.now() : Date.now();
    const ref = resolvePrice(priceResult.data, entry, currentNow);

    if (ref.kind === "unavailable") {
      await reportError({
        code: "RC_MARKET_UNAVAILABLE",
        message: `Equity price resolution failed: ${ref.detail}`,
        operation: "market.readEquityReference",
        details: { address: target, symbol: entry.tokenSymbol },
      }).catch(() => {});
      return ref;
    }

    priceCache.set(target, {
      ref,
      expiresAt: currentNow + PRICE_TTL_MS,
    });
    return ref;
  })().finally(() => {
    priceInFlight.delete(target);
  });

  priceInFlight.set(target, pricePromise);
  return pricePromise;
}
