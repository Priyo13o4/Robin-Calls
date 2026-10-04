import { toFunctionSelector } from "viem";

/**
 * Browser-safe selector knowledge shared by the lightweight trade preflight
 * and the authoritative scanner. A selector hit is only a name hint; it does
 * not establish runtime behavior or a trade verdict.
 */
export interface DangerousSelectorDefinition {
  signature: string;
  label: string;
}

export const DANGEROUS_SELECTOR_DEFINITIONS: readonly DangerousSelectorDefinition[] = [
  { signature: "mint(address,uint256)", label: "mint" },
  { signature: "mint(uint256)", label: "mint" },
  { signature: "pause()", label: "pause trading" },
  { signature: "blacklist(address)", label: "blacklist" },
  { signature: "addToBlacklist(address)", label: "blacklist" },
  { signature: "setBlacklist(address,bool)", label: "blacklist" },
  { signature: "setMaxTxAmount(uint256)", label: "max-tx limit" },
  { signature: "setMaxWalletAmount(uint256)", label: "max-wallet limit" },
  { signature: "setFees(uint256,uint256)", label: "fee setter" },
  { signature: "setTaxes(uint256,uint256)", label: "tax setter" },
  { signature: "setSwapAndLiquifyEnabled(bool)", label: "swap toggle" },
  { signature: "enableTrading()", label: "trading gate" },
  { signature: "authorizedRouters(address)", label: "router whitelist" },
  { signature: "setAuthorizedRouter(address,bool)", label: "router whitelist setter" },
  { signature: "liquidityOperators(address)", label: "operator whitelist" },
  { signature: "setLiquidityOperators(address[],bool)", label: "operator whitelist setter" },
  { signature: "setBlacklist(address[],bool)", label: "batch blacklist" },
] as const;

export const V4_HOOK_HONEYPOT_SIGNATURES = [
  "authorizedRouters(address)",
  "setAuthorizedRouter(address,bool)",
  "liquidityOperators(address)",
  "setLiquidityOperators(address[],bool)",
  "setBlacklist(address[],bool)",
  "isWhitelist(address)",
  "setCap(uint256)",
] as const;

/** Conventional interface signatures used by the cheap browser check. */
const dangerousSignaturesForLabels = (...labels: string[]) =>
  DANGEROUS_SELECTOR_DEFINITIONS.filter((entry) => labels.includes(entry.label)).map((entry) => entry.signature);

export const QUICK_CONTROL_SIGNATURES = {
  pause: ["pause()", "unpause()", "paused()"],
  mint: [...dangerousSignaturesForLabels("mint"), "mintTo(address,uint256)"],
  blacklist: [...dangerousSignaturesForLabels("blacklist", "batch blacklist"), "blockAddress(address)", "addBlacklistAddress(address)", "removeBlacklistAddress(address)"],
  whitelist: ["isWhitelisted(address)", "setWhitelist(address,bool)", ...V4_HOOK_HONEYPOT_SIGNATURES],
  fee: [...dangerousSignaturesForLabels("fee setter", "tax setter"), "setFee(uint256)", "setSellTax(uint256)", "setBuyTax(uint256)", "setTax(uint256,uint256)", "setProjectTaxRates(uint16,uint16)", "setTaxAccountingAdapter(address)", "addLiquidityPool(address)", "removeLiquidityPool(address)"],
  ownership: ["owner()", "transferOwnership(address)", "renounceOwnership()"],
  roles: ["hasRole(bytes32,address)", "getRoleAdmin(bytes32)", "grantRole(bytes32,address)"],
  upgrade: ["upgradeTo(address)", "upgradeToAndCall(address,bytes)", "implementation()", "proxiableUUID()"],
} as const;

export function selectorForSignature(signature: string): string {
  return toFunctionSelector(signature).slice(2).toLowerCase();
}

export const QUICK_CONTROL_SELECTORS = Object.fromEntries(
  Object.entries(QUICK_CONTROL_SIGNATURES).map(([family, signatures]) => [
    family,
    signatures.map(selectorForSignature),
  ]),
) as unknown as { [K in keyof typeof QUICK_CONTROL_SIGNATURES]: readonly string[] };

/** Older quick-check selectors retained until their originating ABI is identified. */
export const QUICK_CONTROL_LEGACY_SELECTORS = {
  blacklist: ["0ecb93c0", "f9a8a6db"],
  whitelist: ["9b19251a", "4a2f7f65"],
  upgrade: ["8f283970"],
} as const;

/** Match a PUSH4 selector followed by EQ, avoiding incidental byte matches. */
export function hasEvmDispatcherSelector(code: string | undefined, selector: string): boolean {
  if (!code) return false;
  const hex = code.toLowerCase().replace(/^0x/, "");
  const normalizedSelector = selector.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{8}$/.test(normalizedSelector)) return false;
  return hex.includes(`63${normalizedSelector}14`);
}
