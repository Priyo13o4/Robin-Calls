"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  isAddress,
  parseEther,
  type Address,
} from "viem";
import { useBalance, useSwitchChain } from "wagmi";
import { useWallet } from "@/lib/wallet/useWallet";
import { explorerTxUrl } from "@/lib/config/sale-chains";
import { cdnUrl } from "@/lib/config/cdn";
import { SALE_STATE, tokenSaleAbi } from "@/lib/sale/abi";
import { allocationQuote, type SaleSnapshot } from "@/lib/sale/reads";
import { useSaleData } from "@/lib/sale/useSaleData";
import { raisedUsd } from "@/lib/sale/eth-price";
import { useEthUsd } from "@/lib/sale/useEthUsd";
import {
  SALE_TOKENS,
  fmtPrice,
  fmtUsdPrice,
  fmtTokens,
  liveProjection,
} from "@/lib/sale/projection";
import { SALE_FAQ, type FaqGroup } from "@/lib/sale/faq";
import { NoirShell, PageHeader } from "@/app/components/site/NoirShell";
import { SkeletonRegion, SkeletonRow, ShimmerBlock, UnsetBar } from "@/app/components/site/Skeleton";
import { PageBackdrop } from "@/app/components/site/PageBackdrop";
import { ToastAction } from "@/components/ui/toast";
import { toast, dismissToast, ONE_SHOT_MS } from "@/components/ui/use-toast";
import { useReferral } from "@/lib/referrals/useReferral";
import { COMMISSION_BPS } from "@/lib/referrals/rules";
import { ReferralPanel } from "@/app/components/referrals/ReferralPanel";
import { ReferralGate } from "@/app/components/referrals/ReferralGate";
import { LeaderboardTable } from "@/app/components/referrals/LeaderboardTable";
import { useLeaderboard } from "@/lib/referrals/useLeaderboard";
import { referralLink } from "@/lib/referrals/code";
import { formatEth } from "@/lib/referrals/display";
import { TOKEN_ADDRESS, TOKEN_EXPLORER_URL, TOKEN_SYMBOL } from "@/lib/sale/token";
import { AddToWalletButton } from "@/app/components/site/AddToWalletButton";
import { SaleClock } from "@/app/components/site/landing/SaleClock";
import { scheduleChip, type ContractPhase, type SaleSchedule } from "@/lib/sale/schedule-clock";
import { InfoTooltip } from "@/app/components/ui/InfoTooltip";
import {
  ArrowRight,
  Ban,
  BarChart3,
  Check,
  ClipboardList,
  Coins,
  Copy,
  Gift,
  Hand,
  HelpCircle,
  Lock,
  Plus,
  ShieldCheck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { RaiseProjection } from "./RaiseProjection";
import { TokenSaleSwap, type SaleWalletState } from "./TokenSaleSwap";
import { SwapFrame } from "@/app/components/trade/SwapFrame";
import Link from "next/link";

/**
 * The public sale surface. Noir design system: near-black canvas, Paper text,
 * lime is scarce — it goes to the live dot, the CTA, the money numbers and the
 * progress fill, nothing else. Reads come from the shared `lib/sale/reads.ts`
 * path (server snapshot first, client multicall takes over); "—" means "the
 * chain did not answer", never "zero" (§4), and data that is not from a live
 * read says so.
 *
 * Blocks marked PLACEHOLDER hold mock copy the operator replaces before
 * launch; everything bound to the contract stays honest.
 *
 * Chain follows the build gate: a test build (NEXT_PUBLIC_ALLOW_TESTNET_CHAIN)
 * points the whole page at testnet, production only ever renders mainnet.
 */
import { getSaleChain, setActiveSaleChainId } from "@/lib/config/chain";

/** PLACEHOLDER manifesto ticker — every line must stay a true contract fact. */
const MANIFESTO = [
  "PRO-RATA · SAME ETH, SAME PRICE",
  "NO FIXED PRICE · SET AT THE CLOSE",
  "FUNDS COMMITTED OVER LIFE OF SALE, ON-CHAIN",
  "CLAIM WITHIN 60 DAYS OF THE CLOSE",
  "ABANDONED MEANS REFUNDED · EVERY WEI",
  "EVERY NUMBER READ LIVE FROM THE CONTRACT",
];

/**
 * The rewards, as the page is allowed to describe them. All three percentages
 * come from `lib/referrals/rules.ts`, never from a literal here.
 *
 * They are NOT the same numbers as the tokenomics page's GENESIS AIRDROP rows,
 * and that is deliberate rather than a drift. These are percentages of a buyer's
 * OWN purchase. Those are a BUDGET in supply terms, left unchanged by operator
 * decision (2026-09-11): whatever the commissions do not spend stays unspent
 * rather than being re-promised. tests/referral-rules.test.ts pins the one
 * direction that matters, that the budget can cover the maximum payout.
 *
 */
const REFERRER_PCT = COMMISSION_BPS.referrerTokens / 100;
const REFERRER_ETH_PCT = COMMISSION_BPS.referrerEth / 100;
const REFERRED_BUYER_PCT = COMMISSION_BPS.buyerBonus / 100;

// FAQ accordion sections; questions and answers are single-sourced from SALE_FAQ.

const FAQ_GROUPS: { key: FaqGroup; label: string }[] = [
  { key: "sale", label: "THE SALE" },
  { key: "referral", label: "REFERRALS & AIRDROP" },
  { key: "custody", label: "CUSTODY & RISK" },
];

/** Real contract mechanics, contrasted with the presale pattern they replace. */
const CONTRASTS: { icon: LucideIcon; title: string; sub: string }[] = [
  {
    icon: Ban,
    title: "No price until the close",
    sub: "Your slice of the pool is your slice of the raise, pro-rata. Timing changes nothing.",
  },
  {
    icon: Lock,
    title: "Funds stay in the sale contract",
    sub: "Countable by anyone on the explorer. Nobody can move them until the sale closes.",
  },
  {
    icon: Hand,
    title: "You control your allocation",
    sub: "You claim your own tokens after the close. Claim within 60 days: anything unclaimed after that can be burned.",
  },
];

const STATE_COPY: Record<number, { chip: string; tone: string; line: string }> = {
  [SALE_STATE.PENDING]: {
    chip: "OPENS SOON",
    tone: "text-[#8a8a8a] border-[#2a2a2a]",
    line: "The sale is deployed and waiting for its opening. Contributions will appear here the moment it starts.",
  },
  [SALE_STATE.ACTIVE]: {
    chip: "LIVE",
    tone: "text-[#ccff00] border-[#ccff00]",
    line: "Contributions are open. What you commit is held in the contract; your token share is priced at the close.",
  },
  [SALE_STATE.PAUSED]: {
    chip: "PAUSED",
    tone: "text-[#d9c96a] border-[#8a6d1f]",
    line: "Contributions are on hold. Nothing you already committed has moved. It still counts.",
  },
  [SALE_STATE.CLOSED]: {
    chip: "CLOSED · CLAIM OPEN",
    tone: "text-[#8fbf6a] border-[#3d5c3d]",
    line: "The price is set: the raised ETH divided across the pool. Tokens are claimed, never pushed, so come and take yours. Anything still unclaimed 60 days after the close can be burned.",
  },
  [SALE_STATE.ABANDONED]: {
    chip: "ABANDONED · REFUNDS",
    tone: "text-[#e0897a] border-[#8a3a30]",
    line: "The sale was cancelled. Every wei goes back to whoever sent it, by pull. Claim yours below.",
  },
};

function LiveDot({ on }: { on: boolean }) {
  return on ? (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ccff00] opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#ccff00]" />
    </span>
  ) : (
    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#d9c96a]" />
  );
}

