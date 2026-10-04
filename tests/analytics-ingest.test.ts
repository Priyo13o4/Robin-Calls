import test from "node:test";
import assert from "node:assert/strict";
import {
  hashVisitorIp,
  normalizeRoute,
  parseUserAgent,
  parseReferrerDomain,
  parseLogLine,
  processLogBatch,
  computeP95,
  computeAvg,
} from "../lib/data/analytics-ingest";

const TEST_SALT = "test-salt-secret-0123456789abcdef";

test("hashVisitorIp produces 24-char daily-scoped pseudonymous hash", () => {
  const ip = "192.168.1.100";
  const date1 = "2026-08-27";
  const date2 = "2026-08-28";

  const hash1 = hashVisitorIp(ip, date1, TEST_SALT);
  const hash2 = hashVisitorIp(ip, date1, TEST_SALT);
  const hashDifferentDate = hashVisitorIp(ip, date2, TEST_SALT);
  const hashDifferentIp = hashVisitorIp("192.168.1.101", date1, TEST_SALT);
  const hashDifferentSalt = hashVisitorIp(ip, date1, "other-salt");

  assert.equal(hash1.length, 24);
  assert.match(hash1, /^[0-9a-f]{24}$/);
  // Deterministic for same inputs
  assert.equal(hash1, hash2);
  // Daily scoped — prevents cross-day tracking
  assert.notEqual(hash1, hashDifferentDate);
  // IP sensitive
  assert.notEqual(hash1, hashDifferentIp);
  // Salt sensitive
  assert.notEqual(hash1, hashDifferentSalt);
});

test("normalizeRoute collapses addresses and filters static assets", () => {
  const tokenAddr = "0x1234567890123456789012345678901234567890";
  assert.equal(
    normalizeRoute(`/scan/${tokenAddr}`),
    "/scan/[address]"
  );
  assert.equal(
    normalizeRoute(`/scan/${tokenAddr}?tab=audit&refresh=true`),
    "/scan/[address]"
  );
  assert.equal(normalizeRoute("/"), "/");
  assert.equal(normalizeRoute("/wanted"), "/wanted");
  assert.equal(normalizeRoute("/compare?tokens=a,b"), "/compare");

  // Static assets, admin console, and telemetry routes are filtered (return null)
  assert.equal(normalizeRoute("/_next/static/chunks/main.js"), null);
  assert.equal(normalizeRoute("/_next/image?url=foo"), null);
  assert.equal(normalizeRoute("/favicon.ico"), null);
  assert.equal(normalizeRoute("/robots.txt"), null);
  assert.equal(normalizeRoute("/brand/logo.svg"), null);
  assert.equal(normalizeRoute("/admin"), null);
  assert.equal(normalizeRoute("/admin/analytics"), null);
  assert.equal(normalizeRoute("/admin/wanted"), null);
  assert.equal(normalizeRoute("/admin/review"), null);
  assert.equal(normalizeRoute("/api/csp-report"), null);
  assert.equal(normalizeRoute("/health"), null);
  assert.equal(normalizeRoute("/api/stats"), null);
});

test("parseUserAgent classifies browsers, devices, and bots", () => {
  // Desktop Chrome on macOS
  const macChrome = parseUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  assert.equal(macChrome.browser, "Chrome");
  assert.equal(macChrome.os, "macOS");
  assert.equal(macChrome.deviceType, "desktop");

  // Mobile Safari on iPhone
  const iphoneSafari = parseUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  );
  assert.equal(iphoneSafari.browser, "Safari");
  assert.equal(iphoneSafari.os, "iOS");
  assert.equal(iphoneSafari.deviceType, "mobile");

  // Windows Edge
  const winEdge = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
  );
  assert.equal(winEdge.browser, "Edge");
  assert.equal(winEdge.os, "Windows");
  assert.equal(winEdge.deviceType, "desktop");

  // Bot & Crawlers
  const bot = parseUserAgent(
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
  );
  assert.equal(bot.deviceType, "bot");
  assert.equal(bot.browser, "Googlebot");
  assert.equal(bot.os, "Search Engine");

  const aiBot = parseUserAgent(
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)"
  );
  assert.equal(aiBot.deviceType, "bot");
  assert.equal(aiBot.browser, "GPTBot (OpenAI)");
  assert.equal(aiBot.os, "AI Crawler");

  // CLI & script bots
  const wgetBot = parseUserAgent("Wget/1.21.3");
  assert.equal(wgetBot.deviceType, "bot");

  const okhttpBot = parseUserAgent("okhttp/4.9.0");
  assert.equal(okhttpBot.deviceType, "bot");

  const javaBot = parseUserAgent("Java/17.0.2");
  assert.equal(javaBot.deviceType, "bot");
});

