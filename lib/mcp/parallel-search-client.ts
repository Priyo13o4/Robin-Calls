"use client";

/** Keyless, browser-only clients for Parallel Search and DexScreener. */

const PARALLEL_MCP_ENDPOINT = "https://search.parallel.ai/mcp";
const DEXSCREENER_API = "https://api.dexscreener.com";
const CACHE_TTL_MS = 15 * 60 * 1000;
const PARTIAL_CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 64;
const MAX_EXCERPT_CHARS = 500;
const MAX_URLS = 8;
const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const NEWS_FRESHNESS_DAYS = 30;
const CACHE_VERSION = 7;

export interface MarketNewsItem {
  title: string;
  url: string;
  domain: string;
  publishDate: string | null;
  excerpt: string;
  category?: "EARNINGS" | "CATALYST" | "MACRO" | "PRODUCT" | "RATING" | "NEWS";
}

export type BriefCompleteness = "complete" | "partial";
export interface RwaMarketBrief {
  symbol: string;
  name: string;
  fetchedAt: string;
  completeness: BriefCompleteness;
  /** Explicitly says external search found no source tied to this exact token/project identity. */
  emptyMessage?: string;
  items: MarketNewsItem[];
  valuationHint?: string;
}

export interface MarketBriefOptions {
  kind?: "trade" | "rwa";
  address?: string;
  chainId?: number;
}

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}
interface ParallelSearchResult {
  title?: string | null;
  url?: string;
  publish_date?: string | null;
  excerpts?: string[];
}
interface ParallelSearchResponse {
  results?: ParallelSearchResult[];
  errors?: Array<{ url?: string; error?: string }>;
}

const inFlightBriefs = new Map<string, Promise<RwaMarketBrief>>();
const memoryBriefs = new Map<string, { cachedAt: number; brief: RwaMarketBrief }>();

function safeHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const ipLiteral = host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    const publicDnsName = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host);
    if (url.protocol !== "https:" || url.username || url.password || !publicDnsName || host.length > 253 || ipLiteral ||
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host === "home.arpa") return null;
    return url;
  } catch {
    return null;
  }
}

function extractDomain(raw: string): string {
  return safeHttpsUrl(raw)?.hostname.replace(/^www\./, "") ?? "source";
}

/** Flatten hostile or malformed third-party text before putting it in a model prompt. */
export function defangWebText(value: unknown, maxLen = MAX_EXCERPT_CHARS): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s{2,}/g, " ").trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

async function readBoundedText(response: Response, limit = MAX_PROVIDER_RESPONSE_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("Provider response exceeded its size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("Provider response exceeded its size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

function parseMcpResponse(body: string, contentType: string): { result?: McpToolResult; error?: { message?: string } } {
  try { return JSON.parse(body) as { result?: McpToolResult; error?: { message?: string } }; }
  catch {
    if (!contentType.toLowerCase().includes("text/event-stream")) {
      throw new Error("Parallel Search returned an unreadable MCP response.");
    }
  }

  // Streamable HTTP permits a JSON-RPC response to arrive in an SSE stream.
  // The browser request advertises both supported response types, so decode
  // `data:` frames instead of assuming every successful response is JSON.
  const messages: Array<{ result?: McpToolResult; error?: { message?: string } }> = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const message = JSON.parse(data) as { result?: McpToolResult; error?: { message?: string } };
      if (message && typeof message === "object" && (message.result || message.error)) messages.push(message);
    } catch { /* ignore non-JSON SSE frames such as keepalive comments */ }
  }
  const response = messages.find((message) => message.result || message.error);
  if (!response) throw new Error("Parallel Search returned an unreadable MCP event stream.");
  return response;
}

function briefKey(symbol: string, name: string, options: MarketBriefOptions): string {
  return JSON.stringify([
    CACHE_VERSION, options.kind ?? "rwa", options.chainId ?? (options.kind === "trade" ? 4663 : ""),
    options.address?.trim().toLowerCase() ?? "", defangWebText(symbol, 80).toUpperCase(), defangWebText(name, 160).toLowerCase(),
  ]);
}

function storageKey(key: string): string { return `rc_mcp_brief_${encodeURIComponent(key)}`; }

function briefCacheTtl(brief: RwaMarketBrief): number {
  return brief.completeness === "partial" ? PARTIAL_CACHE_TTL_MS : CACHE_TTL_MS;
}