function Marquee() {
  const row = (hidden: boolean) => (
    <div aria-hidden={hidden} className="flex flex-none items-center">
      {MANIFESTO.map((m) => (
        <span key={m} className="flex flex-none items-center font-mono text-[12px] font-semibold tracking-[0.22em] text-white">
          <span className="px-7">{m}</span>
          <span className="text-[#ccff00]">//</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="overflow-hidden border-y border-[#2a2a2a] bg-[#0a0a0a]/80 py-2.5">
      <div className="flex w-max animate-marquee">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}


/** One id for every chain-trouble message on this page, so they replace rather than stack. */
const CHAIN_TOAST_ID = "sale-chain";

export function SalePageClient({
  contract,
  addressState,
  snapshot,
  chainId,
  schedule,
  renderedAt,
}: {
  contract: string;
  /** Server's three-state read of where the address lives (§8 #9). */
  addressState: "address" | "unconfigured" | "unavailable";
  snapshot?: SaleSnapshot | null;
  chainId?: number;
  /** Admin's announced window, the same read the landing clock uses. */
  schedule: SaleSchedule;
  renderedAt: number;
}) {
  const chain = getSaleChain(chainId);
  // This page's server render is the authority on where the sale lives; the
  // wallet stack otherwise only has the injected global, which is null on every
  // prerendered route (see setActiveSaleChainId).
  useEffect(() => setActiveSaleChainId(chain.id), [chain.id]);
  const wallet = useWallet();
  const { switchChainAsync } = useSwitchChain();
  const { sale, live, status, asOf, refresh, refreshing, client } = useSaleData({
    chain,
    contract,
    walletAddress: wallet.address,
    snapshot,
  });
  const { usd: ethUsd } = useEthUsd(client);
  // The swap card's "Use max" reads the wallet's native balance — wagmi's
  // balance hook, not a hand-rolled getBalance loop.
  const { data: walletBalance } = useBalance({
    address: wallet.address ? (wallet.address as `0x${string}`) : undefined,
    chainId: chain.id,
  });

  // No contract configured means nothing on this page was ever read from one.
  // `unavailable` (the DB was unreachable) is deliberately included: in both
  // cases we have no figure, and inviting the reader to wait for one would be
  // the all-clear-shaped lie §8 #9 is about.
  const unset = addressState !== "address";

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<string | null>(SALE_FAQ[0]?.q ?? null);
  const [terminalTab, setTerminalTab] = useState<"contribute" | "referral">("contribute");
  const [activeBoard, setActiveBoard] = useState<"contributions" | "referrals">("contributions");
  const { status: boardStatus, rows: boardRows } = useLeaderboard(activeBoard, 5);
  const [copiedRef, setCopiedRef] = useState<"code" | "link" | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  const copyToClipboard = useCallback(async (type: "code" | "link", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRef(type);
      setTimeout(() => setCopiedRef(null), 1800);
    } catch {
      /* clipboard denied in some iframe environments */
    }
  }, []);
  const swapColRef = useRef<HTMLDivElement>(null);
  const [swapTall, setSwapTall] = useState(false);
  useEffect(() => {
    const el = swapColRef.current;
    if (!el) return;
    // Both inputs to the decision get watched: the element's own size AND the
    // viewport's — an element-only ResizeObserver never hears a rotation or a
    // window resize, and a stale "fits" keeps a too-tall card sticky.
    const measure = () => setSwapTall(el.offsetHeight > window.innerHeight - 140);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      measure();
      window.addEventListener("resize", measure);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const configured = isAddress(contract);
  const st = sale?.state;
  // Until the contract reports a state, every chip reads the same schedule as the clock.
  const dateChip = scheduleChip(schedule, renderedAt);
  const contractPhase: ContractPhase | undefined =
    st === SALE_STATE.ACTIVE || st === SALE_STATE.PAUSED ? "live"
    : st === SALE_STATE.CLOSED ? "closed"
    : st === SALE_STATE.ABANDONED ? "cancelled"
    : undefined;
  const sym = TOKEN_SYMBOL;
  const dec = sale?.tokenMeta?.decimals;
  const mine = sale?.mine;

  const amountValid = amount.trim() !== "" && (() => { try { return parseEther(amount) > 0n; } catch { return false; } })();
  const amountBig = amountValid ? parseEther(amount) : null;

  /** Mirrors the contract's admission rules so a rejection is explained before the
   *  user signs, never discovered as a revert. Every branch fails OPEN: an unread
   *  constant, or an unknown existing balance, must not block a legal contribution —
   *  the chain is the enforcer, this is only the explanation. */
  const admission = useMemo<string | null>(() => {
    if (amountBig === null) return null;
    const step = sale?.contributionStep;
    if (step !== undefined && step > 0n && amountBig % step !== 0n) {
      return `Contributions go in multiples of ${formatEther(step)} ETH.`;
    }
    const floor = sale?.minInitialContribution;
    // undefined is "we could not read your balance", which is not "this is your first".
    const isFirst = mine?.contributed === undefined ? null : mine.contributed === 0n;
    if (isFirst === true && floor !== undefined && amountBig < floor) {
      return `A first contribution must be at least ${formatEther(floor)} ETH.`;
    }
    return null;
  }, [amountBig, sale?.contributionStep, sale?.minInitialContribution, mine?.contributed]);

  /** The honest quote: your tokens AND your share of the pool if the sale
   *  ended at this instant. `allocationQuote` mirrors allocationOf's math. */
  const quote = useMemo(() => {
    if (sale?.totalRaised === undefined || sale.tokensForSale === undefined || dec === undefined) return null;
    const q = allocationQuote({
      extra: amountBig ?? 0n,
      contributed: mine?.contributed ?? 0n,
      totalRaised: sale.totalRaised,
      tokensForSale: sale.tokensForSale,
    });
    if (!q) return { pct: "—", tokens: "—" };
    return {
      pct: `${(Number(q.shareBps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`,
      tokens: fmtTokens(q.tokens, dec),
    };
  }, [sale?.totalRaised, sale?.tokensForSale, mine?.contributed, amountBig, dec]);

  /** The sale pool in WHOLE tokens. `tokensForSale` is the contract's raw
   *  18-decimal value, and every consumer that divides an ETH amount by it
   *  needs it de-scaled first — `impliedPrice` below is the exception, because
   *  raw wei ÷ raw token-units cancels the 1e18 on both sides. Passing the raw
   *  bigint into a whole-token parameter priced the sale 1e18 too cheap and
   *  made `poolDrift` fire permanently: two cells for the same quantity, side
   *  by side, disagreeing by eighteen orders of magnitude. */
  const poolWholeTokens = useMemo(() => {
    if (sale?.tokensForSale === undefined || dec === undefined) return undefined;
    const n = Number(formatUnits(sale.tokensForSale, dec));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [sale?.tokensForSale, dec]);

  /** Raised ÷ pool — the price this instant would set. Undefined (—) at zero
   *  raised: the first wei creates the price, it is not zero. */
  const impliedPrice = useMemo(() => {
    if (sale?.totalRaised === undefined || sale.tokensForSale === undefined) return null;
    if (sale.totalRaised === 0n) return null;
    return Number(sale.totalRaised) / Number(sale.tokensForSale);
  }, [sale?.totalRaised, sale?.tokensForSale]);

  /** The sale page's live numbers divide the CHAIN's pool, never the published
   *  split — a projection against `SALE_TOKENS` while the neighbouring cell
   *  prints the chain's `tokensForSale` is how two public pages state different
   *  pool sizes with nothing noticing. A disagreement is still rendered, as a
   *  named warning: it means the deployed contract and /tokenomics' split
   *  diverged, which the operator must reconcile, not the UI hide. */
  const poolDrift = useMemo(() => {
    if (poolWholeTokens === undefined) return false;
    return poolWholeTokens !== SALE_TOKENS;
  }, [poolWholeTokens]);

  /** The listing projection, in its three honest states. `undefined` raised =
   *  the read faulted (§8 #9: "couldn't read" ≠ "raised nothing" — a dead RPC
   *  must never publish an FDV, and a zero raise must never publish a price).
   *  Priced from the contract's own tokensForSale, so this panel can never
   *  quietly disagree with the TOKEN POOL cell beside it. */
  const liveProj = useMemo(
    () =>
      poolWholeTokens === undefined
        ? liveProjection(undefined) // pool unread → unavailable wins; nothing priced is possible
        : liveProjection(sale?.totalRaised, poolWholeTokens),
    [sale?.totalRaised, poolWholeTokens],
  );
  const saleActive = st === SALE_STATE.ACTIVE;
  const saleClosed = st === SALE_STATE.CLOSED;
  const saleAbandoned = st === SALE_STATE.ABANDONED;
  /** An abandoned sale set no price, so the FDV card must not print one. */
  const showImplied = liveProj.kind === "implied" && !saleAbandoned;

  /** Price label is state-aware: while the sale runs the number is a
   *  hypothesis; once CLOSED the same division IS the final price — calling
   *  that "if closed now" mislabels a settled fact as speculative. ABANDONED
   *  prices nothing, so the cell shows the dash with its own sentence. */
  const priceLabel = saleClosed
    ? "FINAL PRICE"
    : st === SALE_STATE.ABANDONED
      ? "PRICE"
      : "PRICE IF CLOSED NOW";
  const priceHint = saleClosed
    ? "raised ÷ pool, fixed at the close"
    : st === SALE_STATE.ABANDONED
      ? "sale abandoned, no price was set"
      : "raised ÷ pool, set by the close";

  /** Formatted REAL allocation from chain — what the claim actually delivers.
   *  Never the input-derived quote: a leftover typed amount must not let the
   *  button overstate what the user will receive. */
  const allocationLabel =
    mine?.allocation !== undefined && dec !== undefined
      ? `${fmtTokens(mine.allocation, dec)} `
      : "";

  /** One in-flight notice id per page, so contribute-flow toasts replace rather than stack. */
  const TX_TOAST_ID = "sale-tx";

  /**
   * Hand the transaction hash to the mirror. The browser holds the receipt;
   * the server re-reads it from the chain and believes only that. Fire and
   * forget on purpose: the endpoint records the claim before any RPC work, so
   * it cannot fail for chain reasons, and the reconciler retries anything it
   * left pending. A failure here never bothers the user — their contribution
   * is already on chain.
   */
  const submitContributionClaim = useCallback(
    async (hash: `0x${string}`, address: string | null) => {
      if (!address) return;
      try {
        await fetch("/api/referrals/contribute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: address.toLowerCase(), txHash: hash }),
        });
      } catch {
        // Offline or our server hiccuped: the reconciler's census pass picks
        // the contribution up anyway. Nothing is lost by not telling us.
      }
    },
    [],
  );

  /**
   * The six moments of a contribute-flow transaction, as toasts.
   *
   * The pinned/loading split is settled policy (tests/toast-durations.test.ts):
   * `duration: null` for anything that might already be on chain, ONE_SHOT_MS
   * for a failure that is known closed, a progress bar only on a resolved
   * success. "Nothing was spent" is only ever said when it is known — a
   * reverted tx DID spend gas, and a timeout may still land.
   */
  /** Set when a send returned no hash; the failure toast waits for the wallet hook's fresh error. */
  const awaitingSendError = useRef(false);
  useEffect(() => {
    if (!awaitingSendError.current || !wallet.error) return;
    awaitingSendError.current = false;
    // Nothing was broadcast, so a countdown is a promise we can keep, but only
    // when the hook says the failure is settled.
    toast.error(wallet.error, {
      id: TX_TOAST_ID,
      duration: wallet.errorSettled ? ONE_SHOT_MS : null,
    });
  }, [wallet.error, wallet.errorSettled]);

  const sendTx = useCallback(
    async (label: string, data: `0x${string}`, value?: bigint) => {
      if (!configured) return;
      dismissToast(TX_TOAST_ID);
      setBusy(label);
      try {
        // One click, like /swap: a wallet on another network is switched first,
        // then the same click carries on. The send below still pins chainId, so
        // a switch that did not hold fails there rather than sending elsewhere.
        if (wallet.chainId !== chain.id) {
          toast.loading(`Switch your wallet to ${chain.name} to continue.`, { id: TX_TOAST_ID, closable: false });
          try {
            await switchChainAsync({ chainId: chain.id });
          } catch {
            toast.error(`Could not switch networks. Change your wallet to ${chain.name}, then try again.`, {
              id: TX_TOAST_ID,
              duration: ONE_SHOT_MS,
            });
            return;
          }
        }

        // The wallet prompt. Pinned: it stays up while the user finds their
        // wallet, and the row is replaced by the next moment's.
        toast.loading(`Confirm this in your wallet: ${label.toLowerCase()}.`, {
          id: TX_TOAST_ID,
          closable: false,
        });

        // chainId pinned, not merely gated by `walletOk` above: that gate is
        // read at render, and the wallet can change network between the click
        // and the confirm. This one is enforced by wagmi at send time.
        const sendWithTimeout = async () => {
          let timer: NodeJS.Timeout | undefined;
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const e = new Error("WALLET_PROMPT_TIMEOUT");
              e.name = "WalletPromptTimeout";
              reject(e);
            }, 120_000);
          });
          try {
            return await Promise.race([
              wallet.sendTransaction({ to: contract as Address, data, value, chainId: chain.id }),
              timeout,
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        let hash: `0x${string}` | null = null;
        try {
          hash = await sendWithTimeout();
        } catch (err: unknown) {
          dismissToast(TX_TOAST_ID);
          if (err instanceof Error && (err.name === "WalletPromptTimeout" || err.message === "WALLET_PROMPT_TIMEOUT")) {
            toast({
              id: TX_TOAST_ID,
              variant: "warning",
              title: "Stopped waiting",
              description: `We stopped waiting for confirmation in your wallet for ${label.toLowerCase()}. Check your wallet and the explorer to see if the transaction was signed.`,
              duration: null,
            });
            return;
          }
          throw err;
        }

        if (!hash) {
          // Rejection or a failed send. The reason is NOT readable here: `wallet`
          // is this render's copy, taken before the send, so its error is stale.
          // The effect below raises the toast once the hook reports the fresh one.
          dismissToast(TX_TOAST_ID);
          awaitingSendError.current = true;
          return;
        }

        // Signed and broadcast; waiting on the chain. Pinned loading row: a
        // countdown under a 90s wait is a promise we cannot keep.
        toast.loading(`${label} signed. Waiting for the chain…`, { id: TX_TOAST_ID, closable: false });

        let rc;
        try {
          rc = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
        } catch {
          // The wait TIMED OUT, not the transaction. It may still land: pinned,
          // with the explorer link, and never "nothing happened".
          toast({
            id: TX_TOAST_ID,
            variant: "warning",
            title: "Still confirming",
            description: `${label} was sent but we stopped waiting before the chain confirmed it. It may still go through. Check the transaction before trying again.`,
            duration: null,
          });
          return;
        }

        if (rc.status === "success") {
          // Resolved: the one shape allowed a countdown bar.
          toast.success(`${label} confirmed.`, { id: TX_TOAST_ID, duration: ONE_SHOT_MS });

          // Only a contribution needs telling to the server. Claims/refunds
          // are nobody's business but the wallet's, and the referral plane
          // only mirrors contributions.
          if (data === encodeFunctionData({ abi: tokenSaleAbi, functionName: "contribute" })) {
            void submitContributionClaim(hash, wallet.address);
          }
          // Forced: a background poll already in flight would otherwise swallow
          // this read and leave the pre-transaction numbers on screen.
          await refresh({ force: true });
        } else {
          // Reverted ON CHAIN — a mined, failed receipt. Gas was spent, so
          // the row stays up and never says otherwise.
          toast({
            id: TX_TOAST_ID,
            variant: "destructive",
            title: `${label} reverted`,
            description: "The transaction was mined but the contract refused it. Gas was spent. Nothing else moved.",
            duration: null,
          });
        }
      } finally {
        setBusy(null);
      }
    },
    [configured, contract, client, wallet, chain, switchChainAsync, submitContributionClaim, refresh],
  );

  /* ── referrals ──────────────────────────────────────────────────────
     A referral code has to be applied BEFORE a wallet's first contribution;
     afterwards the binding is frozen for good. That asymmetry is the whole
     reason the gate below exists — the cost of asking is one extra click, the
     cost of not asking is a buyer permanently locked out of the bonus who never knew
     it was running.
     `referralsOn` is inferred from the API answering rather than from a
     NEXT_PUBLIC flag: this page is server-rendered per request and a build-time
     flag would need a rebuild to change (lib/sale/address.ts, same reasoning).
  */
  // No flag check here: this page 404s when ENABLE_TOKEN_SALE is off, and
  // referrals ride that same switch, so reaching this line means both are on.
  const referral = useReferral({
    walletAddress: wallet.address,
    sign: wallet.sign,
    // The chain's own answer. Without it the gate runs on our indexer's copy,
    // which is a minute behind, and invites a wallet that has already paid to
    // add a code we would then have to take back.
    // No sale contract configured: nothing can have been contributed, so that is an answer,
    // not an unread. Without it the gate waited on a read that never runs.
    contributedOnChain: unset ? 0n : mine?.contributed,
  });
  const [gateOpen, setGateOpen] = useState(false);

  const sendContribution = useCallback(
    () => sendTx("Contribution", encodeFunctionData({ abi: tokenSaleAbi, functionName: "contribute" }), amountBig ?? undefined),
    [sendTx, amountBig],
  );

  /**
   * The gate opens only when the binding window is KNOWN to be open and no code
   * is bound. "unknown" contributes straight through: an unread status must not
   * hold up a purchase, and interrupting one to promise something we cannot
   * check is worse than not asking. Every top-up goes straight through too.
   */
  const contribute = useCallback(() => {
    const first =
      referral.bindWindow === "open" &&
      referral.state !== null &&
      referral.state.usedCode === null;
    if (first) {
      setGateOpen(true);
      return;
    }
    void sendContribution();
  }, [referral.bindWindow, referral.state, sendContribution]);
  const claim = () => sendTx("Claim", encodeFunctionData({ abi: tokenSaleAbi, functionName: "claim" }));
  const refund = () => sendTx("Refund", encodeFunctionData({ abi: tokenSaleAbi, functionName: "claimRefund" }));

  /** The accelerator banner's CTA — shared by its two responsive copies. */
  const scrollToReferral = () => {
    setTerminalTab("referral");
    swapColRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // /token-sale#referrals (the landing hero's link) opens on the referral tab.
  useEffect(() => {
    if (window.location.hash !== "#referrals") return;
    const id = requestAnimationFrame(() => {
      setTerminalTab("referral");
      swapColRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  /** Wallet-side admission, alongside the contract-rules mirror above: the
   *  amount must fit the balance that will sign it. undefined balance = unread,
   *  never over (the wallet still rejects at send time — fails open). */
  const overBalance = useMemo(() => {
    if (amountBig === null || walletBalance?.value === undefined) return false;
    return amountBig > walletBalance.value;
  }, [amountBig, walletBalance?.value]);

  const walletOk = wallet.isConnected && wallet.chainId === chain.id;
  // `admission === null` is load-bearing enforcement, not just an explanation:
  // with the rules read from the chain, a violating amount never reaches the
  // wallet — the button stays disabled. Fail-open shape: unread constants
  // (undefined) leave admission null and the chain remains the only enforcer.
  const canBuy =
    wallet.isConnected && st === SALE_STATE.ACTIVE && amountValid && admission === null && !overBalance && busy === null;

  const raised = sale?.totalRaised === undefined ? null : Number(formatEther(sale.totalRaised));
  const raisedLabel = raised === null ? "—" : raised.toLocaleString('en-US', { maximumFractionDigits: 18 });
  const totalUsd = raisedUsd(raised, ethUsd);
  const raisedUsdLabel = totalUsd === null ? "—" : "$" + totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const ethPriceLabel = ethUsd === null ? "—" : "$" + ethUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** Own contribution, for the projection curve. Unread stays null so the
   *  panel draws its reference stake and says so, rather than drawing zero. */
  const yourEth = mine?.contributed === undefined ? null : Number(formatEther(mine.contributed));
  const canClaim = wallet.isConnected && st === SALE_STATE.CLOSED && !!mine?.allocation && mine.allocation > 0n && !mine.claimed;
  const canRefund = wallet.isConnected && st === SALE_STATE.ABANDONED && !!mine?.contributed && mine.contributed > 0n && !mine.refunded;
  const canStray = wallet.isConnected && !!mine?.stray && mine.stray > 0n;

  const state = st !== undefined ? STATE_COPY[st] : undefined;
  const chip = st === SALE_STATE.PENDING || !state ? dateChip : state.chip;

  /** Age of the numbers on screen whenever they did not come from a client
   *  read that just landed — "—" may be honest, but a stale number is only
   *  honest when it says when it was read. */
  const staleLabel = asOf
    ? `${asOf.blockNumber !== null ? `as of block ${asOf.blockNumber}, ` : "as of "}${Math.max(0, Math.round((Date.now() - asOf.takenAt) / 1000))}s ago`
    : null;
  /* One toast, one precedence: a read that threw outranks a read that came back
     partial. `faults` names internal fields, so it goes to the console below and
     never into the copy. */
  const chainNotice = useMemo(() => {
    if (sale && status === "stale") {
      return {
        kind: "stale",
        title: "Can't reach the chain",
        message: `Showing the last data we read${staleLabel ? ` (${staleLabel})` : ""}. Retrying automatically.`,
      };
    }
    if (sale && live && sale.faults.length > 0) {
      return {
        kind: "faults",
        title: "Partial read",
        message: "Some sale details could not be read just now. A dash means we could not read that value. It does not mean zero.",
      };
    }
    return null;
  }, [sale, status, live, staleLabel]);

  // The field list is the operator's answer, not the reader's. Console only.
  useEffect(() => {
    if (sale && live && sale.faults.length > 0) console.warn("[sale] partial read", sale.faults);
  }, [sale, live]);

  /* `refresh` is a new function most renders, so it travels by ref: as an effect
     dep it would re-raise the toast on every render and restart its clock. */
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  /* Keyed on the two primitives that decide what the reader sees. Reusing one id
     REPLACES, so a read failing on every retry updates one row instead of
     stacking one per attempt. Pinned open: the trouble is still true. */
  const noticeKind = chainNotice?.kind ?? null;
  const noticeTitle = chainNotice?.title ?? null;
  const noticeMessage = chainNotice?.message ?? null;
  useEffect(() => {
    if (!noticeKind) {
      dismissToast(CHAIN_TOAST_ID);
      return;
    }
    toast({
      id: CHAIN_TOAST_ID,
      variant: "warning",
      title: noticeTitle ?? undefined,
      description: noticeMessage ?? undefined,
      duration: null,
      // `force`, or the click is dropped whenever a poll is already running.
      // The label is the only proof the press registered: on a failed retry the
      // toast is replaced with identical text, so without it a working button
      // and a dead one look exactly the same.
      action: (
        <ToastAction onClick={() => void refreshRef.current({ force: true })}>
          {refreshing ? "Checking…" : "Retry"}
        </ToastAction>
      ),
    });
  }, [noticeKind, noticeTitle, noticeMessage, refreshing]);

  // Leaving the page must not leave a stale complaint on screen behind it.
  useEffect(() => () => dismissToast(CHAIN_TOAST_ID), []);

  /** The referrer's commission as it would stand at this instant: ETH brought
   *  in (the mirror's number) and the chain's own sale ratio. It is only earned
   *  once BOTH referrer thresholds are met, so below them it says what is missing. */
  const referralReward = useMemo<
    { kind: "unknown" } | { kind: "none"; sentence: string } | { kind: "some"; text: string }
  >(() => {
    const rs = referral.state;
    if (!rs) return { kind: "unknown" };
    if (!rs.qualifiesNow) {
      const minEth = formatEth(rs.rules.minReferredWei);
      return {
        kind: "none",
        sentence: `Nothing yet. You qualify once ${rs.rules.minReferredWallets} people have used your code and put in ${minEth} ETH between them.`,
      };
    }
    const referredWei = BigInt(rs.referredWei);
    const ethPart = `${formatEth((referredWei * BigInt(COMMISSION_BPS.referrerEth)) / 10_000n)} ETH`;
    const raised = sale?.totalRaised;
    const pool = sale?.tokensForSale;
    if (raised === undefined || pool === undefined || raised === 0n || dec === undefined) {
      return { kind: "some", text: ethPart };
    }
    const tokens = (pool * referredWei * BigInt(COMMISSION_BPS.referrerTokens)) / raised / 10_000n;
    return { kind: "some", text: `${ethPart} + about ${fmtTokens(tokens, dec)} ${sym}` };
  }, [referral.state, sale?.totalRaised, sale?.tokensForSale, dec, sym]);


  /** The referral row, placed directly above the contribute button so nobody
   *  pays without seeing it. Its one button always does the next right thing. */
  const linkCodeReady = referral.linkCode.kind === "valid" ? referral.linkCode.code : null;
  const referralRow = (() => {
    const usedCode = referral.state?.usedCode ?? null;
    if (usedCode) {
      return (
        <ReferralRow tone="done" icon={<Check className="size-4" aria-hidden />}
          title={`Code ${usedCode} applied`} sub={`You get ${REFERRED_BUYER_PCT}% more tokens at the close.`} />
      );
    }
    if (!wallet.isConnected) {
      return (
        <ReferralRow tone="invite" icon={<Gift className="size-4" aria-hidden />}
          title={linkCodeReady ? `Code ${linkCodeReady} is ready to use` : "Have a referral code?"}
          sub={`Connect, then add it before you contribute for ${REFERRED_BUYER_PCT}% more tokens.`} />
      );
    }
    if (referral.bindWindow === "open") {
      return (
        <ReferralRow tone="invite" icon={<Gift className="size-4" aria-hidden />}
          title={linkCodeReady ? `Apply code ${linkCodeReady}` : "Add a referral code first"}
          sub={`${REFERRED_BUYER_PCT}% more tokens. Only possible before your first contribution.`}
          action={linkCodeReady ? "APPLY" : "ADD CODE"} onAction={() => setGateOpen(true)} />
      );
    }
    if (referral.bindWindow === "closed") {
      return (
        <ReferralRow tone="muted" icon={<Gift className="size-4" aria-hidden />}
          title="No referral code on this wallet"
          sub="Codes can only be added before a first contribution. You can still earn by sharing yours."
          action="MY LINK" onAction={() => setTerminalTab("referral")} />
      );
    }
    if (referral.status === "error") {
      return (
        <ReferralRow tone="muted" icon={<Gift className="size-4" aria-hidden />}
          title="We could not check your referral status"
          sub="Nothing changed on your wallet. Try again in a moment."
          action="RETRY" onAction={() => void referral.refresh()} />
      );
    }
    return (
      <ReferralRow tone="muted" icon={<Gift className="size-4" aria-hidden />}
        title="Checking your referral status…" sub="One moment." />
    );
  })();

  const walletState: SaleWalletState = !wallet.isConnected ? "disconnected" : walletOk ? "ready" : "wrong-network";

  return (
    <NoirShell>
      {/* full-bleed backdrop: courtroom vignette + grain, same pattern as the
          other interior pages; pointer-events-none so chrome stays clickable */}
      <PageBackdrop src="/backgrounds/token-sale-bg.webp" />

      <div className="relative z-[2]">
        {/* Title and address on the left, the countdown beside them from lg up; stacked below that. */}
        <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-8 lg:pr-6">
        <div className="min-w-0">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-3">
              <span className="text-[12px] font-semibold tracking-[0.3em] text-white">
                PUBLIC TOKEN SALE · {chain.name.toUpperCase()}
              </span>
              <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] ${state?.tone ?? "border-[#2a2a2a] text-[#8a8a8a]"}`}>
                {st === SALE_STATE.ACTIVE && live && <LiveDot on />}
                {chip}
              </span>
            </span>
          }
          title={`$${TOKEN_SYMBOL}`}
          // PageHeader wraps `subline` in a <p>, so everything here has to be
          // phrasing content. A <div>/<p> in this slot is invalid HTML and
          // React fails hydration on the whole page, not just this block.
          subline={
            <>
              <span className="mb-1 block font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#ccff00] not-italic">
                ROBINHOOD CHAIN PUBLIC SALE
              </span>
              <span className="block text-xs text-[#a0a09a] sm:text-sm">
                {state ? state.line : "A fair launch for a more open financial future."}
              </span>
            </>
          }
        />

        <div className="px-4 pb-5 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-[#ccff00]">CONTRACT ADDRESS</p>
            <a
              href={TOKEN_EXPLORER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block break-all font-mono text-[15px] font-bold text-white transition-colors hover:text-[#ccff00] sm:text-[18px]"
            >
              {TOKEN_ADDRESS}
            </a>
          </div>
        </div>
        </div>
        <div className="flex flex-col items-center gap-4 px-4 pb-6 sm:px-6 lg:items-end lg:px-0 lg:pb-5 lg:pt-12">
          <SaleClock schedule={schedule} renderedAt={renderedAt} referrals={false} contract={contractPhase} onSalePage />
          <AddToWalletButton variant="pill" />
        </div>
        </div>

        <Marquee />

        {/* ── THE VAULT: raised, implied price, headcount, pool ── */}
        <section className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
          <div className="noir-card border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c] overflow-hidden">
            <div className="flex flex-col items-start gap-1.5 border-b border-[#2a2a2a] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6 sm:py-3">
              <span className="font-mono text-[12px] font-bold tracking-[0.14em] text-white sm:tracking-[0.22em]">
                THE VAULT · LIVE ON-CHAIN
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
                <LiveDot on={live} />
                {unset
                  ? dateChip
                  : live
                    ? "LIVE READ"
                    : staleLabel
                      ? `LAST READ ${staleLabel.toUpperCase()}`
                      : "AWAITING FIRST READ"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-[#2a2a2a] lg:grid-cols-3">
              <Cell label="RAISED SO FAR" value={raisedLabel} unit="ETH" accent big unset={unset} hint="committed over the life of the sale" />
              <Cell
                label="RAISED IN USD"
                value={raisedUsdLabel}
                big
                unset={unset}
                hint="raised ETH at the live ETH price"
              />
              <Cell
                label="ETH PRICE"
                value={ethPriceLabel}
                big
              />
              <Cell
                label={priceLabel}
                value={impliedPrice === null ? "—" : ethUsd === null ? fmtPrice(impliedPrice) : fmtUsdPrice(impliedPrice * ethUsd)}
                unit={impliedPrice === null || ethUsd !== null ? undefined : "ETH"}
                big
                unset={unset}
                hint={impliedPrice !== null && ethUsd !== null ? `${fmtPrice(impliedPrice)} ETH, ${priceHint}` : priceHint}
              />
              <Cell
                label="UNIQUE BACKERS"
                value={sale?.contributorCount === undefined ? "—" : String(Number(sale.contributorCount))}
                big
                unset={unset}
                hint="unique wallets"
              />
              <Cell
                label="TOKEN POOL"
                value={sale?.tokensForSale === undefined || dec === undefined ? "—" : fmtTokens(sale.tokensForSale, dec)}
                big
                unset={unset}
                hint="fixed, shared pro-rata"
              />
            </div>
            {poolDrift && sale?.tokensForSale !== undefined && dec !== undefined && (
              <div className="px-5 py-3 border-t border-[#2a2a2a] bg-[#1c1a14]">
                <p className="text-xs leading-relaxed text-[#d9c96a]">
                  The contract&apos;s sale pool ({fmtTokens(sale.tokensForSale, dec)} {sym}) does not match
                  the {SALE_TOKENS.toLocaleString('en-US')} published on the tokenomics page. All pricing on THIS
                  page reads from the contract.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── REFERRAL ACCELERATOR BANNER: full width, matching THE VAULT above.
            Phone view repeats this directly above YOUR POSITION instead (see the
            lg:hidden copy in the left column) — hidden here below `lg` so the
            banner is not shown twice on one screen. ── */}

        {/* ── CORE 2-COLUMN COCKPIT GRID ── */}
        <div className="mx-auto grid max-w-6xl items-start gap-6 px-4 pt-6 pb-6 sm:px-6 grid-cols-1 lg:grid-cols-12">
          {/* ── LEFT COLUMN: ANALYTICS, PROJECTION & STAKE (7 cols) ── */}
          <div className="lg:col-span-7 min-w-0 flex flex-col gap-6">
            {/* One banner, top of the left column: beside the card on desktop, straight after it on a phone. */}
            <AcceleratorBanner onGetLink={scrollToReferral} />
            {/* Card 1: Interactive Raise & Pro-Rata Allocation Curve */}
            <section className="noir-card rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] overflow-hidden">
              <div className="flex flex-col items-start gap-2 border-b border-[#2a2a2a] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-bold tracking-[0.14em] text-white sm:text-[13px] sm:tracking-[0.22em]">
                    LIVE RAISE &amp; PRO-RATA ALLOCATION CURVE
                  </span>
                  <InfoTooltip
                    text="What your allocation and token price become as the total ETH raise scales up or down."
                    label="Raise Projection"
                  />
                </div>
                <span className="rounded-full bg-[#ccff00]/10 border border-[#ccff00]/30 px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-[#ccff00]">
                  TOKENS
                </span>
              </div>
              <RaiseProjection
                raisedEth={raised}
                poolTokens={poolWholeTokens ?? SALE_TOKENS}
                yourEth={yourEth}
                unset={unset}
              />
            </section>


            {/* Card 2: YOUR POSITION — full width of the left column, matching the curve card above it */}
            <section className="noir-card border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c] p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-[#2a2a2a] pb-3 mb-3">
                  <span className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">
                    YOUR POSITION
                  </span>
                  {wallet.isConnected && wallet.address ? (
                    <span className="font-mono text-[10px] tracking-[0.14em] text-[#8fbf6a] flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-[#8fbf6a]" />
                      {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] tracking-[0.14em] text-[#6f6f6f]">
                      DISCONNECTED
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-3">
                    <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white">COMMITTED</p>
                    <p className="mt-1 font-mono text-xs sm:text-sm font-bold text-[#ededea] truncate">
                      {!wallet.isConnected
                        ? "0.000 ETH"
                        : mine?.contributed === undefined
                          ? "—"
                          : `${formatEther(mine.contributed)} ETH`}
                    </p>
                  </div>
                  <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-3">
                    {/* An ABANDONED sale delivers no tokens, so a token
                        allocation is the wrong quantity to show in it: what
                        the wallet gets back is its ETH. Showing "estimated
                        share" here told a refund case it was owed tokens. */}
                    <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white">
                      {st === SALE_STATE.ABANDONED
                        ? "REFUNDABLE"
                        : st === SALE_STATE.CLOSED
                          ? "YOUR SHARE"
                          : "ESTIMATED SHARE"}
                    </p>
                    <p className="mt-1 truncate font-mono text-xs font-bold text-[#ccff00] sm:text-sm">
                      {!wallet.isConnected
                        ? "—"
                        : st === SALE_STATE.ABANDONED
                          ? mine?.contributed === undefined
                            ? "—"
                            : `${formatEther(mine.contributed)} ETH`
                          : mine?.allocation === undefined || dec === undefined
                            ? "—"
                            : `${fmtTokens(mine.allocation, dec)} ${sym}`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3 border-t border-[#2a2a2a] pt-2.5">
                {!wallet.isConnected ? (
                  <p className="text-[11px] leading-relaxed text-[#6f6f6f]">
                    Connect wallet to view active allocation.
                  </p>
                ) : (
                  <>
                    {mine?.claimed && (
                      <p className="flex items-center gap-1.5 font-mono text-xs text-[#8fbf6a]">
                        <Check className="size-3.5 flex-none" aria-hidden />
                        Tokens claimed, in your wallet
                      </p>
                    )}
                    {mine?.refunded && (
                      <p className="flex items-center gap-1.5 font-mono text-xs text-[#d9c96a]">
                        <Check className="size-3.5 flex-none" aria-hidden />
                        Refund claimed, in your wallet
                      </p>
                    )}
                    {!!mine?.stray && mine.stray > 0n && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#8a8a8a]">Stray: {formatEther(mine.stray)} ETH</span>
                        <MiniBtn
                          disabled={!canStray || busy !== null}
                          onClick={() => sendTx("Stray claim", encodeFunctionData({ abi: tokenSaleAbi, functionName: "claimStray" }))}
                        >
                          {busy === "Stray claim" ? "…" : "PULL BACK"}
                        </MiniBtn>
                      </div>
                    )}
                    {!mine?.claimed && !mine?.refunded && (!mine?.stray || mine.stray === 0n) && (
                      <p className="text-[11px] text-[#8a8a8a]">
                        Claim your tokens within 60 days of the close.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          </div>

          {/* ── RIGHT COLUMN: ACTION TERMINAL (5 cols) ── */}
          <div ref={swapColRef} className={`order-first min-w-0 flex flex-col gap-6 lg:order-none lg:col-span-5 ${swapTall ? "" : "lg:sticky lg:top-6"}`}>
            <SwapFrame bodyClassName="min-h-[600px]">
              <div className="space-y-3 p-3 sm:p-4">
                {/* heading, the /swap card's own */}
                <div className="flex items-center justify-between gap-2 px-1 pt-1">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-semibold leading-7 tracking-[-0.035em] text-white">Token sale</h2>
                    <p className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium leading-4 tracking-[0.12em] text-[#8c928c]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/brand/robinhood.svg" alt="" className="size-3 flex-none object-contain" />
                      <span className="truncate">{chain.name.toUpperCase()}</span>
                    </p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] ${state?.tone ?? "border-white/[0.08] text-[#8c928c]"}`}>
                    {st === SALE_STATE.ACTIVE && live && <LiveDot on />}
                    {state || unset ? chip : "READING…"}
                  </span>
                </div>

                {/* The two jobs of this card, as two big tabs: nobody should hunt for referrals. */}
                <div role="tablist" aria-label="Sale actions" className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.08] bg-[#171919] p-1">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={terminalTab === "contribute"}
                    onClick={() => setTerminalTab("contribute")}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors ${
                      terminalTab === "contribute"
                        ? "bg-[#ccff00] text-[#0a0b0b] shadow-[0_2px_12px_#ccff0026]"
                        : "text-[#a1a69f] hover:text-[#f3f4ef]"
                    }`}
                  >
                    <Zap className="size-4" aria-hidden />
                    {st === SALE_STATE.CLOSED ? "Claim" : st === SALE_STATE.ABANDONED ? "Refund" : "Contribute"}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={terminalTab === "referral"}
                    onClick={() => setTerminalTab("referral")}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors ${
                      terminalTab === "referral"
                        ? "bg-[#ccff00] text-[#0a0b0b] shadow-[0_2px_12px_#ccff0026]"
                        : "text-[#ccff00] hover:bg-white/[0.04]"
                    }`}
                  >
                    <Gift className="size-4" aria-hidden />
                    <span>Refer<span className="hidden sm:inline"> &amp; airdrop</span></span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${terminalTab === "referral" ? "bg-[#0a0b0b]/15" : "bg-[#ccff00]/15"}`}>
                      +{REFERRER_PCT}%
                    </span>
                  </button>
                </div>

                {terminalTab === "contribute" ? (
                  <TokenSaleSwap
                    sale={sale ?? { faults: [] }}
                    quote={quote}
                    sym={sym}
                    decimals={dec}
                    balanceWei={walletBalance?.value}
                    admission={admission ?? (overBalance ? "That is more ETH than the connected wallet holds." : null)}
                    canBuy={canBuy}
                    busy={busy}
                    amount={amount}
                    setAmount={setAmount}
                    onContribute={contribute}
                    onClaim={claim}
                    canClaim={canClaim}
                    onRefund={refund}
                    canRefund={canRefund}
                    minInitial={sale?.minInitialContribution}
                    step={sale?.contributionStep}
                    walletError={wallet.error}
                    walletState={walletState}
                    connecting={wallet.isLoading}
                    onConnect={() => void wallet.connect()}
                    onPrepareConnect={wallet.prepare}
                    onSwitchNetwork={() =>
                      void switchChainAsync({ chainId: chain.id }).catch(() => {
                        toast.error(`Could not switch networks. Change your wallet to ${chain.name}, then try again.`, {
                          id: TX_TOAST_ID,
                          duration: ONE_SHOT_MS,
                        });
                      })
                    }
                    priceLabel={impliedPrice === null || st === SALE_STATE.ABANDONED ? null : fmtPrice(impliedPrice)}
                    referralRow={st === SALE_STATE.CLOSED || st === SALE_STATE.ABANDONED ? null : referralRow}
                    chainName={chain.name}
                    unset={unset}
                  />
                ) : (
                  <div className="space-y-3">
                    {/* The three ways to earn, stated before anything asks for a click. */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { big: `+${REFERRED_BUYER_PCT}%`, small: "tokens when you use a code before buying" },
                        { big: `${REFERRER_PCT}% + ${REFERRER_ETH_PCT}%`, small: "tokens and ETH from people who use yours" },
                        { big: "At close", small: "rewards are paid out after the sale ends" },
                      ].map((c) => (
                        <div key={c.big} className="rounded-2xl border border-white/[0.07] bg-[#0d0f0f] p-3">
                          <p className="text-base font-semibold tracking-[-0.02em] text-[#ccff00]">{c.big}</p>
                          <p className="mt-1 text-[11px] leading-4 text-[#a5aba3]">{c.small}</p>
                        </div>
                      ))}
                    </div>
                    <ReferralPanel referral={referral} connected={wallet.isConnected} />
                    {!wallet.isConnected && (
                      <button
                        type="button"
                        onMouseEnter={wallet.prepare}
                        onClick={() => void wallet.connect()}
                        disabled={wallet.isLoading}
                        className="flex w-full items-center justify-center rounded-full border border-[#ccff00] bg-[#ccff00] py-4 text-[15px] font-semibold text-[#0a0b0b] transition-colors hover:bg-[#b8e600] disabled:opacity-40"
                      >
                        {wallet.isLoading ? "CONNECTING…" : "CONNECT WALLET"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </SwapFrame>

            {/* Card 2B: REFERRAL HUB — full width of the right column, matching the terminal above it */}
            <section className="noir-card rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-[#2a2a2a] pb-3 mb-3">
                  <span className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">
                    REFERRAL HUB
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.14em] text-[#ccff00] border border-[#ccff00]/30 bg-[#ccff00]/10 px-2 py-0.5 rounded-full">
                    {REFERRER_PCT}% COMMISSION
                  </span>
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-[11px] font-semibold tracking-[0.18em] text-white">
                    YOUR REFERRAL CODE:
                  </span>
                  {referral.state?.myCode ? (
                    <>
                      <span className="truncate font-mono text-xs font-bold tracking-[0.1em] text-[#ccff00] sm:text-sm">
                        {referral.state.myCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyToClipboard("code", referral.state?.myCode ?? "")}
                        className="flex-none p-0.5 text-[#8a8a8a] transition-colors hover:text-[#ccff00]"
                        title="Copy referral code"
                        aria-label="Copy referral code"
                      >
                        {copiedRef === "code" ? (
                          <Check className="size-3.5 text-[#ccff00]" aria-hidden />
                        ) : (
                          <Copy className="size-3.5" aria-hidden />
                        )}
                      </button>
                    </>
                  ) : (
                    <span className="min-w-0 truncate text-[11px] leading-snug text-[#6f6f6f]">
                      {wallet.isConnected ? "Contribute to unlock" : "Connect wallet"}
                    </span>
                  )}
                </div>

                {referral.state?.myCode && (
                  <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2">
                    <span className="truncate font-mono text-[11px] text-[#8a8a8a]">
                      {origin ? referralLink(origin, referral.state.myCode) : "…"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (referral.state?.myCode) {
                          const l = referralLink(origin, referral.state.myCode);
                          void copyToClipboard("link", l);
                        }
                      }}
                      className="ml-1 flex-none p-1 text-[#8a8a8a] transition-colors hover:text-[#ccff00]"
                      title="Copy referral link"
                      aria-label="Copy referral link"
                    >
                      {copiedRef === "link" ? (
                        <Check className="size-3.5 text-[#ccff00]" aria-hidden />
                      ) : (
                        <Copy className="size-3.5" aria-hidden />
                      )}
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-[#2a2a2a] pt-2.5">
                <div>
                  <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white">ETH BROUGHT IN</p>
                  <p className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-[#ededea]">
                    {referral.state ? `${formatEth(referral.state.referredWei)} ETH` : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white">PEOPLE REFERRED</p>
                  <p className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-[#ededea]">
                    {referral.state ? referral.state.referredCount : "—"}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 border-t border-[#2a2a2a] pt-2.5">
                <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white">YOUR REWARD IF THE SALE CLOSED NOW</p>
                <p className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-[#ccff00]">
                  {referralReward.kind === "unknown"
                    ? "—"
                    : referralReward.kind === "none"
                      ? <span className="font-sans text-[11px] font-normal text-[#8a8a8a]">{referralReward.sentence}</span>
                      : referralReward.text}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-[#6f6f6f]">
                  {REFERRER_ETH_PCT}% of the ETH your people put in, plus {REFERRER_PCT}% of the tokens they receive. Final at the close.
                </p>
              </div>
            </section>
          </div>
        </div>

        {/* ── BELOW THE FOLD: MODULAR 2x2 BENTO GRID & FAQ ── */}
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 space-y-6">
          {status === "loading" && !unset && (
            <p className="noir-card border border-[#1f1f1f] bg-[#141414] px-4 py-3 text-sm text-[#a0a09a]">
              <span className="inline-block size-2 animate-pulse rounded-full bg-[#8a8a8a] align-middle mr-2" />{" "}
              Reading the sale contract…
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* 1. How this sale works */}
            <section className="noir-card border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c] flex flex-col justify-between overflow-hidden">
              <div>
                <div className="flex items-center gap-3 border-b border-[#2a2a2a] px-4 py-4 sm:px-5">
                  <CardGlyph icon={ClipboardList} />
                  <div>
                    <h2 className="text-[16px] font-semibold tracking-[0.01em] text-white sm:text-[19px]">
                      How This Sale Works
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#8a8a8a]">A simple, transparent process.</p>
                  </div>
                </div>
                <ol className="divide-y divide-[#2a2a2a]">
                  <Step
                    n="01"
                    title="Commit ETH while it's open"
                    desc="Your contribution sits in the sale contract, counted, unspent. It buys nothing yet. No price exists until the close."
                  />
                  <Step
                    n="02"
                    title="The pool is split pro-rata at the close"
                    desc="The moment the sale ends, the price is fixed: your share of the ETH raised is your share of the token pool. Two people who paid the same paid the same, regardless of timing."
                  />
                  <Step
                    n="03"
                    title="You pull. Always you."
                    desc="Tokens are claimed from the contract after the close. Claim within 60 days, because anything still unclaimed after that can be burned. If the sale is abandoned instead, every wei comes back the same way, with no deadline."
                  />
                </ol>
              </div>
            </section>

            {/* 2. Why this one is different */}
            <section className="noir-card border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c] flex flex-col justify-between overflow-hidden">
              <div>
                <div className="flex items-center gap-3 border-b border-[#2a2a2a] px-4 py-4 sm:px-5">
                  <CardGlyph icon={ShieldCheck} />
                  <div>
                    <h2 className="text-[16px] font-semibold tracking-[0.01em] text-white sm:text-[19px]">
                      Why This One Is Different
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#8a8a8a]">Built for on-chain integrity.</p>
                  </div>
                </div>
                <div className="divide-y divide-[#2a2a2a]">
                  {CONTRASTS.map((c) => (
                    <div key={c.title} className="flex items-start gap-3 px-4 py-3.5 sm:gap-3.5 sm:px-5 sm:py-4">
                      <span className="mt-0.5 grid size-7 flex-none place-items-center border border-[#2a2a2a] bg-[#0a0a0a] text-[#ccff00]">
                        <c.icon className="size-3.5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold leading-snug text-[#ededea]">
                          {c.title}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-snug text-[#8a8a8a]">
                          {c.sub}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 3. Tokenomics & Implied FDV */}
            <section className="noir-card border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c] flex flex-col justify-between overflow-hidden">
              <div>
                <div className="flex items-center gap-3 border-b border-[#2a2a2a] px-4 py-4 sm:px-5">
                  <CardGlyph icon={BarChart3} />
                  <div>
                    <h2 className="text-[16px] font-semibold tracking-[0.01em] text-white sm:text-[19px]">
                      Tokenomics &amp; Implied FDV
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#8a8a8a]">Fair-launch price telemetry.</p>
                  </div>
                </div>
                <div className="p-5">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                      <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white">
                        {saleClosed ? "FAIR-LAUNCH PRICE" : "FAIR-LAUNCH PRICE NOW"}
                      </p>
                      <div className="mt-1.5 font-mono text-xl font-bold text-[#ededea]">
                        {unset ? (
                          <UnsetBar className="h-6 w-24" />
                        ) : status === "loading" && liveProj.kind === "unavailable" ? (
                          <ShimmerBlock className="h-6 w-24 rounded" />
                        ) : showImplied && liveProj.kind === "implied" ? (
                          `${fmtPrice(liveProj.fairLaunchPrice)} ETH`
                        ) : (
                          "—"
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-[#6f6f6f]">raised ÷ sale pool</p>
                    </div>
                    <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                      <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-white">
                        {saleClosed ? "IMPLIED FDV" : "IMPLIED FDV NOW"}
                      </p>
                      <div className="mt-1.5 font-mono text-xl font-bold text-[#ededea]">
                        {unset ? (
                          <UnsetBar className="h-6 w-24" />
                        ) : status === "loading" && liveProj.kind === "unavailable" ? (
                          <ShimmerBlock className="h-6 w-24 rounded" />
                        ) : showImplied && liveProj.kind === "implied" ? (
                          `${fmtPrice(liveProj.fairLaunchFdv)} ETH`
                        ) : (
                          "—"
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-[#6f6f6f]">price × total supply</p>
                    </div>
                  </div>
                  {saleAbandoned ? (
                    <p className="mt-3 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-3 text-xs text-[#a0a09a]">
                      The sale was abandoned, so no price was set. Every contribution is refundable.
                    </p>
                  ) : liveProj.kind === "zero" ? (
                    <p className="mt-3 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-3 text-xs text-[#a0a09a]">
                      {saleClosed
                        ? "The sale closed without raising anything, so no price was set."
                        : "The sale has raised nothing yet. The first contribution creates the price."}
                    </p>
                  ) : liveProj.kind === "implied" ? (
                    <p className="mt-3 text-xs leading-relaxed text-[#8a8a8a]">
                      {saleClosed
                        ? "Final. The sale has closed, so this is the price every buyer paid."
                        : "Implied so far, not final. Every contribution moves these numbers until the close."}
                    </p>
                  ) : null}
                  {/* The hero's BLACK button (app/page.tsx's /ledger CTA):
                      dark fill, light shadow, halftone-dark — the other half
                      of the site's one CTA pair, paired here with View All's
                      white one so the two bento cards read as a set. */}
                  <Link
                    href="/tokenomics"
                    className="brutalist-box brutalist-shadow-light brutalist-pressable halftone-dark mt-4 flex w-full cursor-pointer items-center justify-center gap-1.5 border-[#EDEDEA] bg-[#0A0A0A] py-2.5 font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#EDEDEA] no-underline"
                  >
                    VIEW FULL TOKENOMICS
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </section>

            {/* 4. Community Leaderboards */}
            <section className="noir-card border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c] flex flex-col justify-between overflow-hidden">
              <div>
                <div className="flex items-center justify-between gap-3 border-b border-[#2a2a2a] px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-3">
                    <CardGlyph icon={Users} />
                    <div>
                      <h2 className="text-[16px] font-semibold tracking-[0.01em] text-white sm:text-[19px]">
                        Community Leaderboards
                      </h2>
                      <p className="mt-0.5 text-[11px] leading-snug text-[#8a8a8a]">Top contributors and referrers.</p>
                    </div>
                  </div>
                  {/* The two board tabs now live where "View All" used to —
                      that link moved below the (now faded) list itself. */}
                  <div className="flex flex-none items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveBoard("contributions")}
                      title="Top contributors"
                      className={`flex min-h-7 items-center gap-1 rounded-full px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em] transition-colors ${
                        activeBoard === "contributions"
                          ? "bg-[#ccff00] text-[#0a0a0a]"
                          : "border border-[#2a2a2a] text-[#8a8a8a] hover:border-[#4a4a4a]"
                      }`}
                    >
                      <Coins className="size-3" aria-hidden />
                      <span className="hidden sm:inline">CONTRIBUTORS</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveBoard("referrals")}
                      title="Top referrers"
                      className={`flex min-h-7 items-center gap-1 rounded-full px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em] transition-colors ${
                        activeBoard === "referrals"
                          ? "bg-[#ccff00] text-[#0a0a0a]"
                          : "border border-[#2a2a2a] text-[#8a8a8a] hover:border-[#4a4a4a]"
                      }`}
                    >
                      <Gift className="size-3" aria-hidden />
                      <span className="hidden sm:inline">REFERRERS</span>
                    </button>
                  </div>
                </div>
                <div className="p-5">
                  {boardStatus === "loading" ? (
                    <>
                      <div className="relative max-h-[335px] overflow-hidden">
                        <LeaderboardTable
                          board={activeBoard}
                          rows={[]}
                          loading
                          compact
                          emptyMessage=""
                        />
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#141414] via-[#141414]/80 to-transparent"
                        />
                      </div>
                      <div className="mt-3 flex w-full items-center justify-center py-2.5">
                        <ShimmerBlock className="h-9 w-full rounded" />
                      </div>
                    </>
                  ) : boardRows.length > 0 ? (
                    <>
                      {/* Top 3 stand full-strength; the fade starts into the
                          4th row and the 5th is cut at half height, so the
                          card reads as a preview rather than the whole board. */}
                      <div className="relative max-h-[335px] overflow-hidden">
                        <LeaderboardTable
                          board={activeBoard}
                          rows={boardRows}
                          highlightWallet={wallet.address}
                          compact
                          emptyMessage=""
                        />
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#141414] via-[#141414]/80 to-transparent"
                        />
                      </div>
                      {/* The site's one CTA treatment (app/page.tsx's hero
                          buttons): squared border, hard offset shadow, halftone
                          fill, press-to-flatten on hover — not a plain text link. */}
                      <Link
                        href={`/leaderboard?board=${activeBoard}`}
                        className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 border-[#EDEDEA] bg-[#EDEDEA] py-2.5 font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#0A0A0A] no-underline"
                      >
                        View All
                        <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    </>
                  ) : (
                    <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-6 text-center">
                      <p className="font-mono text-xs text-[#8a8a8a]">
                        {activeBoard === "contributions"
                          ? "No contributions recorded yet. Be the first to claim #1 on the leaderboard."
                          : "No referral volume recorded yet. Share your link to rank #1 among referrers."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>

          {/* FAQ Accordion */}
          <section className="noir-card border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c] overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[#2a2a2a] px-4 py-4 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <CardGlyph icon={HelpCircle} />
                <h2 className="text-[16px] font-semibold tracking-[0.01em] text-white sm:text-[19px]">
                  Frequently Asked Questions
                </h2>
              </div>
              <span className="font-mono text-[10px] text-[#6f6f6f] border border-[#2a2a2a] px-2 py-0.5 rounded-full">
                {SALE_FAQ.length} items
              </span>
            </div>
            <div className="divide-y divide-[#2a2a2a]">
              {FAQ_GROUPS.map((g) => {
                const rows = SALE_FAQ.filter((f) => f.group === g.key);
                if (rows.length === 0) return null;
                return (
                  <div key={g.key}>
                    <p className="bg-[#0f0f0f] px-4 py-2 font-mono text-[12px] font-bold tracking-[0.22em] text-white sm:px-5">
                      {g.label}
                    </p>
                    <div className="divide-y divide-[#2a2a2a]">
                      {rows.map((f) => {
                        const open = openFaq === f.q;
                        return (
                          <div key={f.q}>
                            <button
                              type="button"
                              className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left text-sm font-semibold text-[#ededea] transition-colors hover:text-[#ccff00] sm:items-center sm:px-5"
                              onClick={() => setOpenFaq(open ? null : f.q)}
                              aria-expanded={open}
                            >
                              {f.q}
                              <Plus
                                aria-hidden
                                className={`mt-0.5 size-4 flex-none text-[#8a8a8a] transition-transform duration-200 sm:mt-0 ${open ? "rotate-45 text-[#ccff00]" : ""}`}
                              />
                            </button>
                            {open && (
                              <p className="px-4 pb-5 text-xs leading-relaxed text-[#a0a09a] sm:px-5">
                                {f.a}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Mounted, not flagged: the gate's own step resets by being a fresh
          component, so reopening never lands on the confirmation screen. */}
      {gateOpen && (
        <ReferralGate
          state={referral.state}
          bindWindow={referral.bindWindow}
          linkCode={referral.linkCode}
          lockedCode={referral.lockedCode}
          prefillCode={referral.prefillCode}
          busy={referral.applyPhase}
          error={referral.error}
          onApply={async (code) => {
            const ok = await referral.bind(code);
            // Code added: close the gate and let them press Contribute again.
            // The transaction is NOT auto-sent — they came here to add a code,
            // and firing a payment off the back of that click is not what they
            // asked for.
            if (ok) setGateOpen(false);
            return ok;
          }}
          onDismiss={() => setGateOpen(false)}
          onProceed={() => {
            setGateOpen(false);
            void sendContribution();
          }}
        />
      )}
    </NoirShell>
  );
}

/* ------------------------------------------------------------------ */

function Cell({
  label,
  value,
  hint,
  unit,
  accent = false,
  big = false,
  unset = false,
}: {
  label: string;
  value: string;
  hint?: string;
  unit?: string;
  accent?: boolean;
  big?: boolean;
  /** No sale contract is configured, so `value` was never read from anything. */
  unset?: boolean;
}) {
  return (
    <div className="bg-[#141414] px-4 py-3.5 sm:px-5 sm:py-6 transition-colors hover:bg-[#171717]">
      <p className="font-mono text-[11px] font-semibold tracking-[0.12em] text-white sm:text-[12px] sm:tracking-[0.2em]">{label}</p>
      <p className={`mt-1.5 font-bold tabular-nums sm:mt-2 ${big ? "font-cinzel text-xl sm:text-3xl" : "text-xl"} ${accent ? "text-[#ccff00]" : "text-[#ededea]"}`}>
        {/* The unit goes with it. "— ETH" reads as a denominated amount we
            failed to fetch; there is no amount and no sale to denominate. */}
        {unset ? <UnsetBar className={big ? "h-7 w-32" : "h-5 w-24"} /> : value}
        {!unset && unit && value !== "—" && <span className="ml-2 font-sans text-sm font-normal text-[#a0a09a]">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-[#6f6f6f]">{hint}</p>}
    </div>
  );
}

/** One referral line in the contribute card. `invite` is the loud one: lime border and a lime button. */
function ReferralRow({
  tone,
  icon,
  title,
  sub,
  action,
  onAction,
}: {
  tone: "invite" | "done" | "muted";
  icon: ReactNode;
  title: string;
  sub: string;
  action?: string;
  onAction?: () => void;
}) {
  const frame = {
    invite: "border-[#ccff00]/45 bg-[#ccff00]/[0.06]",
    done: "border-[#8fbf6a]/40 bg-[#8fbf6a]/[0.06]",
    muted: "border-white/[0.07] bg-[#0d0f0f]",
  }[tone];
  const iconTone = { invite: "text-[#ccff00]", done: "text-[#8fbf6a]", muted: "text-[#8c928c]" }[tone];
  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${frame}`}>
      <span className={`flex-none ${iconTone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5 text-[#f1f3ee]">{title}</p>
        <p className="text-xs leading-4 text-[#a5aba3]">{sub}</p>
      </div>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={`flex-none rounded-full px-3.5 py-2 text-[11px] font-bold tracking-[0.08em] transition-colors ${
            tone === "invite"
              ? "bg-[#ccff00] text-[#0a0b0b] hover:bg-[#b8e600]"
              : "border border-white/[0.12] text-[#e2e5df] hover:border-[#ccff00]/40 hover:text-[#ccff00]"
          }`}
        >
          {action}
        </button>
      )}
    </div>
  );
}

/** The lime tile that fronts every card heading below the fold. */
function CardGlyph({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-8 flex-none place-items-center rounded-xl border border-[#ccff00]/25 bg-[#ccff00]/10 text-[#ccff00]">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}



function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-center gap-3.5 min-w-0">
        <span className="font-cinzel text-base font-black text-[#4a4a4a] flex-none">{n}</span>
        <span className="text-sm font-semibold text-[#ededea] truncate">{title}</span>
      </div>
      <InfoTooltip text={desc} label={title} align="auto" />
    </li>
  );
}

function MiniBtn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="border border-[#2a2a2a] px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-30"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/**
 * The referral banner. Rendered twice by the page — full width below the
 * cockpit grid on `lg`+, and again above YOUR POSITION on phone view — so it
 * lives here once rather than twice.
 *
 * The layered-chevron field is BUILT, not an image: a diamond mosaic (Lea
 * Verou's four-triangle recipe, one linear-gradient per corner of the tile,
 * hard 25% stops) tiled at two scales for depth, plus one radial glow behind
 * the CTA. Gradients cost no request and no decode, and they resize with the
 * strip rather than being cropped by it, which is what the profile-banner
 * JPEG got wrong here.
 *
 * Every facet is lime at 1-7% alpha over the flat card colour, so the pattern
 * stays under the text instead of competing with it. aria-hidden +
 * pointer-events-none: the CTA is the only target.
 */
function AcceleratorBanner({ onGetLink }: { onGetLink: () => void }) {
  return (
    <div className="relative isolate overflow-hidden border border-[#2a2a2a] bg-[#141414] px-3 py-2.5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* large diamonds — the layered-paper depth, faintest */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              "linear-gradient(135deg, rgba(204,255,0,0.035) 25%, transparent 25%)",
              "linear-gradient(225deg, rgba(204,255,0,0.035) 25%, transparent 25%)",
              "linear-gradient(315deg, rgba(204,255,0,0.035) 25%, transparent 25%)",
              "linear-gradient(45deg, rgba(204,255,0,0.035) 25%, rgba(204,255,0,0.01) 25%)",
            ].join(", "),
            backgroundPosition: "-32px 0, -32px 0, 0 0, 0 0",
            backgroundSize: "64px 64px",
          }}
        />
        {/* small diamonds — the crisp facet grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              "linear-gradient(135deg, rgba(204,255,0,0.06) 25%, transparent 25%)",
              "linear-gradient(225deg, rgba(204,255,0,0.06) 25%, transparent 25%)",
              "linear-gradient(315deg, rgba(204,255,0,0.06) 25%, transparent 25%)",
              "linear-gradient(45deg, rgba(204,255,0,0.06) 25%, rgba(204,255,0,0.02) 25%)",
            ].join(", "),
            backgroundPosition: "-16px 0, -16px 0, 0 0, 0 0",
            backgroundSize: "32px 32px",
          }}
        />
        {/* the pattern brightens toward the CTA, the way the reference
            warms toward its right edge, and stays dark under the copy */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(120% 180% at 100% 50%, rgba(204,255,0,0.16) 0%, rgba(204,255,0,0.05) 38%, transparent 70%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, #141414 0%, rgba(20,20,20,0.86) 26%, rgba(20,20,20,0.30) 62%, transparent 100%)",
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 sm:gap-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-4">
          {/* No tile, no ring: the mark is the mark. A bordered chip
              around it invented a second badge next to the real one. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/brand/logo-sm.webp")}
            alt=""
            className="size-6 flex-none object-contain sm:size-12"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="font-mono text-[13px] font-bold tracking-[0.18em] text-white sm:text-base sm:tracking-[0.2em]">
                REFERRAL ACCELERATOR
              </h3>
              <span className="bg-[#ccff00] px-1.5 py-0.5 font-mono text-[9px] font-black text-[#0a0a0a] sm:px-2 sm:text-[10px]">
                {REFERRER_PCT}% + {REFERRED_BUYER_PCT}%
              </span>
            </div>
            <p className="mt-1 hidden text-[11px] leading-snug text-[#8a8a8a] sm:mt-1.5 sm:block sm:text-[13px]">
              Referrers earn {REFERRER_PCT}% of what their people buy, plus {REFERRER_ETH_PCT}% of the ETH. Buyers who use a
              code get {REFERRED_BUYER_PCT}% more tokens.
            </p>
          </div>
        </div>
        {/* The hero's third CTA colour (app/page.tsx's /tokenomics button):
            same brutalist-box/shadow/pressable/halftone treatment as View All
            and View Full Tokenomics, lime fill instead of white or black. */}
        <button
          type="button"
          onClick={onGetLink}
          className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light inline-flex flex-none cursor-pointer items-center justify-center gap-1.5 border-[#CCFF00] bg-[#CCFF00] px-2.5 py-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.1em] text-[#0A0A0A] sm:gap-2 sm:px-5 sm:py-3 sm:text-xs sm:tracking-[0.12em]"
        >
          <span className="sm:hidden">GET LINK</span>
          <span className="hidden sm:inline">Get Your Link</span>
          <ArrowRight className="size-3 sm:size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
