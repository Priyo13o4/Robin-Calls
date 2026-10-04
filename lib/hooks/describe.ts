import type { UniswapHookInfo } from "./types";

export type HookFactTone = "warn" | "neutral";

/**
 * What a buyer should know, in plain words, from the list's properties. Only properties the list
 * sets are described; a missing one says nothing, and nothing here ever reads as "safe".
 */
export function hookFacts(info: UniswapHookInfo): { tone: HookFactTone; text: string }[] {
  const p = info.properties;
  const out: { tone: HookFactTone; text: string }[] = [];
  if (p.swapAccess === "allowlist") out.push({ tone: "warn", text: "It can limit who is allowed to swap, and that includes selling." });
  else if (p.swapAccess === "temporal") out.push({ tone: "warn", text: "It can limit when trading is allowed, such as set hours or a cutoff, and that includes selling." });
  else if (p.swapAccess === "governance") out.push({ tone: "warn", text: "Someone controls whether swapping through it is allowed." });
  else if (p.swapAccess === "other") out.push({ tone: "warn", text: "It restricts swapping in a way the list does not classify." });
  if (p.upgradeable === true) out.push({ tone: "warn", text: "Its code can be changed after you buy, so this description may stop being true." });
  if (p.dynamicFee === true) out.push({ tone: "warn", text: "Its swap fee can change from one swap to the next." });
  if (p.requiresCustomSwapData === true) out.push({ tone: "neutral", text: "It expects extra data on each swap, so some routers cannot trade through it." });
  if (info.verifiedSource === false) out.push({ tone: "warn", text: "Its source code is not verified." });
  if (p.swapAccess === "none") out.push({ tone: "neutral", text: "The list records no limit on who can swap." });
  if (p.upgradeable === false) out.push({ tone: "neutral", text: "The list records that its code cannot be upgraded." });
  return out;
}

const FLAG_WORDS: Record<string, string> = {
  beforeInitialize: "before a pool is created", afterInitialize: "after a pool is created",
  beforeAddLiquidity: "before liquidity is added", afterAddLiquidity: "after liquidity is added",
  beforeRemoveLiquidity: "before liquidity is removed", afterRemoveLiquidity: "after liquidity is removed",
  beforeSwap: "before each swap", afterSwap: "after each swap",
  beforeDonate: "before a donation", afterDonate: "after a donation",
  beforeSwapReturnsDelta: "change a swap's amounts before it runs", afterSwapReturnsDelta: "take or add tokens after a swap",
  afterAddLiquidityReturnsDelta: "change amounts when liquidity is added", afterRemoveLiquidityReturnsDelta: "change amounts when liquidity is removed",
};

/** The callbacks the list says the hook runs, as words. Unknown keys are shown raw, never dropped. */
export function hookFlagWords(flags: Record<string, boolean>): string[] {
  return Object.entries(flags).filter(([, on]) => on === true).map(([k]) => FLAG_WORDS[k] ?? k);
}
