"use client";

import { custodyPoolForPlan, LP_CUSTODY_POLL_MS, type LpCustodyLiveResult } from "@/lib/trade/lp-custody-shared";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "framer-motion";
import { InputNumberScroll } from "./InputNumberScroll";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Copy,
  History,
  Loader2,
  Pencil,
  Eraser,
  RefreshCcwDot,
  RefreshCw,
  Undo2,
  Search,
  Info,
  Repeat2,
  ShieldAlert,
  ScanSearch,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  X,
  Zap,
} from "lucide-react";
import { createPublicClient, erc20Abi, formatUnits, http, isAddress, parseUnits } from "viem";
import { useBalance, useGasPrice, usePublicClient, useSwitchChain } from "wagmi";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID, getSaleChain, robinhoodChain } from "@/lib/config/chain";
import { useWallet } from "@/lib/wallet/useWallet";
import { useTokenBalances, robinhoodPublicClient } from "@/lib/trade/useTokenBalances";
import { BASE_SWAP_TOKENS, type SelectableToken } from "@/lib/trade/types";
import { CANONICAL_STOCK_TOKENS } from "@/lib/trade/canonical-stocks";
import { TokenAvatar } from "./TokenAvatar";
import { searchDexScreenerPairs } from "@/lib/trade/dexscreener-api";
import { useCopy } from "@/app/components/site/CopyAddressChip";
import { NATIVE, type Address, type PlanView, type SignedPermit, type SwapRequest } from "@/lib/swap/types";
import { adviceSentence, describePlanStatus, describeSimulation } from "@/lib/swap/ui-state";
import { fetchSwapPlan, isSupersededPlanError } from "@/lib/swap/client";
import { formatDexPrice } from "@/lib/trade/format";
import { fetchLivePrices, LIVE_PRICE_REFRESH_MS, pickTokenPriceUsd } from "@/lib/trade/live-price";
import { canProceedWithHookStep, hookWarningsForPlan } from "@/lib/swap/hook-runtime";
import { HookDetails } from "./HookDetails";
import { TradeWarningsModal } from "./TradeWarningsModal";
import { CopyAddressChip } from "@/app/components/site/CopyAddressChip";
import { isLargeEstimatedPriceImpact } from "@/lib/swap/price-impact";
import { selectedPoolFeeSummary } from "@/lib/swap/fee-display";
import {
  fetchTradeSecuritySignal,
  isSecuritySignalChangeForReview,
  plannedBlockedRouteMatches,
  type TradeSecuritySignal,
} from "./security-signal";
import {
  classifyReceiptOutcome,
  doesPlanMatchRequest,
  isApprovalRepeated,
  isAttemptValid,
  isQuoteAttemptCurrent,
  isPendingBroadcastActive,
  isPlanExpired,
  makeApprovalKey,
  resolvePendingHashOnTimeout,
  type TradeAttemptCurrent,
  type TradeAttemptTarget,
} from "@/lib/trade/trade-attempt";
import { readLiquidity } from "@/lib/trade/liquidity-watch";
import { onScanAnnounced } from "@/lib/trade/scan-signal";
import {
  calculateMaxNativeAmount,
  comparePlansForReview,
  deserializeTokenFromStorage,
  formatBaseUnits,
  formatPriceImpact,
  formatVenueDisplay,
  getTaxDisclosure,
  serializeTokenForStorage,
  validateExactRawBalance,
} from "@/lib/trade/quote-review";
import {
  parseCustomSlippage,
  formatSelectedSlippageDisplay,
  getEffectiveSlippageBps,
  getCustomExecuteSlippage,
  formatTruthfulSlippageLabel,
  AUTO_SLIPPAGE_LABEL,
  DEFAULT_SLIPPAGE_PRESETS,
  type ParseSlippageResult,
} from "@/lib/trade/slippage";

import { dismissToast, toast, ONE_SHOT_MS } from "@/components/ui/use-toast";
import {
  runTradeContractQuickCheck,
  isWarningSuppressed,
  setWarningSuppressed,
  registerCanonicalRwaAddresses,
  isCanonicalRwaAddress,
  isBaseSwapToken,
  type TradeQuickCheckResult,
} from "@/lib/trade/quick-check";

// viem's default is 4 s; blocks here are ~0.1 s, so a 4 s poll shows a mined swap up to 4 s late.
const RECEIPT_POLL_MS = 1_000;

export type { SelectableToken };
export { InputNumberScroll } from "./InputNumberScroll";

/** Amount shrinks in steps as digits pile up so text never overflows. */
/** The /swap page opens with no receive token, like Uniswap. Never quoted, never sent. */
const UNSELECTED_TOKEN: SelectableToken = {
  symbol: "",
  name: "",
  address: "",
  decimals: 18,
  priceUsd: 0,
  priceEth: 0,
  balance: 0,
  category: "crypto",
  volume24h: 0,
  iconBg: "",
  iconColor: "",
  iconLabel: "",
};
const isUnselected = (token: SelectableToken) => !token.isNative && !token.address;

/** Width in characters as displayed: en-US grouping adds a comma every three integer digits. */
function displayLength(amount: string): number {
  const intDigits = amount.replace(/,/g, "").split(".")[0].replace(/\D/g, "").length;
  return amount.replace(/,/g, "").length + Math.max(0, Math.floor((intDigits - 1) / 3));
}

function sizeForLength(len: number) {
  if (len <= 4) return 38;
  if (len <= 6) return 34;
  if (len <= 8) return 30;
  if (len <= 10) return 26;
  if (len <= 13) return 22;
  if (len <= 16) return 18;
  if (len <= 20) return 15;
  return 13;
}

/**
 * Copy button for asset contract address with instant visual feedback.
 */
function CopyAddressButton({ address }: { address: string }) {
  const { copied, copy } = useCopy(address);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy();
      }}
      title={copied ? "Copied!" : `Copy ${address}`}
      aria-label={copied ? "Address copied" : `Copy address ${address}`}
      className="p-1 rounded text-[#a3a3a3] hover:text-[#ccff00] hover:bg-white/10 transition-colors shrink-0"
    >
      {copied ? (
        <Check className="size-3 text-[#ccff00]" strokeWidth={2.5} />
      ) : (
        <Copy className="size-3" strokeWidth={2} />
      )}
    </button>
  );
}

export const CANONICAL_ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const fallbackRobinhoodClient = createPublicClient({
  chain: robinhoodChain,
  batch: {
    multicall: {
      batchSize: 1024,
      wait: 32,
    },
  },
  transport: http(CANONICAL_ROBINHOOD_RPC_URL, {
    timeout: 6000,
    retryCount: 2,
    batch: {
      batchSize: 1024,
      wait: 32,
    },
  }),
});

export const IMPORTED_TOKENS_STORAGE_KEY = "robincalls_imported_tokens";
export const RECENT_TOKENS_STORAGE_KEY = "robincalls_recent_tokens";

function tokenSecurityAddresses(tokens: SelectableToken[]): string[] {
  return [...new Set(tokens
    .filter((token) => !token.isNative && !isBaseSwapToken(token.address, ROBINHOOD_CHAIN_ID) && isAddress(token.address))
    .map((token) => token.address.toLowerCase()))];
}

function securitySignalText(signal: TradeSecuritySignal): string {
  if (signal.kind === "unknown") return "Scanner result unavailable. Risk is unknown.";
  if (signal.kind === "unscanned") return "No saved scan result is available. Risk is unknown.";
  if (signal.honeypot?.status.toUpperCase() === "CRITICAL") {
    return `Scanner: CRITICAL — honeypot. ${signal.honeypot.reason || "The scan found severe sell restrictions."}`;
  }
  if (signal.ownToken) return "RobinCalls issued this token, so it is not scored. The honeypot and liquidity reads still apply.";
  if (signal.tier.toUpperCase() === "CRITICAL") return `Scanner: CRITICAL risk tier · ${signal.score}/100.`;
  if (!signal.currentFormula) return `Scan uses older scoring rules (${signal.scoreVersion}); rescan for current rules. The result is not a safety guarantee.`;
  return `Saved token scan: ${signal.tier} · ${signal.score}/100. A scan does not establish current chain state or that a token is safe.`;
}

function conclusiveBlockedRoutes(signal: TradeSecuritySignal): Array<{ poolId?: string; protocol?: string; reason: string }> {
  return signal.kind === "verdict" ? signal.honeypot?.blockedRoutes ?? [] : [];
}

function hasConclusiveBlockedRoute(signal: TradeSecuritySignal): boolean {
  return conclusiveBlockedRoutes(signal).length > 0;
}

function hasIncompleteSellCoverage(signal: TradeSecuritySignal): boolean {
  return signal.kind === "verdict" && signal.honeypot?.sellCoverageIncomplete === true;
}

function securityScanTimestamp(signal: TradeSecuritySignal): string | null {
  return signal.kind === "verdict"
    ? `Saved scan: ${new Date(signal.scannedAt).toLocaleString()}`
    : null;
}

function verdictPillText(signal: Extract<TradeSecuritySignal, { kind: "verdict" }>): string {
  return signal.ownToken ? "Our token · not scored" : `${signal.tier} · ${signal.score}/100`;
}

/** The sentence a verdict needs beyond its tier pill; null when the pill says it all. */
function securityDetailText(signal: TradeSecuritySignal): string | null {
  if (signal.kind !== "verdict") return null;
  if (signal.honeypot?.status.toUpperCase() === "CRITICAL") return `Honeypot. ${signal.honeypot.reason || "The scan found severe sell restrictions."}`;
  if (!signal.currentFormula) return `Scored with older rules (${signal.scoreVersion}). Rescan for the current rules.`;
  return null;
}

function tierTone(signal: TradeSecuritySignal): StatusTone {
  if (signal.kind !== "verdict") return "muted";
  const tier = signal.tier.toUpperCase();
  if (signal.ownToken) return signal.honeypot?.status.toUpperCase() === "CRITICAL" ? "bad" : "muted";
  // Tiers: CLEAR | CAUTION | DANGER | CRITICAL (lib/config/formula.ts).
  return tier === "CRITICAL" || tier === "DANGER" || signal.honeypot?.status.toUpperCase() === "CRITICAL" ? "bad"
    : tier === "CLEAR" ? "ok" : "warn";
}

// Never "safe" or "pass": selector absence is not a verdict (quick-check.ts).
function quickCheckPill(status: TradeQuickCheckResult["status"]): string {
  return status === "paused" ? "Paused" : status === "controls" ? "Controls found" : status === "clear" ? "No standard controls" : "Unavailable";
}

type StatusTone = "bad" | "warn" | "ok" | "muted";

type LpCustodyResult = LpCustodyLiveResult;

const STATUS_TONE: Record<StatusTone, string> = {
  bad: "border-[#ff5c5c]/40 bg-[#ff5c5c]/10 text-[#ff8a8a]",
  warn: "border-[#f5b942]/35 bg-[#f5b942]/10 text-[#f5c96a]",
  ok: "border-[#ccff00]/25 bg-[#ccff00]/[0.06] text-[#dce6c8]",
  muted: "border-white/10 bg-white/[0.04] text-[#b7bdb3]",
};

