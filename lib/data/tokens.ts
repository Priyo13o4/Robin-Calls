import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { database, isDatabaseConfigured } from "@/lib/db/client";
import { registry } from "@/lib/db/schema";
import { BASE_SWAP_TOKENS, type SelectableToken } from "@/lib/trade/types";

export { BASE_SWAP_TOKENS };

/**
 * Reads swappable tokens from the database across RWA stock tokens and graduated DEX tokens.
 * Supports optional search query across symbol, name, and address.
 * Adheres to AGENTS.md §1 & §4: reads degrade to empty on absent DB, but transient
 * DB failures throw so callers never launder infrastructure outages into clean answers.
 */
export async function readSwappableTokens(query?: string): Promise<SelectableToken[]> {
  const conn = database();
  const q = query?.trim();
  const matchingBase = q
    ? BASE_SWAP_TOKENS.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q.toLowerCase()) ||
          t.name.toLowerCase().includes(q.toLowerCase()) ||
          t.address.toLowerCase() === q.toLowerCase()
      )
    : [...BASE_SWAP_TOKENS];

  if (!conn) {
    if (isDatabaseConfigured()) {
      throw new Error("Database configured but connection is unavailable");
    }
    return matchingBase;
  }

  try {
    const pattern = q ? `%${q}%` : "";

    // 1. Stock tokens from the registry table
    // When a query is provided, search across all 196 stock tokens (up to 200 limit)
    const stockWhere = q
      ? and(
          eq(registry.verifyStatus, "ok"),
          inArray(registry.category, ["stock-token", "etf"]),
          or(
            ilike(registry.assetSymbol, pattern),
            ilike(registry.assetName, pattern),
            ilike(registry.address, pattern)
          )
        )
      : and(
          eq(registry.verifyStatus, "ok"),
          inArray(registry.category, ["stock-token", "etf"])
        );

    const stockRows = await conn
      .select({
        address: registry.address,
        symbol: registry.assetSymbol,
        name: registry.assetName,
        category: registry.category,
      })
      .from(registry)
      .where(stockWhere)
      .limit(q ? 200 : 30);

    const stockTokens: SelectableToken[] = stockRows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      address: r.address,
      decimals: 18,
      priceUsd: 0,
      priceEth: 0,
      balance: 0,
      category: "stocks",
      iconBg: "bg-[#181818]",
      iconColor: "text-white",
      iconLabel: r.symbol.slice(0, 2),
      imageUrl: `https://dd.dexscreener.com/ds-data/tokens/robinhood/${r.address.toLowerCase()}.png`,
    }));

    // Merge and deduplicate by lowercased address
    const seen = new Set<string>();
    const result: SelectableToken[] = [];

    for (const t of [...matchingBase, ...stockTokens]) {
      const addr = t.address.toLowerCase();
      if (!seen.has(addr)) {
        seen.add(addr);
        result.push(t);
      }
    }

    return result;
  } catch (err) {
    if (isDatabaseConfigured()) {
      throw err;
    }
    return matchingBase;
  }
}
