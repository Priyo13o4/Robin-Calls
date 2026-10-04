/**
 * Optional CDN indirection for heavy static assets (the roadmap GLB, hero /
 * section background art, the loading-screen scene). The heavy media lives in a
 * Cloudflare R2 bucket behind `cdn.robincalls.com` (free egress) so the VPS
 * serves application traffic rather than tens of megabytes of art.
 *
 * Set NEXT_PUBLIC_CDN_URL to the bucket's public origin (e.g.
 * "https://cdn.robincalls.com") and the referenced files are served from there.
 * Leave it unset and everything falls back to the local /public path, so dev and
 * any not-yet-configured environment keep working unchanged.
 *
 * Only route genuinely heavy, cacheable, public files through this — never
 * anything private or per-request. The R2 bucket must mirror the same paths
 * (e.g. upload public/models/roadmap-city.glb to <bucket>/models/roadmap-city.glb).
 */
/**
 * A bare host gets https://. Set as a repo Variable this arrived once as
 * "cdn.robincalls.com" with no scheme, and `${origin}${path}` then yields a
 * RELATIVE url — the browser resolves it against the current page, so every
 * heavy asset 404s at https://robincalls.com/cdn.robincalls.com/... with
 * nothing failing at build or deploy to say so.
 *
 * Only a bare host is rewritten. A protocol-relative "//host" and a
 * same-origin path prefix "/assets" are both legitimate and mean something a
 * bare host cannot, so the rewrite must not reach them.
 *
 * Exported and pure so it can be tested directly: the origin below is read
 * once at module load, which no amount of env juggling in a test can re-run.
 */
export function normalizeCdnOrigin(raw: string | undefined): string {
  const v = raw?.trim().replace(/\/+$/, "") ?? "";
  if (!v || v.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  return `https://${v}`;
}

const RAW = normalizeCdnOrigin(process.env.NEXT_PUBLIC_CDN_URL);

/** Prefix an absolute `/public` path with the CDN origin when one is configured. */
export function cdnUrl(path: string): string {
  if (!RAW) return path;
  return `${RAW}${path.startsWith("/") ? "" : "/"}${path}`;
}