test("parseReferrerDomain extracts domain or returns Direct", () => {
  assert.equal(parseReferrerDomain("https://github.com/robincalls"), "github.com");
  assert.equal(parseReferrerDomain("https://www.google.com/search?q=robincalls"), "google.com");
  assert.equal(parseReferrerDomain("-"), "Direct");
  assert.equal(parseReferrerDomain(""), "Direct");
  assert.equal(parseReferrerDomain(undefined), "Direct");
  assert.equal(parseReferrerDomain("not-a-valid-url"), "Direct");
});

test("parseReferrerDomain groups known platform aliases into one canonical row", () => {
  assert.equal(parseReferrerDomain("https://twitter.com/robincalls"), "x.com (Twitter)");
  assert.equal(parseReferrerDomain("https://x.com/robincalls"), "x.com (Twitter)");
  assert.equal(parseReferrerDomain("https://t.co/abc123"), "x.com (Twitter)");
  assert.equal(parseReferrerDomain("https://mobile.twitter.com/robincalls"), "x.com (Twitter)");
  assert.equal(parseReferrerDomain("https://m.facebook.com/post"), "facebook.com");
  assert.equal(parseReferrerDomain("https://old.reddit.com/r/CryptoCurrency"), "reddit.com");
  assert.equal(parseReferrerDomain("https://www.google.co.in/search?q=x"), "google.com");
  assert.equal(parseReferrerDomain("https://t.me/robincalls"), "t.me (Telegram)");
  // An unmapped domain passes through unchanged
  assert.equal(parseReferrerDomain("https://news.ycombinator.com/item?id=1"), "news.ycombinator.com");
});

test("parseReferrerDomain treats same-origin referrers as Direct", () => {
  // Default SITE_URL fallback is https://robincalls.com (lib/config/site.ts) —
  // every same-origin sub-resource request (static assets, internal
  // navigation) carries this as its Referer under strict-origin-when-cross-origin
  // and must not pollute the external traffic-source breakdown.
  assert.equal(parseReferrerDomain("https://robincalls.com/wanted"), "Direct");
  assert.equal(parseReferrerDomain("https://www.robincalls.com/scan/0xabc"), "Direct");
  assert.equal(parseReferrerDomain("https://dexscreener.com/robinhood"), "dexscreener.com");
});

test("parseLogLine parses valid JSON log line", () => {
  const line = JSON.stringify({
    timestamp: "2026-08-27T14:32:01+00:00",
    remote_addr: "203.0.113.195",
    request_method: "GET",
    request_uri: "/scan/0x1234567890123456789012345678901234567890",
    uri: "/scan/0x1234567890123456789012345678901234567890",
    status: 200,
    bytes_sent: 14500,
    body_bytes_sent: 14200,
    request_time: 0.045,
    upstream_response_time: "0.042",
    http_referer: "https://t.co/xyz",
    http_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    country: "US",
    cf_ray: "8b1234567890",
  });

  const parsed = parseLogLine(line);
  assert.ok(parsed);
  assert.equal(parsed.remoteAddr, "203.0.113.195");
  assert.equal(parsed.status, 200);
  assert.equal(parsed.requestTime, 0.045);
  assert.equal(parsed.country, "US");
});

