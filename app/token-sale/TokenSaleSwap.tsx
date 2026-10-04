"use client";
/**
 * The contribute card, in the /swap card's visual language (SwapFrame chrome,
 * pay and receive panels, pill CTA) with everything a fixed ETH -> sale-token
 * purchase does not need removed: no token picker, slippage, route or security
 * panel. The wallet flow is the page's own (connect, switch network, send);
 * this card only places the buttons that call it.
 *
 * "—" means the chain did not answer (§4). Only a parseable number reaches an
 * odometer, so a missing quote can never roll to "you receive 0".
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion, useSpring, useTransform } from "framer-motion";
import { ArrowDown, ChevronDown, RefreshCw, Shield } from "lucide-react";
import { formatEther, formatUnits, parseEther } from "viem";
import type { SaleView } from "@/lib/sale/reads";
import { SALE_STATE } from "@/lib/sale/abi";
import { fmtTokens } from "@/lib/sale/projection";
import { InputNumberScroll, exactlyRenderable } from "@/app/components/trade/InputNumberScroll";
import { TokenAvatar } from "@/app/components/trade/TokenAvatar";
import { BASE_SWAP_TOKENS, type SelectableToken } from "@/lib/trade/types";
import { cdnUrl } from "@/lib/config/cdn";

/** The swap card's own ETH: blue mark with the Robinhood Chain badge. */
const ETH_TOKEN: SelectableToken = BASE_SWAP_TOKENS.find((t) => t.symbol === "ETH") ?? BASE_SWAP_TOKENS[0];

/** Amount shrinks in steps as digits pile up. Tuned by eye, not by formula. */
function sizeForLength(len: number) {
  if (len <= 4) return 44;
  if (len <= 6) return 36;
  if (len <= 8) return 30;
  if (len <= 10) return 26;
  return 22;
}

/** Quick amounts. Nothing under the default 0.005 ETH first-contribution floor. */
const QUICK_AMOUNTS = ["0.01", "0.05", "0.1", "0.5"] as const;

export type SaleWalletState = "disconnected" | "wrong-network" | "ready";

export interface TokenSaleSwapProps {
  sale: SaleView;
  /** "—" means the chain did not answer — rendered, never coerced to 0 (§4). */
  quote: { pct: string; tokens: string } | null;
  sym: string;
  decimals?: number;
  /** Wallet's native balance in wei; undefined = unread, never zero. */
  balanceWei?: bigint;
  admission: string | null;
  canBuy: boolean;
  busy: string | null;
  amount: string;
  setAmount: (v: string) => void;
  onContribute: () => void;
  onClaim?: () => void;
  canClaim?: boolean;
  onRefund?: () => void;
  canRefund?: boolean;
  /** The two admission constants, read from the chain, printed or dashed. */
  minInitial?: bigint;
  step?: bigint;
  walletError?: string | null;
  walletState: SaleWalletState;
  connecting?: boolean;
  onConnect: () => void;
  onPrepareConnect?: () => void;
  onSwitchNetwork: () => void;
  /** Raised ÷ pool right now, already formatted, or null when unpriced. */
  priceLabel?: string | null;
  /** The referral row. Rendered directly above the CTA so it is seen before paying. */
  referralRow?: ReactNode;
  chainName: string;
  /** No sale contract is configured yet, so nothing was read from one. */
  unset?: boolean;
}