function isCacheableBrief(brief: RwaMarketBrief): boolean {
  // An empty partial response proves only that no results arrived before the
  // failed source did. Let ordinary loads try again instead of caching absence.
  return brief.completeness === "complete" || brief.items.length > 0;
}

interface BriefCacheEntry {
  cachedAt: number;
  brief: RwaMarketBrief;
}

function isBriefCacheEntry(value: unknown): value is BriefCacheEntry {
  if (!isRecord(value)) return false;
  const entry = value;
  const brief = entry.brief;
  if (typeof entry.cachedAt !== "number" || !Number.isFinite(entry.cachedAt) || !isRecord(brief)) return false;
  return typeof brief.symbol === "string" && typeof brief.name === "string" && typeof brief.fetchedAt === "string" &&
    (brief.completeness === "complete" || brief.completeness === "partial") && Array.isArray(brief.items) &&
    brief.items.every((item) => isRecord(item) && typeof item.title === "string" && typeof item.url === "string" &&
      typeof item.domain === "string" && (item.publishDate === null || typeof item.publishDate === "string") &&
      typeof item.excerpt === "string") &&
    (brief.emptyMessage === undefined || typeof brief.emptyMessage === "string") &&
    (brief.valuationHint === undefined || typeof brief.valuationHint === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSessionCache(key: string): RwaMarketBrief | null {
  try {
    const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(storageKey(key));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isBriefCacheEntry(parsed) && isCacheableBrief(parsed.brief) &&
      Date.now() - parsed.cachedAt < briefCacheTtl(parsed.brief)) return parsed.brief;
  } catch { /* unavailable storage is an ordinary cache miss */ }
  const memory = memoryBriefs.get(key);
  if (memory && isCacheableBrief(memory.brief) && Date.now() - memory.cachedAt < briefCacheTtl(memory.brief)) return memory.brief;
  memoryBriefs.delete(key);
  return null;
}

function writeSessionCache(key: string, brief: RwaMarketBrief): void {
  if (!isCacheableBrief(brief)) return;
  const entry = { cachedAt: Date.now(), brief };
  for (const [cachedKey, cached] of memoryBriefs) {
    if (entry.cachedAt - cached.cachedAt >= briefCacheTtl(cached.brief)) memoryBriefs.delete(cachedKey);
  }
  memoryBriefs.delete(key);
  while (memoryBriefs.size >= MAX_CACHE_ENTRIES) memoryBriefs.delete(memoryBriefs.keys().next().value!);
  memoryBriefs.set(key, entry);
  try {
    if (typeof window !== "undefined") {
      const storage = window.sessionStorage;
      const prefix = "rc_mcp_brief_";
      const entries: Array<{ key: string; cachedAt: number }> = [];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
      for (const storageKey of keys) {
        try {
          const stored: unknown = JSON.parse(storage.getItem(storageKey) ?? "null");
          if (!isBriefCacheEntry(stored) || !isCacheableBrief(stored.brief) ||
            Date.now() - stored.cachedAt >= briefCacheTtl(stored.brief)) storage.removeItem(storageKey);
          else entries.push({ key: storageKey, cachedAt: stored.cachedAt });
        } catch { storage.removeItem(storageKey); }
      }
      entries.sort((a, b) => a.cachedAt - b.cachedAt);
      while (entries.length >= MAX_CACHE_ENTRIES) storage.removeItem(entries.shift()!.key);
      storage.setItem(storageKey(key), JSON.stringify(entry));
    }
  } catch { /* bounded in-memory cache remains available */ }
}

function isGenericDirectoryPage(url: string, title?: string, excerpt?: string): boolean {
  const parsedUrl = safeHttpsUrl(url);
  const path = parsedUrl?.pathname.toLowerCase().replace(/\/+$/, "") ?? "";
  if (/\/symbol\/[a-z0-9]+$|\/stocks\/[a-z0-9_-]+$|\/quote\/[a-z0-9_-]+$/.test(path) ||
      /\/(?:quote|symbol|stocks)\/[a-z0-9_-]+\/(?:news|headlines)$/.test(path)) return true;
  if (/\/(?:quotes?|stocks?|etfs?)\/[a-z0-9_.-]+(?:\/(?:news|latest-news|news-headlines|forecast|estimates|sec-filings|earnings(?:-calendar|-report)?|holdings|summary|quote))?$/.test(path) ||
      /\/quote\/[^/]+\/[^/]+$/.test(path) || /\/stock\/research\/[^/]+\/earnings-calendar$/.test(path)) return true;
  const titleText = (title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const excerptText = (excerpt ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const text = `${titleText} ${excerptText}`;
  if (/\bedgar entity landing page\b|\bedgar filing documents for\b|\bsec\.gov\s*\|\s*home\b/.test(text)) return true;
  if (/\bhidden document icon\b|\bsec logo\b|\bedgar\s*\|\s*company search results\b/.test(text)) return true;
  if (["find the latest", "a high-level overview of", "real-time stock price, chart, news, analysis"]
    .some((phrase) => text.includes(phrase))) return true;
  if (/\b(?:latest|today'?s?)\s+(?:stock\s+)?news\s*(?:&|and)?\s*(?:headlines|financial updates)?\b/.test(text) ||
      /\bnews\s*\|\s*(?:morningstar|yahoo finance)\b/.test(titleText) ||
      /\bread about .+ stock and today'?s? latest news\b/.test(excerptText) ||
      /\btrending news\b.*\blatest updates\b.*\banalysis\b/.test(titleText)) return true;
  const irHomepage = parsedUrl && /\binvestor relations\b/.test(titleText) &&
    (path === "" || path === "/" || /^\/(?:investor-relations|investors?|ir|home)$/.test(path) ||
      /\/(?:default|index)\.(?:aspx?|html?)$/.test(path));
  return Boolean(irHomepage);
}

function publicationDay(value: string | null | undefined): number | null {
  if (!value) return null;
  // Only accept a provider-supplied calendar date. Never infer publication
  // time from a filing period or a date embedded in a URL/title.
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (!match) return null;
  const time = Date.parse(`${match[1]}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === match[1] ? time : null;
}

function isRecentDatedPublication(item: MarketNewsItem, now = Date.now()): boolean {
  const publishedAt = publicationDay(item.publishDate);
  if (publishedAt === null) return false;
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const firstFreshDay = today.getTime() - NEWS_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;
  return publishedAt >= firstFreshDay && publishedAt <= today.getTime();
}

function cleanExcerpt(raw: unknown): string {
  const text = defangWebText(raw, 900)
    .replace(/\|{2,}/g, " · ")
    .replace(/\s*[|•]\s*/g, " · ")
    .replace(/\b(?:UNITED STATES SECURITIES AND EXCHANGE COMMISSION|WASHINGTON, D\.C\. 20549|FORM 8-K CURRENT REPORT|PURSUANT TO SECTION 13 OR 15\(D\))\b/gi, "")
    .replace(/\bSEC\.gov\s*\|\s*HOME\b/gi, "")
    .replace(/\bEDGAR\s*\|\s*COMPANY SEARCH RESULTS\b/gi, "")
    .replace(/\b(?:HIDDEN DOCUMENT ICON|SEC LOGO)\b/gi, "")
    .replace(/\s*·\s*·+/g, " · ")
    .replace(/^[\s·*|]+|[\s·*|]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}…` : text;
}

function cleanHeadline(raw: unknown, fallback: string): string {
  const cleaned = defangWebText(raw || fallback, 160)
    .replace(/^(?:EX-\d+(?:\.\d+)?(?:\s+\S+){0,2}\s+)?/i, "")
    .replace(/^EXHIBIT\s+\d+(?:\.\d+)?\s*/i, "")
    .replace(/\b[A-Z0-9_.-]+\.html?\b/gi, "")
    .replace(/\s*[|·]\s*SEC\.gov.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s|·-]+|[\s|·-]+$/g, "")
    .trim();
  return cleaned || fallback || "News item";
}

function explicitPublicationDate(sourceText: string): string | null {
  const labeled = [
    /(?:datePublished|published_time|publication date|published date|published(?: on)?|posted(?: on)?|filing date|filed on|accepted(?: on)?)\s*["']?\s*[:=]?\s*["']?\s*(\d{4}-\d{2}-\d{2})/i,
    /(?:publication date|published date|published(?: on)?|posted(?: on)?|filing date|filed on|accepted(?: on)?)\s*[:\-]?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
    /["']datePublished["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i,
  ];
  const meta = sourceText.match(/property=["']article:published_time["'][^>]*content=["']([^"']+)/i)?.[1]
    ?? sourceText.match(/content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i)?.[1];
  const candidate = meta ?? labeled.map((pattern) => sourceText.match(pattern)?.[1]).find(Boolean);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) return null;
  const date = parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

async function verifyUndatedRwaPublications(
  items: MarketNewsItem[],
): Promise<{ items: MarketNewsItem[]; faulted: boolean }> {
  const seenUrls = new Set<string>();
  const candidates: MarketNewsItem[] = [];
  for (const item of items) {
    const url = safeHttpsUrl(item.url)?.toString();
    if (!url || seenUrls.has(url)) continue;
    if (publicationDay(item.publishDate) === null && !isGenericDirectoryPage(url, item.title, item.excerpt)) {
      seenUrls.add(url);
      candidates.push({ ...item, url });
      if (candidates.length === 4) break;
    }
  }
  if (!candidates.length) return { items, faulted: false };
  try {
    const fetched = await clientWebFetch(
      candidates.map((item) => item.url),
      "Return explicit source publication dates only; ignore event dates, report periods, and URL/title dates.",
      true,
    );
    const pages = new Map(fetched.pages.map((page) => [safeHttpsUrl(page.url)?.toString() ?? page.url, page]));
    const verified = items.map((item) => {
      if (publicationDay(item.publishDate) !== null) return item;
      const normalizedItemUrl = safeHttpsUrl(item.url)?.toString() ?? item.url;
      const page = pages.get(normalizedItemUrl);
      if (!page) return item;

      // A valid provider date remains authoritative even when stale/future;
      // the final freshness gate rejects it rather than replacing it with prose.
      const publishDate = publicationDay(page.publishDate) !== null
        ? page.publishDate!
        : explicitPublicationDate(page.content);
      if (!publishDate) return item;
      const excerpt = cleanExcerpt(page.content);
      return { ...item, publishDate, excerpt: excerpt || item.excerpt };
    });
    return { items: verified, faulted: fetched.completeness === "partial" };
  } catch {
    // An unavailable date-verification fetch cannot make an undated result current.
    return { items, faulted: true };
  }
}

function detectCategory(title: string, excerpt: string): MarketNewsItem["category"] {
  const text = `${title} ${excerpt}`.toLowerCase();
  if (/earnings|revenue|eps|profit|guidance|quarterly/.test(text)) return "EARNINGS";
  if (/rating|price target|analyst|upgrade|downgrade/.test(text)) return "RATING";
  if (/launch|product|announcement|partnership|release/.test(text)) return "PRODUCT";
  if (/fed|inflation|rate cut|macro|treasury|recession|tariff/.test(text)) return "MACRO";
  if (/catalyst|acquisition|merger|deal|investigation|fda/.test(text)) return "CATALYST";
  return "NEWS";
}

/** Tool errors are faults, never a successful empty search that can be cached. */
export async function callParallelMcpTool(
  toolName: "web_search" | "web_fetch",
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<McpToolResult> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(PARALLEL_MCP_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID?.() ?? Date.now(), method: "tools/call", params: { name: toolName, arguments: args } }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Parallel Search is unavailable (HTTP ${response.status}).`);
    const body = await readBoundedText(response);
    const data = parseMcpResponse(body, response.headers.get("content-type") ?? "");
    if (data.error) throw new Error(data.error.message || "Parallel Search returned an error.");
    if (!data.result || data.result.isError) throw new Error("Parallel Search could not complete this request.");
    return data.result;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (controller.signal.aborted) throw new Error("Parallel Search timed out after 8 seconds.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

function parseSearchResponse(result: McpToolResult): { items: MarketNewsItem[]; completeness: BriefCompleteness } {
  const blocks = result.content?.filter((block) => block.type === "text" && block.text) ?? [];
  let parsedAny = false;
  let partial = false;
  const items: MarketNewsItem[] = [];
  for (const block of blocks.slice(0, 8)) {
    try {
      const parsed = JSON.parse(block.text!) as ParallelSearchResponse;
      if (!Array.isArray(parsed.results)) continue;
      parsedAny = true;
      partial ||= Boolean(parsed.errors?.length);
      for (const row of parsed.results.slice(0, 20)) {
        const url = typeof row.url === "string" ? safeHttpsUrl(row.url) : null;
        if (!url) continue;
        const excerptCandidates = (row.excerpts ?? []).map(cleanExcerpt).filter(Boolean);
        const excerpt = excerptCandidates.sort((a, b) => {
          const score = (value: string) => {
            const catalyst = /guidance|earnings|revenue|acquisition|merger|launch|approval|investigation|results|announced|raises|cuts/i.test(value) ? 2 : 0;
            const tableNoise = (value.match(/[|·]/g) ?? []).length;
            return catalyst + Math.min(value.length, 260) / 260 - tableNoise * 0.25;
          };
          return score(b) - score(a);
        })[0] ?? "";
        const title = cleanHeadline(row.title, excerpt || url.hostname);
        items.push({
          title, url: url.toString(), domain: extractDomain(url.toString()),
          publishDate: typeof row.publish_date === "string" ? defangWebText(row.publish_date, 64) : null,
          excerpt,
        });
      }
    } catch { /* another text block may contain the structured response */ }
  }
  if (!parsedAny) throw new Error("Parallel Search returned no readable results.");
  return { items, completeness: partial ? "partial" : "complete" };
}

export async function clientWebSearch(
  objective: string,
  queries: string[],
  signal?: AbortSignal
): Promise<{ items: MarketNewsItem[]; completeness: BriefCompleteness; fetchedAt: string }> {
  const cleanQueries = queries.map((q) => defangWebText(q, 240)).filter(Boolean).slice(0, 5);
  if (!cleanQueries.length) throw new Error("A focused search query is required.");
  const result = await callParallelMcpTool("web_search", { objective: defangWebText(objective, 600), search_queries: cleanQueries }, signal);
  return { ...parseSearchResponse(result), fetchedAt: new Date().toISOString() };
}

export async function clientWebFetch(
  urls: string[], objective?: string, fullContent = false, signal?: AbortSignal
): Promise<{ pages: Array<{ url: string; title: string; content: string; publishDate?: string | null }>; completeness: BriefCompleteness; fetchedAt: string }> {
  const safeUrls = [...new Set(urls.map((raw) => safeHttpsUrl(raw)?.toString()).filter((url): url is string => Boolean(url)))].slice(0, MAX_URLS);
  if (!safeUrls.length) throw new Error("Provide one or more public HTTPS article URLs.");
  const result = await callParallelMcpTool("web_fetch", {
    urls: safeUrls, objective: defangWebText(objective || "Extract dated facts relevant to the question, with source context.", 199), full_content: fullContent,
  }, signal);
  const blocks = result.content?.filter((block) => block.type === "text" && block.text) ?? [];
  const pages: Array<{ url: string; title: string; content: string; publishDate?: string | null }> = [];
  let parsedAny = false;
  let partial = false;
  for (const block of blocks.slice(0, 8)) {
    try {
      const parsed = JSON.parse(block.text!) as { results?: Array<{ url?: string; title?: string; excerpts?: string[]; full_content?: string; publish_date?: string | null }>; errors?: unknown[] };
      if (!Array.isArray(parsed.results)) continue;
      parsedAny = true;
      partial ||= Boolean(parsed.errors?.length);
      for (const row of parsed.results) {
        const url = typeof row.url === "string" ? safeHttpsUrl(row.url) : null;
        if (!url) continue;
        pages.push({
          url: url.toString(),
          title: defangWebText(row.title || url.hostname, 120),
          content: defangWebText(row.full_content || row.excerpts?.join("\n\n") || "", fullContent ? 4000 : 1200),
          publishDate: typeof row.publish_date === "string" ? defangWebText(row.publish_date, 64) : (row.publish_date === null ? null : undefined),
        });
      }
    } catch { /* skip non-JSON blocks */ }
  }
  if (!parsedAny) throw new Error("Parallel Search returned no readable page content.");
  return { pages, completeness: partial ? "partial" : "complete", fetchedAt: new Date().toISOString() };
}

interface DexPair {
  chainId?: string; dexId?: string; url?: string; pairAddress?: string; labels?: string[];
  baseToken?: { address?: string; name?: string; symbol?: string }; quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string; priceNative?: string; fdv?: number | null; marketCap?: number | null; pairCreatedAt?: number | null;
  txns?: Record<string, { buys?: number; sells?: number }>; volume?: Record<string, number>; priceChange?: Record<string, number>;
  liquidity?: { usd?: number }; info?: { websites?: Array<{ label?: string; url?: string }>; socials?: Array<{ type?: string; url?: string }> };
}

/** Read-only DexScreener search. Exact address matching is always chain-scoped. */
export async function clientDexScreenerSearch(query: string, expectedAddress?: string, callerSignal?: AbortSignal): Promise<{ pairs: DexPair[]; completeness: BriefCompleteness; fetchedAt: string }> {
  const normalized = defangWebText(query, 128).trim();
  if (!normalized) throw new Error("A token name, symbol, or contract address is required.");
  if (expectedAddress && !/^0x[a-fA-F0-9]{40}$/.test(expectedAddress)) throw new Error("address must be a 0x-prefixed 40-hex contract address.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const onAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    const address = expectedAddress?.trim() || (/^0x[a-fA-F0-9]{40}$/.test(normalized) ? normalized : null);
    const endpoint = address
      ? `${DEXSCREENER_API}/latest/dex/tokens/${encodeURIComponent(address)}`
      : `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(normalized)}`;
    const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`DexScreener is unavailable (HTTP ${response.status}).`);
    const body = await readBoundedText(response);
    const data = JSON.parse(body) as { pairs?: DexPair[] };
    if (!Array.isArray(data.pairs)) throw new Error("DexScreener returned an unreadable response.");
    const target = address?.toLowerCase();
    const pairs = data.pairs.filter((pair) => {
      if ((pair.chainId ?? "").toLowerCase() !== "robinhood") return false;
      if (!target) return true;
      return pair.baseToken?.address?.toLowerCase() === target || pair.quoteToken?.address?.toLowerCase() === target || pair.pairAddress?.toLowerCase() === target;
    }).slice(0, 12).map((pair) => {
      const cleanMetric = (group: Record<string, unknown> | undefined, keys: string[]) => Object.fromEntries(
        keys.flatMap((key) => typeof group?.[key] === "number" && Number.isFinite(group[key]) ? [[key, group[key]]] : [])
      );
      const cleanToken = (token?: DexPair["baseToken"]) => ({
        address: defangWebText(token?.address, 64), name: defangWebText(token?.name, 120), symbol: defangWebText(token?.symbol, 40),
      });
      const info = pair.info ?? {};
      return {
        chainId: "robinhood", dexId: defangWebText(pair.dexId, 80), url: safeHttpsUrl(pair.url ?? "")?.toString() ?? "",
        pairAddress: defangWebText(pair.pairAddress, 80), baseToken: cleanToken(pair.baseToken), quoteToken: cleanToken(pair.quoteToken),
        priceUsd: defangWebText(pair.priceUsd, 64), priceNative: defangWebText(pair.priceNative, 64),
        fdv: typeof pair.fdv === "number" && Number.isFinite(pair.fdv) ? pair.fdv : null,
        marketCap: typeof pair.marketCap === "number" && Number.isFinite(pair.marketCap) ? pair.marketCap : null,
        pairCreatedAt: typeof pair.pairCreatedAt === "number" && Number.isFinite(pair.pairCreatedAt) ? pair.pairCreatedAt : null,
        txns: Object.fromEntries(["m5", "h1", "h6", "h24"].map((period) => [period, cleanMetric(pair.txns?.[period], ["buys", "sells"])])),
        volume: cleanMetric(pair.volume, ["m5", "h1", "h6", "h24"]),
        priceChange: cleanMetric(pair.priceChange, ["m5", "h1", "h6", "h24"]),
        liquidity: cleanMetric(pair.liquidity as Record<string, unknown> | undefined, ["usd"]),
        info: {
          websites: (info.websites ?? []).slice(0, 8).flatMap((item) => {
            const url = safeHttpsUrl(item.url ?? ""); return url ? [{ label: defangWebText(item.label, 80), url: url.toString() }] : [];
          }),
          socials: (info.socials ?? []).slice(0, 8).flatMap((item) => {
            const url = safeHttpsUrl(item.url ?? ""); return url ? [{ type: defangWebText(item.type, 32), url: url.toString() }] : [];
          }),
        },
      };
    });
    return { pairs, completeness: "complete", fetchedAt: new Date().toISOString() };
  } finally { clearTimeout(timeout); callerSignal?.removeEventListener("abort", onAbort); }
}

function buildBriefSearch(symbol: string, name: string, options: MarketBriefOptions): { objective: string; queries: string[] } {
  const today = new Date().toISOString().slice(0, 10);
  const freshnessStart = new Date(Date.now() - NEWS_FRESHNESS_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (options.kind === "trade") {
    const address = options.address?.toLowerCase();
    const chain = options.chainId ?? 4663;
    const identity = address ? `contract ${address} and exact project name ${JSON.stringify(name)}` : `exact project name ${JSON.stringify(name)}`;
    return {
      objective: `Find recent, material news specifically about the Robinhood Chain (${chain}) token ${identity}. Include a result only if its source text or URL mentions the full contract address or the full project name. A ticker match alone, generic Robinhood Chain coverage, chain directories, explorers, token listings, or another asset with the same symbol is not relevant. Prefer dated primary sources for project announcements, listings, liquidity changes, exploit reports, and impersonation claims. If no source matches the exact identity, return no results; do not substitute general chain news. Current date: ${today}.`,
      queries: [
        ...(address ? [`"${address}" Robinhood Chain`] : []),
        `"${name}" token Robinhood Chain`,
        `"${name}" project listing liquidity exploit impersonation`,
      ],
    };
  }
  // A month hint finds individual stories more reliably than "latest news",
  // which often returns quote/directory pages. Use the window midpoint so a
  // month boundary does not steer a 30-day search toward one day's coverage.
  const newsMonth = new Date(Date.now() - NEWS_FRESHNESS_DAYS / 2 * 24 * 60 * 60 * 1000)
    .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    objective: `Find recent asset-specific reporting and individual news articles about ${name} (${symbol}), published ${freshnessStart} through ${today}. Prioritize dated issuer statements, material company developments and ETF macro/flows. Regulatory filings are optional when material. Exclude quote pages, news directories, earnings calendars, old filings and unrelated companies. Use source publication dates, never fiscal periods or event dates. Do not infer token backing or token price from equity news.`,
    queries: /\b(?:ETF|Trust|Shares|iShares|SPDR|Vanguard|Invesco|Fund)\b/i.test(name)
      ? [`${name} ${symbol} news ${newsMonth} after:${freshnessStart}`]
      : [
        `${name.split(/\s+/)[0]} ${symbol} news ${newsMonth} after:${freshnessStart}`,
        `${name.replace(/,?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|plc)$/i, "")} ${symbol} ${newsMonth} announcements after:${freshnessStart}`,
      ],
  };
}

function matchesTradeIdentity(item: MarketNewsItem, name: string, address?: string): boolean {
  const evidenceText = `${item.title} ${item.url} ${item.excerpt}`.toLowerCase();
  const evidenceWords = evidenceText.match(/[a-z0-9]+/g) ?? [];
  const exactAddress = address?.trim().toLowerCase();
  if (exactAddress && /^0x[a-f0-9]{40}$/.test(exactAddress) && evidenceText.includes(exactAddress)) return true;
  const lowerName = name.toLowerCase();
  const normalizedName = lowerName.replace(/[^a-z0-9]/g, "");
  // Short/generic token names (including ticker-like ERC-20 names) are not
  // enough to associate an article with a contract.
  if (normalizedName.length < 5 || ["robinhood", "ethereum", "token", "coin", "wrappedether", "usdcoin"].includes(normalizedName)) return false;
  const identityForms = [
    lowerName.match(/[a-z0-9]+/g) ?? [],
    name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z0-9]+/g) ?? [],
    [normalizedName],
  ].filter((words) => words.length > 0 && words.join("").length >= 5);
  return identityForms.some((words) => {
    for (let start = 0; start <= evidenceWords.length - words.length; start += 1) {
      if (words.every((word, offset) => evidenceWords[start + offset] === word)) return true;
    }
    return false;
  });
}

function isTradeDirectoryPage(item: MarketNewsItem): boolean {
  const url = safeHttpsUrl(item.url);
  if (!url) return true;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (["robinscan.io", "blockscout.com", "dexscreener.com", "geckoterminal.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
  const path = url.pathname.toLowerCase();
  if (/\/(?:token|tokens|coin|coins|chart|charts|price|prices|trading|markets?)(?:\/|$)/.test(path)) return true;
  const text = `${item.title} ${item.excerpt}`.toLowerCase();
  return /token (directory|list(?:ing)?|explorer)|all tokens on robinhood|robinhood chain tokens|latest tokens on robinhood|price\s*(?:&|and)?\s*(?:live\s*)?(?:price\s*)?charts?|(?:live|real[- ]time)\s+(?:token\s+)?price|trading\s*(?:&|and)\s*price\s*chart|token price chart|buy and sell tokens/.test(text);
}

function selectBriefItems(items: MarketNewsItem[], options: MarketBriefOptions, name: string): MarketNewsItem[] {
  const seen = new Set<string>();
  const selected: MarketNewsItem[] = [];
  const candidates = options.kind === "trade"
    ? items
    : [...items].filter((item) => isRecentDatedPublication(item)).sort((a, b) =>
      (publicationDay(b.publishDate) ?? 0) - (publicationDay(a.publishDate) ?? 0));
  for (const item of candidates) {
    const url = safeHttpsUrl(item.url)?.toString();
    if (!url || seen.has(url) || (options.kind !== "trade" && isGenericDirectoryPage(url, item.title, item.excerpt)) ||
      (options.kind === "trade" && (isTradeDirectoryPage({ ...item, url }) || !matchesTradeIdentity({ ...item, url }, name, options.address)))) continue;
    seen.add(url);
    selected.push({ ...item, category: detectCategory(item.title, item.excerpt) });
    if (selected.length === 5) break;
  }
  return selected;
}

function valuationHint(items: MarketNewsItem[]): string | undefined {
  return items.find((item) => /p\/e|pe ratio|forward p\/e|valuation|market cap|guidance/i.test(item.excerpt))?.excerpt;
}

/** Fetch a market brief with per-identity single flight and caller-independent refill. */
export async function getRwaMarketBrief(
  symbol: string,
  name: string,
  signal?: AbortSignal,
  options: MarketBriefOptions = {}
): Promise<RwaMarketBrief> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedName = name.trim() || normalizedSymbol;
  const key = briefKey(normalizedSymbol, normalizedName, options);
  const cached = readSessionCache(key);
  if (cached) return cached;
  let refill = inFlightBriefs.get(key);
  if (!refill) {
    const { objective, queries } = buildBriefSearch(normalizedSymbol, normalizedName, options);
    refill = (async () => {
      try {
        const result = await clientWebSearch(objective, queries);
        const verified = options.kind === "trade"
          ? { items: result.items, faulted: false }
          : await verifyUndatedRwaPublications(result.items);
        const items = selectBriefItems(verified.items, options, normalizedName);
        const brief: RwaMarketBrief = {
          symbol: normalizedSymbol, name: normalizedName, fetchedAt: result.fetchedAt,
          completeness: result.completeness === "partial" || verified.faulted ? "partial" : "complete", items,
          valuationHint: options.kind === "trade" ? undefined : valuationHint(items),
          emptyMessage: result.completeness === "complete" && !verified.faulted && items.length === 0
            ? options.kind === "trade"
              ? "No token-specific news found for this contract or project identity."
              : `No dated ${NEWS_FRESHNESS_DAYS}-day news matched this asset. Older or undated results are hidden.`
            : undefined,
        };
        if (inFlightBriefs.get(key) === refill) writeSessionCache(key, brief);
        return brief;
      } finally {
        if (inFlightBriefs.get(key) === refill) inFlightBriefs.delete(key);
      }
    })();
    inFlightBriefs.set(key, refill);
  }
  return awaitForCaller(refill, signal);
}

function awaitForCaller<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    shared.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

export function clearRwaMarketBriefCache(symbol: string, name: string, options: MarketBriefOptions = {}): void {
  const key = briefKey(symbol, name, options);
  // Detached work may finish for its caller, but cannot republish cleared data.
  inFlightBriefs.delete(key);
  memoryBriefs.delete(key);
  try { if (typeof window !== "undefined") window.sessionStorage.removeItem(storageKey(key)); } catch { /* ignore */ }
}

export async function refreshRwaMarketBrief(symbol: string, name: string, options: MarketBriefOptions = {}): Promise<RwaMarketBrief> {
  const key = briefKey(symbol, name, options);
  const { objective, queries } = buildBriefSearch(symbol, name, options);
  const task = clientWebSearch(objective, queries).then(async ({ items, completeness, fetchedAt }) => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const normalizedName = name.trim() || normalizedSymbol;
    const verified = options.kind === "trade" ? { items, faulted: false } : await verifyUndatedRwaPublications(items);
    const selected = selectBriefItems(verified.items, options, normalizedName);
    const brief = {
      symbol: normalizedSymbol, name: normalizedName, fetchedAt,
      completeness: completeness === "partial" || verified.faulted ? "partial" as const : "complete" as const,
      items: selected, valuationHint: options.kind === "trade" ? undefined : valuationHint(selected),
      emptyMessage: completeness === "complete" && !verified.faulted && selected.length === 0
        ? options.kind === "trade"
          ? "No token-specific news found for this contract or project identity."
          : `No dated ${NEWS_FRESHNESS_DAYS}-day news matched this asset. Older or undated results are hidden.`
        : undefined,
    };
    if (inFlightBriefs.get(key) === task) writeSessionCache(key, brief);
    return brief;
  });
  inFlightBriefs.set(key, task);
  try { return await task; }
  finally { if (inFlightBriefs.get(key) === task) inFlightBriefs.delete(key); }
}
