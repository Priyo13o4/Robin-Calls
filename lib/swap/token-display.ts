import { parseAbi } from "viem";
import type { AllowanceClient } from "./plan-context";
import { factCache } from "./fact-cache";
import { runSharedRpcWork } from "../observability/context";
import { NATIVE, type Address, type TokenDisplay, type TokenDisplayPair } from "./types";

const ERC20_DISPLAY = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** Above this a scale is not a token's decimals, it is a garbage decode. */
const MAX_DECIMALS = 36;

/** Read failure and "the token says 0" are different answers, so this never coerces (§8 #3). */
function asDecimals(value: unknown): number | null {
  const n = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_DECIMALS) return null;
  return n;
}

function asSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  // A token is free to return an empty or absurd symbol; neither is worth printing.
  return s && s.length <= 32 ? s : null;
}

/**
 * How to PRINT a token's amounts, never how to compute them. `decimals: null` means the
 * read failed, and the panel then shows base units and says so: a wrong scale renders a
 * wrong number with no sign that anything went wrong (§4, §8 #11).
 */
export async function readTokenDisplay(client: AllowanceClient, token: Address): Promise<TokenDisplay> {
  if (token.toLowerCase() === NATIVE) return { symbol: "ETH", decimals: 18 };
  const address = token.toLowerCase() as Address;
  // Only a complete answer is kept: a failed leg must be re-asked, never remembered.
  return displayCache.get(address, () => readDisplayOnce(client, address), (d) => d.symbol !== null && d.decimals !== null);
}

const displayCache = factCache<TokenDisplay>(60 * 60_000, 1024, runSharedRpcWork);

async function readDisplayOnce(client: AllowanceClient, address: Address): Promise<TokenDisplay> {
  const [symbol, decimals] = await Promise.all([
    client
      .readContract({ address, abi: ERC20_DISPLAY, functionName: "symbol" })
      .then(asSymbol)
      .catch(() => null),
    client
      .readContract({ address, abi: ERC20_DISPLAY, functionName: "decimals" })
      .then(asDecimals)
      .catch(() => null),
  ]);
  return { symbol, decimals };
}

/** Both legs, in parallel. A failed read on one leg never costs the other its scale. */
export async function readTokenDisplayPair(
  client: AllowanceClient,
  tokenIn: Address,
  tokenOut: Address,
): Promise<TokenDisplayPair> {
  const [inDisplay, outDisplay] = await Promise.all([
    readTokenDisplay(client, tokenIn),
    readTokenDisplay(client, tokenOut),
  ]);
  return { in: inDisplay, out: outDisplay };
}
