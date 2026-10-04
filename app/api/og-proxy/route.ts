import { NextRequest, NextResponse } from "next/server";
import { assertPublicHttpsUrl } from "@/lib/security/ssrf";
import { readPublishedDirectoryUrls } from "@/lib/data/registry";

export const runtime = "nodejs"; // needs node DNS for the SSRF guard

/**
 * Directory banner proxy: fetches a published platform's page and extracts its
 * og:image / twitter:image so the directory cards can show a preview.
 *
 * Hardened against SSRF three ways:
 *   1. Allowlist — the requested origin MUST match a published directory row.
 *      Callers can't point this at arbitrary hosts.
 *   2. assertPublicHttpsUrl — https only, no IP-literal hosts, and every DNS
 *      answer must be publicly routable (blocks localhost / 169.254.169.254 /
 *      RFC-1918 / CGNAT / ULA).
 *   3. Bounded read — cap the HTML we buffer so a hostile page can't exhaust
 *      memory, and only the <head> is needed for meta tags.
 *
 * Also rate-limited as a "read" class in proxy.ts.
 */

const MAX_HTML_BYTES = 512 * 1024; // 512 KB is plenty for <head> meta tags

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // ── 1. allowlist: origin must belong to a published directory listing ──
  let requestedOrigin: string;
  try {
    requestedOrigin = new URL(raw).origin;
  } catch {
    return NextResponse.json({ error: "Invalid url." }, { status: 400 });
  }

  const rows = await readPublishedDirectoryUrls();

  const allowed = new Set(
    rows
      .map((r) => {
        try {
          return new URL(r.url).origin;
        } catch {
          return null;
        }
      })
      .filter((o): o is string => o !== null)
  );

  if (!allowed.has(requestedOrigin)) {

    // Not an approved listing — refuse silently (no oracle for probing).
    return NextResponse.json({ image: null }, { status: 403 });
  }

  // ── 1b. Submitter-declared banner, if any, wins outright — but only the
  //     value ADMIN-APPROVED FOR THIS ROW, looked up server-side. `banner`
  //     is deliberately not a client-suppliable query param: that would turn
  //     this endpoint into a fetch-anything-https proxy gated by nothing more
  //     than "know one public directory URL". A live site's own og:image
  //     already points at arbitrary hosts too (§ below), but that risk is
  //     bounded to what the platform's OWN page declares about itself; an
  //     open param has no such bound.
  const declaredRaw = rows.find((r) => r.url === raw)?.banner_url;
  const declared = declaredRaw && sanitize(declaredRaw, raw);
  if (declared) {
    const live = await firstLiveImage([declared]);
    if (live) {
      return NextResponse.json(
        { image: live },
        {
          headers: {
            "Cache-Control":
              "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        }
      );
    }
    // Declared banner is dead (site redeployed, link rotted) — fall through
    // to the normal scrape below rather than serving nothing.
  }

  // ── 2 + 3. SSRF-guarded fetch, following same-origin redirects only ──
  // Landing pages routinely 307 to a sub-route (pons.family/ → /launchpad);
  // each hop is re-guarded and must stay on the allowlisted origin, so a
  // redirect still can't escape to an arbitrary host.
  try {
    let target = raw;
    let fetchedUrl = raw; // the exact URL that produced `res` — the base for resolving relative hrefs
    let res: Response | null = null;
    for (let hop = 0; hop < 3; hop++) {
      const safe = await assertPublicHttpsUrl(target);
      if (!safe.ok || !safe.url) return NextResponse.json({ image: null }, { status: 400 });
      res = await fetch(safe.url, {
        headers: { "User-Agent": "RobinCalls-Bot/1.0", accept: "text/html" },
        redirect: "manual",
        cache: "no-store", // our bounded response is cached below; never cache the raw fetch
        signal: AbortSignal.timeout(3000),
      });
      fetchedUrl = safe.url.toString();
      if (res.status < 300 || res.status >= 400) break;
      const next = new URL(res.headers.get("location") ?? "", safe.url);
      if (next.origin !== requestedOrigin) return NextResponse.json({ image: null });
      target = next.toString();
      res = null;
    }
    if (!res?.ok || !res.body) return NextResponse.json({ image: null });

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return NextResponse.json({ image: null });

    const html = await readCapped(res.body, MAX_HTML_BYTES);
    const image = await firstLiveImage(extractImageCandidates(html, fetchedUrl));
    return NextResponse.json(
      { image },
      {
        headers: {
          "Cache-Control":
            "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch {
    return NextResponse.json({ image: null });
  }
}

/**
 * Declared social images are often stale (a dead og:image URL on a launchpad
 * that redeployed, an /opengraph-image route that 500s), so candidates are
 * verified before one is handed to the client's <img>: first candidate that
 * answers 200 with an image/* content-type wins. Each probe re-runs the SSRF
 * guard — og:image frequently points at a *different* host than the page.
 */
async function firstLiveImage(candidates: string[]): Promise<string | null> {
  // extractImageCandidates already resolved every entry to an absolute https URL.
  const seen = new Set<string>();
  let probes = 0;
  for (const abs of candidates) {
    if (probes >= 4) break; // bounded work per request; result is CDN-cached
    if (seen.has(abs)) continue;
    seen.add(abs);

    const safe = await assertPublicHttpsUrl(abs);
    if (!safe.ok || !safe.url) continue;
    probes++;
    try {
      const res = await fetch(safe.url, {
        headers: { "User-Agent": "RobinCalls-Bot/1.0", accept: "image/*" },
        redirect: "error", // a redirect would escape the SSRF check above
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      const ct = res.headers.get("content-type") ?? "";
      await res.body?.cancel().catch(() => {}); // headers are all we need
      if (res.ok && ct.startsWith("image/")) return abs;
    } catch {
      /* dead candidate — try the next one */
    }
  }
  return null;
}

/** Read a stream up to `limit` bytes, then stop — never buffer a whole hostile page. */
async function readCapped(
  body: ReadableStream<Uint8Array>,
  limit: number
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= limit) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * All plausible banner images in priority order: og:image, twitter:image,
 * apple-touch-icon, icon links, then the first in-page <img> sources (a hero
 * image beats a blank card when the meta tags are broken).
 *
 * `pageUrl` is the exact URL that served this HTML (post-redirects) — bare
 * relative hrefs (no leading slash, e.g. wagent.fun's `<link rel="icon"
 * href="logo.png">`) resolve against its directory, not just the origin, so a
 * candidate on a subpath page (ponsfamily.com/launchpad) lands correctly too.
 */
function extractImageCandidates(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const push = (m: RegExpMatchArray | null) => {
    const v = m?.[1] && sanitize(m[1], pageUrl);
    if (v) out.push(v);
  };

  push(
    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i)
  );
  push(
    html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/i)
  );
  push(html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i));
  push(html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+\.png[^"']*)["']/i));

  for (const m of html.matchAll(/<img[^>]*src=["']([^"']+)["']/gi)) {
    const v = sanitize(m[1], pageUrl);
    if (v) out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Resolve against the page's own URL (handles bare-relative, root-relative,
 * and absolute hrefs alike — new URL()'s base-resolution covers all three),
 * then keep only https. Protocol-relative ("//host/…") is rejected before
 * resolution so an og:image tag can't point the banner at an arbitrary
 * external host; http:, data:, javascript: all fail the protocol check below.
 */
function sanitize(candidate: string, pageUrl: string): string | null {
  if (candidate.startsWith("//")) return null;
  try {
    const u = new URL(candidate, pageUrl);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
