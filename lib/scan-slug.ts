/**
 * Scan route slug utilities for SEO-friendly URLs: /scan/[symbol]-[address]
 */

const ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/;

/**
 * Extracts the first 0x-prefixed 40-hex-character address from a slug,
 * lowercasing it. Returns null if no valid address is present.
 */
export function parseScanSlug(slug: string): string | null {
  if (!slug || typeof slug !== "string") return null;
  const match = slug.match(ADDRESS_REGEX);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Builds a canonical scan slug in the form `${cleanedSymbol}-${address}`,
 * falling back to bare lowercased `${address}` when symbol is absent or cleans to empty.
 */
export function buildScanSlug(address: string, symbol?: string | null): string {
  const normalizedAddr = (address ?? "").trim().toLowerCase();
  const cleanedSymbol = (symbol ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  if (!cleanedSymbol) {
    return normalizedAddr;
  }

  return `${cleanedSymbol}-${normalizedAddr}`;
}
