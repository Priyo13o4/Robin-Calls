/**
 * Analytics ingestion engine — parsing, hashing, and log processing.
 *
 * Separated from the route handler for testability and from the persistence
 * boundary (lib/data/analytics.ts) because this module is pure computation:
 * no DB, no Redis, no I/O beyond what the caller hands it.
 */

import { createHmac } from "node:crypto";
import { SITE_URL } from "@/lib/config/site";

const OWN_HOSTNAME = (() => {
  try {
    return new URL(SITE_URL).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
})();

// ── Visitor hashing (PRD §5.1) ──────────────────────────────────────────────

/**
 * Generates a 24-character pseudonymized visitor hash.
 * Scoped to UTC date + saltSecret to prevent cross-day tracking.
 */
export function hashVisitorIp(
  ip: string,
  dateIso: string,
  saltSecret: string,
): string {
  return createHmac("sha256", saltSecret)
    .update(`rc-analytics:${dateIso}:${ip.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

// ── Route normalization (PRD §7.3) ──────────────────────────────────────────

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;

/**
 * Machine surfaces: never a page a person navigated to.
 *
 * `/agent/*` is the AI plane's live API (nginx proxies it to FastAPI) and
 * `/mcp` is the tool endpoint. Both were being counted as pageviews. `/dev/*`
 * is an internal scratch surface, not a product page.
 */
const NON_PAGE_PREFIX_RE =
  /^\/_next\/|^\/api\/|^\/agent\/|^\/mcp\b|^\/admin\b|^\/health\b|^\/dev\//;

/**
 * A real page has no file extension. This catches every asset directory at once
 * — /backgrounds, /scene, /lanyard, /models, /brand, /downloads — plus the
 * favicon family, the webmanifest, robots.txt and sitemap.xml, without naming
 * any of them.
 *
 * Safe for this app's routes: no page path contains a dot. The ecosystem slugs
 * are the only user-supplied segment and they are already hyphenated at write
 * time (`gmgn-ai`, `stoxes-fun`, `hood-fun`). If a dotted slug is ever allowed,
 * this rule silently stops counting that page, so add the exception here.
 *
 * The length bound is 12, not 5: `.webmanifest` is eleven characters and a
 * tighter bound let `/site.webmanifest` through as a page.
 */
const HAS_FILE_EXTENSION_RE = /\/[^/]+\.[a-z0-9]{2,12}$/i;

/**
 * Collapses dynamic URL segments to route templates, and filters out everything
 * that is not a page a human navigated to.
 *
 * ## Why this is structural rather than a longer deny-list
 *
 * It used to be one deny-list of prefixes, and the list was short: `/api/jobs`,
 * `/api/internal`, `/api/stats`, `/api/csp-report` and `/brand/`. Everything it
 * did not name was counted as a PAGEVIEW. Measured against the real nginx log,
 * the top two "pages" on the site were `/api/og-proxy` (38 hits) and
 * `/api/rwa/icon` (32), against 19 actual page loads — the XHR that the
 * ecosystem and RWA grids fire once per card. `/backgrounds/*.webp`,
 * `/scene/*.webp`, `/apple-touch-icon.png`, `/site.webmanifest` and
 * `/agent/config` were all counted too.
 *
 * That is §8 #16's failure direction. A deny-list of non-pages fails toward
 * COUNTING a surface nobody listed, and an inflated number looks like success,
 * so nothing ever reports it. These two rules fail the other way: a new API
 * route or asset directory is excluded the day it ships, and the cost of being
 * wrong is a real page reading zero, which is visible on the dashboard.
 *
 * Note what is deliberately NOT here: RSC prefetch filtering. That happens in
 * nginx on the `Next-Router-Prefetch` header (docker/nginx/nginx.conf), because
 * a prefetch and a real click-through are the same `?_rsc=` request shape and
 * only the header separates them. Verified working: one `/rwa` load fires 139
 * prefetches and logs none of them.
 */
export function normalizeRoute(uri: string): string | null {
  // nginx logs `$uri` (already query-stripped); this guards a caller passing
  // `$request_uri`, which still carries `?_rsc=`.
  const path = uri.split("?")[0] || "/";

  if (NON_PAGE_PREFIX_RE.test(path)) return null;
  if (HAS_FILE_EXTENSION_RE.test(path)) return null;

  // Collapse 0x addresses into [address] placeholder
  return path.replace(ADDRESS_RE, "[address]");
}

// ── User-Agent parsing ──────────────────────────────────────────────────────

export interface ParsedUA {
  browser: string;
  os: string;
  deviceType: string; // desktop | mobile | tablet | bot
}

/** Granular UA classifier identifying human platforms as well as specific bots/crawlers. */
export function parseUserAgent(ua: string): ParsedUA {
  if (!ua || ua === "-" || ua === "") {
    return { browser: "Unknown / Headless", os: "Bot / Unknown", deviceType: "bot" };
  }

  // 1. Specific Bot & Crawler identification
  if (/gptbot/i.test(ua)) {
    return { browser: "GPTBot (OpenAI)", os: "AI Crawler", deviceType: "bot" };
  }
  if (/claudebot|anthropic/i.test(ua)) {
    return { browser: "ClaudeBot (Anthropic)", os: "AI Crawler", deviceType: "bot" };
  }
  if (/bytespider/i.test(ua)) {
    return { browser: "ByteSpider (ByteDance)", os: "AI Crawler", deviceType: "bot" };
  }
  if (/ccbot/i.test(ua)) {
    return { browser: "CCBot (Common Crawl)", os: "AI Crawler", deviceType: "bot" };
  }
  if (/perplexitybot/i.test(ua)) {
    return { browser: "PerplexityBot", os: "AI Crawler", deviceType: "bot" };
  }
  if (/googlebot/i.test(ua)) {
    return { browser: "Googlebot", os: "Search Engine", deviceType: "bot" };
  }
  if (/bingbot|bingpreview/i.test(ua)) {
    return { browser: "Bingbot", os: "Search Engine", deviceType: "bot" };
  }
  if (/yandex/i.test(ua)) {
    return { browser: "YandexBot", os: "Search Engine", deviceType: "bot" };
  }
  if (/baiduspider/i.test(ua)) {
    return { browser: "BaiduSpider", os: "Search Engine", deviceType: "bot" };
  }
  if (/duckduck/i.test(ua)) {
    return { browser: "DuckDuckBot", os: "Search Engine", deviceType: "bot" };
  }
  if (/twitterbot/i.test(ua)) {
    return { browser: "Twitterbot (X)", os: "Social Crawler", deviceType: "bot" };
  }
  if (/facebookexternalhit|facebookcatalog/i.test(ua)) {
    return { browser: "Meta / Facebook", os: "Social Crawler", deviceType: "bot" };
  }
  if (/telegrambot/i.test(ua)) {
    return { browser: "TelegramBot", os: "Social Crawler", deviceType: "bot" };
  }
  if (/discordbot/i.test(ua)) {
    return { browser: "DiscordBot", os: "Social Crawler", deviceType: "bot" };
  }
  if (/slackbot/i.test(ua)) {
    return { browser: "Slackbot", os: "Social Crawler", deviceType: "bot" };
  }
  if (/applebot/i.test(ua)) {
    return { browser: "Applebot", os: "Search / Siri", deviceType: "bot" };
  }
  if (/ahrefs/i.test(ua)) {
    return { browser: "AhrefsBot", os: "SEO Crawler", deviceType: "bot" };
  }
  if (/semrush/i.test(ua)) {
    return { browser: "SemrushBot", os: "SEO Crawler", deviceType: "bot" };
  }
  if (/dotbot|petalbot|mj12bot/i.test(ua)) {
    return { browser: "SEO Scraper", os: "SEO Crawler", deviceType: "bot" };
  }
  if (/curl|wget/i.test(ua)) {
    return { browser: "curl / wget / CLI", os: "CLI / Dev Tool", deviceType: "bot" };
  }
  if (/python-requests|aiohttp|httpx|urllib|faraday/i.test(ua)) {
    return { browser: "Python / Ruby HTTP", os: "Automated Script", deviceType: "bot" };
  }
  if (/go-http-client/i.test(ua)) {
    return { browser: "Go HTTP Client", os: "Automated Script", deviceType: "bot" };
  }
  if (/node-fetch|undici|axios|postman|insomnia|rest-client|okhttp|httpclient|java\/|reqwest|libwww/i.test(ua)) {
    return { browser: "HTTP Client / Script", os: "CLI / Script", deviceType: "bot" };
  }
  // Our own machines. `robincalls-isr-warmup` is the post-deploy warm-up
  // (app/api/jobs/revalidate), which hits every ISR path in lib/config/isr-paths.ts
  // on every deploy — it matched nothing above and scored as a DESKTOP HUMAN,
  // so each deploy invented one visitor per warmed page.
  if (/robincalls-isr-warmup|robincalls-[a-z-]*job/i.test(ua)) {
    return { browser: "RobinCalls job", os: "Self", deviceType: "bot" };
  }
  if (/uptime|pingdom|statuscake|newrelic|datadog|betterstack|checkly|synthetic/i.test(ua)) {
    return { browser: "Uptime monitor", os: "Monitoring", deviceType: "bot" };
  }
  if (/bot|crawl|spider|slurp|headless|scraper/i.test(ua)) {
    return { browser: "Other Crawler / Bot", os: "Automated Bot", deviceType: "bot" };
  }

  // 2. Human Device Types
  let deviceType: string = "desktop";
  if (/tablet|ipad/i.test(ua)) deviceType = "tablet";
  else if (/mobile|android.*mobile|iphone|ipod/i.test(ua)) deviceType = "mobile";

  // 3. Human OS
  let os = "Other";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/macintosh|mac os/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";
  else if (/cros/i.test(ua)) os = "ChromeOS";

  // 4. Human Browsers
  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/brave/i.test(ua)) browser = "Brave";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/crios/i.test(ua)) browser = "Chrome";
  else if (/chrome|chromium/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";

  return { browser, os, deviceType };
}

// ── Referrer parsing ────────────────────────────────────────────────────────

/**
 * Same platform, different hostnames depending on client/redirect chain —
 * grouped so "Traffic Sources" reads as one row per real source instead of
 * splitting a single platform's traffic across 2-4 near-duplicate rows.
 * Ordered most-specific-first since some entries are substrings of others
 * (`t.co` vs `com` would never collide, but keep the habit for future edits).
 */
const REFERRER_DOMAIN_ALIASES: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /^(www\.)?(twitter\.com|x\.com|t\.co|mobile\.twitter\.com)$/, canonical: "x.com (Twitter)" },
  { pattern: /^(www\.|m\.|l\.)?(facebook\.com|fb\.com|lm\.facebook\.com)$/, canonical: "facebook.com" },
  { pattern: /^(www\.|old\.|new\.|out\.)?reddit\.com$/, canonical: "reddit.com" },
  { pattern: /^(www\.)?google\.[a-z.]+$/, canonical: "google.com" },
  { pattern: /^(www\.)?bing\.com$/, canonical: "bing.com" },
  { pattern: /^(www\.|l\.)?instagram\.com$/, canonical: "instagram.com" },
  { pattern: /^(www\.|web\.)?telegram\.(org|me)$|^t\.me$/, canonical: "t.me (Telegram)" },
  { pattern: /^(www\.)?(discord\.com|discord\.gg|discordapp\.com)$/, canonical: "discord.com" },
  { pattern: /^(www\.)?youtube\.com$|^youtu\.be$/, canonical: "youtube.com" },
  { pattern: /^(www\.|link\.)?dexscreener\.com$/, canonical: "dexscreener.com" },
  { pattern: /^(www\.)?duckduckgo\.com$/, canonical: "duckduckgo.com" },
];

