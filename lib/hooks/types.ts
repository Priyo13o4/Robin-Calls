export type HookSwapAccess = "none" | "allowlist" | "temporal" | "governance" | "other";

export interface UniswapHookProperties {
  dynamicFee?: boolean;
  upgradeable?: boolean;
  requiresCustomSwapData?: boolean;
  vanillaSwap?: boolean;
  swapAccess?: HookSwapAccess | string;
}

/** One entry of Uniswap's hook list: what the hook's team submitted, reviewed by Uniswap. */
export interface UniswapHookInfo {
  chainId: number;
  address: string;
  name: string;
  description: string;
  deployer: string;
  verifiedSource: boolean | null;
  auditUrl: string;
  flags: Record<string, boolean>;
  properties: UniswapHookProperties;
  fetchedAt: string;
}

export const HOOKLIST_URL = "https://raw.githubusercontent.com/Uniswap/hooklist/main/hooklist.json";
export const HOOKLIST_SOURCE_URL = "https://github.com/Uniswap/hooklist";
