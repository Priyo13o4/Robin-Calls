/**
 * Re-export base swap tokens from types.ts for backward compatibility.
 * All multi-chain base tokens and types live canonically in lib/trade/types.ts.
 */
export {
  COMMON_BASES_BY_CHAIN,
  getBaseSwapTokens,
  BASE_SWAP_TOKENS,
} from "./types";
export type { SelectableToken } from "./types";