function canonicalizeReferrerDomain(hostname: string): string {
  for (const { pattern, canonical } of REFERRER_DOMAIN_ALIASES) {
    if (pattern.test(hostname)) return canonical;
  }
  return hostname;
}

/**
 * Extracts the domain from a Referer header. Empty/self → "Direct".
 *
 * Same-origin requests (internal navigation, and every `_next/static` /
 * image sub-resource a page load triggers) carry our own domain as the
 * Referer under `strict-origin-when-cross-origin`. Without this check every
 * one of those counted as a top "referrer", drowning out real external
 * traffic sources (x.com, dexscreener.com, ...) with our own hostname.
 */
export function parseReferrerDomain(referer: string | undefined): string {
  if (!referer || referer === "-" || referer === "") return "Direct";
  try {
    const hostname = new URL(referer).hostname.replace(/^www\./, "");
    if (!hostname) return "Direct";
    if (OWN_HOSTNAME && hostname === OWN_HOSTNAME) return "Direct";
    return canonicalizeReferrerDomain(hostname);
  } catch {
    return "Direct";
  }
}

// ── Log line parsing ────────────────────────────────────────────────────────

export interface NginxLogEntry {
  timestamp: string;
  remoteAddr: string;
  requestMethod: string;
  requestUri: string;
  uri: string;
  status: number;
  bytesSent: number;
  bodyBytesSent: number;
  requestTime: number;
  upstreamResponseTime: string;
  httpReferer: string;
  httpUserAgent: string;
  country: string;
  cfRay: string;
}