function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 ${STATUS_TONE[tone]}`}>{children}</span>;
}

export interface ModernTradingCardProps {
  tokenAddress?: string;
  /** Omit both this and tokenAddress to open with no receive token chosen (the /swap page). */
  tokenSymbol?: string;
  tokenName?: string;
  tokenImageUrl?: string;
  priceUsd: number;
  priceEth: number;
  decimals?: number;
  initialMode?: "buy" | "sell";
  onTradeSuccess?: (txHash: string) => void;
  /** Read-only terminal context observer; never triggers a quote or execution. */
  onPlanContext?: (plan: PlanView | null) => void;
  customExecute?: (amount: string, mode: "buy" | "sell", slippage: number) => Promise<string>;
  canonicalRwaAddresses?: Iterable<string>;
  /** /swap only: no page feeds this card a price, so it refreshes its two tokens itself. */
  livePrices?: boolean;
  /** /swap chart control, placed with the other header actions. */
  chartAction?: ReactNode;
  /** Reports the asset the chart should follow as the swap selection changes. */
  onMarketTokenChange?: (token: SelectableToken) => void;
}

export function ModernTradingCard({
  tokenAddress,
  tokenSymbol = "",
  tokenName,
  tokenImageUrl,
  priceUsd,
  priceEth,
  decimals: propDecimals,
  initialMode = "buy",
  onTradeSuccess,
  onPlanContext,
  customExecute,
  canonicalRwaAddresses,
  livePrices = false,
  chartAction,
  onMarketTokenChange,
}: ModernTradingCardProps) {
  const wallet = useWallet();
  // EIP-5792: a wallet that batches atomically gets approve + swap in one confirmation.
  const atomicBatchRef = useRef(false);
  const { supportsAtomicBatch } = wallet;
  useEffect(() => {
    atomicBatchRef.current = false;
    if (!wallet.isConnected || !wallet.address) return;
    let live = true;
    void supportsAtomicBatch(ROBINHOOD_CHAIN_ID).then((ok) => { if (live) atomicBatchRef.current = ok; });
    return () => { live = false; };
  }, [wallet.isConnected, wallet.address, supportsAtomicBatch]);
  const publicClient = usePublicClient({ chainId: ROBINHOOD_CHAIN_ID });
  const { data: liveGasPrice } = useGasPrice({ chainId: ROBINHOOD_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();

  // SalePageClient pattern: direct useBalance for native currency on active Robinhood chain
  const effectiveAddress = wallet.address as `0x${string}` | undefined;
  const activeChain = getSaleChain(wallet.chainId);
  const {
    data: directNativeBalance,
    refetch: refetchDirectBalance,
    isLoading: isDirectNativeLoading,
    isError: isDirectNativeError,
  } = useBalance({
    address: effectiveAddress,
    chainId: activeChain.id,
  });

  // Canonical token decimals resolution: do not guess 18 when metadata is unknown
  const resolvedDecimals = useMemo(() => {
    if (propDecimals !== undefined && typeof propDecimals === "number" && propDecimals >= 0) {
      return propDecimals;
    }
    const baseMatch = BASE_SWAP_TOKENS.find(
      (t) =>
        t.symbol.toUpperCase() === tokenSymbol.toUpperCase() ||
        (tokenAddress && t.address.toLowerCase() === tokenAddress.toLowerCase())
    );
    if (baseMatch) return baseMatch.decimals;
    const stockMatch = CANONICAL_STOCK_TOKENS.find(
      (s) => s.symbol.toUpperCase() === tokenSymbol.toUpperCase()
    );
    if (stockMatch) return stockMatch.decimals;
    return undefined;
  }, [propDecimals, tokenSymbol, tokenAddress]);

  const [mode, setMode] = useState<"buy" | "sell">(initialMode);
  const [amount, setAmount] = useState("");
  const [raw, setRaw] = useState("");
  const [caretOn, setCaretOn] = useState(false);
  const [slippage, setSlippage] = useState<number | "auto">("auto");
  const [isCustomSlippage, setIsCustomSlippage] = useState(false);
  const [isEditingSlippage, setIsEditingSlippage] = useState(false);
  const [customSlippageInput, setCustomSlippageInput] = useState("");
  const customParsed = useMemo<ParseSlippageResult>(() => {
    return parseCustomSlippage(customSlippageInput);
  }, [customSlippageInput]);

  const isCustomSlippageInvalid = isCustomSlippage && !customParsed.valid;
  const customSlippageError = customParsed.valid ? null : customParsed.error;
  const [busy, setBusy] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // For kind "batch", `hash` is the EIP-5792 batch id, not a transaction hash.
  const [unconfirmedTx, setUnconfirmedTx] = useState<{
    hash: `0x${string}`;
    kind: "approve" | "swap" | "custom" | "batch";
  } | null>(null);

  // In-flight broadcast reference to ensure pending status is not wiped out by form edits
  const pendingBroadcastRef = useRef<{
    hash: `0x${string}`;
    kind: "approve" | "swap" | "custom" | "batch";
  } | null>(null);
  const [isPendingBroadcast, setIsPendingBroadcast] = useState(false);

  const setPendingBroadcast = useCallback(
    (val: { hash: `0x${string}`; kind: "approve" | "swap" | "custom" | "batch" } | null) => {
      pendingBroadcastRef.current = val;
      setIsPendingBroadcast(val !== null);
    },
    []
  );

  // Uniswap-style token selection state
  const [selectorTarget, setSelectorTarget] = useState<"pay" | "receive" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchingContract, setIsSearchingContract] = useState(false);
  const [isSearchingName, setIsSearchingName] = useState(false);
  const [resolvedContractToken, setResolvedContractToken] = useState<SelectableToken | null>(null);
  const [searchedTokens, setSearchedTokens] = useState<SelectableToken[]>([]);

  // Progressive list rendering (DOM virtualization slice)
  const [displayCount, setDisplayCount] = useState(30);

  // LocalStorage-backed imported and recently traded tokens
  const [importedTokens, setImportedTokens] = useState<SelectableToken[]>([]);
  const [recentTokens, setRecentTokens] = useState<SelectableToken[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Pure client-side: Base Currencies + Verified Canonical Stocks + Prop Target Token
  const [availableTokens, setAvailableTokens] = useState<SelectableToken[]>(() => {
    const list: SelectableToken[] = [...BASE_SWAP_TOKENS, ...CANONICAL_STOCK_TOKENS];
    if (
      tokenAddress &&
      tokenSymbol &&
      !list.some((t) => t.address.toLowerCase() === tokenAddress.toLowerCase())
    ) {
      const stockMatch = CANONICAL_STOCK_TOKENS.find(
        (s) => s.symbol.toUpperCase() === tokenSymbol.toUpperCase()
      );
      list.push({
        symbol: tokenSymbol,
        name: tokenName || (stockMatch ? stockMatch.name : `${tokenSymbol} Token`),
        address: tokenAddress,
        decimals: resolvedDecimals ?? (stockMatch ? stockMatch.decimals : 18),
        priceUsd: priceUsd > 0 ? priceUsd : 0,
        priceEth: priceEth > 0 ? priceEth : 0,
        balance: 0,
        category: stockMatch ? "stocks" : "ecosystem",
        volume24h: 0,
        imageUrl:
          tokenImageUrl ||
          stockMatch?.imageUrl ||
          `https://dd.dexscreener.com/ds-data/tokens/robinhood/${tokenAddress.toLowerCase()}.png`,
        iconBg: "bg-[#ccff00]/20",
        iconColor: "text-[#ccff00]",
        iconLabel: tokenSymbol.slice(0, 2),
      });
    }
    // A pre-rendered price wins over the zero-valued canonical stock seed.
    if (tokenAddress && priceUsd > 0) {
      const index = list.findIndex((t) => t.address.toLowerCase() === tokenAddress.toLowerCase());
      if (index >= 0) list[index] = { ...list[index], priceUsd, priceEth: priceEth > 0 ? priceEth : list[index].priceEth };
    }
    return list;
  });

  // Keep target token from props updated if incoming props change
  useEffect(() => {
    if (!tokenAddress || !tokenSymbol) return;
    const key = tokenAddress.toLowerCase();
    const stockMatch = CANONICAL_STOCK_TOKENS.find(
      (s) => s.symbol.toUpperCase() === tokenSymbol.toUpperCase()
    );
    setAvailableTokens((prev) => {
      const existing = prev.find((t) => t.address.toLowerCase() === key);
      if (existing) {
        return prev.map((t) =>
          t.address.toLowerCase() === key
            ? {
                ...t,
                symbol: tokenSymbol,
                name: tokenName || t.name,
                decimals: resolvedDecimals ?? t.decimals,
                priceUsd: priceUsd > 0 ? priceUsd : t.priceUsd,
                priceEth: priceEth > 0 ? priceEth : t.priceEth,
                imageUrl: tokenImageUrl || t.imageUrl || stockMatch?.imageUrl,
              }
            : t
        );
      }
      return [
        ...prev,
        {
          symbol: tokenSymbol,
          name: tokenName || (stockMatch ? stockMatch.name : `${tokenSymbol} Token`),
          address: tokenAddress,
          decimals: resolvedDecimals ?? (stockMatch ? stockMatch.decimals : 18),
          priceUsd: priceUsd > 0 ? priceUsd : 0,
          priceEth: priceEth > 0 ? priceEth : 0,
          balance: 0,
          category: stockMatch ? "stocks" : "ecosystem",
          volume24h: 0,
          imageUrl:
            tokenImageUrl ||
            stockMatch?.imageUrl ||
            `https://dd.dexscreener.com/ds-data/tokens/robinhood/${key}.png`,
          iconBg: "bg-[#ccff00]/20",
          iconColor: "text-[#ccff00]",
          iconLabel: tokenSymbol.slice(0, 2),
        },
      ];
    });
  }, [tokenAddress, tokenSymbol, tokenName, tokenImageUrl, resolvedDecimals, priceUsd, priceEth]);

  // Read live on-chain balances batched via Multicall3 + native ETH balance explicitly on 4663
  const {
    tokensWithBalances,
    isLoading: isBalancesLoading,
    refetch: refetchBalances,
  } = useTokenBalances(availableTokens, effectiveAddress);
  const chainTokens = tokensWithBalances;

  // Direct native balance fallback via robinhoodPublicClient (fallback-transport enabled)
  const [directNativeFallback, setDirectNativeFallback] = useState<bigint | null>(null);
  useEffect(() => {
    if (!effectiveAddress) {
      setDirectNativeFallback(null);
      return;
    }
    if (directNativeBalance?.value !== undefined) {
      setDirectNativeFallback(null);
      return;
    }

    let active = true;
    const fetchDirectNative = async () => {
      try {
        const bal = await robinhoodPublicClient.getBalance({ address: effectiveAddress });
        if (active) setDirectNativeFallback(bal);
      } catch {
        // Ignored
      }
    };

    void fetchDirectNative();
    return () => {
      active = false;
    };
  }, [effectiveAddress, directNativeBalance?.value, isDirectNativeError]);

  // Pre-warm AppKit modal so the connect modal opens instantaneously without connector registration delay
  useEffect(() => {
    const timer = setTimeout(() => {
      wallet.prepare();
    }, 400);
    return () => clearTimeout(timer);
  }, [wallet.prepare]);

  // Clear wallet connection error messages and trigger fresh balance reads once connected
  useEffect(() => {
    const isConn = wallet.isConnected && !!wallet.address;
    if (isConn) {
      setErrorMsg((prev) => {
        if (
          prev === "Wallet connection was not completed." ||
          prev === "Failed to connect wallet." ||
          prev === "Connect wallet to read balance."
        ) {
          return null;
        }
        return prev;
      });
      void refetchBalances();
      void refetchDirectBalance();
    }
  }, [wallet.isConnected, wallet.address, refetchBalances, refetchDirectBalance]);

  // Initial Pay and Receive tokens
  const defaultEth = chainTokens[0] || BASE_SWAP_TOKENS[0];
  const defaultTargetToken = !tokenAddress && !tokenSymbol
    ? UNSELECTED_TOKEN
    : chainTokens.find(
      (t) => t.address.toLowerCase() === (tokenAddress || "").toLowerCase()
    ) ||
    chainTokens.find((t) => t.symbol.toUpperCase() === tokenSymbol.toUpperCase()) ||
    chainTokens[1] ||
    defaultEth;

  const [payToken, setPayToken] = useState<SelectableToken>(() =>
    initialMode === "buy" ? defaultEth : defaultTargetToken
  );
  const [receiveToken, setReceiveToken] = useState<SelectableToken>(() =>
    initialMode === "buy" ? defaultTargetToken : defaultEth
  );
  useEffect(() => {
    const preferred = mode === "buy" ? receiveToken : payToken;
    const other = mode === "buy" ? payToken : receiveToken;
    onMarketTokenChange?.(!isUnselected(preferred) ? preferred : other);
  }, [onMarketTokenChange, mode, payToken, receiveToken]);
  const payTokenPriceRef = useRef(payToken.priceUsd);
  payTokenPriceRef.current = payToken.priceUsd;

  // Dedicated single-token fallback for non-native pay token to guarantee immediate resolution
  // even if bulk multicall is pending or failing on a local node
  const [directErc20PayBalance, setDirectErc20PayBalance] = useState<{
    address: string;
    raw: bigint;
  } | null>(null);

  useEffect(() => {
    if (
      !effectiveAddress ||
      payToken.isNative ||
      payToken.address === "0x0000000000000000000000000000000000000000" ||
      !isAddress(payToken.address)
    ) {
      setDirectErc20PayBalance(null);
      return;
    }

    let active = true;
    const fetchPayTokenBalance = async () => {
      try {
        const raw = await robinhoodPublicClient.readContract({
          address: payToken.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [effectiveAddress],
        });
        if (active && typeof raw === "bigint") {
          setDirectErc20PayBalance({ address: payToken.address.toLowerCase(), raw });
        }
      } catch {
        // Fall back to chainTokens
      }
    };

    void fetchPayTokenBalance();
    return () => {
      active = false;
    };
  }, [effectiveAddress, payToken.address, payToken.isNative]);

  // Derive live balance, rawBalance, decimals, and status directly from chainTokens
  // and direct native useBalance (SalePageClient pattern) to guarantee
  // that TanStack Query caching, effect ordering, or reconnects cannot desync or trap balances in a loading/error state.
  const activePayToken = useMemo<SelectableToken>(() => {
    const match = chainTokens.find(
      (t) => t.address.toLowerCase() === payToken.address.toLowerCase()
    );
    let resolvedRawBalance = match?.rawBalance;
    let resolvedBalance = match?.balance ?? 0;
    let resolvedStatus = match?.balanceStatus ?? (effectiveAddress ? "loading" : "disconnected");

    // Harmonize native ETH with direct SalePageClient useBalance + direct fallback
    if (payToken.isNative || payToken.address === "0x0000000000000000000000000000000000000000") {
      const nativeVal = directNativeBalance?.value ?? directNativeFallback ?? undefined;
      if (nativeVal !== undefined) {
        resolvedRawBalance = nativeVal;
        resolvedBalance = Number(formatUnits(nativeVal, 18));
        resolvedStatus = "loaded";
      } else if (isDirectNativeLoading && directNativeFallback === null) {
        resolvedStatus = "loading";
      } else if (isDirectNativeError && directNativeFallback === null) {
        resolvedStatus = "error";
      } else if (!effectiveAddress) {
        resolvedStatus = "disconnected";
      }
    } else {
      // For ERC-20 pay tokens: direct single-token fallback wins if available
      if (directErc20PayBalance && directErc20PayBalance.address === payToken.address.toLowerCase()) {
        resolvedRawBalance = directErc20PayBalance.raw;
        const dec = match?.decimals ?? payToken.decimals ?? 18;
        resolvedBalance = Number(formatUnits(directErc20PayBalance.raw, dec));
        resolvedStatus = "loaded";
      }
    }

    if (!match) {
      return {
        ...payToken,
        balance: resolvedBalance,
        rawBalance: resolvedRawBalance,
        balanceStatus: resolvedStatus,
      };
    }
    return {
      ...payToken,
      decimals: match.decimals ?? payToken.decimals,
      balance: resolvedBalance,
      rawBalance: resolvedRawBalance,
      balanceStatus: resolvedStatus,
      priceUsd: match.priceUsd > 0 ? match.priceUsd : payToken.priceUsd,
      imageUrl: payToken.imageUrl || match.imageUrl,
    };
  }, [
    chainTokens,
    payToken,
    directNativeBalance?.value,
    directNativeFallback,
    directErc20PayBalance,
    isDirectNativeLoading,
    isDirectNativeError,
    effectiveAddress,
  ]);

  const activeReceiveToken = useMemo<SelectableToken>(() => {
    const match = chainTokens.find(
      (t) => t.address.toLowerCase() === receiveToken.address.toLowerCase()
    );
    let resolvedRawBalance = match?.rawBalance;
    let resolvedBalance = match?.balance ?? 0;
    let resolvedStatus = match?.balanceStatus ?? (effectiveAddress ? "loading" : "disconnected");

    // Harmonize native ETH with direct SalePageClient useBalance + direct fallback
    if (receiveToken.isNative || receiveToken.address === "0x0000000000000000000000000000000000000000") {
      const nativeVal = directNativeBalance?.value ?? directNativeFallback ?? undefined;
      if (nativeVal !== undefined) {
        resolvedRawBalance = nativeVal;
        resolvedBalance = Number(formatUnits(nativeVal, 18));
        resolvedStatus = "loaded";
      } else if (isDirectNativeLoading && directNativeFallback === null) {
        resolvedStatus = "loading";
      } else if (isDirectNativeError && directNativeFallback === null) {
        resolvedStatus = "error";
      } else if (!effectiveAddress) {
        resolvedStatus = "disconnected";
      }
    }

    if (!match) {
      return {
        ...receiveToken,
        balance: resolvedBalance,
        rawBalance: resolvedRawBalance,
        balanceStatus: resolvedStatus,
      };
    }
    return {
      ...receiveToken,
      decimals: match.decimals ?? receiveToken.decimals,
      balance: resolvedBalance,
      rawBalance: resolvedRawBalance,
      balanceStatus: resolvedStatus,
      priceUsd: match.priceUsd > 0 ? match.priceUsd : receiveToken.priceUsd,
      imageUrl: receiveToken.imageUrl || match.imageUrl,
    };
  }, [
    chainTokens,
    receiveToken,
    directNativeBalance?.value,
    directNativeFallback,
    isDirectNativeLoading,
    isDirectNativeError,
    effectiveAddress,
  ]);

  // Prevent wallet switching from retaining stale query data or mixing accounts
  const lastUserAddressRef = useRef<string | null>(null);
  useEffect(() => {
    const current = wallet.isConnected && wallet.address ? `${wallet.address.toLowerCase()}:${wallet.chainId ?? "unknown"}` : null;
    if (current !== lastUserAddressRef.current) {
      lastUserAddressRef.current = current;
      setPayToken((prev) => {
        const match = wallet.isConnected && wallet.address
          ? chainTokens.find((t) => t.address.toLowerCase() === prev.address.toLowerCase())
          : null;
        return {
          ...prev,
          balance: match?.balance ?? 0,
          rawBalance: match?.rawBalance,
          balanceStatus: match?.balanceStatus ?? (wallet.isConnected ? "loading" : "disconnected"),
        };
      });
      setReceiveToken((prev) => {
        const match = wallet.isConnected && wallet.address
          ? chainTokens.find((t) => t.address.toLowerCase() === prev.address.toLowerCase())
          : null;
        return {
          ...prev,
          balance: match?.balance ?? 0,
          rawBalance: match?.rawBalance,
          balanceStatus: match?.balanceStatus ?? (wallet.isConnected ? "loading" : "disconnected"),
        };
      });
    }
  }, [wallet.address, wallet.isConnected, wallet.chainId, chainTokens]);

  // Synchronize balances and prices when on-chain multicall completes or tokens update
  useEffect(() => {
    setPayToken((prev) => {
      const match = chainTokens.find(
        (t) => t.address.toLowerCase() === prev.address.toLowerCase()
      );
      if (!match) return prev;
      if (
        prev.balance === match.balance &&
        prev.rawBalance === match.rawBalance &&
        prev.balanceStatus === match.balanceStatus &&
        (match.priceUsd <= 0 || prev.priceUsd === match.priceUsd)
      ) {
        return prev;
      }
      return {
        ...prev,
        decimals: match.decimals ?? prev.decimals,
        balance: match.balance,
        rawBalance: match.rawBalance,
        balanceStatus: match.balanceStatus,
        priceUsd: match.priceUsd > 0 ? match.priceUsd : prev.priceUsd,
        imageUrl: prev.imageUrl || match.imageUrl,
      };
    });
    setReceiveToken((prev) => {
      const match = chainTokens.find(
        (t) => t.address.toLowerCase() === prev.address.toLowerCase()
      );
      if (!match) return prev;
      if (
        prev.balance === match.balance &&
        prev.rawBalance === match.rawBalance &&
        prev.balanceStatus === match.balanceStatus &&
        (match.priceUsd <= 0 || prev.priceUsd === match.priceUsd)
      ) {
        return prev;
      }
      return {
        ...prev,
        decimals: match.decimals ?? prev.decimals,
        balance: match.balance,
        rawBalance: match.rawBalance,
        balanceStatus: match.balanceStatus,
        priceUsd: match.priceUsd > 0 ? match.priceUsd : prev.priceUsd,
        imageUrl: prev.imageUrl || match.imageUrl,
      };
    });
  }, [chainTokens, wallet.address, wallet.isConnected]);

  // Hydrate availableTokens with live market prices from /api/rwa/feed
  const hasHydratedFeedRef = useRef(false);
  useEffect(() => {
    if (hasHydratedFeedRef.current) return;
    hasHydratedFeedRef.current = true;

    void fetch("/api/rwa/feed")
      .then((res) => (res.ok ? (res.json() as Promise<{ tokens?: Array<{ address: string; priceUsd: number | null }> }>) : null))
      .then((data) => {
        if (!data || !Array.isArray(data.tokens) || data.tokens.length === 0) return;
        const priceMap = new Map<string, number>();
        for (const item of data.tokens) {
          if (typeof item.priceUsd === "number" && item.priceUsd > 0) {
            priceMap.set(item.address.toLowerCase(), item.priceUsd);
          }
        }
        if (priceMap.size === 0) return;

        setAvailableTokens((prev) =>
          prev.map((t) => {
            const p = priceMap.get(t.address.toLowerCase());
            return p && p > 0 ? { ...t, priceUsd: p } : t;
          })
        );
        setPayToken((prev) => {
          const p = priceMap.get(prev.address.toLowerCase());
          return p && p > 0 && prev.priceUsd <= 0 ? { ...prev, priceUsd: p } : prev;
        });
        setReceiveToken((prev) => {
          const p = priceMap.get(prev.address.toLowerCase());
          return p && p > 0 && prev.priceUsd <= 0 ? { ...prev, priceUsd: p } : prev;
        });
      })
      .catch(() => {
        // Degrades gracefully to per-token /api/rwa/price
      });
  }, []);

  // Price only the two selected assets. Pre-rendered prices never trigger a fetch.
  const requestedPricesRef = useRef(new Set<string>());
  useEffect(() => {
    for (const token of [payToken, receiveToken]) {
      if (token.priceUsd > 0 || (token.category !== "stocks" && token.symbol !== "ETH" && token.symbol !== "WETH")) continue;
      const address = token.address.toLowerCase();
      if (requestedPricesRef.current.has(address)) continue;
      requestedPricesRef.current.add(address);

      void fetch(`/api/rwa/price?address=${encodeURIComponent(address)}`)
        .then((res) => res.ok ? res.json() as Promise<{ priceUsd: number | null }> : null)
        .then((result) => {
          const value = result?.priceUsd;
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
          const apply = (current: SelectableToken) => current.address.toLowerCase() === address
            ? { ...current, priceUsd: value }
            : current;
          setAvailableTokens((prev) => prev.map(apply));
          setPayToken(apply);
          setReceiveToken(apply);
        })
        .catch(() => {
          // Unknown price stays unknown; the trade plan still checks a live route.
        });
    }
  }, [payToken.address, payToken.priceUsd, payToken.category, payToken.symbol, receiveToken.address, receiveToken.priceUsd, receiveToken.category, receiveToken.symbol]);

  // Stocks keep their share-price reference; everything else follows its deepest DexScreener pool.
  const livePriceAddresses = [payToken, receiveToken]
    .filter((t) => t.address && t.category !== "stocks")
    .map((t) => t.address.toLowerCase())
    .join(",");
  useEffect(() => {
    if (!livePrices || !livePriceAddresses) return;
    const addresses = livePriceAddresses.split(",");
    let controller: AbortController | null = null;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      void fetchLivePrices(addresses, controller.signal)
        .then((prices) => {
          if (prices.size === 0) return;
          const apply = (t: SelectableToken) => {
            const p = prices.get(t.address.toLowerCase());
            return p && p !== t.priceUsd ? { ...t, priceUsd: p } : t;
          };
          setAvailableTokens((prev) => prev.map(apply));
          setPayToken(apply);
          setReceiveToken(apply);
        })
        .catch(() => {
          // A missed refresh keeps the last price; it is a display estimate, never a quote.
        });
    };
    const timer = window.setInterval(refresh, LIVE_PRICE_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      controller?.abort();
    };
  }, [livePrices, livePriceAddresses]);

  // Only sync initial target token on mount or when tokenAddress prop actually changes
  const prevTokenAddrRef = useRef<string | undefined>(tokenAddress);
  useEffect(() => {
    if (tokenAddress && tokenAddress !== prevTokenAddrRef.current) {
      prevTokenAddrRef.current = tokenAddress;
      if (defaultTargetToken) {
        if (mode === "buy") {
          setReceiveToken(defaultTargetToken);
        } else {
          setPayToken(defaultTargetToken);
        }
      }
    }
  }, [tokenAddress, defaultTargetToken, mode]);

  const [activePlan, setActivePlan] = useState<PlanView | null>(null);
  useEffect(() => { onPlanContext?.(activePlan); }, [activePlan, onPlanContext]);
  // The server priced it but skipped the test run: this wallet cannot pay for it.
  const walletShort = wallet.isConnected && activePlan?.simulation.status === "insufficient-balance";
  const tokenMissing = isUnselected(payToken) || isUnselected(receiveToken);
  // L205: an 81% loss sat inside collapsed trade details. At 15% the user must say yes first.
  const severeImpact = (activePlan?.priceImpactBps ?? 0) >= 1500;
  const impactKey = activePlan ? `${activePlan.amountIn}:${activePlan.poolId ?? activePlan.pool}:${activePlan.priceImpactBps}` : null;
  const [impactAckKey, setImpactAckKey] = useState<string | null>(null);
  const impactBlocked = severeImpact && impactAckKey !== impactKey;
  // Bumped when a disconnected visitor settles on an amount: the connect button nudges once.
  const [connectNudge, setConnectNudge] = useState(0);
  // L213 #15: a per-calldata key expired on every re-quote and after every approval step, so the
  // tick vanished and Confirm looked dead. A hook's permissions are its address: ack per pair + hooks.
  const hookAckedRef = useRef<Set<string>>(new Set());
  const [, setHookAckVersion] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  function hookAckKey(plan: PlanView): string | null {
    const hooks = hookWarningsForPlan(plan).map((h) => h.address.toLowerCase()).sort();
    if (!hooks.length) return null;
    return `hook:${[plan.tokenIn, plan.tokenOut].map((t) => t.toLowerCase()).sort().join(":")}:${hooks.join(",")}`;
  }
  function isHookAcked(plan: PlanView): boolean {
    const key = hookAckKey(plan);
    return key === null || hookAckedRef.current.has(key) || isWarningSuppressed(ROBINHOOD_CHAIN_ID, key);
  }
  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [isFetchingPlan, setIsFetchingPlan] = useState<boolean>(false);
  const [backgroundQuoteFailure, setBackgroundQuoteFailure] = useState<string | null>(null);
  const backgroundQuoteFailureKeyRef = useRef<string | null>(null);
  const currentQuoteKey = `${payToken.address.toLowerCase()}:${receiveToken.address.toLowerCase()}:${amount.trim()}`;
  const currentQuoteFailed = backgroundQuoteFailure !== null && backgroundQuoteFailureKeyRef.current === currentQuoteKey;
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [quickCheckResult, setQuickCheckResult] = useState<TradeQuickCheckResult | null>(null);
  const [lpCustodyResult, setLpCustodyResult] = useState<LpCustodyResult | null>(null);
  const [securitySignals, setSecuritySignals] = useState<Record<string, TradeSecuritySignal>>({});
  const [showTradeDetails, setShowTradeDetails] = useState(false);
  const [showTokenSecurity, setShowTokenSecurity] = useState(false);
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const activeHookWarnings = activePlan ? hookWarningsForPlan(activePlan) : [];
  const settingsPopoverRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showSettingsPopover) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        settingsPopoverRef.current &&
        !settingsPopoverRef.current.contains(e.target as Node) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(e.target as Node)
      ) {
        setShowSettingsPopover(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showSettingsPopover]);

  // Register verified canonical RWA tokens from /api/tokens (all 196 stock tokens)
  useEffect(() => {
    if (typeof window === "undefined") return;
    fetch("/api/tokens")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.tokens)) {
          const verified = data.tokens
            .filter((t: SelectableToken) => t.category === "stocks" && t.address)
            .map((t: SelectableToken) => t.address);
          registerCanonicalRwaAddresses(verified);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (canonicalRwaAddresses) {
      registerCanonicalRwaAddresses(canonicalRwaAddresses);
    }
  }, [canonicalRwaAddresses]);

  // Keep the resolved address result's ETH reference current without restarting metadata reads.
  useEffect(() => {
    setResolvedContractToken((prev) => {
      if (!prev || prev.priceUsd <= 0 || payToken.priceUsd <= 0) return prev;
      const priceEth = prev.priceUsd / payToken.priceUsd;
      return prev.priceEth === priceEth ? prev : { ...prev, priceEth };
    });
  }, [payToken.priceUsd, resolvedContractToken?.priceUsd]);

  useEffect(() => {
    setQuickCheckResult(null);
    setLpCustodyResult(null);
    setSecuritySignals({});
    setShowTokenSecurity(false);
  }, [tokenAddress, payToken.address, receiveToken.address, mode]);

  const lpCustodyToken = mode === "buy" ? activePlan?.tokenOut : activePlan?.tokenIn;
  const lpCustodyPool = activePlan && lpCustodyToken ? custodyPoolForPlan(activePlan, lpCustodyToken) : null;
  // Keyed on pool and token only: a requote of the same pool must not reset or refetch the read.
  const lpCustodyEligible = !!activePlan && activePlan.protocol !== "aggregator";
  // Flag off: say nothing rather than "not checked" on every card.
  const lpCustodyShown = !!lpCustodyResult && !(lpCustodyResult.status !== "complete" && lpCustodyResult.disabled);
  useEffect(() => {
    if (!lpCustodyEligible || !lpCustodyPool || !lpCustodyToken || !isAddress(lpCustodyToken)) {
      setLpCustodyResult(null);
      return;
    }

    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;
    setLpCustodyResult({ status: "checking", pool: lpCustodyPool });
    const query = new URLSearchParams({ pool: lpCustodyPool });
    const load = async () => {
      try {
        const response = await fetch(`/api/trades/${encodeURIComponent(lpCustodyToken)}/lp-custody?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`LP custody request failed (${response.status})`);
        const result = await response.json() as LpCustodyResult;
        if (controller.signal.aborted) return;
        setLpCustodyResult(result);
        if (result.status === "checking" && polls++ < 12) pollTimer = setTimeout(() => void load(), LP_CUSTODY_POLL_MS);
      } catch {
        if (!controller.signal.aborted) setLpCustodyResult({ status: "faulted", pool: lpCustodyPool });
      }
    };
    void load();
    return () => { controller.abort(); if (pollTimer) clearTimeout(pollTimer); };
  }, [lpCustodyEligible, lpCustodyPool, lpCustodyToken]);

  // The saved verdict belongs on the card before Review too, and after a scan finishes in another
  // tab. Review still re-reads it before signing; this never writes while a review is open.
  const reviewingRef = useRef(isReviewing);
  useEffect(() => { reviewingRef.current = isReviewing; }, [isReviewing]);
  const securityKey = tokenSecurityAddresses([payToken, receiveToken]).join(":");
  useEffect(() => {
    if (!securityKey) return;
    const addresses = securityKey.split(":");
    let live = true;
    const load = async () => {
      const fetched = await Promise.all(addresses.map(async (a) => [a, await fetchTradeSecuritySignal(a)] as const));
      if (live && !reviewingRef.current) setSecuritySignals(Object.fromEntries(fetched));
    };
    const timer = setTimeout(() => void load(), 300);
    const unsubs = addresses.map((a) => onScanAnnounced(a, () => void load()));
    return () => { live = false; clearTimeout(timer); unsubs.forEach((u) => u()); };
  }, [securityKey]);

  // ---- Toast bridge: surface errors, notices, and scan prompts via toasts
  // rather than inline boxes so the Swap UI stays clean. The state variables
  // remain for CTA logic (e.g. disabling buttons while an error is active).
  useEffect(() => {
    if (errorMsg) toast.error(errorMsg, { id: "swap-error", duration: ONE_SHOT_MS });
  }, [errorMsg]);

  useEffect(() => {
    if (planNotice) toast.warning(planNotice, { id: "swap-notice", duration: ONE_SHOT_MS });
  }, [planNotice]);

  useEffect(() => {
    if (!backgroundQuoteFailure || backgroundQuoteFailureKeyRef.current !== currentQuoteKey) {
      dismissToast("swap-quote-failure");
      return;
    }
    toast.warning(backgroundQuoteFailure, { id: "swap-quote-failure", duration: ONE_SHOT_MS });
  }, [backgroundQuoteFailure, currentQuoteKey]);


  // Unscanned: open Token security once per token, where the red "Not scanned" line and the scan
  // link live. It replaces a corner toast that repeated the same sentence (L213).
  const lastUnscannedOpenRef = useRef<string | null>(null);
  useEffect(() => {
    const addr = activePlan?.unscanned ? activePlan.unscannedToken : undefined;
    if (!addr || lastUnscannedOpenRef.current === addr) return;
    lastUnscannedOpenRef.current = addr;
    setShowTokenSecurity(true);
  }, [activePlan?.unscanned, activePlan?.unscannedToken]);

  useEffect(() => {
    if (!unconfirmedTx) return;
    if (unconfirmedTx.kind === "batch") {
      toast.warning("Your approve and swap batch was sent, but its result is not confirmed yet. Check your wallet's activity before trying again.", { id: `swap-pending-${unconfirmedTx.hash}`, duration: null });
      return;
    }
    toast.warning(
      <>
        Confirmation is still pending or unknown. {" "}
        <a
          href={`${robinhoodChain.blockExplorers.default.url}/tx/${unconfirmedTx.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold hover:text-[#ededea]"
        >
          Check the transaction →
        </a>
      </>,
      { id: `swap-pending-${unconfirmedTx.hash}`, duration: null },
    );
  }, [unconfirmedTx]);

  useEffect(() => {
    if (!successTx) return;
    toast.success(
      <>
        Swap completed. {" "}
        <a
          href={`${robinhoodChain.blockExplorers.default.url}/tx/${successTx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold hover:text-[#ededea]"
        >
          View transaction →
        </a>
      </>,
      { id: `swap-success-${successTx}`, duration: ONE_SHOT_MS },
    );
  }, [successTx]);

  // Truthful taxed-output disclosure and minimum semantics (A01 / Requirement 3)
  const taxDisclosure = useMemo(() => {
    return getTaxDisclosure({
      isNative: receiveToken.isNative,
      tokenSymbol: receiveToken.symbol,
      tokenAddress: receiveToken.address,
    });
  }, [receiveToken.isNative, receiveToken.symbol, receiveToken.address]);

  // Derive truthful receive amount from actual served PlanView quote (A03 / Requirement 1)
  const displayReceiveAmount = useMemo(() => {
    if (!activePlan || activePlan.tokenOutDisplay.decimals === null) return null;
    const rawUnits =
      activePlan.simulation.status === "ok"
        ? activePlan.simulation.measuredOut
        : activePlan.quotedOut;
    return formatBaseUnits(rawUnits, activePlan.tokenOutDisplay.decimals);
  }, [activePlan]);
  const receiveScaleUnavailable = activePlan?.tokenOutDisplay.decimals === null;

  const targetSize = useMemo(
    () => sizeForLength(displayLength((raw || "0").replace(/^0+(?=\.)/, "0"))),
    [raw]
  );
  const size = useSpring(targetSize, { stiffness: 320, damping: 30 });
  useEffect(() => void size.set(targetSize), [targetSize, size]);
  const fontSize = useTransform(size, (v) => `${v}px`);

  const attemptIdRef = useRef(0);

  const walletAddressRef = useRef(wallet.address);
  const walletChainIdRef = useRef(wallet.chainId);
  const walletIsConnectedRef = useRef(wallet.isConnected);
  const payTokenRef = useRef(payToken);
  const receiveTokenRef = useRef(receiveToken);
  const amountRef = useRef(amount);
  const slippageRef = useRef(slippage);
  const tokenAddressPropRef = useRef(tokenAddress);

  useEffect(() => {
    walletAddressRef.current = wallet.address;
    walletChainIdRef.current = wallet.chainId;
    walletIsConnectedRef.current = wallet.isConnected;
  }, [wallet.address, wallet.chainId, wallet.isConnected]);

  useEffect(() => {
    payTokenRef.current = payToken;
  }, [payToken]);

  useEffect(() => {
    receiveTokenRef.current = receiveToken;
  }, [receiveToken]);

  useEffect(() => {
    amountRef.current = amount;
  }, [amount]);

  useEffect(() => {
    slippageRef.current = slippage;
  }, [slippage]);

  useEffect(() => {
    tokenAddressPropRef.current = tokenAddress;
  }, [tokenAddress]);

  // Invalidate attempt if wallet account, chain, or connection changes while awaiting
  const prevWalletStateRef = useRef({
    address: wallet.address,
    chainId: wallet.chainId,
    isConnected: wallet.isConnected,
  });
  useEffect(() => {
    const prev = prevWalletStateRef.current;
    if (
      prev.address !== wallet.address ||
      prev.chainId !== wallet.chainId ||
      prev.isConnected !== wallet.isConnected
    ) {
      prevWalletStateRef.current = {
        address: wallet.address,
        chainId: wallet.chainId,
        isConnected: wallet.isConnected,
      };
      attemptIdRef.current++;
      if (!pendingBroadcastRef.current) {
        setBusy(null);
      }
    }
  }, [wallet.address, wallet.chainId, wallet.isConnected]);

  // Invalidate attempt if external tokenAddress prop changes
  const prevTokenAddressPropRef = useRef(tokenAddress);
  useEffect(() => {
    if (tokenAddress !== prevTokenAddressPropRef.current) {
      prevTokenAddressPropRef.current = tokenAddress;
      attemptIdRef.current++;
      if (!pendingBroadcastRef.current) {
        setBusy(null);
      }
    }
  }, [tokenAddress]);

  const getCurrentAttemptState = useCallback((): TradeAttemptCurrent => ({
    attemptId: attemptIdRef.current,
    account: walletAddressRef.current,
    chainId: walletChainIdRef.current,
    isConnected: walletIsConnectedRef.current,
    tokenInAddress: (payTokenRef.current.isNative ? NATIVE : payTokenRef.current.address).toLowerCase(),
    tokenOutAddress: (receiveTokenRef.current.isNative ? NATIVE : receiveTokenRef.current.address).toLowerCase(),
    amount: amountRef.current,
    slippage: slippageRef.current,
    tokenAddressProp: tokenAddressPropRef.current,
  }), []);

  const emit = useCallback((next: string, focusEnd = false) => {
    if (pendingBroadcastRef.current) return;
    if (next !== "" && (!/^\d{0,18}(\.\d{0,18})?$/.test(next) || next.length > 24)) return;
    attemptIdRef.current++;
    setBusy(null);
    setRaw(next);
    setAmount(next.replace(/^0{2,}(?=\d)/, "0").replace(/^0+(?=\.)/, "0"));
    setErrorMsg(null);
    setSuccessTx(null);
    setActivePlan(null);
    setIsReviewing(false);
    setPlanNotice(null);

    if (focusEnd) {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const len = next.length;
          inputRef.current.setSelectionRange(len, len);
        }
      });
    }
  }, []);

  const focusAmountInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
      setCaretOn(true);
    }
  }, []);

  // Autofocus onto the price entry field when the swap UI is invoked or mode changes
  useEffect(() => {
    focusAmountInput();
    const timer = setTimeout(focusAmountInput, 80);
    return () => clearTimeout(timer);
  }, [mode, focusAmountInput]);

  // Autofocus back onto the price entry field after selecting a token or closing token selector
  const prevSelectorTargetRef = useRef<"pay" | "receive" | null>(selectorTarget);
  useEffect(() => {
    if (prevSelectorTargetRef.current !== null && selectorTarget === null) {
      focusAmountInput();
      const timer = setTimeout(focusAmountInput, 50);
      return () => clearTimeout(timer);
    }
    prevSelectorTargetRef.current = selectorTarget;
  }, [selectorTarget, focusAmountInput]);

  const useMax = () => {
    if (pendingBroadcastRef.current) return;
    attemptIdRef.current++;
    setBusy(null);
    setActivePlan(null);
    setIsReviewing(false);
    if (!wallet.isConnected || !wallet.address) {
      setErrorMsg("Connect wallet to read balance.");
      return;
    }

    if (activePayToken.isNative) {
      if (activePayToken.balanceStatus === "error") {
        setErrorMsg("Unable to read native ETH balance from RPC. Please check your network or refresh.");
        return;
      }
      if (activePayToken.rawBalance === undefined || activePayToken.rawBalance === null) {
        setErrorMsg("Native ETH balance is still loading. Please wait or refresh before setting Max.");
        return;
      }
      const balanceWei = activePayToken.rawBalance;

      const measuredGasUsed =
        activePlan?.simulation.status === "ok" ? activePlan.simulation.gasUsed : undefined;
      const maxResult = calculateMaxNativeAmount({
        rawBalance: balanceWei,
        measuredGasUsed,
        gasPriceWei: liveGasPrice ?? undefined,
      });

      if (maxResult.usableAmountWei > 0n) {
        emit(formatUnits(maxResult.usableAmountWei, 18), true);
        if (!maxResult.isMeasured) {
          setPlanNotice(maxResult.label);
        }
      } else {
        setErrorMsg(maxResult.reason || "Insufficient native balance to cover gas reserve.");
      }
    } else {
      if (activePayToken.balanceStatus === "error") {
        setErrorMsg(`Unable to read ${activePayToken.symbol} balance from RPC. Please check your network or refresh.`);
        return;
      }
      if (activePayToken.rawBalance === undefined || activePayToken.rawBalance === null) {
        setErrorMsg("Token balance is still loading. Please wait or refresh before setting Max.");
        return;
      }

      const tokenDecimals =
        activePayToken.address.toLowerCase() === (tokenAddress || "").toLowerCase()
          ? (resolvedDecimals ?? activePayToken.decimals)
          : activePayToken.decimals;

      if (tokenDecimals === undefined || typeof tokenDecimals !== "number" || tokenDecimals < 0) {
        setErrorMsg("Token decimals metadata is unavailable. Cannot set Max amount safely.");
        return;
      }

      if (activePayToken.rawBalance === 0n) {
        emit("0", true);
        setErrorMsg(`Your ${activePayToken.symbol} balance is 0.`);
      } else {
        emit(formatUnits(activePayToken.rawBalance, tokenDecimals), true);
      }
    }
  };

  const toggleMode = () => {
    if (pendingBroadcastRef.current) return;
    attemptIdRef.current++;
    setBusy(null);
    setActivePlan(null);
    setIsReviewing(false);
    setPlanNotice(null);
    const oldPay = payToken;
    const oldReceive = receiveToken;
    setPayToken(oldReceive);
    setReceiveToken(oldPay);
    setMode((prev) => (prev === "buy" ? "sell" : "buy"));
    setAmount("");
    setRaw("");
    setErrorMsg(null);
    setSuccessTx(null);
  };

  const handlePresetSlippageChange = (nextPreset: number | "auto") => {
    if (pendingBroadcastRef.current) return;
    attemptIdRef.current++;
    setBusy(null);
    setActivePlan(null);
    setIsReviewing(false);
    setPlanNotice(null);
    setIsCustomSlippage(false);
    setIsEditingSlippage(false);
    setCustomSlippageInput("");
    setSlippage(nextPreset);
    slippageRef.current = nextPreset;
  };

  const handleCustomSlippageChange = (nextValue: string) => {
    if (pendingBroadcastRef.current) return;
    attemptIdRef.current++;
    setBusy(null);
    setActivePlan(null);
    setIsReviewing(false);
    setPlanNotice(null);
    setIsCustomSlippage(true);
    setIsEditingSlippage(true);
    setCustomSlippageInput(nextValue);
    const parsed = parseCustomSlippage(nextValue);
    const nextSlippage = parsed.valid ? parsed.percent : NaN;
    setSlippage(nextSlippage);
    slippageRef.current = nextSlippage;
  };

  const handleSlippageChange = (nextSlippage: number | "auto") => {
    handlePresetSlippageChange(nextSlippage);
  };

  const handleResetSettings = useCallback(() => {
    handlePresetSlippageChange("auto");
    setIsEditingSlippage(false);
    toast.success("Slippage reset to Auto.", { id: "swap-reset-slippage", duration: ONE_SHOT_MS });
  }, []);

  const handleResetSwap = useCallback(() => {
    attemptIdRef.current++;
    setAmount("");
    setRaw("");
    setActivePlan(null);
    setIsReviewing(false);
    setPlanNotice(null);
    setErrorMsg(null);
    setSuccessTx(null);
    setBusy(null);

    // Reset tokens to default initial pair
    const eth = chainTokens[0] || BASE_SWAP_TOKENS[0];
    const target = !tokenAddress && !tokenSymbol
      ? UNSELECTED_TOKEN
      : chainTokens.find((t) => t.address.toLowerCase() === (tokenAddress || "").toLowerCase()) ||
        chainTokens.find((t) => t.symbol.toUpperCase() === tokenSymbol.toUpperCase()) ||
        chainTokens[1] ||
        eth;

    if (mode === "buy") {
      setPayToken(eth);
      setReceiveToken(target);
    } else {
      setPayToken(target);
      setReceiveToken(eth);
    }

    // Reset slippage
    handlePresetSlippageChange("auto");
    setIsEditingSlippage(false);
    setShowSettingsPopover(false);

    // Re-focus input
    focusAmountInput();
    toast.success("Swap reset. Ready for a new trade.", { id: "swap-reset-all", duration: ONE_SHOT_MS });
  }, [chainTokens, tokenAddress, tokenSymbol, mode, focusAmountInput]);

  const handleFetchQuoteBackground = useCallback(async (trimmedAmount: string) => {
    if (pendingBroadcastRef.current) return;
    const currentAttempt = ++attemptIdRef.current;

    setIsFetchingPlan(true);
    backgroundQuoteFailureKeyRef.current = null;
    setBackgroundQuoteFailure(null);
    try {
      const currentAccount = wallet.address || "0x0000000000000000000000000000000000000000";
      const tokenInAddr = (payToken.isNative ? NATIVE : payToken.address) as Address;
      const tokenOutAddr = (receiveToken.isNative ? NATIVE : receiveToken.address) as Address;

      const targetSlippage = isCustomSlippage
        ? (customParsed.valid ? customParsed.percent : NaN)
        : slippage;

      const attemptTarget: TradeAttemptTarget = {
        attemptId: currentAttempt,
        account: currentAccount,
        chainId: ROBINHOOD_CHAIN_ID,
        tokenInAddress: tokenInAddr.toLowerCase(),
        tokenOutAddress: tokenOutAddr.toLowerCase(),
        amount: trimmedAmount,
        slippage: targetSlippage,
        tokenAddressProp: tokenAddress,
      };

      const effectiveDecimals = activePayToken.decimals ?? payToken.decimals ?? 18;
      let baseAmountIn: string;
      try {
        const parsedBigInt = parseUnits(trimmedAmount, effectiveDecimals);
        if (parsedBigInt <= 0n) return;
        baseAmountIn = parsedBigInt.toString();
      } catch {
        return;
      }

      const slippageBps = getEffectiveSlippageBps(
        slippage,
        isCustomSlippage,
        customParsed.valid ? customParsed.bps : undefined
      );

      const baseReq: SwapRequest = {
        account: currentAccount as Address,
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn: baseAmountIn,
        slippageBps,
        ...(atomicBatchRef.current ? { atomicBatch: true } : {}),
      };

      const planRes = await fetchSwapPlan(baseReq);

      const postFetchCheck = isQuoteAttemptCurrent(attemptTarget, getCurrentAttemptState());
      if (!postFetchCheck.valid || currentAttempt !== attemptIdRef.current) return;

      if (planRes.status === "ready") {
        const plan = planRes.plan;
        if (
          doesPlanMatchRequest({
            plan: { tokenIn: plan.tokenIn, tokenOut: plan.tokenOut, amountIn: plan.amountIn },
            request: { tokenIn: baseReq.tokenIn, tokenOut: baseReq.tokenOut, amountIn: baseReq.amountIn },
          })
        ) {
          setActivePlan(plan);
          setErrorMsg(null);
          backgroundQuoteFailureKeyRef.current = null;
          setBackgroundQuoteFailure(null);
        } else {
          setActivePlan(null);
          backgroundQuoteFailureKeyRef.current = `${payToken.address.toLowerCase()}:${receiveToken.address.toLowerCase()}:${trimmedAmount.trim()}`;
          setBackgroundQuoteFailure("The quote did not match this trade. Try again.");
        }
      } else {
        const desc = describePlanStatus(planRes, readLiquidity(tokenAddress ?? "").removal);
        setActivePlan(null);
        backgroundQuoteFailureKeyRef.current = `${payToken.address.toLowerCase()}:${receiveToken.address.toLowerCase()}:${trimmedAmount.trim()}`;
        setBackgroundQuoteFailure(desc.sentence || "Could not get a quote. Try again.");
      }
    } catch (err) {
      if (isSupersededPlanError(err) || currentAttempt !== attemptIdRef.current) return;
      setActivePlan(null);
      backgroundQuoteFailureKeyRef.current = `${payToken.address.toLowerCase()}:${receiveToken.address.toLowerCase()}:${trimmedAmount.trim()}`;
      setBackgroundQuoteFailure(err instanceof Error && err.message.includes("timed out")
        ? "The quote timed out. Try again."
        : "Could not get a quote. Try again.");
    } finally {
      if (currentAttempt === attemptIdRef.current) {
        setIsFetchingPlan(false);
      }
    }
  }, [
    wallet.address,
    payToken,
    receiveToken,
    activePayToken,
    slippage,
    isCustomSlippage,
    customParsed,
    tokenAddress,
    getCurrentAttemptState,
  ]);

  const fetchQuoteRef = useRef(handleFetchQuoteBackground);
  fetchQuoteRef.current = handleFetchQuoteBackground;
  const hiddenQuoteRef = useRef<string | null>(null);
  const lastInputAtRef = useRef(0);

  // Debounced auto-quote on amount or token pair changes (Uniswap-style)
  useEffect(() => {
    const trimmed = amount.trim();
    dismissToast("swap-quote-failure");
    backgroundQuoteFailureKeyRef.current = null;
    setBackgroundQuoteFailure(null);
    if (!trimmed || trimmed === "." || Number(trimmed) <= 0) {
      setActivePlan(null);
      setIsReviewing(false);
      return;
    }

    if (isPendingBroadcast || pendingBroadcastRef.current) return;
    const tokensChosen = !isUnselected(payToken) && !isUnselected(receiveToken);
    lastInputAtRef.current = Date.now();

    // Past a normal gap between keystrokes, so a number is usually finished before it is quoted.
    // A replaced quote is cancelled in the browser and stops its RPC on the server.
    const timer = setTimeout(() => {
      if (!walletAddressRef.current) setConnectNudge((n) => n + 1);
      if (!tokensChosen) return;
      // A hidden tab spends nothing; the quote runs when the tab is shown again.
      if (document.hidden) {
        hiddenQuoteRef.current = trimmed;
        return;
      }
      fetchQuoteRef.current(trimmed);
    }, 600);

    return () => clearTimeout(timer);
    // Only what the trade IS re-quotes. The callback is read through a ref: it is rebuilt on
    // every balance and price refresh, which re-quoted an idle card every 30 seconds.
  }, [
    amount,
    payToken.address,
    receiveToken.address,
    slippage,
    isCustomSlippage,
    customParsed,
    mode,
    wallet.address,
    isPendingBroadcast,
  ]);

  useEffect(() => {
    const onVisible = () => {
      const pending = hiddenQuoteRef.current;
      if (document.hidden || pending === null) return;
      hiddenQuoteRef.current = null;
      if (pending === amount.trim()) fetchQuoteRef.current(pending);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [amount]);

  // A shown quote is renewed when it expires, while the tab is visible and for 5 minutes after the
  // last edit. An abandoned open tab would otherwise spend a quote every 45 seconds forever.
  useEffect(() => {
    if (!activePlan || isReviewing || isPendingBroadcast) return;
    const timer = setTimeout(() => {
      const trimmed = amount.trim();
      if (!trimmed || Date.now() - lastInputAtRef.current > 5 * 60_000) return;
      if (document.hidden) {
        hiddenQuoteRef.current = trimmed;
        return;
      }
      fetchQuoteRef.current(trimmed);
    }, Math.max(activePlan.expiresAt - Date.now(), 1_000));
    return () => clearTimeout(timer);
  }, [activePlan, isReviewing, isPendingBroadcast, amount]);

  const handleRefreshQuote = useCallback(async () => {
    if (pendingBroadcastRef.current || isFetchingPlan) return;
    const trimmed = amount.trim();
    if (!trimmed || trimmed === "." || Number(trimmed) <= 0) {
      toast.info("Enter an amount first to get a live quote.", { id: "swap-enter-amt", duration: ONE_SHOT_MS });
      return;
    }

    const currentAttempt = ++attemptIdRef.current;

    setBusy("Refreshing live quote...");
    setIsFetchingPlan(true);
    setErrorMsg(null);
    setPlanNotice(null);

    try {
      const currentAccount = wallet.address || "0x0000000000000000000000000000000000000000";
      const tokenInAddr = (payToken.isNative ? NATIVE : payToken.address) as Address;
      const tokenOutAddr = (receiveToken.isNative ? NATIVE : receiveToken.address) as Address;

      const targetSlippage = isCustomSlippage
        ? (customParsed.valid ? customParsed.percent : NaN)
        : slippage;

      const attemptTarget: TradeAttemptTarget = {
        attemptId: currentAttempt,
        account: currentAccount,
        chainId: ROBINHOOD_CHAIN_ID,
        tokenInAddress: tokenInAddr.toLowerCase(),
        tokenOutAddress: tokenOutAddr.toLowerCase(),
        amount,
        slippage: targetSlippage,
        tokenAddressProp: tokenAddress,
      };

      const effectiveDecimals = activePayToken.decimals ?? payToken.decimals ?? 18;
      let baseAmountIn: string;
      try {
        const parsedBigInt = parseUnits(trimmed, effectiveDecimals);
        if (parsedBigInt <= 0n) {
          toast.info("Enter an amount first to get a live quote.", { id: "swap-enter-amt", duration: ONE_SHOT_MS });
          return;
        }
        baseAmountIn = parsedBigInt.toString();
      } catch {
        setErrorMsg("Invalid amount format.");
        return;
      }

      const slippageBps = getEffectiveSlippageBps(
        slippage,
        isCustomSlippage,
        customParsed.valid ? customParsed.bps : undefined
      );

      const baseReq: SwapRequest = {
        account: currentAccount as Address,
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn: baseAmountIn,
        slippageBps,
        ...(atomicBatchRef.current ? { atomicBatch: true } : {}),
      };

      const planRes = await fetchSwapPlan(baseReq);

      const postFetchCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
      if (!postFetchCheck.valid || currentAttempt !== attemptIdRef.current) return;

      if (planRes.status !== "ready") {
        const desc = describePlanStatus(planRes, readLiquidity(tokenAddress ?? "").removal);
        setErrorMsg(desc.sentence || ("detail" in planRes ? planRes.detail : "Swap quote unavailable."));
        setActivePlan(null);
        return;
      }

      const plan = planRes.plan;
      if (
        !doesPlanMatchRequest({
          plan: { tokenIn: plan.tokenIn, tokenOut: plan.tokenOut, amountIn: plan.amountIn },
          request: { tokenIn: baseReq.tokenIn, tokenOut: baseReq.tokenOut, amountIn: baseReq.amountIn },
        })
      ) {
        setErrorMsg("Swap plan does not match requested tokens or amount.");
        setActivePlan(null);
        return;
      }

      setActivePlan(plan);
      setIsReviewing(true);
      toast.success("Quote refreshed.", { id: "swap-refreshed", duration: 2000 });
    } catch (err) {
      if (isSupersededPlanError(err)) return;
      setErrorMsg(err instanceof Error ? err.message : "Failed to refresh quote.");
    } finally {
      setIsFetchingPlan(false);
      setBusy(null);
    }
  }, [
    amount,
    wallet.address,
    payToken,
    receiveToken,
    activePayToken,
    slippage,
    isCustomSlippage,
    customParsed,
    tokenAddress,
    getCurrentAttemptState,
    isFetchingPlan,
  ]);

  // Load persisted imported and recently traded tokens from localStorage safely (A02 / Requirement 5)
  useEffect(() => {
    try {
      const storedImported = localStorage.getItem(IMPORTED_TOKENS_STORAGE_KEY);
      if (storedImported) {
        const parsed = JSON.parse(storedImported);
        if (Array.isArray(parsed)) {
          const valid = parsed
            .map((t) => deserializeTokenFromStorage(t))
            .filter((t): t is SelectableToken => t !== null);
          setImportedTokens(valid);
          setAvailableTokens((prev) => {
            const map = new Map<string, SelectableToken>();
            for (const t of prev) map.set(t.address.toLowerCase(), t);
            for (const t of valid) map.set(t.address.toLowerCase(), t);
            return Array.from(map.values());
          });
        }
      }
    } catch {
      // ignore
    }

    try {
      const storedRecent = localStorage.getItem(RECENT_TOKENS_STORAGE_KEY);
      if (storedRecent) {
        const parsed = JSON.parse(storedRecent);
        if (Array.isArray(parsed)) {
          const valid = parsed
            .map((t) => deserializeTokenFromStorage(t))
            .filter((t): t is SelectableToken => t !== null);
          setRecentTokens(valid.slice(0, 5));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const saveImportedToken = useCallback((token: SelectableToken) => {
    try {
      const raw = localStorage.getItem(IMPORTED_TOKENS_STORAGE_KEY);
      const list: unknown[] = raw ? JSON.parse(raw) : [];
      const existingTokens = list
        .map((t) => deserializeTokenFromStorage(t))
        .filter((t): t is SelectableToken => t !== null);
      if (!existingTokens.some((t) => t.address.toLowerCase() === token.address.toLowerCase())) {
        const next = [token, ...existingTokens];
        const serialized = next.map((t) => serializeTokenForStorage(t));
        localStorage.setItem(IMPORTED_TOKENS_STORAGE_KEY, JSON.stringify(serialized));
        setImportedTokens(next);
      }
    } catch {
      // ignore
    }
  }, []);

  const recordRecentTokens = useCallback((traded: SelectableToken[]) => {
    try {
      const raw = localStorage.getItem(RECENT_TOKENS_STORAGE_KEY);
      const existing: unknown[] = raw ? JSON.parse(raw) : [];
      const map = new Map<string, SelectableToken>();
      for (const t of traded) {
        map.set(t.address.toLowerCase(), t);
      }
      for (const rawToken of existing) {
        const t = deserializeTokenFromStorage(rawToken);
        if (t) {
          const k = t.address.toLowerCase();
          if (!map.has(k)) {
            map.set(k, t);
          }
        }
      }
      const next = Array.from(map.values()).slice(0, 5);
      const serialized = next.map((t) => serializeTokenForStorage(t));
      localStorage.setItem(RECENT_TOKENS_STORAGE_KEY, JSON.stringify(serialized));
      setRecentTokens(next);
    } catch {
      // ignore
    }
  }, []);

  const handleSelectToken = (selected: SelectableToken) => {
    if (pendingBroadcastRef.current) return;
    attemptIdRef.current++;
    setBusy(null);
    setActivePlan(null);
    setIsReviewing(false);
    setPlanNotice(null);

    // If selecting a custom/resolved contract token, persist to imported tokens
    const isBase = BASE_SWAP_TOKENS.some((b) => b.address.toLowerCase() === selected.address.toLowerCase());
    if (!isBase && selected.category !== "stocks") {
      saveImportedToken(selected);
      setAvailableTokens((prev) => {
        if (prev.some((t) => t.address.toLowerCase() === selected.address.toLowerCase())) return prev;
        return [...prev, selected];
      });
    }

    if (selectorTarget === "pay") {
      if (selected.symbol === receiveToken.symbol) {
        setReceiveToken(payToken);
        setPayToken(selected);
      } else {
        setPayToken(selected);
      }
    } else if (selectorTarget === "receive") {
      if (selected.symbol === payToken.symbol) {
        setPayToken(receiveToken);
        setReceiveToken(selected);
      } else {
        setReceiveToken(selected);
      }
    }
    setSelectorTarget(null);
    setSearchQuery("");
    setResolvedContractToken(null);
    setSearchedTokens([]);
    requestAnimationFrame(() => {
      focusAmountInput();
      setTimeout(focusAmountInput, 50);
    });
  };

  const handleConnectWallet = async () => {
    setErrorMsg(null);
    try {
      const addr = await wallet.connect();
      if (!addr && !wallet.isConnected) {
        if (wallet.error) {
          setErrorMsg(wallet.error);
        }
      }
    } catch {
      setErrorMsg(wallet.error || "Failed to connect wallet.");
    }
  };

  const handleTrade = async () => {
    // Block duplicate broadcasts while pendingBroadcastRef exists (Requirement 4)
    if (pendingBroadcastRef.current) {
      setErrorMsg(
        `A transaction (${pendingBroadcastRef.current.hash.slice(0, 10)}…) is currently awaiting confirmation on-chain. Please wait.`
      );
      return;
    }

    // 0. If a previous transaction was submitted but confirmation status is unknown:
    // Retain the hash and prevent duplicate sends until confirmation is resolved.
    if (unconfirmedTx) {
      if (!publicClient) {
        setErrorMsg("Network client unavailable. Cannot verify confirmation status.");
        return;
      }
      setBusy("Checking confirmation status of previous transaction...");
      if (unconfirmedTx.kind === "batch") {
        try {
          const res = await wallet.waitForCalls(unconfirmedTx.hash, 10_000);
          const last = res.receipts?.at(-1);
          setUnconfirmedTx(null);
          if (res.status === "success" && last?.status === "success") {
            setSuccessTx(last.transactionHash);
            recordRecentTokens([receiveToken, payToken]);
            onTradeSuccess?.(last.transactionHash);
            void refetchBalances();
            setErrorMsg(null);
          } else {
            setErrorMsg("The approve and swap batch did not go through. Nothing was swapped.");
          }
        } catch {
          setErrorMsg("The approve and swap batch is still pending. Please wait for it before sending another.");
        }
        setBusy(null);
        return;
      }
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: unconfirmedTx.hash });
        if (receipt) {
          if (receipt.status === "success") {
            const resolvedHash = unconfirmedTx.hash;
            const wasSwap = unconfirmedTx.kind === "swap" || unconfirmedTx.kind === "custom";
            setUnconfirmedTx(null);
            if (wasSwap) {
              setSuccessTx(resolvedHash);
              recordRecentTokens([receiveToken, payToken]);
              onTradeSuccess?.(resolvedHash);
              void refetchBalances();
              setErrorMsg(null);
              setBusy(null);
              return;
            } else {
              // Approval confirmed on chain
              setBusy(null);
              setErrorMsg("Previous approval confirmed on-chain. You may now proceed with the swap.");
              return;
            }
          } else {
            setUnconfirmedTx(null);
            setErrorMsg("Previous transaction reverted on-chain.");
            setBusy(null);
            return;
          }
        } else {
          setErrorMsg(
            `Previous transaction ${unconfirmedTx.hash.slice(0, 10)}… is still pending on-chain. Please wait for confirmation before sending a new transaction.`
          );
          setBusy(null);
          return;
        }
      } catch {
        setErrorMsg(
          `Could not resolve confirmation for transaction ${unconfirmedTx.hash.slice(0, 10)}… Please check explorer before retrying.`
        );
        setBusy(null);
        return;
      }
    }

    const currentAttempt = ++attemptIdRef.current;
    setErrorMsg(null);
    setSuccessTx(null);
    setPlanNotice(null);

    // Block submission if custom slippage is active and invalid
    if (isCustomSlippage) {
      const parsed = parseCustomSlippage(customSlippageInput);
      if (!parsed.valid) {
        setErrorMsg(parsed.error);
        setBusy(null);
        return;
      }
    }

    // 1. If publicClient is unavailable, do not broadcast.
    if (!publicClient) {
      setErrorMsg("Network client unavailable. Cannot broadcast without confirmation provider.");
      return;
    }

    // 2. Perform connection before balance validation.
    const wasDisconnected = (!wallet.isConnected || !wallet.address);
    if (wasDisconnected) {
      setBusy("Connecting wallet...");
      try {
        const addr = await wallet.connect();
        if (currentAttempt !== attemptIdRef.current) return;
        const isNowConnected = Boolean((addr || wallet.address) && wallet.isConnected);
        if (!isNowConnected) {
          if (wallet.error) {
            setErrorMsg(wallet.error);
          }
          setBusy(null);
          return;
        }
        // Connected from disconnected state: stop and ask user to retry with loaded balances.
        setBusy(null);
        setErrorMsg("Wallet connected. Balances loaded — please review and submit your trade.");
        void refetchBalances();
        void refetchDirectBalance();
        return;
      } catch {
        if (currentAttempt !== attemptIdRef.current) return;
        setErrorMsg(wallet.error || "Failed to connect wallet.");
        setBusy(null);
        return;
      }
    }

    // 3. Exact raw balance, amount parsing, and decimals validation (pure test seam)
    const effectiveDecimals =
      activePayToken.address.toLowerCase() === (tokenAddress || "").toLowerCase()
        ? (resolvedDecimals ?? activePayToken.decimals)
        : activePayToken.decimals;

    const nativeToken = chainTokens.find((t) => t.isNative);
    const measuredGasUsed =
      activePlan?.simulation.status === "ok" ? activePlan.simulation.gasUsed : undefined;

    const validation = validateExactRawBalance({
      amount,
      decimals: effectiveDecimals,
      rawBalance: activePayToken.rawBalance,
      tokenSymbol: activePayToken.symbol,
      isNative: activePayToken.isNative,
      measuredGasUsed,
      gasPriceWei: liveGasPrice ?? undefined,
      nativeRawBalance: nativeToken?.rawBalance,
    });

    if (!validation.valid) {
      setErrorMsg(validation.errorMsg || "Invalid trade parameters.");
      setBusy(null);
      return;
    }

    const baseAmountIn = validation.baseAmountIn!.toString();

    // 4. Chain binding to 4663
    if (wallet.chainId !== ROBINHOOD_CHAIN_ID) {
      setBusy("Switching network...");
      try {
        if (switchChainAsync) {
          await switchChainAsync({ chainId: ROBINHOOD_CHAIN_ID });
        } else {
          await wallet.switchChain();
        }
        if (currentAttempt !== attemptIdRef.current) return;
      } catch {
        if (currentAttempt !== attemptIdRef.current) return;
        setErrorMsg("Please switch to Robinhood Chain (4663) to execute swap.");
        setBusy(null);
        return;
      }
    }

    if (walletChainIdRef.current !== ROBINHOOD_CHAIN_ID) {
      setErrorMsg("Please switch to Robinhood Chain (4663) to execute swap.");
      setBusy(null);
      return;
    }

    const currentAccount = walletAddressRef.current;
    if (!currentAccount) {
      setErrorMsg("No wallet account connected.");
      setBusy(null);
      return;
    }

    const tokenInAddr = (payToken.isNative ? NATIVE : payToken.address) as Address;
    const tokenOutAddr = (receiveToken.isNative ? NATIVE : receiveToken.address) as Address;

    const targetSlippage = isCustomSlippage
      ? (customParsed.valid ? customParsed.percent : NaN)
      : slippage;


    // Bind plan and each wallet action to exact account, chain 4663, token pair, amount, and slippage
    const attemptTarget: TradeAttemptTarget = {
      attemptId: currentAttempt,
      account: currentAccount,
      chainId: ROBINHOOD_CHAIN_ID,
      tokenInAddress: tokenInAddr.toLowerCase(),
      tokenOutAddress: tokenOutAddr.toLowerCase(),
      amount,
      slippage: targetSlippage,
      tokenAddressProp: tokenAddress,
    };

    // 5. Custom execute path: execute direct custom transaction without claiming a served router quote
    if (customExecute) {
      const initialCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
      if (!initialCheck.valid) return;

      setBusy("Submitting transaction...");
      setErrorMsg(null);
      try {
        const slippageVal = getCustomExecuteSlippage(
          slippage,
          isCustomSlippage,
          customParsed.valid ? customParsed.percent : undefined
        );
        const tx = await customExecute(amount, mode, slippageVal);

        if (typeof tx === "string" && tx.startsWith("0x")) {
          const txHash = tx as `0x${string}`;
          setPendingBroadcast({ hash: txHash, kind: "custom" });
          setBusy("Confirming transaction...");

          const replacementHolder: {
            current: { reason: string; hash: `0x${string}`; status: string } | null;
          } = { current: null };
          try {
            const receipt = await publicClient.waitForTransactionReceipt({
              hash: txHash,
              timeout: 45_000,
              pollingInterval: RECEIPT_POLL_MS,
              onReplaced: (replacement) => {
                replacementHolder.current = {
                  reason: replacement.reason,
                  hash: replacement.transaction.hash,
                  status: replacement.transactionReceipt.status,
                };
              },
            });
            setPendingBroadcast(null);

            const rep = replacementHolder.current;
            const outcome = classifyReceiptOutcome({
              receipt,
              replacement: rep
                ? {
                    reason: rep.reason,
                    transactionReceipt: { status: rep.status },
                    transaction: { hash: rep.hash },
                  }
                : null,
              originalHash: txHash,
            });

            if (outcome.status === "cancelled") {
              setErrorMsg("Transaction was cancelled in wallet.");
              setBusy(null);
              return;
            }
            if (outcome.status !== "success") {
              setErrorMsg(outcome.reason || "Transaction reverted on chain.");
              setBusy(null);
              return;
            }

            setSuccessTx(outcome.hash);
            recordRecentTokens([receiveToken, payToken]);
            onTradeSuccess?.(outcome.hash);
            void refetchBalances();
            setTimeout(() => {
              void refetchBalances();
            }, 1500);
            setIsReviewing(false);
            setBusy(null);
            return;
          } catch {
            setPendingBroadcast(null);
            // On timeout/RPC error: retain replacement hash if replaced (Requirement 4)
            const rep = replacementHolder.current;
            const pendingHash = resolvePendingHashOnTimeout(txHash, rep?.hash);
            setUnconfirmedTx({ hash: pendingHash, kind: "custom" });
            setErrorMsg(
              `Transaction submitted (${pendingHash.slice(0, 10)}…), but confirmation status is unknown. Please verify on explorer before retrying.`
            );
            setBusy(null);
            return;
          }
        } else {
          setErrorMsg("Custom execution failed to return a transaction hash.");
          setBusy(null);
          return;
        }
      } catch (err) {
        setPendingBroadcast(null);
        const postCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
        if (!postCheck.valid) return;
        setErrorMsg(err instanceof Error ? err.message : "Custom transaction failed.");
        setBusy(null);
      } finally {
        if (!pendingBroadcastRef.current && currentAttempt === attemptIdRef.current) {
          setBusy(null);
        }
      }
      return;
    }

    const slippageBps = getEffectiveSlippageBps(
      slippage,
      isCustomSlippage,
      customParsed.valid ? customParsed.bps : undefined
    );

    const baseReq: SwapRequest = {
      account: currentAccount as Address,
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      amountIn: baseAmountIn,
      slippageBps,
      ...(atomicBatchRef.current ? { atomicBatch: true } : {}),
    };

    // -------------------------------------------------------------------------
    // ACTION 1: FIRST CLICK — LOAD QUOTE AND TRANSITION TO EXPLICIT REVIEW
    // NEVER approve, sign Permit2, or broadcast on first click (Requirement 2).
    // -------------------------------------------------------------------------
    if (!isReviewing) {
      setBusy("Fetching live quote for review...");
      setIsFetchingPlan(true);

      try {
        const client = publicClient ?? fallbackRobinhoodClient;
        const subjectAddress = receiveToken.address;
        const isSubjectBase =
          receiveToken.isNative || isBaseSwapToken(subjectAddress, ROBINHOOD_CHAIN_ID);
        const isSubjectCanonical = isCanonicalRwaAddress(
          subjectAddress,
          canonicalRwaAddresses,
        );
        const shouldRunQuickCheck =
          mode === "buy" &&
          !isSubjectBase &&
          !isSubjectCanonical &&
          isAddress(subjectAddress);

        const planPromise = fetchSwapPlan(baseReq);
        const quickCheckPromise = shouldRunQuickCheck
          ? runTradeContractQuickCheck({
              address: subjectAddress,
              client,
              chainId: ROBINHOOD_CHAIN_ID,
              canonicalRwaAddresses,
          })
          : Promise.resolve(null);
        const securityAddresses = tokenSecurityAddresses([payToken, receiveToken]);
        const securityPromise = Promise.all(securityAddresses.map(async (address) => [
          address,
          await fetchTradeSecuritySignal(address),
        ] as const));

        const [planRes, checkResult, fetchedSecuritySignals] = await Promise.all([
          planPromise,
          quickCheckPromise,
          securityPromise,
        ]);

        const postFetchCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
        if (!postFetchCheck.valid) return;

        // Bind the returned scanner data to the exact selected token addresses.
        // A response for an earlier selection must never label the current trade.
        if (securityAddresses.join(":") === tokenSecurityAddresses([payToken, receiveToken]).join(":")) {
          setSecuritySignals(Object.fromEntries(fetchedSecuritySignals));
        }

        if (checkResult) {
          setQuickCheckResult(checkResult);
          setShowTokenSecurity(true);

          // Transient RPC failures stay in the compact status row; only detected
          // controls trigger a warning toast.
          if ((checkResult.status === "controls" || checkResult.status === "paused") && !checkResult.exempt) {
            const isSuppressed = isWarningSuppressed(ROBINHOOD_CHAIN_ID, subjectAddress);
            if (!isSuppressed) {
              const toastId = `quick-check-warning-${subjectAddress.toLowerCase()}`;
              const warningMessage =
                checkResult.status === "paused"
                  ? "Token reports paused on-chain."
                  : checkResult.statusText;

              toast.warning(
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3 font-mono text-xs font-bold text-[#f2d675]">
                    <span>CONTRACT ADVISORY</span>
                    <a
                      href={`/scan/${subjectAddress}?rescan=1`}
                      className="shrink-0 text-xs font-semibold text-[#ededea] underline underline-offset-2 hover:text-[#ccff00]"
                    >
                      Scan token →
                    </a>
                  </div>
                  <p className="text-sm font-medium leading-snug text-[#ededea]">{warningMessage}</p>
                  <label className="flex items-center gap-2 pt-1 text-xs text-[#d0d0ca] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        setWarningSuppressed(ROBINHOOD_CHAIN_ID, subjectAddress, e.target.checked);
                      }}
                      className="size-4 cursor-pointer accent-[#ccff00]"
                    />
                    <span>Don&apos;t show again for this token</span>
                  </label>
                </div>,
                { id: toastId, skin: "card", duration: ONE_SHOT_MS },
              );
            }
          }
        }

        if (planRes.status !== "ready") {
          const desc = describePlanStatus(planRes, readLiquidity(tokenAddress ?? "").removal);
          setErrorMsg(desc.sentence || ("detail" in planRes ? planRes.detail : "Swap quote unavailable."));
          setBusy(null);
          return;
        }

        const plan = planRes.plan;

        if (
          !doesPlanMatchRequest({
            plan: { tokenIn: plan.tokenIn, tokenOut: plan.tokenOut, amountIn: plan.amountIn },
            request: { tokenIn: baseReq.tokenIn, tokenOut: baseReq.tokenOut, amountIn: baseReq.amountIn },
          })
        ) {
          setErrorMsg("Swap plan does not match requested tokens or amount.");
          setBusy(null);
          return;
        }

        if (isPlanExpired(plan)) {
          setErrorMsg("Returned quote is already expired. Please retry.");
          setBusy(null);
          return;
        }

        // Transition to explicit review! No transaction or signature dispatched.
        setActivePlan(plan);
        setIsReviewing(true);
        setBusy(null);
        return;
      } catch (err) {
        if (isSupersededPlanError(err)) { setBusy(null); return; }
        setErrorMsg(err instanceof Error ? err.message : "Failed to fetch swap quote.");
        setBusy(null);
        return;
      } finally {
        setIsFetchingPlan(false);
      }
    }

    // -------------------------------------------------------------------------
    // ACTION 2: SECOND ACTION — CONFIRM & EXECUTE REVIEWED SWAP
    // If quote is expired or materially changed, show new review instead of silently executing.
    // -------------------------------------------------------------------------

    // Revalidate scanner context before any approval, signature, or swap wallet prompt.
    // A newly discovered critical/stale result returns to explicit review first.
    const signingSecurityAddresses = tokenSecurityAddresses([payToken, receiveToken]);
    const signingSecurityEntries = await Promise.all(signingSecurityAddresses.map(async (address) => [
      address,
      await fetchTradeSecuritySignal(address),
    ] as const));
    const beforeSigningCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
    if (!beforeSigningCheck.valid) return;
    const signingSecurity = Object.fromEntries(signingSecurityEntries) as Record<string, TradeSecuritySignal>;
    const securityChanged = signingSecurityEntries.some(([address, signal]) =>
      isSecuritySignalChangeForReview(securitySignals[address], signal));
    setSecuritySignals(signingSecurity);
    if (securityChanged) {
      setBusy(null);
      setErrorMsg(null);
      setPlanNotice("Scanner information changed. Review the updated token security status before continuing.");
      return;
    }

    // 6. Direct Router Swap Execution via /api/swap/plan
    setBusy("Preparing swap execution...");
    setErrorMsg(null);
    setSuccessTx(null);

    try {
      let currentPlan = activePlan;

      // If active quote has expired, fetch a fresh plan and check for material changes
      if (!currentPlan || isPlanExpired(currentPlan)) {
        setBusy("Quote expired. Fetching fresh quote for review...");
        const freshRes = await fetchSwapPlan(baseReq);
        const postRefreshCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
        if (!postRefreshCheck.valid) return;

        if (freshRes.status !== "ready") {
          const desc = describePlanStatus(freshRes, readLiquidity(tokenAddress ?? "").removal);
          setErrorMsg(desc.sentence || ("detail" in freshRes ? freshRes.detail : "Fresh quote unavailable."));
          setBusy(null);
          return;
        }

        const freshPlan = freshRes.plan;

        if (currentPlan) {
          const diff = comparePlansForReview(currentPlan, freshPlan);
          if (diff.materiallyChanged) {
            setActivePlan(freshPlan);
            setPlanNotice(diff.interrupt);
            setBusy(null);
            return; // Show new review rather than silently executing (Requirement 2)
          }
        }

        currentPlan = freshPlan;
        setActivePlan(freshPlan);
      }

      if (hookWarningsForPlan(currentPlan).length > 0 &&
          !isHookAcked(currentPlan)) {
        setActivePlan(currentPlan);
        setIsReviewing(true);
        setPlanNotice("This V4 hook route changed or its warning has not been acknowledged. Review the hook permissions and confirm again.");
        setBusy(null);
        return;
      }
      // Loop to handle approval -> permit2-sign -> swap sequence with bound attempts
      let currentPermit: SignedPermit | undefined = undefined;
      let approvalAttempts = 0;
      const MAX_APPROVAL_ATTEMPTS = 2;
      const approvedKeys = new Set<string>();

      while (true) {
        // Validate attempt at the start of loop iteration
        const preFetchCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
        if (!preFetchCheck.valid) return;

        if (hookWarningsForPlan(currentPlan).length > 0 &&
            !isHookAcked(currentPlan)) {
          setActivePlan(currentPlan);
          setPlanNotice("The fetched route has a new V4 hook warning. Review it before continuing.");
          setBusy(null);
          return;
        }
        const step = currentPlan.steps[0];
        if (!step) {
          setActivePlan(null);
          setIsReviewing(false);
          setErrorMsg("This route no longer has an executable transaction. Please refresh the quote.");
          setBusy(null);
          return;
        }

        if (step.kind === "approve") {
          const approvalKey = makeApprovalKey(step.token, step.spender, step.amount);
          if (isApprovalRepeated(step.token, step.spender, approvedKeys, step.amount)) {
            setErrorMsg(
              `Repeated approval requested for ${payToken.symbol}. Allowance was not updated on-chain. Please check token balance/allowance.`
            );
            setBusy(null);
            return;
          }
          if (approvalAttempts >= MAX_APPROVAL_ATTEMPTS) {
            setErrorMsg(`Exceeded maximum approval attempts for ${payToken.symbol}. Aborting.`);
            setBusy(null);
            return;
          }
          approvalAttempts++;

          if (!publicClient) {
            setErrorMsg("Network client unavailable. Cannot confirm approval.");
            setBusy(null);
            return;
          }

          // Check validity and expiration immediately before approval send
          const preApproveCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
          if (!preApproveCheck.valid) return;
          if (hookWarningsForPlan(currentPlan).length > 0 &&
              !isHookAcked(currentPlan)) {
            setPlanNotice("Review and acknowledge the V4 hook warning for this plan before approving.");
            setBusy(null);
            return;
          }
          if (isPlanExpired(currentPlan)) {
            setErrorMsg("Quote expired before approval broadcast. Please retry.");
            setBusy(null);
            return;
          }

          setBusy(`Approving ${payToken.symbol} in wallet...`);
          const approveHash = await wallet.sendTransaction({
            to: step.tx.to,
            data: step.tx.data,
            value: BigInt(step.tx.value || "0"),
            chainId: ROBINHOOD_CHAIN_ID,
          });

          if (!approveHash) {
            const check = isAttemptValid(attemptTarget, getCurrentAttemptState());
            if (!check.valid) return;
            setErrorMsg(wallet.error || "Approval transaction was rejected or failed.");
            setBusy(null);
            return;
          }

          // Handed to wallet/network! Retain pending status independent of form edits
          setPendingBroadcast({ hash: approveHash, kind: "approve" });
          setBusy(`Confirming ${payToken.symbol} approval on-chain...`);

          const replacementHolder: {
            current: { reason: string; hash: `0x${string}`; status: string } | null;
          } = { current: null };
          try {
            const receipt = await publicClient.waitForTransactionReceipt({
              hash: approveHash,
              timeout: 45_000,
              pollingInterval: RECEIPT_POLL_MS,
              onReplaced: (replacement) => {
                replacementHolder.current = {
                  reason: replacement.reason,
                  hash: replacement.transaction.hash,
                  status: replacement.transactionReceipt.status,
                };
              },
            });
            setPendingBroadcast(null);

            const rep = replacementHolder.current;
            const outcome = classifyReceiptOutcome({
              receipt,
              replacement: rep
                ? {
                    reason: rep.reason,
                    transactionReceipt: { status: rep.status },
                    transaction: { hash: rep.hash },
                  }
                : null,
              originalHash: approveHash,
            });

            if (outcome.status === "cancelled") {
              setErrorMsg("Approval transaction was cancelled in wallet.");
              setBusy(null);
              return;
            }
            if (outcome.status !== "success") {
              setErrorMsg(outcome.reason || "Approval transaction reverted on-chain.");
              setBusy(null);
              return;
            }

            approvedKeys.add(approvalKey);

            // Verify attempt was not invalidated while waiting for approval confirmation
            const postApproveCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
            if (!postApproveCheck.valid) {
              setBusy(null);
              return;
            }

            setBusy("Approval confirmed. Updating swap plan...");

            // Refetch plan after approval: verify binding or re-review if terms materially changed (Requirement 2)
            const nextReq: SwapRequest = { ...baseReq, permit: currentPermit };
            const nextPlanRes = await fetchSwapPlan(nextReq);
            if (nextPlanRes.status !== "ready") {
              setErrorMsg("Could not retrieve next execution step after approval.");
              setBusy(null);
              return;
            }

            const diff = comparePlansForReview(currentPlan, nextPlanRes.plan, { allowStepProgression: true });
            if (diff.materiallyChanged) {
              setActivePlan(nextPlanRes.plan);
              setPlanNotice(diff.interrupt);
              setBusy(null);
              return; // Show updated review rather than silently executing
            }

            currentPlan = nextPlanRes.plan;
            setActivePlan(nextPlanRes.plan);
            continue;
          } catch {
            setPendingBroadcast(null);
            // On timeout/RPC error: retain replacement hash if available (Requirement 4)
            const rep = replacementHolder.current;
            const pendingHash = resolvePendingHashOnTimeout(approveHash, rep?.hash);
            setUnconfirmedTx({ hash: pendingHash, kind: "approve" });
            setErrorMsg(
              `Approval submitted (${pendingHash.slice(0, 10)}…), but confirmation status is unknown. Check explorer before retrying.`
            );
            setBusy(null);
            return;
          }
        }

        if (step.kind === "permit2-sign") {
          const prePermitCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
          if (!prePermitCheck.valid) return;
          if (hookWarningsForPlan(currentPlan).length > 0 &&
              !isHookAcked(currentPlan)) {
            setPlanNotice("Review and acknowledge the V4 hook warning for this plan before signing.");
            setBusy(null);
            return;
          }
          if (isPlanExpired(currentPlan)) {
            setErrorMsg("Quote expired before signing permit. Please refresh.");
            setBusy(null);
            return;
          }

          setBusy("Please sign Permit2 message in your wallet...");
          const sig = await wallet.signTypedData(step.typedData as any);

          const postPermitCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
          if (!postPermitCheck.valid) return;

          if (!sig) {
            setErrorMsg(wallet.error || "Permit2 signature was rejected.");
            setBusy(null);
            return;
          }

          currentPermit = {
            token: step.typedData.message.details.token,
            spender: step.typedData.message.spender,
            amount: step.typedData.message.details.amount,
            expiration: step.typedData.message.details.expiration,
            nonce: step.typedData.message.details.nonce,
            sigDeadline: step.typedData.message.sigDeadline,
            signature: sig,
          };

          setBusy("Signature captured. Preparing final swap...");

          // Refetch plan with signed permit: verify binding or re-review if terms materially changed (Requirement 2)
          const nextReq: SwapRequest = { ...baseReq, permit: currentPermit };
          const nextPlanRes = await fetchSwapPlan(nextReq);
          if (nextPlanRes.status !== "ready") {
            setErrorMsg("Could not prepare swap execution after signature.");
            setBusy(null);
            return;
          }

          const diff = comparePlansForReview(currentPlan, nextPlanRes.plan, { allowStepProgression: true });
          if (diff.materiallyChanged) {
            setActivePlan(nextPlanRes.plan);
            setPlanNotice(diff.interrupt);
            setBusy(null);
            return; // Show updated review rather than silently executing
          }

          currentPlan = nextPlanRes.plan;
          setActivePlan(nextPlanRes.plan);
          continue;
        }

        if (step.kind === "batch") {
          if (!canProceedWithHookStep(currentPlan, isHookAcked(currentPlan), "swap")) {
            setActivePlan(currentPlan);
            setPlanNotice("The selected hook route needs a completed buy and sell simulation before the swap can be signed.");
            setBusy(null);
            return;
          }
          if (currentPlan.simulation.status !== "ok") {
            setErrorMsg(describeSimulation(currentPlan.simulation) || "Swap simulation failed on-chain.");
            setBusy(null);
            return;
          }
          if (!isAttemptValid(attemptTarget, getCurrentAttemptState()).valid) return;
          if (hookWarningsForPlan(currentPlan).length > 0 &&
              !isHookAcked(currentPlan)) {
            setPlanNotice("Review and acknowledge the V4 hook warning for this plan before swapping.");
            setBusy(null);
            return;
          }
          if (isPlanExpired(currentPlan)) {
            setErrorMsg("Quote expired before swap submission. Please refresh.");
            setBusy(null);
            return;
          }

          setBusy("Confirm approval and swap in wallet...");
          const batchId = await wallet.sendCalls(
            step.calls.map((c) => ({ to: c.to, data: c.data, value: BigInt(c.value || "0") })),
            ROBINHOOD_CHAIN_ID,
          );
          if (!batchId) {
            if (!isAttemptValid(attemptTarget, getCurrentAttemptState()).valid) return;
            setErrorMsg(wallet.error || "The approval and swap were rejected or failed.");
            setBusy(null);
            return;
          }
          setPendingBroadcast({ hash: batchId as `0x${string}`, kind: "batch" });
          setBusy("Confirming approval and swap on-chain...");
          try {
            const res = await wallet.waitForCalls(batchId, 60_000);
            setPendingBroadcast(null);
            const last = res.receipts?.at(-1);
            // Atomic: every call landed or none did. Success is the whole batch, read from its receipts.
            if (res.status !== "success" || !res.receipts?.length || res.receipts.some((r) => r.status !== "success") || !last) {
              setErrorMsg("The approval and swap reverted on-chain. Nothing was swapped.");
              setBusy(null);
              return;
            }
            setSuccessTx(last.transactionHash);
            recordRecentTokens([receiveToken, payToken]);
            onTradeSuccess?.(last.transactionHash);
            void refetchBalances();
            setTimeout(() => {
              void refetchBalances();
            }, 1500);
            setActivePlan(null);
            setIsReviewing(false);
            setBusy(null);
            return;
          } catch {
            setPendingBroadcast(null);
            setUnconfirmedTx({ hash: batchId as `0x${string}`, kind: "batch" });
            setErrorMsg("Approval and swap submitted, but confirmation status is unknown. Check your wallet's activity before retrying.");
            setBusy(null);
            return;
          }
        }

        if (step.kind === "swap") {
          const hookStepAllowed = canProceedWithHookStep(
            currentPlan,
            isHookAcked(currentPlan),
            "swap",
          );
          if (!hookStepAllowed) {
            setActivePlan(currentPlan);
            setPlanNotice("The selected hook route needs a completed buy and sell simulation before the swap can be signed.");
            setBusy(null);
            return;
          }
          if (currentPlan.simulation.status !== "ok") {
            const simDesc = describeSimulation(currentPlan.simulation);
            setErrorMsg(simDesc || "Swap simulation failed on-chain.");
            setBusy(null);
            return;
          }

          if (!publicClient) {
            setErrorMsg("Network client unavailable. Cannot confirm swap.");
            setBusy(null);
            return;
          }

          // Check validity and expiration immediately before swap broadcast
          const preSwapCheck = isAttemptValid(attemptTarget, getCurrentAttemptState());
          if (!preSwapCheck.valid) return;
          if (hookWarningsForPlan(currentPlan).length > 0 &&
              !isHookAcked(currentPlan)) {
            setPlanNotice("Review and acknowledge the V4 hook warning for this plan before swapping.");
            setBusy(null);
            return;
          }
          if (isPlanExpired(currentPlan)) {
            setErrorMsg("Quote expired before swap submission. Please refresh.");
            setBusy(null);
            return;
          }

          setBusy("Confirm swap in wallet...");
          const swapTxHash = await wallet.sendTransaction({
            to: step.tx.to,
            data: step.tx.data,
            value: BigInt(step.tx.value || "0"),
            chainId: ROBINHOOD_CHAIN_ID,
          });

          if (!swapTxHash) {
            const check = isAttemptValid(attemptTarget, getCurrentAttemptState());
            if (!check.valid) return;
            setErrorMsg(wallet.error || "Swap transaction was rejected or failed.");
            setBusy(null);
            return;
          }

          // Handed to wallet/network! Retain pending status independent of form edits
          setPendingBroadcast({ hash: swapTxHash, kind: "swap" });
          setBusy("Confirming swap on-chain...");

          const replacementHolder: {
            current: { reason: string; hash: `0x${string}`; status: string } | null;
          } = { current: null };
          try {
            const receipt = await publicClient.waitForTransactionReceipt({
              hash: swapTxHash,
              timeout: 45_000,
              pollingInterval: RECEIPT_POLL_MS,
              onReplaced: (replacement) => {
                replacementHolder.current = {
                  reason: replacement.reason,
                  hash: replacement.transaction.hash,
                  status: replacement.transactionReceipt.status,
                };
              },
            });
            setPendingBroadcast(null);

            const rep = replacementHolder.current;
            const outcome = classifyReceiptOutcome({
              receipt,
              replacement: rep
                ? {
                    reason: rep.reason,
                    transactionReceipt: { status: rep.status },
                    transaction: { hash: rep.hash },
                  }
                : null,
              originalHash: swapTxHash,
            });

            if (outcome.status === "cancelled") {
              setErrorMsg("Swap transaction was cancelled in wallet.");
              setBusy(null);
              return;
            }
            if (outcome.status !== "success") {
              setErrorMsg(outcome.reason || "Transaction reverted on-chain.");
              setBusy(null);
              return;
            }

            // Ensure no onTradeSuccess before mined success (Requirement 4)
            setSuccessTx(outcome.hash);
            recordRecentTokens([receiveToken, payToken]);
            onTradeSuccess?.(outcome.hash);
            void refetchBalances();
            setTimeout(() => {
              void refetchBalances();
            }, 1500);
            setActivePlan(null);
            setIsReviewing(false);
            setBusy(null);
            return;
          } catch {
            setPendingBroadcast(null);
            // On timeout/RPC error: retain replacement hash if available (Requirement 4)
            const rep = replacementHolder.current;
            const pendingHash = resolvePendingHashOnTimeout(swapTxHash, rep?.hash);
            setUnconfirmedTx({ hash: pendingHash, kind: "swap" });
            setErrorMsg(
              `Swap submitted (${pendingHash.slice(0, 10)}…), but confirmation status is unknown. Check explorer before retrying.`
            );
            setBusy(null);
            return;
          }
        }

        break;
      }
    } catch (err) {
      setPendingBroadcast(null);
      const check = isAttemptValid(attemptTarget, getCurrentAttemptState());
      if (!check.valid) return;
      setErrorMsg(err instanceof Error ? err.message : "Swap transaction failed.");
    } finally {
      if (!pendingBroadcastRef.current && currentAttempt === attemptIdRef.current) {
        setBusy(null);
      }
    }
  };

  // Focus/blur listeners
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const on = () => setCaretOn(true);
    const off = () => setCaretOn(false);
    el.addEventListener("focus", on);
    el.addEventListener("blur", off);
    return () => {
      el.removeEventListener("focus", on);
      el.removeEventListener("blur", off);
    };
  }, []);

  // Real-time On-Chain / DexScreener Contract Address Search
  useEffect(() => {
    const raw = searchQuery.trim();
    const addr = (raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`).toLowerCase();
    if (isAddress(addr)) {
      let isCancelled = false;
      setIsSearchingContract(true);
      setResolvedContractToken(null);

      async function resolveAddress() {
        try {
          const existing = chainTokens.find(
            (t) => t.address.toLowerCase() === addr
          );
          if (existing) {
            if (!isCancelled) {
              setResolvedContractToken(existing);
              setIsSearchingContract(false);
            }
            return;
          }

          // 1. Query on-chain ERC-20 contract directly via client-side RPC for exact decimals, symbol, name
          let onChainDecimals: number | null = null;
          let onChainSymbol = "TOKEN";
          let onChainName = "Custom Token";
          let onChainSuccess = false;

          const client = publicClient ?? fallbackRobinhoodClient;

          try {
            const [decRes, symRes, nmRes] = await Promise.allSettled([
              client.readContract({
                address: addr as `0x${string}`,
                abi: erc20Abi,
                functionName: "decimals",
              }),
              client.readContract({
                address: addr as `0x${string}`,
                abi: erc20Abi,
                functionName: "symbol",
              }),
              client.readContract({
                address: addr as `0x${string}`,
                abi: erc20Abi,
                functionName: "name",
              }),
            ]);
            if (
              decRes.status === "fulfilled" &&
              (typeof decRes.value === "number" || typeof decRes.value === "bigint") &&
              Number(decRes.value) >= 0 &&
              Number(decRes.value) <= 255
            ) {
              onChainDecimals = Number(decRes.value);
              onChainSuccess = true;
            }
            if (symRes.status === "fulfilled" && typeof symRes.value === "string" && symRes.value.trim().length > 0) {
              onChainSymbol = symRes.value.trim();
              onChainSuccess = true;
            }
            if (nmRes.status === "fulfilled" && typeof nmRes.value === "string" && nmRes.value.trim().length > 0) {
              onChainName = nmRes.value.trim();
              onChainSuccess = true;
            }
          } catch {
            // Contract read failed
          }

          // Check canonical stocks fallback if decimals was not found
          if (onChainDecimals === null) {
            const stockMatch = CANONICAL_STOCK_TOKENS.find(
              (s) => s.address.toLowerCase() === addr
            );
            if (stockMatch) {
              onChainDecimals = stockMatch.decimals;
              if (onChainSymbol === "TOKEN") onChainSymbol = stockMatch.symbol;
              if (onChainName === "Custom Token") onChainName = stockMatch.name;
              onChainSuccess = true;
            }
          }

          // Default decimals to 18 if symbol or name was successfully read on-chain
          if (onChainSuccess && onChainDecimals === null) {
            onChainDecimals = 18;
          }

          // Immediately display on-chain verified token (fast 150ms path)
          if (!isCancelled) {
            if (onChainSuccess && onChainDecimals !== null) {
              setResolvedContractToken({
                symbol: onChainSymbol,
                name: onChainName,
                address: addr,
                decimals: onChainDecimals,
                priceUsd: 0,
                priceEth: 0,
                balance: 0,
                imageUrl: `https://dd.dexscreener.com/ds-data/tokens/robinhood/${addr}.png`,
                category: "ecosystem",
                volume24h: 0,
                iconBg: "bg-[#ccff00]/10",
                iconColor: "text-[#ccff00]",
                iconLabel: onChainSymbol.slice(0, 2),
              });
            } else {
              setResolvedContractToken(null);
            }
            setIsSearchingContract(false);
          }

          // 2. Background DexScreener enrichment for price, volume, and logo (non-blocking)
          try {
            let price = 0;
            let vol24 = 0;
            let img: string | undefined = undefined;

            let pairs: any[] = [];
            const res = await fetch(
              `https://api.dexscreener.com/token-pairs/v1/robinhood/${addr}`,
              { signal: AbortSignal.timeout(3500) }
            );
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data)) {
                pairs = data;
              }
            }

            if (pairs.length === 0) {
              const res2 = await fetch(
                `https://api.dexscreener.com/latest/dex/tokens/${addr}`,
                { signal: AbortSignal.timeout(3500) }
              );
              if (res2.ok) {
                const data2 = await res2.json();
                pairs = (data2.pairs || []).filter(
                  (p: { chainId?: string }) => (p.chainId || "").toLowerCase() === "robinhood"
                );
              }
            }

            // If still no pairs, check if addr is a pair address directly
            if (pairs.length === 0) {
              try {
                const resPair = await fetch(
                  `https://api.dexscreener.com/latest/dex/pairs/robinhood/${addr}`,
                  { signal: AbortSignal.timeout(3500) }
                );
                if (resPair.ok) {
                  const dataPair = await resPair.json();
                  if (dataPair.pair && (dataPair.pair.chainId || "").toLowerCase() === "robinhood") {
                    pairs = [dataPair.pair];
                  }
                }
              } catch {
                // Ignore
              }
            }

            let resolvedTargetAddr = addr;
            if (pairs.length > 0) {
              // Prioritize exact pair address match if addr is a pair address, else rank by active depth
              const exact = pairs.find((p: any) => (p.pairAddress || "").toLowerCase() === addr);
              pairs.sort((a: any, b: any) => {
                const scoreA = Number(a.liquidity?.usd ?? 0) * 2 + Number(a.volume?.h24 ?? 0);
                const scoreB = Number(b.liquidity?.usd ?? 0) * 2 + Number(b.volume?.h24 ?? 0);
                return scoreB - scoreA;
              });
              const pair = exact || pairs[0];
              const isBase = pair.baseToken?.address?.toLowerCase() === addr;
              const matched = isBase ? pair.baseToken : (exact ? pair.baseToken : pair.quoteToken);
              // priceUsd is the base side's price: a token found as quote must not wear it (§8 #21).
              price = isBase || exact ? parseFloat(pair.priceUsd || "0") : (pickTokenPriceUsd(pairs, addr) ?? 0);
              vol24 = pair.volume?.h24 || 0;
              img = pair.info?.imageUrl || img;
              if (!onChainSuccess || onChainSymbol === "TOKEN") {
                if (matched?.symbol) onChainSymbol = matched.symbol;
                if (matched?.name) onChainName = matched.name;
              }
              // If addr was a pair address, point to the underlying baseToken
              if (exact && pair.baseToken?.address) {
                resolvedTargetAddr = pair.baseToken.address.toLowerCase() as `0x${string}`;
                if (pair.baseToken.symbol) onChainSymbol = pair.baseToken.symbol;
                if (pair.baseToken.name) onChainName = pair.baseToken.name;
              }
            }

            if (!isCancelled && (price > 0 || img || (onChainSymbol !== "TOKEN" && !onChainSuccess))) {
              setResolvedContractToken((prev) => {
                const finalDecimals = onChainDecimals ?? 18;
                if (!prev) {
                  return {
                    symbol: onChainSymbol,
                    name: onChainName,
                    address: resolvedTargetAddr,
                    decimals: finalDecimals,
                    priceUsd: price,
                    priceEth: price > 0 && payTokenPriceRef.current > 0 ? price / payTokenPriceRef.current : 0,
                    balance: 0,
                    imageUrl: img || `https://dd.dexscreener.com/ds-data/tokens/robinhood/${resolvedTargetAddr}.png`,
                    category: "ecosystem",
                    volume24h: vol24,
                    iconBg: "bg-[#ccff00]/10",
                    iconColor: "text-[#ccff00]",
                    iconLabel: onChainSymbol.slice(0, 2),
                  };
                }
                if (prev.address.toLowerCase() !== resolvedTargetAddr && prev.address.toLowerCase() !== addr) return prev;
                return {
                  ...prev,
                  address: resolvedTargetAddr,
                  symbol: onChainSymbol !== "TOKEN" ? onChainSymbol : prev.symbol,
                  name: onChainName !== "Custom Token" ? onChainName : prev.name,
                  priceUsd: price > 0 ? price : prev.priceUsd,
                  priceEth: price > 0 && payTokenPriceRef.current > 0 ? price / payTokenPriceRef.current : prev.priceEth,
                  volume24h: vol24 > 0 ? vol24 : prev.volume24h,
                  imageUrl: img || prev.imageUrl,
                };
              });
            }
          } catch {
            // Ignore background DexScreener error
          }
        } catch {
          if (!isCancelled) {
            setIsSearchingContract(false);
          }
        }
      }

      resolveAddress();
      return () => {
        isCancelled = true;
      };
    } else {
      setResolvedContractToken(null);
      setIsSearchingContract(false);
    }
  }, [searchQuery, chainTokens, publicClient]);

  // Dynamic Name / Symbol Search for Tokens Not in Local List
  useEffect(() => {
    const raw = searchQuery.trim();
    const addr = raw.startsWith("0x") || raw.startsWith("0X") ? raw : `0x${raw}`;
    if (isAddress(addr) || raw.length < 2) {
      setSearchedTokens([]);
      setIsSearchingName(false);
      return;
    }

    let isCancelled = false;
    setIsSearchingName(true);

    const timer = setTimeout(async () => {
      try {
        const pairs = await searchDexScreenerPairs(raw);
        if (isCancelled) return;

        // Sort pairs by active depth before deduplicating candidates
        pairs.sort((a, b) => {
          const scoreA = Number(a.liquidity?.usd ?? 0) * 2 + Number(a.volume?.h24 ?? 0);
          const scoreB = Number(b.liquidity?.usd ?? 0) * 2 + Number(b.volume?.h24 ?? 0);
          return scoreB - scoreA;
        });

        const client = publicClient ?? fallbackRobinhoodClient;

        const seenAddresses = new Set<string>(chainTokens.map((t) => t.address.toLowerCase()));
        const candidates: SelectableToken[] = [];

        // First pair seen wins below, so the deepest must come first: a thin pool's price
        // labelled a correct CASHCAT quote ~8% low.
        const byDepth = [...pairs].sort((a: any, b: any) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));
        for (const pair of byDepth) {
          const base = pair.baseToken;
          if (base?.address && isAddress(base.address)) {
            const lower = base.address.toLowerCase();
            if (!seenAddresses.has(lower)) {
              seenAddresses.add(lower);
              const sym = (base.symbol || "TOKEN").toUpperCase();
              const pUsd = parseFloat(pair.priceUsd || "0");
              const vol = pair.volume?.h24 || 0;
              candidates.push({
                symbol: sym,
                name: base.name || sym,
                address: base.address,
                decimals: 18,
                priceUsd: pUsd,
                priceEth: pUsd > 0 && payToken.priceUsd > 0 ? pUsd / payToken.priceUsd : 0,
                balance: 0,
                category: "ecosystem",
                volume24h: vol,
                imageUrl: pair.info?.imageUrl,
                iconBg: "bg-[#ccff00]/10",
                iconColor: "text-[#ccff00]",
                iconLabel: sym.slice(0, 2),
              });
            }
          }
        }

        // Show candidates immediately
        if (!isCancelled && candidates.length > 0) {
          setSearchedTokens(candidates);
        }

        // Read decimals on-chain via batched Multicall3
        const targetSlice = candidates.slice(0, 8);
        let enriched = candidates;
        try {
          const decResults = await client.multicall({
            contracts: targetSlice.map((tok) => ({
              address: tok.address as `0x${string}`,
              abi: erc20Abi,
              functionName: "decimals" as const,
            })),
            allowFailure: true,
          });
          enriched = candidates.map((tok, i) => {
            if (i >= targetSlice.length) return tok;
            const res = decResults[i] as { status: "success"; result: unknown } | { status: "failure"; error: Error } | undefined;
            if (res && res.status === "success" && (typeof res.result === "number" || typeof res.result === "bigint")) {
              const num = Number(res.result);
              if (num >= 0 && num <= 255) return { ...tok, decimals: num };
            }
            return tok;
          });
        } catch {
          // keep fallback 18
        }

        if (!isCancelled) {
          setSearchedTokens(enriched);
          setIsSearchingName(false);
        }
      } catch {
        if (!isCancelled) {
          setSearchedTokens([]);
          setIsSearchingName(false);
        }
      }
    }, 280);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, chainTokens, payToken.priceUsd, publicClient]);

  // Filtered and volume-sorted tokens for Uniswap selection drawer
  const filteredTokens = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = chainTokens;
    if (q) {
      list = chainTokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q)
      );
    }
    // Uniswap-style sort:
    // 1. Tokens with positive balance (> 0) float to top
    // 2. Then sorted by 24h volume descending
    return [...list].sort((a, b) => {
      const aHasBal = (a.balance || 0) > 0 ? 1 : 0;
      const bHasBal = (b.balance || 0) > 0 ? 1 : 0;
      if (aHasBal !== bHasBal) return bHasBal - aHasBal;
      return (b.volume24h || 0) - (a.volume24h || 0);
    });
  }, [chainTokens, searchQuery]);

  // Combined with dynamic name search results
  const allDisplayTokens = useMemo(() => {
    if (searchedTokens.length === 0) return filteredTokens;
    const map = new Map<string, SelectableToken>();
    for (const t of filteredTokens) {
      map.set(t.address.toLowerCase(), t);
    }
    for (const t of searchedTokens) {
      if (!map.has(t.address.toLowerCase())) {
        map.set(t.address.toLowerCase(), t);
      }
    }
    return Array.from(map.values());
  }, [filteredTokens, searchedTokens]);

  // Progressive display slice (DOM virtualization)
  useEffect(() => {
    setDisplayCount(30);
  }, [searchQuery]);

  const visibleTokens = useMemo(() => {
    return allDisplayTokens.slice(0, displayCount);
  }, [allDisplayTokens, displayCount]);

  const handleListScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
      if (scrollTop + clientHeight >= scrollHeight - 80) {
        setDisplayCount((prev) => Math.min(prev + 25, allDisplayTokens.length));
      }
    },
    [allDisplayTokens.length]
  );

  // Quick select chips matching Uniswap on DexScreener (Image 1)
  const cryptoChips = useMemo(() => {
    const symbols = ["ETH", "USDC", "USDG", "USDT", "WBTC", "WETH"];
    return symbols
      .map((sym) => chainTokens.find((t) => t.symbol === sym))
      .filter((t): t is SelectableToken => !!t);
  }, [chainTokens]);

  const stockChips = useMemo(() => {
    return chainTokens
      .filter((t) => t.category === "stocks")
      .slice(0, 6);
  }, [chainTokens]);

  const payAmountNum = parseFloat(raw);
  const payTokenPrice =
    activePayToken.priceUsd > 0
      ? activePayToken.priceUsd
      : (activePayToken.symbol === "USDG" ? 1.0 : 0);
  const payUsdVal =
    !isNaN(payAmountNum) && payAmountNum > 0 && payTokenPrice > 0
      ? payAmountNum * payTokenPrice
      : null;

  const receiveAmountNum = displayReceiveAmount !== null ? parseFloat(displayReceiveAmount) : NaN;
  const receiveTokenPrice =
    receiveToken.priceUsd > 0
      ? receiveToken.priceUsd
      : (receiveToken.symbol === "USDG" ? 1.0 : 0);
  const receiveUsdVal =
    !isNaN(receiveAmountNum) && receiveAmountNum > 0 && receiveTokenPrice > 0
      ? receiveAmountNum * receiveTokenPrice
      : null;

  const connectedWalletAddress = wallet.address;
  const isNativePayToken = activePayToken.isNative || activePayToken.address.toLowerCase() === NATIVE.toLowerCase();
  const hasLoadedPayBalance =
    wallet.isConnected &&
    !!connectedWalletAddress &&
    activePayToken.balanceStatus === "loaded" &&
    activePayToken.rawBalance !== undefined &&
    activePayToken.rawBalance !== null;
  const hasLoadedReceiveBalance =
    wallet.isConnected &&
    !!connectedWalletAddress &&
    activeReceiveToken.balanceStatus === "loaded" &&
    activeReceiveToken.rawBalance !== undefined &&
    activeReceiveToken.rawBalance !== null;
  const payTokenDecimals =
    !isNativePayToken && activePayToken.address.toLowerCase() === (tokenAddress || "").toLowerCase()
      ? (resolvedDecimals ?? activePayToken.decimals)
      : activePayToken.decimals;
  const canUsePercentPresets =
    hasLoadedPayBalance &&
    Number.isInteger(payTokenDecimals) &&
    payTokenDecimals >= 0;
  const payBalanceLabel =
    !wallet.isConnected || !connectedWalletAddress
      ? "—"
      : activePayToken.balanceStatus === "loading" || (isBalancesLoading && activePayToken.rawBalance === undefined)
        ? "…"
        : activePayToken.balanceStatus === "error"
          ? "Unavailable"
          : hasLoadedPayBalance
            ? formatBaseUnits(activePayToken.rawBalance as bigint, activePayToken.decimals, 4)
            : "—";
  const receiveBalanceLabel =
    !wallet.isConnected || !connectedWalletAddress
      ? "—"
      : activeReceiveToken.balanceStatus === "loading" || (isBalancesLoading && activeReceiveToken.rawBalance === undefined)
        ? "…"
        : activeReceiveToken.balanceStatus === "error"
          ? "Unavailable"
          : hasLoadedReceiveBalance
            ? formatBaseUnits(activeReceiveToken.rawBalance as bigint, activeReceiveToken.decimals, 4)
            : "—";
  const securityToken = mode === "buy" ? receiveToken : payToken;
  const securityScanAddress = activePlan?.unscanned && activePlan.unscannedToken
    ? activePlan.unscannedToken
    : securityToken.address;
  const canOpenSecurityScan =
    !securityToken.isNative &&
    securityScanAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000" &&
    isAddress(securityScanAddress);
  const visibleSecuritySignals = tokenSecurityAddresses([payToken, receiveToken])
    .map((address) => ({ address, signal: securitySignals[address] }))
    .filter((entry): entry is { address: string; signal: TradeSecuritySignal } => Boolean(entry.signal));
  // One scan state for the section: a saved verdict wins, then the lookup, then the plan's flag.
  const scanSubject = securityScanAddress.toLowerCase();
  const subjectSignal = securitySignals[scanSubject];
  const scanState: "verdict" | "unscanned" | "unknown" | null =
    subjectSignal?.kind === "verdict" ? "verdict"
      : subjectSignal?.kind === "unscanned" || (!subjectSignal && activePlan?.unscanned) ? "unscanned"
        : subjectSignal?.kind === "unknown" ? "unknown" : null;
  const scanChip = scanState === "unscanned" ? { text: "Not scanned", tone: "font-semibold text-[#ff8a8a]" }
    : subjectSignal?.kind === "verdict" ? { text: verdictPillText(subjectSignal), tone: subjectSignal.tier.toUpperCase() === "CRITICAL" ? "font-semibold text-[#ff8a8a]" : "text-[#d0d5cd]" }
      : null;
  const isCriticalSignal = (signal: TradeSecuritySignal) => signal.kind === "verdict" &&
    (signal.tier.toUpperCase() === "CRITICAL" || signal.honeypot?.status.toUpperCase() === "CRITICAL" || hasConclusiveBlockedRoute(signal));
  const modalScannerSignals = visibleSecuritySignals.filter(({ signal }) => signal.kind === "verdict" &&
    (signal.tier.toUpperCase() !== "CLEAR" || hasIncompleteSellCoverage(signal) || isCriticalSignal(signal)));
  const modalCritical = modalScannerSignals.some(({ signal }) => isCriticalSignal(signal));
  const scanAckKey = activePlan && modalScannerSignals.length
    ? `scan:${[activePlan.tokenIn, activePlan.tokenOut].map((t) => t.toLowerCase()).sort().join(":")}`
    : null;
  const scanNeedsAck = scanAckKey !== null &&
    (modalCritical || !(hookAckedRef.current.has(scanAckKey) || isWarningSuppressed(ROBINHOOD_CHAIN_ID, scanAckKey)));
  const confirmTrade = () => {
    // An expired quote re-quotes first; the warnings belong to the plan that will actually run.
    if (activePlan && !isPlanExpired(activePlan) && (!isHookAcked(activePlan) || scanNeedsAck)) {
      setWarningsOpen(true);
      return;
    }
    void handleTrade();
  };

  return (
    <div
      className={`relative flex flex-col gap-3.5 p-5 sm:p-6 bg-[#0a0b0b] text-[#ededea] text-[15px] leading-[1.5] min-h-full`}
    >
      {warningsOpen && activePlan && (
        <TradeWarningsModal
          tokenSymbol={(activePlan.tokenOut.toLowerCase() === NATIVE ? activePlan.tokenInDisplay.symbol : activePlan.tokenOutDisplay.symbol) ?? "this token"}
          hooks={isHookAcked(activePlan) ? [] : activeHookWarnings}
          scannerLines={scanNeedsAck ? modalScannerSignals.map(({ signal }) =>
            hasIncompleteSellCoverage(signal) && signal.kind === "verdict" && signal.tier.toUpperCase() === "CLEAR"
              ? `${securitySignalText(signal)} We could not confirm every sell route, so whether you can sell is not known.`
              : securitySignalText(signal)) : []}
          critical={modalCritical}
          onCancel={() => setWarningsOpen(false)}
          onConfirm={(remember) => {
            for (const key of [hookAckKey(activePlan), modalCritical ? null : scanAckKey]) {
              if (!key) continue;
              hookAckedRef.current.add(key);
              if (remember) setWarningSuppressed(ROBINHOOD_CHAIN_ID, key, true);
            }
            setHookAckVersion((v) => v + 1);
            setWarningsOpen(false);
            void handleTrade();
          }}
        />
      )}
      {/* Swap heading, trade mode and one-tap settings access. */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0" data-drag-region>
          <h2 className="flex items-baseline gap-1.5 text-xl font-semibold leading-6 tracking-[-0.035em] text-[#f1f3ee]">
            Swap
            <a
              href="/methodology#swap"
              title="What Swap V1 does, and what it does not promise"
              className="inline-flex items-center gap-0.5 text-xs font-semibold tracking-[0.04em] text-[#ccff00] underline decoration-[#ccff00]/40 underline-offset-2 hover:decoration-[#ccff00]"
            >
              V1
              <Info className="size-3 opacity-70" aria-hidden="true" />
            </a>
          </h2>
          <p className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium leading-4 tracking-[0.12em] text-[#8c928c]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/robinhood.svg" alt="Robinhood Chain" className="size-3 flex-none object-contain" />
            <span className="truncate">ROBINHOOD CHAIN · 4663</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {chartAction}
          <div className="flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-[#171919] p-1">
          <button
            type="button"
            onClick={() => {
              if (mode !== "buy") {
                toggleMode();
              }
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === "buy"
                ? "bg-[#ccff00] text-[#0a0b0b] shadow-[0_2px_12px_#ccff0026]"
                : "text-[#a1a69f] hover:text-[#f3f4ef]"
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode !== "sell") {
                toggleMode();
              }
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === "sell"
                ? "bg-[#e0897a] text-[#0a0b0b]"
                : "text-[#a1a69f] hover:text-[#f3f4ef]"
            }`}
          >
            Sell
          </button>
        </div>

        <div className="relative">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleResetSwap}
              disabled={isPendingBroadcast}
              title="Reset swap (clear and fresh token)"
              aria-label="Reset swap"
              className="grid size-9 place-items-center rounded-full border border-white/[0.08] bg-[#171919] text-[#c5c9c3] hover:border-white/20 hover:text-[#ccff00] transition-colors disabled:opacity-50"
            >
              <Eraser className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleRefreshQuote}
              disabled={isFetchingPlan || isPendingBroadcast}
              title="Refresh quote"
              aria-label="Refresh quote"
              className="grid size-9 place-items-center rounded-full border border-white/[0.08] bg-[#171919] text-[#c5c9c3] hover:border-white/20 hover:text-[#ccff00] transition-colors disabled:opacity-50"
            >
              <RefreshCcwDot className={`size-4 ${isFetchingPlan ? "animate-spin text-[#ccff00]" : ""}`} />
            </button>
            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => setShowSettingsPopover((open) => !open)}
              aria-label={showSettingsPopover ? "Hide trade settings" : "Show trade settings"}
              aria-expanded={showSettingsPopover}
              className={`grid size-9 place-items-center rounded-full border transition-colors ${
                showSettingsPopover
                  ? "border-[#ccff00]/35 bg-[#1b2113] text-[#ccff00]"
                  : "border-white/[0.08] bg-[#171919] text-[#c5c9c3] hover:border-white/20 hover:text-white"
              }`}
            >
              <SlidersHorizontal className="size-4" />
            </button>
          </div>

          <AnimatePresence>
            {showSettingsPopover && (
              <motion.div
                ref={settingsPopoverRef}
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-12 z-50 w-72 sm:w-80 rounded-2xl border border-white/[0.1] bg-[#111313]/95 backdrop-blur-xl p-4 shadow-2xl space-y-4"
              >
                {/* Header with Title and Reset Button */}
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.07]">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#ededea]">
                    Settings
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowSettingsPopover(false)}
                      className="text-[#8a908a] hover:text-white transition-colors"
                      title="Close settings"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Slippage Tolerance */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#c4c9c2]">Max slippage</span>
                    <span className="text-xs font-mono font-bold text-[#facc15]">
                      {slippage === "auto" && !isCustomSlippage
                        ? activePlan?.slippageMode === "auto" ? `Auto (${activePlan.slippageBps / 100}%)` : AUTO_SLIPPAGE_LABEL
                        : isCustomSlippage
                        ? `${customSlippageInput || "0"}%`
                        : `${slippage}%`}
                    </span>
                  </div>

                  {/* Presets + Custom */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePresetSlippageChange("auto")}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                        slippage === "auto" && !isCustomSlippage
                          ? "bg-[#ccff00] text-black shadow-[0_0_10px_rgba(204,255,0,0.3)]"
                          : "border border-white/[0.08] bg-white/[0.03] text-[#a5aba3] hover:text-white"
                      }`}
                    >
                      Auto
                    </button>
                    {[0.1, 0.5, 1.0].map((preset) => {
                      const isSelected = !isCustomSlippage && slippage === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handlePresetSlippageChange(preset)}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                            isSelected
                              ? "bg-[#ccff00] text-black shadow-[0_0_10px_rgba(204,255,0,0.3)]"
                              : "border border-white/[0.08] bg-white/[0.03] text-[#a5aba3] hover:text-white"
                          }`}
                        >
                          {preset}%
                        </button>
                      );
                    })}
                    <div className="relative w-20">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Custom"
                        value={isCustomSlippage ? customSlippageInput : ""}
                        onChange={(e) => handleCustomSlippageChange(e.target.value)}
                        className={`w-full rounded-lg border py-1.5 pr-5 pl-2 text-right font-mono text-xs font-semibold transition-all focus:outline-none ${
                          isCustomSlippage
                            ? "border-[#ccff00] bg-[#1a2012] text-[#facc15]"
                            : "border-white/[0.08] bg-white/[0.03] text-[#a5aba3] placeholder-[#666] focus:border-[#ccff00]"
                        }`}
                      />
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#888]">
                        %
                      </span>
                    </div>
                  </div>
                </div>

              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      </div>

      {/* Pay Row */}
      <div className="space-y-3 rounded-[22px] border border-white/[0.07] bg-[#080909] p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium leading-5 text-[#a8ada7]">
            You pay
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs leading-5 text-[#8c928c]">
              Balance: <span className="tabular-nums text-[#c4c9c2]">{payBalanceLabel}</span>
            </span>
            <button
              type="button"
              onClick={useMax}
              className="rounded-full border border-white/[0.09] bg-white/[0.045] px-3 py-1 text-[11px] leading-4 font-semibold text-[#d8dcd5] hover:border-[#ccff00]/35 hover:text-[#ccff00] transition-colors"
            >
              MAX
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2.5">
          {/* Centered amount input and USD helper underneath */}
          <div className="min-w-0 flex-1">
            <div
              onClick={() => {
                inputRef.current?.focus();
                const len = inputRef.current?.value.length ?? 0;
                inputRef.current?.setSelectionRange(len, len);
                setCaretOn(true);
              }}
              className="relative flex h-[60px] min-w-0 flex-1 cursor-text items-center overflow-x-auto no-scrollbar"
            >
              <input
                ref={inputRef}
                value={raw}
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                onFocus={() => setCaretOn(true)}
                onBlur={() => setCaretOn(false)}
                onChange={(e) => emit(e.target.value)}
                placeholder="0.0"
                aria-label="amount"
                className="absolute h-px w-px opacity-0"
              />
              <motion.div
                style={{ fontSize }}
                className="inline-flex min-w-0 items-center font-sans font-semibold leading-none tracking-[-0.045em] tabular-nums text-[#f4f5f1] whitespace-nowrap"
              >
                <InputNumberScroll value={raw} placeholderColor="text-[#888888]" />
                <span
                  aria-hidden
                  className={`amt-caret ml-[2px] inline-block w-[2.5px] h-[1.1em] rounded-full bg-[#ccff00] shrink-0 ${
                    caretOn ? "animate-pulse" : "hidden"
                  }`}
                />
              </motion.div>
            </div>

            {/* USD estimate helper placed cleanly below the number */}
            <div className="mt-1 flex items-center min-h-[18px]">
              {payUsdVal !== null ? (
                <span
                  className="inline-flex items-center gap-1 select-none whitespace-nowrap text-xs font-medium leading-tight tabular-nums text-[#899087]"
                  title={`1 ${activePayToken.symbol} ≈ ${formatDexPrice(payTokenPrice)}. An estimate, refreshed about every 30 s.`}
                >
                  {`~$${payUsdVal < 0.01 ? payUsdVal.toFixed(4) : payUsdVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  <Info className="size-3 opacity-60" aria-hidden="true" />
                </span>
              ) : (
                <span className="select-none text-xs font-medium leading-tight text-[#525750]">~$0.00</span>
              )}
            </div>
          </div>

          {/* Uniswap-style Token Badge Selector */}
          <div className="flex shrink-0 items-center z-10 pl-2">

            <button
              type="button"
              onClick={() => setSelectorTarget("pay")}
              title="Select Pay Token"
              className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#171a19] px-3 py-2 transition-colors hover:border-white/20 hover:bg-[#202322] group"
            >
              {isUnselected(payToken) ? (
                <span className="px-1 text-sm font-semibold leading-5 text-[#ccff00]">Select token</span>
              ) : (
                <>
                  <TokenAvatar
                    key={`pay-${payToken.address || payToken.symbol}`}
                    token={payToken}
                    className="size-8"
                  />
                  <span className="text-sm font-medium leading-5 text-[#f1f3ee] group-hover:text-[#ccff00]">
                    {payToken.symbol}
                  </span>
                </>
              )}
              <ChevronDown className="size-3.5 text-[#a2a7a0] group-hover:text-[#ccff00] transition-colors" />
            </button>
          </div>
        </div>

        {/* Quick Amount Chips */}
        <div className="grid grid-cols-5 gap-2 pt-0.5">
          {[15, 25, 50, 75, 100].map((percentage) => (
            <button
              key={percentage}
              type="button"
              disabled={!canUsePercentPresets}
              aria-label={`${percentage}% of available ${activePayToken.symbol} balance`}
              title={
                !connectedWalletAddress
                  ? "Connect a wallet to use balance percentages"
                  : activePayToken.balanceStatus === "error"
                    ? "Balance is unavailable"
                    : canUsePercentPresets
                      ? `${percentage}% of available ${activePayToken.symbol}`
                      : "Loading balance"
              }
              onClick={() => {
                if (!canUsePercentPresets || activePayToken.rawBalance === undefined || activePayToken.rawBalance === null) {
                  setErrorMsg(
                    activePayToken.balanceStatus === "error"
                      ? `Unable to read ${activePayToken.symbol} balance from RPC.`
                      : "Balance is still loading. Please wait before using a percentage."
                  );
                  return;
                }

                let availableBalance = activePayToken.rawBalance;
                if (isNativePayToken) {
                  const maxResult = calculateMaxNativeAmount({
                    rawBalance: activePayToken.rawBalance,
                    measuredGasUsed:
                      activePlan?.simulation.status === "ok" ? activePlan.simulation.gasUsed : undefined,
                    gasPriceWei: liveGasPrice ?? undefined,
                  });
                  if (maxResult.usableAmountWei <= 0n) {
                    setErrorMsg(maxResult.reason || "Insufficient native balance to cover the gas reserve.");
                    return;
                  }
                  availableBalance = maxResult.usableAmountWei;
                }

                const amountBigInt = (availableBalance * BigInt(percentage)) / 100n;
                if (amountBigInt === 0n) {
                  setErrorMsg(`Your ${activePayToken.symbol} balance is too small for ${percentage}%.`);
                  return;
                }

                const formattedAmount = formatUnits(amountBigInt, payTokenDecimals);
                const [whole, fraction] = formattedAmount.split(".");
                const inputAmount = fraction
                  ? `${whole}.${fraction.slice(0, 18).replace(/0+$/, "")}`
                  : whole;
                emit(inputAmount, true);
              }}
              className="min-w-0 rounded-xl border border-white/[0.075] bg-[#141716] py-2 text-center text-xs font-medium leading-4 tabular-nums text-[#c2c8bf] transition-colors hover:border-[#ccff00]/35 hover:bg-[#1a2015] hover:text-[#e9f2db] disabled:cursor-not-allowed disabled:border-white/[0.035] disabled:bg-[#101212] disabled:text-[#555c55]"
            >
              {percentage}%
            </button>
          ))}
        </div>
      </div>

      {/* Flip Button */}
      <div className="relative z-10 -my-3.5 flex items-center justify-center">
        <div className="absolute inset-x-0 h-px bg-[#1e1e1e]" />
        <button
          type="button"
          onClick={toggleMode}
          title="Switch Pay / Receive"
          className="relative grid size-9 place-items-center rounded-full border border-white/[0.08] bg-[#171a19] text-[#c5c9c3] shadow-[0_8px_24px_#0008] transition-colors hover:border-[#ccff00]/50 hover:text-[#ccff00] cursor-pointer"
        >
          <ArrowDown className="size-4" />
        </button>
      </div>

      {/* Receive Panel (A03 / Requirement 1) */}
      <div className="space-y-3 rounded-[22px] border border-white/[0.07] bg-[#080909] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium leading-5 text-[#a8ada7]">
            {customExecute ? "Custom execution" : "You receive"}
          </span>
          <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4">
            <span className="shrink-0 text-[#858c84]">
              Balance: <span className="tabular-nums text-[#b8beb6]">{receiveBalanceLabel}</span>
            </span>
            {activePlan && (
              <span className="truncate font-medium text-[#899087]">
                {activePlan.simulation.status === "ok" ? "Simulated" : "Quoted"}
              </span>
            )}
          </div>
        </div>

        <div className="flex min-h-[56px] items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            {/* Fixed 60 px slots (here and on the pay side): the animated number is ~58 px at its
                largest font, the placeholder 20 px, and a changing height moved the whole card. */}
            <div className="flex h-[60px] items-center overflow-x-auto no-scrollbar">
              {customExecute ? (
                <span className="text-sm leading-5 text-[#e2e5df]">
                  Determined by custom contract on execution
                </span>
              ) : displayReceiveAmount !== null ? (
                <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
                  <span
                    style={{ fontSize: `${sizeForLength(displayLength(displayReceiveAmount))}px` }}
                    className="min-w-0 font-sans font-semibold leading-none tracking-[-0.045em] tabular-nums text-[#f4f5f1]"
                  >
                    <InputNumberScroll value={displayReceiveAmount} />
                  </span>
                </div>
              ) : isFetchingPlan && !busy ? (
                <div role="status" aria-label="Fetching live quote" className="flex h-[38px] items-center">
                  <span className="h-[30px] w-40 animate-pulse rounded-lg bg-white/[0.08]" />
                </div>
              ) : receiveScaleUnavailable ? (
                <span className="text-sm leading-5 text-[#a8ada7]">Token decimals unavailable</span>
              ) : (
                <span className="text-sm leading-5 text-[#a8ada7]">
                  {tokenMissing ? "Select a token" : amount ? "Review the quote to see an estimate" : "Enter an amount above"}
                </span>
              )}
            </div>

            {/* USD estimate helper placed cleanly below the receive quote */}
            <div className="mt-1 flex items-center min-h-[18px]">
              {receiveUsdVal !== null && (
                <span
                  className="inline-flex items-center gap-1 select-none whitespace-nowrap text-xs font-medium leading-tight tabular-nums text-[#899087]"
                  title={`1 ${receiveToken.symbol} ≈ ${formatDexPrice(receiveTokenPrice)}. An estimate, refreshed about every 30 s.`}
                >
                  {`~$${receiveUsdVal < 0.01 ? receiveUsdVal.toFixed(4) : receiveUsdVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  <Info className="size-3 opacity-60" aria-hidden="true" />
                </span>
              )}
            </div>
          </div>

          {/* Uniswap-style Token Badge Selector */}
          <div className="flex shrink-0 items-center z-10 pl-2">

            <button
              type="button"
              disabled={isReviewing || isPendingBroadcast}
              onClick={() => setSelectorTarget("receive")}
              title="Select Receive Token"
              className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#171a19] px-3 py-2 transition-colors hover:border-white/20 hover:bg-[#202322] group disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isUnselected(receiveToken) ? (
                <span className="px-1 text-sm font-semibold leading-5 text-[#ccff00]">Select token</span>
              ) : (
                <>
                  <TokenAvatar
                    key={`receive-${receiveToken.address || receiveToken.symbol}`}
                    token={receiveToken}
                    className="size-8"
                  />
                  <span className="text-sm font-medium leading-5 text-[#f1f3ee] group-hover:text-[#ccff00]">
                    {receiveToken.symbol}
                  </span>
                </>
              )}
              <ChevronDown className="size-3.5 text-[#a2a7a0] group-hover:text-[#ccff00] transition-colors" />
            </button>
          </div>
        </div>

        {activePlan && (
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.065] pt-2.5 text-xs leading-5">
            <span className="inline-flex items-center gap-1 text-[#858c84]" title={taxDisclosure.warningText || taxDisclosure.disclosureText}>
              {taxDisclosure.minOutLabel}
              <Info className="size-3 opacity-70" aria-hidden="true" />
            </span>
            <span className="text-right font-medium tabular-nums text-[#dce6c8]">
              {receiveScaleUnavailable
                ? "Unavailable"
                : `${formatBaseUnits(activePlan.minOut, activePlan.tokenOutDisplay.decimals)} ${receiveToken.symbol}`}
            </span>
          </div>
        )}
      </div>

      {activePlan && displayReceiveAmount !== null && amount && (
        <p className="break-words px-1 text-center text-xs leading-5 text-[#aeb4ac]">
          {amount} {payToken.symbol} <span className="px-1 text-[#727970]">≈</span> {displayReceiveAmount} {receiveToken.symbol}
        </p>
      )}

      {/* Trade Settings & Route Info (Truthful served PlanView values) */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d0f0f]">
        <button
          type="button"
          onClick={() => setShowTradeDetails((open) => !open)}
          aria-expanded={showTradeDetails}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.025]"
        >
          <span className="text-sm font-medium text-[#d8dcd5]">Trade details</span>
          <span className="flex items-center gap-2 text-xs text-[#a5aba3]">
            {activePlan && (
              <span className={isLargeEstimatedPriceImpact(activePlan.priceImpactBps) ? "font-semibold text-[#ff8a8a]" : undefined}>
                Impact {activePlan.priceImpactBps == null ? "n/a" : formatPriceImpact(activePlan.priceImpactBps).formatted} ·
              </span>
            )}
            Max slippage {formatTruthfulSlippageLabel({
              isManual: isCustomSlippage || slippage !== "auto",
              manualBps: isCustomSlippage
                ? customParsed.valid ? customParsed.bps : null
                : slippage === "auto" ? null : Math.round(slippage * 100),
              activePlan,
            })}
            <ChevronDown className={`size-3.5 transition-transform ${showTradeDetails ? "rotate-180" : ""}`} />
          </span>
        </button>
        {showTradeDetails && <div className="space-y-2 border-t border-white/[0.06] px-4 py-3 text-xs leading-[1.618]">
        <div>
          <div className="flex items-center justify-between text-[#f0f0f0]">
            <span>Max Slippage</span>
            {!isEditingSlippage ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[#facc15] font-bold">
                  {formatTruthfulSlippageLabel({
                    isManual: isCustomSlippage || slippage !== "auto",
                    manualBps: isCustomSlippage
                      ? customParsed.valid ? customParsed.bps : null
                      : slippage === "auto" ? null : Math.round(slippage * 100),
                    activePlan,
                  })}
                </span>
                {(isCustomSlippage || slippage !== "auto") && (
                  <button
                    type="button"
                    onClick={handleResetSettings}
                    title="Reset slippage to Auto"
                    className="flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[11px] font-semibold text-[#a5aba3] hover:border-[#ccff00]/40 hover:text-[#ccff00] transition-colors"
                  >
                    <Undo2 className="size-2.5" />
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  disabled={isPendingBroadcast}
                  onClick={() => handleCustomSlippageChange(customSlippageInput)}
                  aria-label="Edit slippage"
                  className="p-0.5 rounded text-white hover:text-[#ccff00] transition-colors"
                >
                  <Pencil className="size-3 text-[#ccff00]" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <label htmlFor="custom-slippage-input" className="sr-only">
                  Custom max slippage percentage
                </label>
                <input
                  id="custom-slippage-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Custom"
                  autoComplete="off"
                  aria-label="Custom max slippage percentage"
                  aria-invalid={isCustomSlippage && !customParsed.valid}
                  disabled={isPendingBroadcast}
                  value={customSlippageInput}
                  onChange={(e) => handleCustomSlippageChange(e.target.value)}
                  onBlur={() => {
                    if (customParsed.valid) {
                      setIsEditingSlippage(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customParsed.valid) {
                      setIsEditingSlippage(false);
                    }
                  }}
                  autoFocus
                  className="w-14 bg-transparent text-right outline-none font-mono text-xs leading-5 border-b border-[#333] focus:border-[#ccff00] disabled:cursor-not-allowed text-[#facc15] font-bold"
                />
                <span className="text-xs leading-5 text-[#facc15] font-bold">%</span>
              </div>
            )}
          </div>
          {/* L213 #25: judged per keystroke, "1." on the way to "1.5" toasted as invalid. Inline, not a toast. */}
          {isEditingSlippage && customSlippageError && !/^\d*\.?$/.test(customSlippageInput.trim()) && (
            <p className="mt-1 text-right text-[11px] leading-4 text-[#ff8a8a]">{customSlippageError}</p>
          )}
        </div>

        <div className="flex items-center justify-between text-[#f0f0f0]">
          <span>Routing Venue</span>
          <span className="text-white font-medium">
            {customExecute
              ? "Custom Contract Execution"
              : activePlan
              ? formatVenueDisplay(activePlan.venue, activePlan.protocol)
              : "Route selected after quote"}
          </span>
        </div>

        <div className="flex items-center justify-between text-[#f0f0f0]">
          <span>Estimated Price Impact</span>
          <span className={isLargeEstimatedPriceImpact(activePlan?.priceImpactBps) ? "text-amber-300 font-bold" : "text-[#f0f0f0]"}>
            {activePlan?.priceImpactBps == null ? "Unavailable" : formatPriceImpact(activePlan.priceImpactBps).formatted}
          </span>
        </div>
        {activePlan?.poolFeeBps !== undefined && !severeImpact && (
          <p className="rounded-md border border-amber-400/35 bg-amber-950/20 px-2.5 py-2 text-xs leading-5 text-amber-100">
            This route goes through a pool that charges {formatPriceImpact(activePlan.poolFeeBps).formatted} on every swap, far above the usual 1% or less. That fee is included in the price impact above.
          </p>
        )}
        {isLargeEstimatedPriceImpact(activePlan?.priceImpactBps) && activePlan?.poolFeeBps === undefined && (
          <p className="rounded-md border border-amber-400/35 bg-amber-950/20 px-2.5 py-2 text-xs leading-5 text-amber-100">
            This quote estimates at least 5% size impact against a small quote on the same route. Review the output before continuing; this warning does not block the trade.
          </p>
        )}

        {activePlan && (
          <>
            <div className="space-y-1 rounded-lg bg-white/[0.025] px-2.5 py-2 text-[#f0f0f0]" aria-label="Selected route fees">
              {selectedPoolFeeSummary(activePlan).map((fee, index) => {
                const plainLabel = fee.label
                  .replace(/pool fee/i, "Pool Fee (Paid to LPs)")
                  .replace(/hook fee/i, "Hook Fee (DEX Contract)");
                return (
                  <div key={`${fee.label}-${index}`} className="flex items-center justify-between gap-3">
                    <span className="text-[#a6ada4]">{plainLabel}</span>
                    <span className="text-right font-medium tabular-nums text-[#d8dcd5]">{fee.value}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-[#f0f0f0] pt-0.5 border-t border-[#1e1e1e]/60">
              <span>Quote Status</span>
              <div className="flex items-center gap-2">
                <span className={isPlanExpired(activePlan) ? "text-[#e0897a] font-bold" : "text-[#8fbf6a] font-bold"}>
                  {isPlanExpired(activePlan) ? "Expired, run a fresh quote" : "Fresh"}
                </span>
              </div>
            </div>
          </>
        )}
        </div>}
      </div>

      {/* Main Action Buttons (Two-step Review Workflow - A03 / Requirement 2) */}
      <div className="space-y-2">
        {isReviewing && (modalCritical || scanNeedsAck) && visibleSecuritySignals.some(({ signal }) => signal.kind !== "verdict" || !signal.currentFormula || signal.tier.toUpperCase() === "CRITICAL" || signal.honeypot?.status.toUpperCase() === "CRITICAL" || hasConclusiveBlockedRoute(signal) || hasIncompleteSellCoverage(signal) || plannedBlockedRouteMatches(activePlan, signal).length > 0) && (
          <div className="space-y-2" aria-label="Scanner risk warnings">
            {visibleSecuritySignals.filter(({ signal }) => signal.kind !== "verdict" || !signal.currentFormula || signal.tier.toUpperCase() === "CRITICAL" || signal.honeypot?.status.toUpperCase() === "CRITICAL" || hasConclusiveBlockedRoute(signal) || hasIncompleteSellCoverage(signal) || plannedBlockedRouteMatches(activePlan, signal).length > 0).map(({ address, signal }) => {
              const selectedRouteBlockedMatches = plannedBlockedRouteMatches(activePlan, signal);
              const critical = signal.kind === "verdict" &&
                (signal.honeypot?.status.toUpperCase() === "CRITICAL" || signal.tier.toUpperCase() === "CRITICAL" || hasConclusiveBlockedRoute(signal) || selectedRouteBlockedMatches.length > 0);
              const token = [payToken, receiveToken].find((candidate) => candidate.address.toLowerCase() === address);
              return (
                <div key={address} role="alert" className={`rounded-xl border p-3 text-xs leading-5 ${critical ? "border-red-500/50 bg-red-950/40 text-red-100" : "border-[#ff5c5c]/35 bg-[#2a1010] text-[#ffd6d6]"}`}>
                  <div className="font-mono font-bold">{securitySignalText(signal)}{token ? ` (${token.symbol})` : ""}</div>
                  {selectedRouteBlockedMatches.map((route, index) => <p key={`selected-${route.poolId ?? index}`} className="mt-1 font-bold text-red-100">Selected route uses a pool where the scanner observed sells being blocked. Pool: {route.poolId}{route.protocol ? ` · ${route.protocol}` : ""}. A successful quote or simulation does not establish that a later sell will work.</p>)}
                  {hasIncompleteSellCoverage(signal) && <p className="mt-1 font-semibold">{signal.kind === "verdict" ? signal.honeypot?.sellCoverageReason ?? "Sell-route check incomplete; exitability unknown." : "Sell-route check incomplete; exitability unknown."}</p>}
                  {conclusiveBlockedRoutes(signal).map((route, index) => (
                    <p key={`${route.poolId ?? "route"}-${index}`} className="mt-1 font-semibold text-red-100">
                      Sell blocked on this route; token-wide result unresolved. Pool: {route.poolId ?? "pool ID unavailable"}{route.protocol ? ` · ${route.protocol}` : ""}
                    </p>
                  ))}
                  {securityScanTimestamp(signal) && <p className="mt-1 text-[#c4c8bf]">{securityScanTimestamp(signal)}</p>}
                  <p className="mt-1 text-[#deded5]">{activePlan?.simulation.status === "ok" ? "The displayed route was simulated and is executable, but that does not clear token-level scanner risk." : "This route still requires approval or signature and exact swap simulation. Neither would clear token-level scanner risk."}</p>
                  <a href={`/scan/${address}?rescan=1`} className="mt-1 inline-flex font-semibold underline underline-offset-2">Open fresh token scan →</a>
                </div>
              );
            })}
          </div>
        )}
        {severeImpact && activePlan && !isReviewing && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#ff5c5c]/40 bg-[#2a1010] p-3 text-xs leading-5 text-[#ffd6d6]">
            <input
              type="checkbox"
              checked={impactAckKey === impactKey}
              onChange={(e) => setImpactAckKey(e.target.checked ? impactKey : null)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#ff5c5c]"
            />
            <span>
              {activePlan.poolFeeBps !== undefined
                ? `This route goes through a pool that charges a ${formatPriceImpact(activePlan.poolFeeBps).formatted} fee on every swap. You lose at least ${formatPriceImpact(activePlan.priceImpactBps!).formatted} of this trade. Tick to continue anyway.`
                : `This trade loses about ${formatPriceImpact(activePlan.priceImpactBps!).formatted} to price impact. The pool is too small for this amount. Tick to continue anyway.`}
            </span>
          </label>
        )}
        {activePlan?.advice?.length ? (
          <p className={`rounded-xl border p-3 text-xs leading-5 ${activePlan.advice[0].kind === "use-usdg" ? "border-white/10 bg-white/[0.04] text-[#b7bdb3]" : "border-[#f5b942]/35 bg-[#f5b942]/10 text-[#f5c96a]"}`}>
            {adviceSentence(activePlan.advice[0])}
          </p>
        ) : null}
        {(!wallet.isConnected || !wallet.address) ? (
          <motion.button
            key={`connect-${connectNudge}`}
            initial={{ x: 0 }}
            animate={connectNudge > 0 ? { x: [0, -10, 10, -7, 7, -3, 3, 0] } : { x: 0 }}
            transition={{ duration: 0.55, ease: "easeInOut" }}
            whileTap={{ scale: 0.98 }}
            type="button"
            disabled={wallet.isLoading}
            onMouseEnter={wallet.prepare}
            onTouchStart={wallet.prepare}
            onPointerDown={wallet.prepare}
            onClick={handleConnectWallet}
            className={`flex w-full items-center justify-center gap-2 rounded-full py-4 text-[15px] leading-5 font-semibold tracking-[-0.01em] transition-all shadow-[0_12px_34px_#ccff0018] ${
              connectNudge > 0 && amount
                ? "border border-[#ff5c5c] bg-[#ff5c5c] text-[#0a0b0b] hover:bg-[#ff4040]"
                : mode === "buy"
                ? "border border-[#ccff00] bg-[#ccff00] text-[#0a0b0b] hover:bg-[#b8e600]"
                : "border border-[#e0897a] bg-[#e0897a] text-[#0a0b0b] hover:bg-[#cf7869]"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {wallet.isLoading ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                <span>CONNECTING…</span>
              </>
            ) : (
              <span>CONNECT WALLET</span>
            )}
          </motion.button>
        ) : isReviewing ? (
          <div className="space-y-1.5">
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              disabled={busy !== null || isPendingBroadcast || isCustomSlippageInvalid ||
                (activeHookWarnings.length > 0 &&
                  (activePlan?.steps[0]?.kind === "swap" || activePlan?.steps[0]?.kind === "batch") && !canProceedWithHookStep(activePlan, true, "swap"))}
              onClick={confirmTrade}
            className={`flex w-full items-center justify-center gap-2 rounded-full py-4 text-[15px] leading-5 font-semibold tracking-[-0.01em] transition-all shadow-[0_12px_34px_#ccff0018] ${
                mode === "buy"
                  ? "border border-[#ccff00] bg-[#ccff00] text-[#0a0b0b] hover:bg-[#b8e600]"
                  : "border border-[#e0897a] bg-[#e0897a] text-[#0a0b0b] hover:bg-[#cf7869]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  <span>{busy}</span>
                </>
              ) : isPendingBroadcast ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  <span>CONFIRMING TRANSACTION ON-CHAIN...</span>
                </>
              ) : isPlanExpired(activePlan) ? (
                <>
                  <RefreshCw className="size-3.5" />
                  <span>QUOTE EXPIRED · REFRESH</span>
                </>
              ) : (
                <>
                  <Zap className="size-3.5" />
                  <span>CONFIRM &amp; EXECUTE {mode.toUpperCase()}</span>
                </>
              )}
            </motion.button>

            <button
              type="button"
              disabled={busy !== null || isPendingBroadcast}
              onClick={() => {
                setIsReviewing(false);
                setActivePlan(null);
                setPlanNotice(null);
              }}
              className="w-full py-1.5 text-center font-mono text-xs leading-5 text-[#a3a3a3] hover:text-[#e5e5e5] transition-colors "
            >
              ← Cancel review and edit trade
            </button>
          </div>
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            disabled={
              busy !== null ||
              isPendingBroadcast ||
              isFetchingPlan ||
              isCustomSlippageInvalid ||
              !amount ||
              !/^\d+(\.\d+)?$/.test(amount.trim()) ||
              amount.trim() === "0" ||
              /^0+(\.0+)?$/.test(amount.trim()) ||
              walletShort ||
              tokenMissing ||
              impactBlocked
            }
            onClick={() => currentQuoteFailed ? fetchQuoteRef.current(amount.trim()) : handleTrade()}
              className={`flex w-full items-center justify-center gap-2 rounded-full py-4 text-[15px] leading-5 font-semibold tracking-[-0.01em] transition-all shadow-[0_12px_34px_#ccff0018] ${
                mode === "buy"
                  ? "border border-[#ccff00] bg-[#ccff00] text-[#0a0b0b] hover:bg-[#b8e600]"
                  : "border border-[#e0897a] bg-[#e0897a] text-[#0a0b0b] hover:bg-[#cf7869]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                <span>{busy}</span>
              </>
            ) : unconfirmedTx ? (
              <>
                <RefreshCw className="size-3.5" />
                <span>RESOLVE PENDING TX ({unconfirmedTx.hash.slice(0, 6)}…{unconfirmedTx.hash.slice(-4)})</span>
              </>
            ) : tokenMissing ? (
              <span>SELECT A TOKEN</span>
            ) : isFetchingPlan ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>FETCHING LIVE QUOTE...</span>
              </>
            ) : !amount || !/^\d+(\.\d+)?$/.test(amount.trim()) || amount.trim() === "0" || /^0+(\.0+)?$/.test(amount.trim()) ? (
              <span>ENTER {payToken.symbol} AMOUNT</span>
            ) : isCustomSlippageInvalid ? (
              <span>INVALID SLIPPAGE</span>
            ) : walletShort ? (
              <span>NOT ENOUGH {payToken.symbol}</span>
            ) : currentQuoteFailed ? (
              <span>RETRY QUOTE</span>
            ) : customExecute ? (
              <>
                <Zap className="size-3.5" />
                <span>EXECUTE {mode.toUpperCase()}</span>
              </>
            ) : (
              <span>Review swap</span>
            )}
          </motion.button>
        )}

        <p className="flex items-center justify-center gap-1 text-center text-[11px] leading-4 text-[#858b84]">
          <Shield className="size-2.5 flex-none" />
          Non-custodial swap · Robinhood Chain
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d0f0f]">
        <button
          type="button"
          onClick={() => setShowTokenSecurity((open) => !open)}
          aria-expanded={showTokenSecurity}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.025]"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-[#d8dcd5]">
            <Shield className="size-4 text-[#aeb5a9]" />
            Token security
          </span>
          <span className="flex items-center gap-2 text-xs text-[#a5aba3]">
            {scanChip ? <span className={scanChip.tone}>{scanChip.text}</span> : "Details"}
            <ChevronDown className={`size-3.5 transition-transform ${showTokenSecurity ? "rotate-180" : ""}`} />
          </span>
        </button>
        {showTokenSecurity && (
          <div
            role={(quickCheckResult && !quickCheckResult.exempt) || lpCustodyShown ? "status" : undefined}
            className="space-y-2.5 border-t border-white/[0.06] px-4 py-3 text-xs leading-5 text-[#9da49b]"
          >
            {/* L213: one fixed order, each fact once. 1 quick check, 2 hook, 3 full scan, 4 one link. */}
            {mode === "buy" && (quickCheckResult?.exempt ? null : (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 font-medium text-[#d8dcd5]"><ScanSearch className="size-3.5 text-[#aeb5a9]" />Quick check</span>
                  {quickCheckResult ? (
                    <StatusPill tone={quickCheckResult.statusTone === "warn" ? "bad" : quickCheckResult.statusTone === "amber" ? "warn" : "muted"}>
                      {quickCheckPill(quickCheckResult.status)}
                    </StatusPill>
                  ) : <StatusPill tone="muted">Runs on review</StatusPill>}
                </div>
                <p className={quickCheckResult?.statusTone === "warn" ? "text-[#ff8a8a]" : quickCheckResult?.statusTone === "amber" ? "text-[#ffc2c2]" : undefined}>
                  {quickCheckResult ? `${quickCheckResult.statusText}.` : "Reads the contract's owner, pause and proxy slots when you review this buy."}
                </p>
              </div>
            ))}
            {lpCustodyShown && lpCustodyResult && (
              <div className="space-y-1" aria-label="Pool liquidity ownership">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[#d8dcd5]">Pool liquidity ownership</span>
                  <StatusPill tone={lpCustodyResult.status === "complete" ? "muted" : lpCustodyResult.status === "faulted" || lpCustodyResult.status === "incomplete" ? "warn" : "muted"}>
                    {lpCustodyResult.status === "complete" ? "Read at block " + lpCustodyResult.asOfBlock
                      : lpCustodyResult.status === "checking" ? "Checking"
                      : lpCustodyResult.status === "not-checked" ? "Not checked"
                      : lpCustodyResult.status === "incomplete" ? "Incomplete" : "Unavailable"}
                  </StatusPill>
                </div>
                <p>
                  {lpCustodyResult.status === "complete" ? lpCustodyResult.summary
                    : lpCustodyResult.status === "checking" ? "Checking who holds this pool's liquidity."
                    : lpCustodyResult.status === "not-checked" ? lpCustodyResult.reason ?? "Not checked yet."
                    : lpCustodyResult.status === "incomplete" ? "Could not account for all of this pool's active liquidity, so who can remove it is unknown."
                    : "Could not read who holds this pool's liquidity."}
                </p>
              </div>
            )}
            {activeHookWarnings.length > 0 && activePlan && (
              <div className="space-y-1.5 rounded-lg border border-[#ff5c5c]/35 bg-[#2a1010] p-2.5 text-[#ffd6d6]" aria-label="V4 hook">
                {activeHookWarnings.map((hook) => (
                  <div key={`${hook.address}-${hook.pool ?? "pool"}`} className="space-y-1.5">
                    <p>This pool runs a custom hook, a contract that executes on swaps. It can act {hook.permissions.length ? hook.permissions.join(", ") : "with no decoded callbacks"}.{hook.dynamicFee ? " Its fee can change per swap." : ""}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <CopyAddressChip compact label="Hook" address={hook.address} />
                      {hook.pool && (
                        <CopyAddressChip compact label="Pool" address={hook.pool}
                          explorerHref={`https://www.geckoterminal.com/robinhood/pools/${hook.pool}`} explorerTitle="View pool on GeckoTerminal" />
                      )}
                    </div>
                    <HookDetails address={hook.address} />
                  </div>
                ))}
              </div>
            )}
            {activePlan?.mainPoolSell && (() => {
              const m = activePlan.mainPoolSell;
              const size = m.liquidityUsd !== null ? ` ($${Math.round(m.liquidityUsd).toLocaleString("en-US")} listed)` : "";
              return (
                <div className="space-y-1.5" aria-label="Main pool">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 font-medium text-[#d8dcd5]"><ShieldAlert className="size-3.5 text-[#ff8a8a]" />Main pool</span>
                    <StatusPill tone="bad">Sells fail</StatusPill>
                  </div>
                  <p className="text-[#ff8a8a]">
                    This token&apos;s biggest pool{size} did not let a sell through{m.source === "scan" ? " in its latest full scan" : " in our test just now"}. This quote uses a different pool. Selling later may only work through smaller pools.
                  </p>
                  <p className="break-words text-[#ffc2c2]">{m.reason}</p>
                  <CopyAddressChip compact label="Pool" address={m.pool}
                    explorerHref={`https://www.geckoterminal.com/robinhood/pools/${m.pool}`} explorerTitle="View pool on GeckoTerminal" />
                </div>
              );
            })()}
            {activePlan?.mainPoolPrice && (() => {
              const m = activePlan.mainPoolPrice;
              const size = m.liquidityUsd !== null ? ` ($${Math.round(m.liquidityUsd).toLocaleString("en-US")} listed)` : "";
              const x = (m.shortfallBps / 100).toFixed(1);
              return (
                <div className="space-y-1.5" aria-label="Price vs main pool">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 font-medium text-[#d8dcd5]"><ShieldAlert className="size-3.5 text-[#f5b942]" />Price vs main pool</span>
                    <StatusPill tone="warn">{`${(m.shortfallBps / 100).toFixed(1)}% worse`}</StatusPill>
                  </div>
                  <p className="text-[#f5c96a]">
                    {mode === "sell"
                      ? `This quote does not use this token's biggest pool${size}. At this size you would receive ${x}% less than that pool would pay.`
                      : `This quote does not use this token's biggest pool${size}. At this size it gives you ${x}% fewer tokens than that pool would.`}
                  </p>
                  <CopyAddressChip compact label="Pool" address={m.pool}
                    explorerHref={`https://www.geckoterminal.com/robinhood/pools/${m.pool}`} explorerTitle="View pool on GeckoTerminal" />
                </div>
              );
            })()}
            {mode === "buy" && activePlan && (activeHookWarnings.length > 0 || activePlan.hookRoundTrip || (activePlan.unscanned && activePlan.simulation.status === "pending-approval")) && (() => {
              const rt = activePlan.hookRoundTrip;
              const measured = rt?.status === "measured" || rt?.status === "warning";
              const lossPct = ((rt?.lossBps ?? 0) / 100).toFixed(2);
              return (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 font-medium text-[#d8dcd5]"><Repeat2 className="size-3.5 text-[#aeb5a9]" />Sell test</span>
                    {measured ? <StatusPill tone={rt?.status === "warning" ? "warn" : "muted"}>{lossPct}% round trip</StatusPill>
                      : activePlan.simulation.status === "pending-approval" ? <StatusPill tone="muted">After approval</StatusPill>
                        : <StatusPill tone="warn">Did not run</StatusPill>}
                  </div>
                  <p className={rt?.status === "warning" ? "text-[#ffc2c2]" : undefined}>
                    {measured
                      ? <>Bought then sold straight back: {formatBaseUnits(activePlan.amountIn, activePlan.tokenInDisplay.decimals)} {activePlan.tokenInDisplay.symbol ?? ""} in, {rt?.recovered ? formatBaseUnits(rt.recovered, activePlan.tokenInDisplay.decimals) : "unknown"} back. A sale now does not guarantee a later one.</>
                      : activePlan.simulation.status === "pending-approval"
                        ? "The buy then sell test runs after the approval or signature."
                        : "The buy then sell test did not run, so whether this token sells is not known."}
                  </p>
                </div>
              );
            })()}
            {canOpenSecurityScan && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 font-medium text-[#d8dcd5]"><ShieldCheck className="size-3.5 text-[#aeb5a9]" />Full scan</span>
                  {scanState === "unscanned" ? <StatusPill tone="bad">Not scanned</StatusPill>
                    : scanState === "unknown" ? <StatusPill tone="warn">Unavailable</StatusPill>
                      : subjectSignal?.kind === "verdict" ? (
                        <StatusPill tone={tierTone(subjectSignal)}>{verdictPillText(subjectSignal)}</StatusPill>
                      ) : null}
                </div>
                {scanState === "unscanned" && <p className="text-[#ff8a8a]">Not scanned yet. The risk is unknown.</p>}
                {scanState === "unknown" && <p className="text-[#ffc2c2]">The saved scan could not be loaded. The risk is unknown.</p>}
                {visibleSecuritySignals.filter(({ signal }) => signal.kind === "verdict" && !(isReviewing && (modalCritical || scanNeedsAck) && modalScannerSignals.some((m) => m.signal === signal))).map(({ address, signal }) => {
                  const selectedBlocked = plannedBlockedRouteMatches(activePlan, signal);
                  const other = address !== scanSubject ? [payToken, receiveToken].find((t) => t.address.toLowerCase() === address) : null;
                  const detail = securityDetailText(signal);
                  return (
                    <div key={`scanner-${address}`} className="space-y-1.5">
                      {other && signal.kind === "verdict" && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[#aeb5a9]">{other.symbol}</span>
                          <StatusPill tone={tierTone(signal)}>{verdictPillText(signal)}</StatusPill>
                        </div>
                      )}
                      {detail && <p className={isCriticalSignal(signal) ? "font-semibold text-red-200" : "text-[#ffc2c2]"}>{detail}</p>}
                      {selectedBlocked.map((route, index) => <p key={`selected-${route.poolId ?? index}`} className="font-semibold text-red-200">The selected route uses a pool where the scanner saw sells blocked. A working quote does not mean a later sell will work.</p>)}
                      {hasIncompleteSellCoverage(signal) && <p className="font-semibold text-[#ffc2c2]">{signal.kind === "verdict" ? signal.honeypot?.sellCoverageReason ?? "We could not confirm every sell route, so whether you can sell is not known." : "We could not confirm every sell route, so whether you can sell is not known."}</p>}
                      {conclusiveBlockedRoutes(signal).map((route, index) => (
                        <p key={`${route.poolId ?? "route"}-${index}`} className="font-semibold text-red-200">Sell blocked on one route{route.protocol ? ` (${route.protocol})` : ""}. Whether the token sells elsewhere is unresolved.</p>
                      ))}
                      {signal.kind === "verdict" && (signal.highlights ?? []).length > 0 && (
                        <ul className="space-y-1.5 rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
                          {(signal.highlights ?? []).map((h) => (
                            <li key={`${address}-${h.id}`} className="flex items-start gap-2">
                              <StatusPill tone={h.status === "FAIL" ? "bad" : h.status === "WARN" ? "warn" : "muted"}>{h.status}</StatusPill>
                              <span className="min-w-0 break-words"><span className="font-medium text-[#d8dcd5]">{h.name}.</span> {h.reason}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {securityScanTimestamp(signal) && <p className="text-[#8c928c]">{securityScanTimestamp(signal)}</p>}
                    </div>
                  );
                })}
                <a
                  href={`/scan/${securityScanAddress}?rescan=1`}
                  className="inline-flex items-center gap-1 font-medium text-[#dce6c8] underline decoration-white/25 underline-offset-2 hover:text-[#ccff00]"
                >
                  {scanState === "unscanned" ? "Run a full scan" : "Open the full scan"} <span aria-hidden="true">→</span>
                </a>
              </div>
            )}
            <p className="border-t border-white/[0.06] pt-2 text-[#8c928c]">Neither check establishes that a token is safe.</p>
          </div>
        )}
      </div>

      {/*
        ========================================================================
        UNISWAP-STYLE TOKEN SELECTION INTERFACE (OVERLAY DRAWER)
        ========================================================================
      */}
      <AnimatePresence>
        {selectorTarget && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-30 flex flex-col rounded-2xl bg-[#0c0c0c] p-3 text-[#ededea] border border-[#2a2a2a] shadow-2xl overflow-hidden"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-2 border-b border-[#222222]">
              <span className="font-mono text-xs font-bold text-[#ededea]">
                Select {selectorTarget === "pay" ? "Payment" : "Receive"} Token
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectorTarget(null);
                  setSearchQuery("");
                  setResolvedContractToken(null);
                  setSearchedTokens([]);
                }}
                className="rounded p-1 text-[#a3a3a3] hover:bg-white/10 hover:text-white transition-colors"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Search input with live contract resolving */}
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#8a8a8a]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name or paste contract address"
                className="w-full rounded-xl border border-[#262626] bg-[#141414] py-1.5 pl-8 pr-7 text-xs font-mono text-[#ededea] placeholder-[#8a8a8a] focus:border-[#ccff00] focus:outline-none transition-colors"
                autoFocus
              />
              {isSearchingContract || isSearchingName ? (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3 text-[#ccff00] animate-spin" />
              ) : searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchedTokens([]);
                    setResolvedContractToken(null);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a8a8a] hover:text-white"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            {/* Quick Select Chips Section (Exact DexScreener Uniswap Layout) */}
            <div className="mt-2 space-y-1.5 border-b border-[#1c1c1c] pb-2">
              {/* Row 1: Core Crypto */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                {cryptoChips.map((tok) => (
                  <button
                    key={tok.symbol}
                    type="button"
                    onClick={() => handleSelectToken(tok)}
                    className="flex items-center gap-1.5 rounded-xl border border-[#242424] bg-[#141414] px-2.5 py-1 text-xs font-mono font-medium text-[#ededea] hover:border-[#ccff00] hover:bg-[#1f1f1f] transition-colors shrink-0"
                  >
                    <TokenAvatar token={tok} className="size-6" />
                    <span className="font-semibold">{tok.symbol}</span>
                  </button>
                ))}
              </div>

              {/* Row 2: Stocks / RWA (Robinhood Chain feature) */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <span className="text-xs font-mono tracking-wider text-[#a3a3a3] flex items-center gap-1 pr-0.5 shrink-0">
                  Stocks <span className="text-xs leading-4 text-[#ccff00] bg-[#ccff00]/10 px-1.5 rounded">New</span>
                </span>
                {stockChips.map((tok) => (
                  <button
                    key={tok.symbol}
                    type="button"
                    onClick={() => handleSelectToken(tok)}
                    className="flex items-center gap-1.5 rounded-xl border border-[#242424] bg-[#141414] px-2.5 py-1 text-xs font-mono font-medium text-[#ededea] hover:border-[#ccff00] hover:bg-[#1f1f1f] transition-colors shrink-0"
                  >
                    <TokenAvatar token={tok} className="size-6" />
                    <span className="font-semibold">{tok.symbol}</span>
                  </button>
                ))}
                {/* Active token pill if not in standard list */}
                {tokenSymbol && !["ETH", "USDC", "USDG", "USDT", "WBTC", "WETH", "SPCX", "NVDA"].includes(tokenSymbol) && (
                  <button
                    type="button"
                    onClick={() => {
                      const cur = chainTokens.find((t) => t.symbol === tokenSymbol);
                      if (cur) handleSelectToken(cur);
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-[#ccff00]/30 bg-[#161a0f] px-2.5 py-1 text-xs font-mono font-bold text-[#ccff00] hover:bg-[#202812] transition-colors shrink-0"
                  >
                    <span className="size-5 rounded-full bg-[#ccff00]/20 flex items-center justify-center text-xs">
                      ★
                    </span>
                    <span>{tokenSymbol}</span>
                  </button>
                )}
              </div>

              {/* Row 3: Recently Traded Tokens */}
              {recentTokens.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-0.5">
                  <span className="text-xs font-mono tracking-wider text-[#a3a3a3] flex items-center gap-1 pr-0.5 shrink-0">
                    <History className="size-3 text-[#a3a3a3]" /> Recent
                  </span>
                  {recentTokens.map((tok) => (
                    <button
                      key={`recent-${tok.address}`}
                      type="button"
                      onClick={() => handleSelectToken(tok)}
                      className="flex items-center gap-1.5 rounded-xl border border-[#242424] bg-[#141414] px-2.5 py-1 text-xs font-mono font-medium text-[#ededea] hover:border-[#ccff00] hover:bg-[#1f1f1f] transition-colors shrink-0"
                    >
                      <TokenAvatar token={tok} className="size-5" />
                      <span className="font-semibold">{tok.symbol}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* List Header */}
            <div className="mt-2 text-xs leading-5 font-mono tracking-wider text-[#a3a3a3] px-1 flex items-center justify-between">
              <span>TOKENS BY 24H VOLUME</span>
              <span>BALANCE / USD</span>
            </div>

            {/* Scrollable Token List with Progressive Virtualization */}
            <div
              onScroll={handleListScroll}
              className="no-scrollbar mt-1 flex-1 overflow-y-auto divide-y divide-[#181818] pr-0.5"
            >
              {/* If an on-chain address was resolved live, show it at top */}
              {resolvedContractToken && (
                <button
                  type="button"
                  onClick={() => handleSelectToken(resolvedContractToken)}
                  className="w-full flex items-center justify-between p-2 rounded-xl bg-[#141c10] border border-[#ccff00]/30 hover:bg-[#1a2614] transition-colors text-left group mb-1"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TokenAvatar key={`resolved-${resolvedContractToken.address}`} token={resolvedContractToken} className="size-10" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-[#ccff00]">
                          {resolvedContractToken.symbol}
                        </span>
                        <span className="text-xs leading-4 px-1.5 rounded bg-[#ccff00]/20 text-[#ccff00] font-mono">
                          Live On-Chain
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs leading-[1.618] text-[#a3a3a3] font-mono truncate max-w-[180px]">
                        <span className="truncate">{resolvedContractToken.name}</span>
                        {resolvedContractToken.address && (
                          <>
                            <span className="text-[#a3a3a3]">·</span>
                            <span className="text-[#8a8a8a] shrink-0 font-mono text-xs">
                              {resolvedContractToken.address.slice(0, 6)}…{resolvedContractToken.address.slice(-4)}
                            </span>
                            <CopyAddressButton address={resolvedContractToken.address} />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-xs text-[#ccff00]">Select</div>
                    <div className="text-xs leading-[1.618] text-[#a3a3a3] font-mono">
                      {resolvedContractToken.priceUsd > 0
                        ? `$${resolvedContractToken.priceUsd.toFixed(4)}`
                        : "Price unavailable"}
                    </div>
                  </div>
                </button>
              )}

              {visibleTokens.length === 0 && !resolvedContractToken ? (
                <div className="py-8 text-center text-xs font-mono text-[#a3a3a3]">
                  {isSearchingContract || isSearchingName ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="size-4 animate-spin text-[#ccff00]" />
                      <span>
                        {isSearchingContract
                          ? "Resolving contract directly on Robinhood Chain..."
                          : `Searching for "${searchQuery.trim()}" on Robinhood Chain...`}
                      </span>
                    </div>
                  ) : (
                    `No tokens found matching "${searchQuery}"`
                  )}
                </div>
              ) : (
                visibleTokens.map((t) => (
                  <button
                    key={t.symbol + t.address}
                    type="button"
                    onClick={() => handleSelectToken(t)}
                    className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[#161616] transition-colors text-left group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <TokenAvatar key={`modal-${t.address || t.symbol}`} token={t} className="size-10" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-[#ededea] group-hover:text-[#ccff00] transition-colors">
                            {t.symbol}
                          </span>
                          {t.isNative ? (
                            <span className="text-xs leading-4 px-1.5 rounded bg-[#ccff00]/10 text-[#ccff00] font-mono">
                              Native
                            </span>
                          ) : t.category === "stocks" ? (
                            <span className="text-xs leading-4 px-1.5 rounded bg-[#00c805]/10 text-[#00c805] font-mono">
                              Stock
                            </span>
                          ) : importedTokens.some((it) => it.address.toLowerCase() === t.address.toLowerCase()) ? (
                            <span className="text-xs leading-4 px-1.5 rounded bg-[#ccff00]/20 text-[#ccff00] font-mono">
                              Imported
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 text-xs leading-[1.618] text-[#a3a3a3] font-mono truncate max-w-[210px]">
                          <span className="truncate">{t.name}</span>
                          {!t.isNative && t.address && t.address !== "0x0000000000000000000000000000000000000000" && (
                            <>
                              <span className="text-[#a3a3a3]">·</span>
                              <span className="text-[#8a8a8a] shrink-0 font-mono text-xs">
                                {t.address.slice(0, 6)}…{t.address.slice(-4)}
                              </span>
                              <CopyAddressButton address={t.address} />
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono text-xs text-[#ededea]">
                        {!wallet.isConnected || !wallet.address
                          ? "—"
                          : t.balanceStatus === "loading" || (isBalancesLoading && t.rawBalance === undefined)
                          ? "…"
                          : t.balanceStatus === "error"
                          ? "—"
                          : t.rawBalance !== undefined && t.rawBalance !== null
                          ? formatBaseUnits(t.rawBalance, t.decimals, 4)
                          : t.balance > 0
                          ? t.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })
                          : "0"}
                      </div>
                      <div className="text-xs leading-[1.618] text-[#a3a3a3] font-mono">
                        {t.priceUsd > 0 ? (
                          <>
                            {t.category === "stocks" ? "Reference " : ""}$
                            {t.priceUsd < 0.01
                              ? t.priceUsd.toFixed(6)
                              : t.priceUsd.toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                          </>
                        ) : "Price unavailable"}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
