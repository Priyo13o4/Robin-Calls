/**
 * URL slugs for /ecosystem/<slug>.
 *
 * Kept identical to the SQL in migration 0066 — the DB backfills existing rows
 * and this generates one for a new submission, so a divergence would give two
 * listings two different slug conventions with no error anywhere.
 * `tests/ecosystem-slug.test.ts` pins the two against each other.
 */

/** Lowercase, alphanumeric runs joined by single hyphens, no leading/trailing hyphen. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A slug that is safe to put in the URL for `id`.
 *
 * A name that slugifies to nothing (all punctuation, or a non-Latin script)
 * still needs an addressable page, so it falls back to the id. Ugly and rare;
 * an ugly URL that resolves beats a null that 500s the route.
 */
export function listingSlug(name: string, id: number): string {
  return slugify(name) || `listing-${id}`;
}

/** What a route param must look like before it is worth a database round-trip. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