/** Parse a single JSON log line. Returns null on malformed input. */
export function parseLogLine(line: string): NginxLogEntry | null {
  try {
    const raw = JSON.parse(line);
    return {
      timestamp: raw.timestamp ?? "",
      remoteAddr: raw.remote_addr ?? "",
      requestMethod: raw.request_method ?? "",
      requestUri: raw.request_uri ?? "",
      uri: raw.uri ?? "",
      status: typeof raw.status === "number" ? raw.status : 0,
      bytesSent: typeof raw.bytes_sent === "number" ? raw.bytes_sent : 0,
      bodyBytesSent:
        typeof raw.body_bytes_sent === "number" ? raw.body_bytes_sent : 0,
      requestTime:
        typeof raw.request_time === "number" ? raw.request_time : 0,
      upstreamResponseTime: raw.upstream_response_time ?? "",
      httpReferer: raw.http_referer ?? "",
      httpUserAgent: raw.http_user_agent ?? "",
      country: raw.country ?? "",
      cfRay: raw.cf_ray ?? "",
    };
  } catch {
    return null;
  }
}

// ── Batch aggregation ───────────────────────────────────────────────────────

export interface HourlyBucket {
  pageviews: number;
  uniqueVisitorHashes: Set<string>;
  bytesTransferred: number;
  latencies: number[];
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
}