test("processLogBatch aggregates metrics correctly and excludes bots from AUDIENCE metrics", () => {
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-27T14:10:00Z",
      remote_addr: "1.1.1.1",
      uri: "/wanted",
      status: 200,
      body_bytes_sent: 5000,
      request_time: 0.05,
      http_referer: "https://twitter.com/post",
      http_user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      country: "US",
    }),
    JSON.stringify({
      timestamp: "2026-08-27T14:20:00Z",
      remote_addr: "1.1.1.1", // Same human visitor in same hour
      uri: "/wanted",
      status: 200,
      body_bytes_sent: 4000,
      request_time: 0.03,
      http_referer: "https://twitter.com/post",
      http_user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      country: "US",
    }),
    JSON.stringify({
      timestamp: "2026-08-27T14:30:00Z",
      remote_addr: "2.2.2.2", // Different human visitor
      uri: "/scan/0x1234567890123456789012345678901234567890",
      status: 404,
      body_bytes_sent: 1000,
      request_time: 0.10,
      http_referer: "-",
      http_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      country: "GB",
    }),
    JSON.stringify({
      timestamp: "2026-08-27T14:40:00Z",
      remote_addr: "3.3.3.3", // Bot crawler
      uri: "/wanted",
      status: 200,
      body_bytes_sent: 2000,
      request_time: 0.02,
      http_referer: "-",
      http_user_agent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      country: "US",
    }),
    JSON.stringify({
      timestamp: "2026-08-27T14:50:00Z",
      remote_addr: "4.4.4.4",
      uri: "/api/csp-report", // Excluded telemetry route with 429
      status: 429,
      body_bytes_sent: 100,
      request_time: 0.01,
      http_referer: "-",
      http_user_agent: "Mozilla/5.0",
      country: "US",
    }),
    "", // Empty line should be skipped
    "invalid json line", // Invalid JSON should be skipped
  ];

  const batch = processLogBatch(lines, TEST_SALT);

  assert.equal(batch.linesProcessed, 4);
  assert.equal(batch.linesSkipped, 3); // 1 empty + 1 invalid + 1 /api/csp-report

  // Hourly check — 3 human pageviews from 2 unique humans (1.1.1.1 and 2.2.2.2).
  // Googlebot at 3.3.3.3 counts toward NEITHER: a crawl is not audience. It is
  // still in the status buckets below, which are operational rather than
  // audience metrics, so `pageviews` deliberately does not equal their sum.
  const hourKey = "2026-08-27T14:00:00.000Z";
  const hour = batch.hourly.get(hourKey);
  assert.ok(hour);
  assert.equal(hour.pageviews, 3);
  assert.equal(hour.uniqueVisitorHashes.size, 2);
  assert.equal(hour.bytesTransferred, 12000);
  assert.equal(hour.status2xx, 3);
  assert.equal(hour.status4xx, 1); // Only the /scan 404; /api/csp-report 429 is skipped
  assert.equal(hour.status5xx, 0);

  // Pages check — /wanted has 2 pageviews, both from 1.1.1.1. The Googlebot hit
  // on the same path adds nothing; it used to add a third.
  const wantedPage = batch.pages.get("2026-08-27|/wanted");
  assert.ok(wantedPage);
  assert.equal(wantedPage.pageviews, 2);
  assert.equal(wantedPage.uniqueVisitorHashes.size, 1);

  const scanPage = batch.pages.get("2026-08-27|/scan/[address]");
  assert.ok(scanPage);
  assert.equal(scanPage.pageviews, 1);
  assert.equal(scanPage.uniqueVisitorHashes.size, 1);

  // Referrers check — twitter.com is canonicalized to the grouped alias
  const twitterRef = batch.referrers.get("2026-08-27|x.com (Twitter)");
  assert.ok(twitterRef);
  assert.equal(twitterRef.hits, 2);

  // Only the human 404 on /scan. Googlebot also arrived with no Referer and
  // used to make this 2; a crawler has no referral story worth reporting.
  const directRef = batch.referrers.get("2026-08-27|Direct");
  assert.ok(directRef);
  assert.equal(directRef.hits, 1);

  // Countries check — US has 2 human pageviews, both 1.1.1.1. The US Googlebot
  // hit used to make this 3, which inflated the geography chart with crawlers.
  const usCountry = batch.countries.get("2026-08-27|US");
  assert.ok(usCountry);
  assert.equal(usCountry.pageviews, 2);
  assert.equal(usCountry.uniqueVisitorHashes.size, 1);

  const gbCountry = batch.countries.get("2026-08-27|GB");
  assert.ok(gbCountry);
  assert.equal(gbCountry.pageviews, 1);
  assert.equal(gbCountry.uniqueVisitorHashes.size, 1);

  // Devices check — the bot IS still recorded here. This is the deliberate
  // seam: audience metrics drop crawlers, the device breakdown keeps them, so
  // "how much of our traffic is crawlers" stays answerable.
  const botDevice = batch.devices.get("2026-08-27|bot|Googlebot|Search Engine");
  assert.ok(botDevice);
  assert.equal(botDevice.hits, 1);
});

test("computeP95 and computeAvg compute statistics correctly", () => {
  const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(computeAvg(latencies), 55);
  assert.equal(computeP95(latencies), 100);

  const empty: number[] = [];
  assert.equal(computeAvg(empty), 0);
  assert.equal(computeP95(empty), 0);
});
