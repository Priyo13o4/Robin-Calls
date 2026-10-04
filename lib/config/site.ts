/**
 * The site's own absolute origin.
 *
 * Absolute URLs are required in three places a relative path silently breaks:
 * `sitemap.xml`, `robots.txt`, and JSON-LD `@id`/`url` fields — a crawler
 * resolving a relative `@id` gets a different node identity per page and the
 * graph stops linking up. Centralised so those three cannot drift apart.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || "https://robincalls.com";
