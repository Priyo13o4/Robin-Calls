import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for server-side fetches of caller-influenced URLs (the directory
 * OG-image proxy). Two independent gates, both must pass:
 *
 *   1. Scheme is https and the host is not an IP literal.
 *   2. Every resolved address is publicly routable — no loopback, private,
 *      link-local, CGNAT, or cloud-metadata ranges.
 *
 * The caller layers an allowlist on top (only origins of published directory
 * rows), so this is defense-in-depth: even an approved host can't be used to
 * reach internal services if its DNS ever points somewhere private.
 */

/** True if an IPv4/IPv6 string falls in a range we must never fetch. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true; // unparseable → treat as unsafe
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 169 && b === 254) return true; // link-local + AWS/GCP metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]!);
  return false;
}

export interface SafeUrlResult {
  ok: boolean;
  reason?: string;
  url?: URL;
}

/**
 * Validate a URL for server-side fetching: https only, host not an IP literal,
 * and every DNS answer publicly routable. Returns the parsed URL when safe.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<SafeUrlResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "scheme must be https" };
  if (isIP(url.hostname) !== 0) return { ok: false, reason: "IP-literal host not allowed" };

  try {
    const answers = await lookup(url.hostname, { all: true });
    if (answers.length === 0) return { ok: false, reason: "host did not resolve" };
    for (const a of answers) {
      if (isPrivateAddress(a.address)) {
        return { ok: false, reason: "host resolves to a private address" };
      }
    }
  } catch {
    return { ok: false, reason: "DNS resolution failed" };
  }
  return { ok: true, url };
}