export function TokenSaleSwap(props: TokenSaleSwapProps) {
  const {
    sale, quote, sym, decimals, balanceWei, admission, canBuy, busy,
    amount, setAmount, onContribute,
    onClaim, canClaim, onRefund, canRefund,
    minInitial, step, walletError, walletState, connecting, onConnect, onPrepareConnect, onSwitchNetwork,
    priceLabel, referralRow, chainName, unset,
  } = props;

  const [raw, setRaw] = useState(amount);
  const inputRef = useRef<HTMLInputElement>(null);
  const [caretOn, setCaretOn] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Keep local raw in step when the parent drives the amount. Numeric equality,
  // not string inequality, so the user's mid-keystroke text is never rewritten.
  useEffect(() => {
    setRaw((prev) => {
      const a = amount.trim();
      if (a === prev.trim()) return prev;
      try {
        if (a !== "" && prev.trim() !== "" && parseEther(a) === parseEther(prev)) return prev;
      } catch {
        /* not both parseable — treat as a parent-driven change below */
      }
      return a;
    });
  }, [amount]);

  const emit = useCallback(
    (next: string) => {
      // digits and a single dot, max 18 decimals (wei-compatible); empty ok
      if (next !== "" && !/^\d*\.?\d{0,18}$/.test(next)) return;
      setRaw(next);
      setAmount(next.replace(/^0{2,}(?=\d)/, "0").replace(/^0+(?=\.)/, "0"));
    },
    [setAmount],
  );

  const overBalance =
    balanceWei !== undefined && raw !== "" && (() => {
      try {
        return parseEther(raw) > balanceWei;
      } catch {
        return false;
      }
    })();

  const shake = useSpring(0, { stiffness: 900, damping: 12 });
  const x = useTransform(shake, (v) => `${v}px`);
  useEffect(() => {
    if (!overBalance) return;
    shake.set(10);
    const t = setTimeout(() => shake.set(0), 90);
    return () => clearTimeout(t);
  }, [overBalance, shake]);

  const targetSize = useMemo(
    () => sizeForLength((raw || "0").replace(/^0+(?=\.)/, "0").replace(/^0{2,}(?=\d)/, "0").length),
    [raw],
  );
  const size = useSpring(targetSize, { stiffness: 300, damping: 30 });
  useEffect(() => void size.set(targetSize), [targetSize, size]);
  const fontSize = useTransform(size, (v) => `${v}px`);

  const useMax = () => {
    if (balanceWei === undefined) return;
    const floored = maxContribution(balanceWei, step);
    if (floored <= 0n) return;
    emit(formatEther(floored));
    inputRef.current?.focus();
  };

  const st = sale.state;
  const mode: "buy" | "claim" | "refund" =
    st === SALE_STATE.CLOSED ? "claim" : st === SALE_STATE.ABANDONED ? "refund" : "buy";
  const mine = sale.mine;
  const connected = walletState !== "disconnected";

  const allocationLabel =
    mine?.allocation !== undefined && decimals !== undefined ? fmtTokens(mine.allocation, decimals) : null;
  const receiveText = mode === "buy" ? (quote?.tokens ?? null) : allocationLabel;
  const receiveNum = useMemo(() => {
    if (receiveText === null) return null;
    const n = Number(receiveText.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }, [receiveText]);

  const balanceLabel =
    !connected || balanceWei === undefined
      ? "—"
      : `${Number(formatUnits(balanceWei, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`;

  const closedNotice =
    mode === "buy" && st !== SALE_STATE.ACTIVE
      ? unset
        ? "The sale has not opened yet. Contributions start here the moment it does."
        : st === undefined
        ? "No sale data from the chain yet."
        : st === SALE_STATE.PAUSED
          ? "Contributions are paused. What you already committed still counts."
          : "Contributions have not opened yet."
      : null;

  /* ---- CTA: one button, whose job follows the wallet and the sale ---- */
  let cta: { label: ReactNode; onClick?: () => void; disabled: boolean; tone: "lime" | "rose" };
  if (walletState === "disconnected") {
    cta = {
      label: connecting ? (
        <><RefreshCw className="size-3.5 animate-spin" aria-hidden /> CONNECTING…</>
      ) : (
        "CONNECT WALLET"
      ),
      onClick: onConnect,
      disabled: !!connecting,
      tone: "lime",
    };
  } else if (mode === "claim") {
    cta = {
      label: busy ? `${busy.toUpperCase()}…` : mine?.claimed ? "TOKENS CLAIMED" : "CLAIM TOKENS",
      onClick: onClaim,
      disabled: !(canClaim && busy === null),
      tone: "lime",
    };
  } else if (mode === "refund") {
    cta = {
      label: busy ? `${busy.toUpperCase()}…` : mine?.refunded ? "REFUND CLAIMED" : "CLAIM REFUND",
      onClick: onRefund,
      disabled: !(canRefund && busy === null),
      tone: "rose",
    };
  } else {
    cta = {
      label: busy ? `${busy.toUpperCase()}…` : raw ? `CONTRIBUTE ${raw} ETH` : "ENTER AN AMOUNT",
      onClick: onContribute,
      disabled: !canBuy,
      tone: "lime",
    };
  }
  const ctaTone = {
    lime: "border-[#ccff00] bg-[#ccff00] text-[#0a0b0b] hover:bg-[#b8e600] shadow-[0_12px_34px_#ccff0018]",
    rose: "border-[#e0897a] bg-[#e0897a] text-[#0a0b0b] hover:bg-[#cf7869]",
  }[cta.tone];

  return (
    <motion.div style={{ x }} className="space-y-3">
      {walletError && (
        <p className="rounded-2xl border border-[#8a3a30] bg-[#1c1414] px-4 py-2.5 text-xs text-[#e0897a]">{walletError}</p>
      )}
      {closedNotice && (
        <p className="rounded-2xl border border-white/[0.07] bg-[#0d0f0f] px-4 py-2.5 text-xs text-[#a5aba3]">{closedNotice}</p>
      )}

      {mode === "buy" ? (
        <>
          {/* ---- pay panel ---- */}
          <div className="space-y-3 rounded-[22px] border border-white/[0.07] bg-[#080909] p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium leading-5 text-[#a8ada7]">You contribute</span>
              <div className="flex items-center gap-2">
                <span className="text-xs leading-5 text-[#8c928c]">
                  Balance: <span className="tabular-nums text-[#c4c9c2]">{balanceLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={useMax}
                  disabled={!connected || balanceWei === undefined || balanceWei === 0n}
                  className="rounded-full border border-white/[0.09] bg-white/[0.045] px-3 py-1 text-[11px] font-semibold leading-4 text-[#d8dcd5] transition-colors hover:border-[#ccff00]/35 hover:text-[#ccff00] disabled:opacity-40"
                >
                  MAX
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2.5">
              <div
                onClick={() => {
                  inputRef.current?.focus();
                  setCaretOn(true);
                }}
                className="relative flex h-[60px] min-w-0 flex-1 cursor-text items-center overflow-x-auto no-scrollbar"
              >
                <input
                  ref={inputRef}
                  value={raw}
                  inputMode="decimal"
                  autoComplete="off"
                  onFocus={() => setCaretOn(true)}
                  onBlur={() => setCaretOn(false)}
                  onChange={(e) => emit(e.target.value)}
                  aria-label="Amount of ETH to contribute"
                  placeholder="0.0"
                  className="absolute h-px w-px opacity-0"
                />
                <motion.div
                  style={{ fontSize }}
                  animate={{ color: overBalance ? "#e0897a" : "#f4f5f1" }}
                  transition={{ duration: 0.18 }}
                  className="inline-flex min-w-0 items-center whitespace-nowrap font-sans font-semibold leading-none tracking-[-0.045em] tabular-nums"
                >
                  <InputNumberScroll value={raw} placeholderColor="text-[#888888]" />
                  <span
                    aria-hidden
                    className={`ml-[2px] inline-block h-[1.1em] w-[2.5px] shrink-0 rounded-full bg-[#ccff00] ${caretOn ? "animate-pulse" : "hidden"}`}
                  />
                </motion.div>
              </div>
              <span className="flex shrink-0 items-center gap-2 rounded-full border border-white/[0.1] bg-[#171a19] px-3 py-2">
                <TokenAvatar token={ETH_TOKEN} className="size-6" />
                <span className="text-sm font-semibold text-[#f1f3ee]">ETH</span>
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => emit(p)}
                  className={`rounded-xl border py-1.5 text-xs font-medium tabular-nums transition-colors ${
                    amount === p
                      ? "border-[#ccff00]/50 bg-[#ccff00]/10 text-[#ccff00]"
                      : "border-white/[0.06] bg-white/[0.03] text-[#8c928c] hover:border-white/15 hover:text-[#e2e5df]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* ---- arrow ---- */}
          <div className="relative z-10 -my-5 flex justify-center">
            <span className="grid size-9 place-items-center rounded-full border border-white/[0.08] bg-[#171a19] text-[#c5c9c3] shadow-[0_8px_24px_#0008]">
              <ArrowDown className="size-4" aria-hidden />
            </span>
          </div>

          {/* ---- receive panel ---- */}
          <div className="space-y-2 rounded-[22px] border border-white/[0.07] bg-[#080909] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium leading-5 text-[#a8ada7]">You receive at the close</span>
              <span className="text-[11px] leading-4 text-[#858c84]">estimate</span>
            </div>
            <div className="flex min-h-[56px] items-center justify-between gap-2.5">
              <div className="flex h-[60px] min-w-0 flex-1 items-center overflow-x-auto no-scrollbar">
                {receiveNum !== null ? (
                  <NumberFlow
                    value={receiveNum}
                    format={{ maximumFractionDigits: 0 }}
                    className="font-sans text-[32px] font-semibold tracking-[-0.045em] tabular-nums text-[#f4f5f1]"
                    transformTiming={{ duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }}
                    spinTiming={{ duration: 620, easing: "cubic-bezier(.2,.8,.2,1)" }}
                  />
                ) : (
                  <span className="text-[32px] font-semibold text-[#3d3d3d]">—</span>
                )}
              </div>
              <SaleTokenPill sym={sym} />
            </div>
            <p className="text-xs leading-5 text-[#899087]">
              {quote && quote.pct !== "—"
                ? `${quote.pct} of the sale pool if it closed now. Your price is fixed at the close, not today.`
                : "Your share of the pool is priced at the close, not today."}
            </p>
          </div>

          {/* ---- admission warning ---- */}
          <AnimatePresence initial={false}>
            {admission && connected && (
              <motion.p
                key="admission"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="rounded-2xl border border-[#8a6d1f] bg-[#1c1a14] px-4 py-2.5 text-xs text-[#d9c96a]"
              >
                {admission}
              </motion.p>
            )}
          </AnimatePresence>
        </>
      ) : (
        /* ---- closed / abandoned: what this wallet is owed ---- */
        <div className="space-y-3 rounded-[22px] border border-white/[0.07] bg-[#080909] p-4 sm:p-5">
          <span className="text-sm font-medium leading-5 text-[#a8ada7]">
            {mode === "claim" ? "Your tokens" : "Your refund"}
          </span>
          <div className="flex min-h-[56px] items-center justify-between gap-2.5">
            {!connected ? (
              <span className="text-sm text-[#8c928c]">Connect your wallet to see what you are owed.</span>
            ) : mode === "claim" ? (
              receiveNum !== null ? (
                <NumberFlow
                  value={receiveNum}
                  format={{ maximumFractionDigits: 0 }}
                  className="font-sans text-[32px] font-semibold tracking-[-0.045em] tabular-nums text-[#f4f5f1]"
                />
              ) : (
                <span className="text-[32px] font-semibold text-[#3d3d3d]">—</span>
              )
            ) : (
              <span className="font-sans text-[32px] font-semibold tracking-[-0.045em] tabular-nums text-[#f4f5f1]">
                {mine?.contributed === undefined ? "—" : formatEther(mine.contributed)}
              </span>
            )}
            {mode === "claim" ? <SaleTokenPill sym={sym} /> : (
              <span className="flex shrink-0 items-center gap-2 rounded-full border border-white/[0.1] bg-[#171a19] px-3 py-2">
                <TokenAvatar token={ETH_TOKEN} className="size-6" />
                <span className="text-sm font-semibold text-[#f1f3ee]">ETH</span>
              </span>
            )}
          </div>
          <p className="text-xs leading-5 text-[#899087]">
            {mode === "claim"
              ? mine?.claimed
                ? "Claimed. The tokens are in your wallet."
                : "Claim within 60 days of the close. Anything unclaimed after that can be burned."
              : mine?.refunded
                ? "Refunded. The ETH is back in your wallet."
                : "The sale was abandoned. Your exact contribution comes back, with no deadline."}
          </p>
        </div>
      )}

      {/* ---- sale details, the swap card's "Trade details" row ---- */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d0f0f]">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.025]"
        >
          <span className="text-sm font-medium text-[#d8dcd5]">Sale details</span>
          <span className="flex items-center gap-2 text-xs text-[#a5aba3]">
            {priceLabel ? `Price now ${priceLabel} ETH` : "Priced at the close"}
            <ChevronDown className={`size-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`} aria-hidden />
          </span>
        </button>
        {detailsOpen && (
          <div className="space-y-2 border-t border-white/[0.06] px-4 py-3 text-xs">
            <DetailRow label="First contribution" value={minInitial !== undefined ? `at least ${formatEther(minInitial)} ETH` : "—"} />
            <DetailRow label="Then, any multiple of" value={step !== undefined ? `${formatEther(step)} ETH` : "—"} />
            <DetailRow
              label="You have committed"
              value={!connected ? "—" : mine?.contributed === undefined ? "—" : `${formatEther(mine.contributed)} ETH`}
            />
            <DetailRow label="Claim window" value="60 days after the close" />
          </div>
        )}
      </div>

      {referralRow}

      {walletState === "wrong-network" && (
        <p className="flex items-center justify-between gap-3 rounded-2xl border border-[#8a6d1f] bg-[#1c1a14] px-4 py-2.5 text-xs text-[#d9c96a]">
          <span>Your wallet is on another network. The button below switches it to {chainName} first.</span>
          <button type="button" onClick={onSwitchNetwork} className="flex-none font-semibold underline underline-offset-2 hover:text-[#f0e08a]">
            Switch now
          </button>
        </p>
      )}

      <motion.button
        whileTap={{ scale: 0.98 }}
        type="button"
        onMouseEnter={walletState === "disconnected" ? onPrepareConnect : undefined}
        onClick={cta.onClick}
        disabled={cta.disabled}
        className={`flex w-full items-center justify-center gap-2 rounded-full border py-4 text-[15px] font-semibold leading-5 tracking-[-0.01em] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${ctaTone}`}
      >
        {cta.label}
      </motion.button>

      <p className="flex items-center justify-center gap-1 text-center text-[11px] leading-4 text-[#858b84]">
        <Shield className="size-2.5 flex-none" aria-hidden />
        Non-custodial · ETH is held by the sale contract until the close
      </p>
    </motion.div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="text-[#8c928c]">{label}</span>
      <span className="text-right tabular-nums text-[#e2e5df]">{value}</span>
    </p>
  );
}

function SaleTokenPill({ sym }: { sym: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-[#ccff00]/25 bg-[#ccff00]/[0.06] px-3 py-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cdnUrl("/brand/logo-sm.webp")} alt="" className="size-6 rounded-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <span className="text-sm font-semibold text-[#ccff00]">{sym}</span>
    </span>
  );
}

/**
 * useMax's floor onto the contribution-step grid. Exported through
 * `_saleSwapInternals` so the test runs THIS arithmetic, not a copy (§8 #10).
 */
export function floorToStep(maxWei: bigint, step: bigint | undefined): bigint {
  return step !== undefined && step > 0n ? (maxWei / step) * step : maxWei;
}

/**
 * Gas held back by MAX. Measured 2026-10-02: a contribution costs 0.000001 to 0.00001 ETH (47k to 450k
 * gas), $0.01 to $0.06 in wallets. 0.0001 also clears the wallet's own max-fee check. The old 0.01 ate 30% of 0.015.
 */
export const GAS_RESERVE_WEI = 100_000_000_000_000n;

/** Balance less the gas reserve, floored onto the step grid (the contract rejects off-grid amounts). */
export function maxContribution(balanceWei: bigint, step: bigint | undefined): bigint {
  const max = balanceWei - GAS_RESERVE_WEI;
  return max <= 0n ? 0n : floorToStep(max, step);
}

export const _saleSwapInternals = { sizeForLength, floorToStep, exactlyRenderable, maxContribution, GAS_RESERVE_WEI };