export interface PageBucket {
  pageviews: number;
  uniqueVisitorHashes: Set<string>;
  /** Every request served for this path, bots included — an OPERATIONAL
   *  metric, unlike `pageviews`. Keeping them separate is what lets the
   *  running average merge weight by the right denominator (0097). */
  latencies: number[];
}

export interface ReferrerBucket {
  hits: number;
}

export interface CountryBucket {
  pageviews: number;
  uniqueVisitorHashes: Set<string>;
}

export interface DeviceBucket {
  hits: number;
}

export interface BatchResult {
  hourly: Map<string, HourlyBucket>;
  pages: Map<string, PageBucket>; // key: "YYYY-MM-DD|path"
  referrers: Map<string, ReferrerBucket>; // key: "YYYY-MM-DD|domain"
  countries: Map<string, CountryBucket>; // key: "YYYY-MM-DD|CC"
  devices: Map<string, DeviceBucket>; // key: "YYYY-MM-DD|type|browser|os"
  linesProcessed: number;
  linesSkipped: number;
}

function bucketHourKey(isoTimestamp: string): string {
  // Truncate to hour in UTC: "2026-08-27T14:32:01+00:00" → "2026-08-27T14:00:00.000Z"
  const d = new Date(isoTimestamp);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function dateKey(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().slice(0, 10);
}

function statusBucket(status: number): "2xx" | "3xx" | "4xx" | "5xx" | null {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return null;
}

/**
 * Process a batch of log lines into aggregation buckets.
 * Pure computation — no I/O. The caller persists the result.
 */
export function processLogBatch(
  lines: string[],
  saltSecret: string,
): BatchResult {
  const result: BatchResult = {
    hourly: new Map(),
    pages: new Map(),
    referrers: new Map(),
    countries: new Map(),
    devices: new Map(),
    linesProcessed: 0,
    linesSkipped: 0,
  };

  for (const line of lines) {
    if (!line.trim()) {
      result.linesSkipped++;
      continue;
    }

    const entry = parseLogLine(line);
    if (!entry || !entry.timestamp) {
      result.linesSkipped++;
      continue;
    }

    const normalizedPath = normalizeRoute(entry.uri);
    if (!normalizedPath) {
      result.linesSkipped++;
      continue;
    }

    result.linesProcessed++;

    const hourKey = bucketHourKey(entry.timestamp);
    const dayKey = dateKey(entry.timestamp);
    const visitorHash = hashVisitorIp(entry.remoteAddr, dayKey, saltSecret);
    const latencyMs = entry.requestTime * 1000;
    const ua = parseUserAgent(entry.httpUserAgent);
    const isBot = ua.deviceType === "bot";

    // ── Hourly rollup ──
    let hourBucket = result.hourly.get(hourKey);
    if (!hourBucket) {
      hourBucket = {
        pageviews: 0,
        uniqueVisitorHashes: new Set(),
        bytesTransferred: 0,
        latencies: [],
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
      };
      result.hourly.set(hourKey, hourBucket);
    }
    // AUDIENCE metrics exclude bots; OPERATIONAL metrics below do not. That is
    // deliberate and it means `pageviews` does NOT equal status2xx+3xx+4xx+5xx
    // on the same row: a crawler's 404 is a real thing the box served, but it is
    // not a person reading a page. `pageviews` used to be incremented here
    // unconditionally while `uniqueVisitorHashes` was already gated, so the
    // dashboard reported Googlebot, GPTBot and ClaudeBot as audience.
    if (!isBot) {
      hourBucket.pageviews++;
      hourBucket.uniqueVisitorHashes.add(visitorHash);
    }
    hourBucket.bytesTransferred += entry.bodyBytesSent;
    hourBucket.latencies.push(latencyMs);
    const sb = statusBucket(entry.status);
    if (sb === "2xx") hourBucket.status2xx++;
    else if (sb === "3xx") hourBucket.status3xx++;
    else if (sb === "4xx") hourBucket.status4xx++;
    else if (sb === "5xx") hourBucket.status5xx++;

    // ── Pages ──
    const pageKey = `${dayKey}|${normalizedPath}`;
    let pageBucket = result.pages.get(pageKey);
    if (!pageBucket) {
      pageBucket = { pageviews: 0, uniqueVisitorHashes: new Set(), latencies: [] };
      result.pages.set(pageKey, pageBucket);
    }
    if (!isBot) {
      pageBucket.pageviews++;
      pageBucket.uniqueVisitorHashes.add(visitorHash);
    }
    // Outside the bot gate on purpose: how long the box took to serve a path
    // is true whoever asked for it.
    pageBucket.latencies.push(latencyMs);

    // ── Referrers ──
    const referrerDomain = parseReferrerDomain(entry.httpReferer);
    const refKey = `${dayKey}|${referrerDomain}`;
    let refBucket = result.referrers.get(refKey);
    if (!refBucket) {
      refBucket = { hits: 0 };
      result.referrers.set(refKey, refBucket);
    }
    if (!isBot) refBucket.hits++;

    // ── Countries ──
    const countryCode = entry.country || "XX";
    const countryKey = `${dayKey}|${countryCode}`;
    let countryBucket = result.countries.get(countryKey);
    if (!countryBucket) {
      countryBucket = { pageviews: 0, uniqueVisitorHashes: new Set() };
      result.countries.set(countryKey, countryBucket);
    }
    if (!isBot) {
      countryBucket.pageviews++;
      countryBucket.uniqueVisitorHashes.add(visitorHash);
    }

    // ── Devices ──
    const deviceKey = `${dayKey}|${ua.deviceType}|${ua.browser}|${ua.os}`;
    let deviceBucket = result.devices.get(deviceKey);
    if (!deviceBucket) {
      deviceBucket = { hits: 0 };
      result.devices.set(deviceKey, deviceBucket);
    }
    deviceBucket.hits++;
  }

  return result;
}

/** Compute p95 from a sorted-on-demand array of latencies. */
export function computeP95(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

/** Compute average from an array of numbers. */
export function computeAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
