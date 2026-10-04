import { parseAbi, type Abi } from "viem";
import { batchRead } from "@/lib/rpc/multicall";

const ERC20_META = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export interface TokenMeta {
  name: string | null;
  symbol: string | null;
  /** null = not read. Never defaulted to 18 here; the caller decides. */
  decimals: number | null;
}

/** name/symbol/decimals for many tokens in one batched read. A failed field stays null. */
export async function readTokenMeta(tokens: readonly string[]): Promise<Map<string, TokenMeta>> {
  const out = new Map<string, TokenMeta>();
  const unique = [...new Set(tokens.map((t) => t.toLowerCase()))];
  if (!unique.length) return out;
  const results = await batchRead(
    unique.flatMap((t) =>
      (["name", "symbol", "decimals"] as const).map((functionName) => ({
        address: t as `0x${string}`,
        abi: ERC20_META as Abi,
        functionName,
      })),
    ),
  );
  unique.forEach((t, i) => {
    const [name, symbol, decimals] = [results[i * 3], results[i * 3 + 1], results[i * 3 + 2]];
    const cleanStr = (val: unknown): string | null => {
      if (typeof val !== "string") return null;
      const cleaned = val.replace(/\0/g, "").trim();
      return cleaned.length > 0 ? cleaned : null;
    };
    out.set(t, {
      name: name?.status === "success" ? cleanStr(name.value) : null,
      symbol: symbol?.status === "success" ? cleanStr(symbol.value) : null,
      decimals: decimals?.status === "success" ? Number(decimals.value) : null,
    });
  });
  return out;
}
