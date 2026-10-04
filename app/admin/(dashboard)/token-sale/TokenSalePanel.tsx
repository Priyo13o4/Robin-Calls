"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatEther, formatUnits, isAddress, parseEther, parseUnits, type Address, type Chain } from "viem";
import { useReadContract, useSwitchChain } from "wagmi";
import { useWallet } from "@/lib/wallet/useWallet";
import {
  robinhoodChain,
  robinhoodTestnetChain,
  setActiveSaleChainId,
  ROBINHOOD_TESTNET_CHAIN_ID,
} from "@/lib/config/chain";
import { explorerTxUrl } from "@/lib/config/sale-chains";
import { SALE_STATE, SALE_STATE_LABELS, erc20MetaAbi, tokenSaleAbi } from "@/lib/sale/abi";
import { buildSaleCall, SALE_ACTIONS, actionAllowedInState, type SaleAction, type SaleActionKind } from "@/lib/sale/actions";
import { preflightSaleCall, preflightBlocks, type Preflight } from "@/lib/sale/preflight";
import { explainSaleFailure } from "@/lib/sale/errors";
import { fundingStatus } from "@/lib/sale/reads";
import { useSaleData } from "@/lib/sale/useSaleData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { InfoPanel } from "../../components/ui";
import { toast, dismissToast, ONE_SHOT_MS } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { saveSaleAddressAction, saveReferralRulesAction } from "./actions";
// The LEAF, not `@/lib/referrals/config`: that module imports the Drizzle
// client, and a client component importing it puts `pg` in the browser bundle.
import { REFERRAL_MIN_WALLETS_KEY, REFERRAL_MIN_WEI_KEY } from "@/lib/referrals/config-keys";

/**
 * The operator cockpit for one TokenSale contract.
 *
 * Two rules shape everything below. First, the FUNDING panel is the headline:
 * start() demands the held sale-token balance equal tokensForSale exactly, over
 * is unrecoverable (the only remedy is abandon + redeploy), and saleTokenBalance
 * used to be read and then displayed nowhere. Second, every write preflights:
 * a decoded rejection blocks with a sentence, an unreadable check warns but
 * never disables (lib/sale/preflight.ts — the contract is the enforcer), so a
 * dead RPC cannot quietly decide a legal owner action is forbidden.
 *
 * All calldata comes from buildSaleCall — never encodeFunctionData in a
 * component — so the selector-level and anvil-replay tests keep covering what
 * these buttons actually send.
 */

const STATE_TONES: Record<number, "secondary" | "default" | "destructive" | "outline"> = {
  [SALE_STATE.PENDING]: "outline",
  [SALE_STATE.ACTIVE]: "default",
  [SALE_STATE.PAUSED]: "outline",
  [SALE_STATE.CLOSED]: "secondary",
  [SALE_STATE.ABANDONED]: "destructive",
};

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Distributed gas is ~55k per contributor (measured: 1.42M for 25, 4.12M for
 *  75). Cap the chunk well under a block's 30M budget so a click can never
 *  outgrow it. */
const DISTRIBUTE_CHUNK_MAX = 250;

const TX_TOAST_ID = "admin-sale-tx";
const WALLET_TOAST_ID = "admin-wallet";

export function TokenSalePanel({
  defaultAddress,
  defaultChainId,
  initialReferralRules,
}: {
  defaultAddress: string;
  defaultChainId?: number;
  initialReferralRules?: {
    minReferredWallets: string;
    minReferredWei: string;
  };
}) {
  const wallet = useWallet();
  const { switchChainAsync } = useSwitchChain();

  const [chainId, setChainId] = useState<number>(defaultChainId ?? robinhoodChain.id);
  // The panel's target, not the published one: the admin chrome's wrong-chain
  // prompt has to agree with the banner below it, and the operator can drive a
  // contract on one chain before publishing it. Prerendered pages ship no sale
  // chain at all, so without this the chrome argues for mainnet.
  useEffect(() => setActiveSaleChainId(chainId), [chainId]);
  const [addrDraft, setAddrDraft] = useState(defaultAddress);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [distributeCount, setDistributeCount] = useState("25");
  const [recoverForm, setRecoverForm] = useState({ erc20: "", to: "", amount: "" });
  const [unsoldTo, setUnsoldTo] = useState("");
  const [sweepTo, setSweepTo] = useState("");
  const [feeAddress1Draft, setFeeAddress1Draft] = useState("");
  const [feeAddress2Draft, setFeeAddress2Draft] = useState("");
  const [feeAddress3Draft, setFeeAddress3Draft] = useState("");
  const [minInitialDraft, setMinInitialDraft] = useState("");
  const [stepDraft, setStepDraft] = useState("");
  const [refWalletsDraft, setRefWalletsDraft] = useState(initialReferralRules?.minReferredWallets ?? "1");
  const [refWeiDraft, setRefWeiDraft] = useState(initialReferralRules?.minReferredWei ?? "100000000000000000");
  const [savingReferralRules, setSavingReferralRules] = useState(false);

  // The confirmation dialog. `confirmWord` is the exact word the operator must
  // retype before the send runs; window.confirm is not a confirmation step.
  const [confirm, setConfirm] = useState<{
    label: string;
    word: string;
    body: ReactNode;
    typed: string;
    build: () => SaleAction | null;
    extra?: { name: string; value: string; label: string; mono?: boolean }[];
  } | null>(null);

  const chain: Chain = chainId === ROBINHOOD_TESTNET_CHAIN_ID ? robinhoodTestnetChain : robinhoodChain;
  const { sale, refresh, client, live } = useSaleData({
    chain,
    contract: addrDraft,
    walletAddress: wallet.address,
  });
  const addrOk = isAddress(addrDraft);

  /* The box is a SESSION POINTER, not a setting. It seeds from site_config and
     is never written back on its own, because it is also the `to:` of every
     write this panel sends: you point it at a freshly deployed contract, drive
     the lifecycle, and publish only once it reads correctly. Publishing early
     would aim the PUBLIC /token-sale page at an unverified contract.

     The danger is that divergence is invisible. An operator who pastes an
     address believing they reconfigured the sale, then clicks start() or
     withdrawProceeds(), sends real money to a contract the live site knows
     nothing about. So the gap is stated, never inferred. */
  const savedAddress = defaultAddress.trim().toLowerCase();
  const divergent =
    (addrOk && addrDraft.toLowerCase() !== savedAddress) ||
    (defaultChainId !== undefined && chainId !== defaultChainId);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const saveAddress = useCallback(async () => {
    setSaving(true);
    try {
      const res = await saveSaleAddressAction(addrDraft, chainId);
      if (res.ok) {
        toast({ variant: "success", title: "Sale address published", description: res.message });
        router.refresh();
      } else {
        toast({ variant: "destructive", title: "Not saved", description: res.error, duration: ONE_SHOT_MS });
      }
    } finally {
      setSaving(false);
    }
  }, [addrDraft, chainId, router]);

  const isOwner =
    !!wallet.address && !!sale?.owner && wallet.address.toLowerCase() === sale.owner.toLowerCase();
  const onRightChain = !wallet.isConnected || wallet.chainId === chainId;
  const canTransact = addrOk && wallet.isConnected && onRightChain && !wallet.isLoading;

  const st = sale?.state;
  const mine = sale?.mine;
  const dec = sale?.tokenMeta?.decimals;
  const sym = sale?.tokenMeta?.symbol ?? "tokens";

  const eth = (v?: bigint) => (v === undefined ? undefined : Number(formatEther(v)));
  const fmt = (n?: number, unit = "ETH") =>
    n === undefined ? "—" : `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${unit}`;

  const tokenAmt = useCallback(
    (v?: bigint) =>
      v === undefined || dec === undefined
        ? "—"
        : `${Number(formatUnits(v, dec)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${sym}`,
    [dec, sym],
  );

  /**
   * The funding DELTA is the one number on this page that may never be
   * rounded. tokenAmt's 2dp exists for readability of whole-scale figures;
   * a 1-wei excess rendered through it reads "0" beside an OVERFUNDED alarm,
   * and a 0.004-token shortfall instructs the operator to send zero. So the
   * delta renders in RAW units first (the unit start() actually compares),
   * with the whole-token figure as a secondary line.
   */
  const rawDelta = useCallback(
    (v?: bigint) => (v === undefined ? "—" : `${v.toLocaleString('en-US')} raw units`),
    [],
  );
  const wholeDelta = useCallback(
    (v?: bigint) =>
      v === undefined || dec === undefined
        ? null
        : `${Number(formatUnits(v, dec)).toLocaleString('en-US', { maximumFractionDigits: 18 })} ${sym}`,
    [dec, sym],
  );

  /* ---------------------------------------------------------------- */
  /*  Send pipeline: build → preflight → sign → receipt               */
  /* ---------------------------------------------------------------- */

  const send = useCallback(
    async (label: string, data: `0x${string}`, value?: bigint) => {
      if (!addrOk || !wallet.address) {
        toast({
          id: TX_TOAST_ID,
          variant: "destructive",
          title: label,
          description: !addrOk ? "The sale address is not valid." : "Connect a wallet before sending transactions.",
          duration: ONE_SHOT_MS,
        });
        return;
      }
      dismissToast(TX_TOAST_ID);
      setBusy(label);
      try {
        // Preflight: simulate first with a pinned loading toast
        toast.loading("Simulating transaction on chain before wallet prompt…", {
          id: TX_TOAST_ID,
          title: label,
        });
        const pf = await preflightSaleCall(client, {
          to: addrDraft as Address,
          from: wallet.address as Address,
          data,
          value: value ?? 0n,
        });
        if (preflightBlocks(pf)) {
          toast({ id: TX_TOAST_ID, variant: "destructive", title: label, description: pf.sentence, duration: ONE_SHOT_MS });
          return;
        }

        toast.loading("Waiting for signature in wallet…", {
          id: TX_TOAST_ID,
          title: label,
        });

        let hash: `0x${string}` | null | undefined;
        let timedOut = false;
        // Cleared in `finally`: an uncleared 120s timer outlives the send on
        // every successful action, so a session of admin clicks accumulates
        // one live timer each, all of which still fire.
        let timerId: ReturnType<typeof setTimeout> | undefined;
        try {
          const sendPromise = wallet.sendTransaction({ to: addrDraft as Address, data, value, chainId });
          const timer = new Promise<never>((_, reject) => {
            timerId = setTimeout(() => {
              timedOut = true;
              reject(new Error("WALLET_TIMEOUT"));
            }, 120_000);
          });
          hash = await Promise.race([sendPromise, timer]);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (timedOut || msg === "WALLET_TIMEOUT") {
            toast({
              id: TX_TOAST_ID,
              variant: "warning",
              title: label,
              description: "The wallet took longer than 2 minutes to respond. If you signed, check your wallet or explorer.",
              duration: null,
            });
            return;
          }
          throw err;
        } finally {
          clearTimeout(timerId);
        }

        if (!hash) {
          toast({
            id: TX_TOAST_ID,
            variant: "destructive",
            title: label,
            description: "Transaction was not sent or was cancelled by user.",
            duration: ONE_SHOT_MS,
          });
          return;
        }

        setLastTx(hash);
        // toast.loading, NOT a bare toast({variant:"loading"}): the raw form
        // inherits the 5s default, so the one row that means "still waiting"
        // counted itself down and vanished while waitForTransactionReceipt
        // had up to 60s left to run — leaving a pending transaction with
        // nothing on screen at all. The helper pins it open and drops the
        // progress bar, because there is no deadline here to draw.
        toast.loading(`Sent ${shortAddr(hash)}. Waiting for the chain to confirm it.`, {
          id: TX_TOAST_ID,
          title: label,
        });
        try {
          const rc = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
          toast(
            rc.status === "success"
              ? { id: TX_TOAST_ID, variant: "success", title: label, description: "Confirmed on chain." }
              : { id: TX_TOAST_ID, variant: "destructive", title: label, description: "The chain rejected this transaction, and the gas was still spent. See the explorer for the reason.", duration: null },
          );
        } catch {
          toast({ id: TX_TOAST_ID, variant: "warning", title: label, description: `Sent ${hash.slice(0, 10)}…, but we stopped waiting before the chain confirmed it. Check the explorer.`, duration: null });
        }
        await refresh();
      } catch (err) {
        // Anything thrown here is wallet transport, not a contract answer —
        // explainSaleFailure keeps the decoded-revert / user-rejection /
        // could-not-reach distinction instead of laundering all three into "no".
        const failure = explainSaleFailure(err);
        toast({
          id: TX_TOAST_ID,
          variant: "destructive",
          title: label,
          description: failure.sentence,
          duration: failure.settled ? ONE_SHOT_MS : null,
        });
      } finally {
        setBusy(null);
      }
    },
    [addrDraft, addrOk, chainId, client, refresh, wallet],
  );

  const runAction = useCallback(
    (label: string, action: SaleAction) => {
      const { data, value } = buildSaleCall(action);
      void send(label, data, value);
    },
    [send],
  );

  const parseAmount = (s: string): bigint | null => {
    try {
      const v = parseEther(s);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  };

  /** Opens the typed-confirmation dialog for a danger action. `build` returns
   *  null when the form's inputs do not parse, and the dialog stays open. */
  const requestConfirm = (kind: SaleActionKind, build: () => SaleAction | null) => {
    const meta = SALE_ACTIONS[kind];
    if (!meta.danger) {
      const a = build();
      if (a) runAction(meta.label, a);
      return;
    }
    setConfirm({
      label: meta.label,
      word: kind.toUpperCase(),
      body: meta.danger,
      typed: "",
      build,
    });
  };

  const confirmSend = () => {
    if (!confirm) return;
    const action = confirm.build();
    if (!action) return;
    if (confirm.typed.trim().toUpperCase() !== confirm.word) return;
    setConfirm(null);
    runAction(confirm.label, action);
  };

  const onConfirmDialogChange = (open: boolean) => {
    if (!open) setConfirm(null);
  };

  /* ---------------------------------------------------------------- */
  /*  Funding — the headline                                          */
  /* ---------------------------------------------------------------- */

  // The tested helper from lib/sale/reads (the anvil replay exercises THIS
  // one), not a private copy that could drift from it.
  const funding = useMemo(
    () => fundingStatus({ saleTokenBalance: sale?.saleTokenBalance, tokensForSale: sale?.tokensForSale }),
    [sale?.saleTokenBalance, sale?.tokensForSale],
  );

  const fundingWord =
    funding.state === "short" ? "SHORT" : funding.state === "over" ? "OVERFUNDED" : funding.state === "exact" ? "EXACT" : undefined;

  const startAllowed = canTransact && actionAllowedInState("start", st);

  /** contribute() amount parsed once for both gates and the send. */
  const contributeValue = amount.trim() === "" ? null : parseAmount(amount);

  const step = sale?.contributionStep;
  const minInitial = sale?.minInitialContribution;

  /** Mirrors the contract's admission rules so a rejection is explained before
   *  the operator signs. Fails open: an unread constant never blocks. */
  const admission = useMemo<string | null>(() => {
    if (contributeValue === null) return null;
    if (step !== undefined && step > 0n && contributeValue % step !== 0n) {
      return `Contributions go in multiples of ${formatEther(step)} ETH.`;
    }
    const isFirst = mine?.contributed === undefined ? null : mine.contributed === 0n;
    if (isFirst === true && minInitial !== undefined && contributeValue < minInitial) {
      return `A first contribution must be at least ${formatEther(minInitial)} ETH.`;
    }
    return null;
  }, [contributeValue, step, minInitial, mine?.contributed]);

  /* ---------------------------------------------------------------- */
  /*  Form-derived actions (parse → open dialog / send)               */
  /* ---------------------------------------------------------------- */

  const distributeCountBn = useMemo(() => {
    const n = Number(distributeCount);
    if (!Number.isInteger(n) || n <= 0) return null;
    return BigInt(n);
  }, [distributeCount]);
  const distributeCountNum = distributeCountBn === null ? null : Number(distributeCountBn);
  const distributeTooLarge = distributeCountNum !== null && distributeCountNum > DISTRIBUTE_CHUNK_MAX;

  /**
   * The recover amount parses against the DECIMALS OF THE TOKEN THE OPERATOR
   * TYPED — read from that token on chain — never the sale token's. 100 USDC
   * (6 dp) encoded at 18 dp is 10^12 too many raw units; the contract would
   * revert, but the form would be unusable for every non-18-decimal stray,
   * which is most stablecoins. Unknown decimals (invalid address, unread
   * chain) leave the amount unparsable, which disables the CONFIRM step only
   * at the dialog — the field stays editable, and the preflight still runs.
   */
  const recoverToken: Address | null = isAddress(recoverForm.erc20) ? (recoverForm.erc20.toLowerCase() as Address) : null;
  const { data: recoverTokenDecimals, isLoading: recoverDecimalsLoading } = useReadContract({
    abi: erc20MetaAbi,
    address: recoverToken ?? undefined,
    functionName: "decimals",
    // Pinned to the panel's OWN chain choice, not wagmi's connected chain —
    // the wallet can sit anywhere while the panel targets mainnet/testnet,
    // and the same token on both chains can carry different decimals.
    chainId,
    query: { enabled: recoverToken !== null },
  });
  const recoverArgs = useMemo(() => {
    const { to, amount: amt } = recoverForm;
    if (!isAddress(to) || recoverToken === null) return null;
    if (recoverTokenDecimals === undefined || typeof recoverTokenDecimals !== "number") return null;
    try {
      const raw = parseUnits(amt, recoverTokenDecimals);
      return raw > 0n ? { erc20: recoverToken, to: to as Address, amount: raw } : null;
    } catch {
      return null;
    }
  }, [recoverForm, recoverToken, recoverTokenDecimals]);

  const unsoldToOk = isAddress(unsoldTo);
  const sweepToOk = isAddress(sweepTo);
  const feeAddress1Ok = isAddress(feeAddress1Draft);
  const feeAddress2Ok = isAddress(feeAddress2Draft);
  const feeAddress3Ok = isAddress(feeAddress3Draft);

  /**
   * WEI, not ETH. The contract stores wei, the ABI takes wei, and every other
   * number in this panel is wei; a decimal box in the middle of that is one
   * `parseEther` away from a floor a thousand times too high. Operator decision
   * 2026-09-09: no unit conversion on a setter.
   *
   * Digits only, so "0.01" is refused outright rather than truncated by BigInt.
   */
  const weiDraft = (v: string): bigint | null => {
    const t = v.trim();
    if (!/^\d+$/.test(t)) return null;
    return BigInt(t);
  };

  const minInitialBig = useMemo(() => weiDraft(minInitialDraft), [minInitialDraft]);
  const stepBig = useMemo(() => weiDraft(stepDraft), [stepDraft]);

  const limitsValid =
    minInitialBig !== null &&
    stepBig !== null &&
    stepBig > 0n &&
    minInitialBig >= stepBig &&
    minInitialBig % stepBig === 0n;

  const saveReferralRules = useCallback(async () => {
    setSavingReferralRules(true);
    try {
      const fd = new FormData();
      fd.append(REFERRAL_MIN_WALLETS_KEY, refWalletsDraft);
      fd.append(REFERRAL_MIN_WEI_KEY, refWeiDraft);
      const res = await saveReferralRulesAction(fd);
      if (res.ok) {
        toast({ variant: "success", title: "Referral rules updated", description: res.message });
        router.refresh();
      } else {
        toast({ variant: "destructive", title: "Not saved", description: res.error, duration: ONE_SHOT_MS });
      }
    } finally {
      setSavingReferralRules(false);
    }
  }, [refWalletsDraft, refWeiDraft, router]);

  /**
   * When the burn opens. `null` means UNKNOWN (either read unanswered), not "not yet",
   * so it must never disable the button: an unreadable check warns, the contract
   * enforces, and it reverts BurnTooEarly with the real time if asked early.
   */
  const burnAvailableAt = useMemo(() => {
    if (!sale?.closedAt || !sale?.burnDelay || sale.closedAt === 0n) return null;
    return new Date(Number(sale.closedAt + sale.burnDelay) * 1000);
  }, [sale?.closedAt, sale?.burnDelay]);
  const burnReady = burnAvailableAt !== null && burnAvailableAt.getTime() <= Date.now();
  const burnGated = burnAvailableAt !== null && !burnReady;

  const pendingOwnerShown = !!sale?.pendingOwner && sale.pendingOwner !== ZERO_ADDRESS;

  /* ---------------------------------------------------------------- */

  const faults = sale?.faults ?? [];

  /* Its own id: a wallet transport fault and a transaction result are different
     events, and one must not overwrite the other. */
  useEffect(() => {
    if (wallet.error) {
      toast({ id: WALLET_TOAST_ID, variant: "destructive", title: "Wallet", description: wallet.error, duration: wallet.errorSettled ? ONE_SHOT_MS : null });
    } else {
      dismissToast(WALLET_TOAST_ID);
    }
  }, [wallet.error, wallet.errorSettled]);

  return (
    <>

      {/* ── CONFIG ── */}
      <Card className="mb-6 p-4">
        <div className="grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="min-w-0">
            <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
              CONTRACT THIS PANEL DRIVES
            </Label>
            <div className="flex gap-2">
              <Input
                className="font-mono text-sm"
                value={addrDraft}
                spellCheck={false}
                onChange={(e) => setAddrDraft(e.target.value.trim())}
                placeholder="0x… paste a deployed sale contract"
              />
              <Button
                variant={divergent ? "default" : "outline"}
                size="sm"
                className="flex-none"
                disabled={!addrOk || saving || !divergent}
                onClick={() => void saveAddress()}
                title={
                  divergent
                    ? "Write this address to site_config, so the public sale page uses it"
                    : "Already the published address"
                }
              >
                {saving ? "SAVING…" : divergent ? "PUBLISH" : "PUBLISHED"}
              </Button>
            </div>

            {/* Reading this box is not the same as reading the live config, so
                the two are never allowed to differ silently. */}
            {divergent && (
              <p className="mt-2 text-xs leading-relaxed text-[#d9c96a]">
                Typing here only aims this panel. Every button below, including the ones that move
                money, targets the address in the box.{" "}
                {savedAddress ? (
                  <>
                    The public sale page still uses{" "}
                    <code className="font-mono text-[#EDEDEA]">{shortAddr(savedAddress)}</code>.
                  </>
                ) : (
                  <>No sale address is published yet, so the public sale page has none.</>
                )}{" "}
                Press PUBLISH to make this the live one.
              </p>
            )}
            {!divergent && addrOk && (
              <p className="mt-2 text-xs text-[#5a5a5a]">
                This is the published address. The public sale page uses it too.
              </p>
            )}
            {sale && faults.length > 0 && (
              <p className="mt-2 text-xs text-[#d9c96a]">
                Could not read: {faults.join(", ")}. A dash means the value was not read, not that it is zero.
                {!live && " Showing the last read."}
              </p>
            )}
          </div>
          <div>
            <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">NETWORK</Label>
            <div className="flex gap-1">
              <Button variant={chainId === robinhoodChain.id ? "default" : "outline"} size="sm"
                onClick={() => setChainId(robinhoodChain.id)}>MAINNET</Button>
              <Button variant={chainId === ROBINHOOD_TESTNET_CHAIN_ID ? "default" : "outline"} size="sm"
                onClick={() => setChainId(ROBINHOOD_TESTNET_CHAIN_ID)}>TESTNET</Button>
            </div>
          </div>
          <div>
            <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">WALLET</Label>
            {wallet.isConnected ? (
              <Button variant="outline" size="sm" onClick={wallet.disconnect}>
                {wallet.providerName} · {shortAddr(wallet.address ?? "")} — disconnect
              </Button>
            ) : (
              <Button variant="default" size="sm" onMouseEnter={wallet.prepare} onFocus={wallet.prepare}
                onClick={() => void wallet.connect()} disabled={wallet.isLoading}>
                {wallet.isLoading ? "CONNECTING…" : "CONNECT"}
              </Button>
            )}
          </div>
        </div>
        {!addrOk && (
          <p className="mt-3 text-xs text-[#d9c96a]">
            Not a valid address — the panel cannot read the sale until one is set.
          </p>
        )}
      </Card>

      {/* ── NETWORK MISMATCH ── */}
      {wallet.isConnected && !onRightChain && (
        <Notice ok={false} tone="warning">
          <span className="flex flex-wrap items-center gap-3">
            <span>
              Wallet is on chain {wallet.chainId}, this panel targets {chain.name} ({chainId}).
            </span>
            <Button variant="outline" size="sm" disabled={busy !== null}
              onClick={() => {
                void switchChainAsync({ chainId }).then(() => refresh()).catch(() => {});
              }}>
              SWITCH WALLET
            </Button>
          </span>
        </Notice>
      )}

      {/* ── FUNDING — the headline. start() demands exact equality; over is
          unrecoverable. This panel exists so the delta is seen BEFORE tokens
          are sent, not from a reverted start(). ── */}
      <Card className="mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">FUNDING — SALE TOKEN HELD BY THE CONTRACT</h2>
          {funding.state !== "unknown" && (
            <Badge variant={funding.state === "exact" ? "secondary" : funding.state === "over" ? "destructive" : "outline"}>
              {fundingWord}
            </Badge>
          )}
        </div>
        {!funding || funding.state === "unknown" ? (
          <p className="text-sm text-[#8a8a8a]">
            {addrOk ? "The contract's token balance has not been read yet — it is unknown, not zero." : "Set a sale address to read funding."}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <FundingCell label="HELD" value={tokenAmt(funding.held)} unit={`${sym} · uint256 raw units on chain`} />
              <FundingCell label="REQUIRED (EXACT)" value={tokenAmt(funding.required)} unit={`${sym} · uint256 raw units on chain`} />
              <FundingCell
                label={funding.state === "exact" ? "DELTA" : funding.state === "short" ? "MISSING" : "EXCESS"}
                value={funding.state === "exact" ? `0 ${sym}` : rawDelta(funding.state === "short" ? funding.missing : funding.excess)}
                sub={funding.state === "exact" ? undefined : wholeDelta(funding.state === "short" ? funding.missing : funding.excess) ?? undefined}
                unit={`${sym} · uint256 raw units on chain — the exact figure start() compares`}
              />
            </div>
            {funding.state === "short" && (
              <p className="mt-3 text-sm text-[#d9c96a]">
                The contract is {rawDelta(funding.missing)} short
                {wholeDelta(funding.missing) ? ` (${wholeDelta(funding.missing)})` : ""}. Send exactly that many
                tokens to the contract address, then read this row again — it must say EXACT before
                START can work.
              </p>
            )}
            {funding.state === "over" && (
              <div className="mt-3 border border-[#8a3a30] bg-[#1c1414] px-4 py-3">
                <p className="text-sm font-semibold text-[#e0897a]">
                  The contract holds {rawDelta(funding.excess)}
                  {wholeDelta(funding.excess) ? ` (${wholeDelta(funding.excess)})` : ""} more than the sale
                  promises. This contract cannot be opened and must be redeployed.
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[#c98d80]">
                  The excess cannot be removed: recoverERC20 refuses the sale token, and
                  withdrawUnsoldTokens only runs from an abandoned sale or a closed one that raised
                  nothing. The only remedy is ABANDON → withdraw → redeploy at the exact amount.
                </p>
              </div>
            )}
            {funding.state === "exact" && (
              <p className="mt-3 text-sm text-[#8fbf6a]">
                The contract holds exactly the sale pool. START can open the sale.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ── SALE STATE ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">SALE</h2>
        {st !== undefined && (
          <Badge variant={STATE_TONES[st] ?? "outline"}>{SALE_STATE_LABELS[st] ?? `UNKNOWN(${st})`}</Badge>
        )}
        {st === undefined && <span className="font-mono text-[11px] text-[#8a8a8a]">STATE —</span>}
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="TOTAL RAISED" value={fmt(eth(sale?.totalRaised))} unit="ETH · uint256 wei on chain" />
        <Stat label="CONTRIBUTORS" value={sale?.contributorCount === undefined ? "—" : Number(sale.contributorCount)} unit="uint256 count" />
        <Stat
          label="PROCEEDS SPLIT"
          value={
            sale?.feeAddress1Bps === undefined || sale?.feeAddress2Bps === undefined || sale?.feeAddress3Bps === undefined
              ? "—"
              : `${(100 - (sale.feeAddress1Bps + sale.feeAddress2Bps + sale.feeAddress3Bps) / 100).toFixed(2)}% / ${(sale.feeAddress1Bps / 100).toFixed(2)}% / ${(sale.feeAddress2Bps / 100).toFixed(2)}% / ${(sale.feeAddress3Bps / 100).toFixed(2)}%`
          }
          unit="fixed: 80% deployer / 8% team / 8% partner 1 / 4% partner 2"
          hint={
            sale?.feeAddress1Bps === undefined || sale?.feeAddress2Bps === undefined || sale?.feeAddress3Bps === undefined
              ? undefined
              : "deployer (80%) / fee address 1 [team] (8%) / fee address 2 [partner 1] (8%) / fee address 3 [partner 2] (4%)"
          }
        />
      </div>

      {/* ── MY POSITION ── */}
      {wallet.isConnected && (
        <>
          <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">MY POSITION</h2>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="CONTRIBUTED" value={fmt(eth(mine?.contributed))} unit="ETH · uint256 wei on chain" />
            <Stat label="ALLOCATION" value={tokenAmt(mine?.allocation)} unit={`${sym} · uint256 raw units on chain`} hint={mine?.claimed ? "claimed" : undefined} />
            {/* The refundable amount shows whenever a refund EXISTS — pinned to
                "refunded" only, it read "—" exactly when the button was live. */}
            <Stat
              label="REFUND"
              unit="ETH · uint256 wei on chain"
              value={fmt(eth(mine?.refunded || !mine?.claimed ? mine?.contributed : undefined))}
              hint={mine?.refunded ? "refunded" : mine?.contributed ? "available if abandoned" : undefined}
            />
            <Stat label="STRAY ETH" value={fmt(eth(mine?.stray))} unit="ETH · uint256 wei on chain" hint="plain send, not a contribution" />
          </div>
        </>
      )}

      {/* ── CONTRIBUTOR ACTIONS ── */}
      <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">CONTRIBUTE / CLAIM</h2>
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="eth-amount">
              ETH AMOUNT
            </Label>
            <Input id="eth-amount" className="font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.1" inputMode="decimal" />
            <p className="mt-1 font-mono text-[10px] text-[#4a4a4a]">
              decimal ETH — sent as wei (x10^18)
            </p>
          </div>
          {admission && <p className="pb-2 text-xs text-[#d9c96a]">{admission}</p>}
          <ActionBtn busy={busy} can={canTransact && actionAllowedInState("contribute", st) && contributeValue !== null && admission === null} accent
            onClick={() => contributeValue !== null && runAction("Contribute", { kind: "contribute", valueWei: contributeValue })}>
            CONTRIBUTE
          </ActionBtn>
          <ActionBtn busy={busy} can={canTransact && actionAllowedInState("claim", st) && !!mine?.allocation && mine.allocation > 0n && !mine.claimed}
            onClick={() => runAction("Claim tokens", { kind: "claim" })}>
            CLAIM TOKENS
          </ActionBtn>
          <ActionBtn busy={busy} can={canTransact && actionAllowedInState("claimRefund", st) && !!mine?.contributed && !mine.refunded}
            onClick={() => runAction("Claim refund", { kind: "claimRefund" })}>
            CLAIM REFUND
          </ActionBtn>
          <ActionBtn busy={busy} can={canTransact && !!mine?.stray && mine.stray > 0n && !sale?.straySwept}
            onClick={() => runAction("Claim stray", { kind: "claimStray" })}>
            CLAIM STRAY
          </ActionBtn>
        </div>
        {lastTx && (
          <p className="mt-3 font-mono text-xs text-[#8a8a8a]">
            last tx:{" "}
            <a className="text-[#ccff00] hover:underline" target="_blank" rel="noreferrer" href={explorerTxUrl(chainId, lastTx)}>
              {lastTx}
            </a>
          </p>
        )}
      </Card>

      {/* ── OWNER SURFACE ── */}
      {isOwner ? (
        <>
          <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">OWNER CONTROLS</h2>

          {/* lifecycle */}
          <Card className="mb-4 p-4">
            <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">LIFECYCLE</p>
            <div className="flex flex-wrap items-center gap-2">
              <ActionBtn busy={busy} can={startAllowed} accent onClick={() => runAction("Start sale", { kind: "start" })}>
                START
              </ActionBtn>
              <ActionBtn busy={busy} can={canTransact && actionAllowedInState("pause", st)}
                onClick={() => runAction("Pause", { kind: "pause" })}>
                PAUSE
              </ActionBtn>
              <ActionBtn busy={busy} can={canTransact && actionAllowedInState("resume", st)}
                onClick={() => runAction("Resume", { kind: "resume" })}>
                RESUME
              </ActionBtn>
              <ActionBtn busy={busy} can={canTransact && actionAllowedInState("close", st)} danger
                onClick={() => requestConfirm("close", () => ({ kind: "close" }))}>
                CLOSE
              </ActionBtn>
              <ActionBtn busy={busy} can={canTransact && actionAllowedInState("abandon", st)} danger
                onClick={() => requestConfirm("abandon", () => ({ kind: "abandon" }))}>
                ABANDON
              </ActionBtn>
            </div>
            <p className="mt-3 font-mono text-[11px] text-[#8a8a8a]">
              START requires the funding panel above to read EXACT — a balance one wei over or under
              reverts, and over is permanent.
            </p>
          </Card>

          {/* fee addresses — set + deferred share state */}
          <Card className="mb-4 p-4">
            <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">FEE RECIPIENTS (8%, 8% &amp; 4% SPLIT)</p>

            {/* Fee Address 1 */}
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="fee1-addr">
                  FEE ADDR 1 (TEAM / 2ND ADMIN) {sale?.feeAddress1 && sale.feeAddress1 !== ZERO_ADDRESS ? `(current: ${shortAddr(sale.feeAddress1)})` : "(none set)"}
                </Label>
                <Input id="fee1-addr" className="font-mono text-sm" spellCheck={false} value={feeAddress1Draft}
                  onChange={(e) => setFeeAddress1Draft(e.target.value.trim())} placeholder="0x…" />
              </div>
              <ActionBtn busy={busy} can={canTransact && actionAllowedInState("setFeeAddress1", st) && feeAddress1Ok}
                onClick={() => requestConfirm("setFeeAddress1", () => ({ kind: "setFeeAddress1", feeAddress: feeAddress1Draft as Address }))}>
                SET FEE ADDR 1
              </ActionBtn>
              <p className="pb-2 text-xs text-[#8a8a8a]">
                {sale?.feeAddress1Bps === undefined ? "8.00%" : `${(sale.feeAddress1Bps / 100).toFixed(2)}%`} of the raise is Fee Address 1 (team/admin).
                Frozen once the sale starts.
              </p>
            </div>

            {/* Fee Address 2 */}
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="fee2-addr">
                  FEE ADDR 2 (PARTNER 1) {sale?.feeAddress2 && sale.feeAddress2 !== ZERO_ADDRESS ? `(current: ${shortAddr(sale.feeAddress2)})` : "(none set)"}
                </Label>
                <Input id="fee2-addr" className="font-mono text-sm" spellCheck={false} value={feeAddress2Draft}
                  onChange={(e) => setFeeAddress2Draft(e.target.value.trim())} placeholder="0x…" />
              </div>
              <ActionBtn busy={busy} can={canTransact && actionAllowedInState("setFeeAddress2", st) && feeAddress2Ok}
                onClick={() => requestConfirm("setFeeAddress2", () => ({ kind: "setFeeAddress2", feeAddress: feeAddress2Draft as Address }))}>
                SET FEE ADDR 2
              </ActionBtn>
              <p className="pb-2 text-xs text-[#8a8a8a]">
                {sale?.feeAddress2Bps === undefined ? "8.00%" : `${(sale.feeAddress2Bps / 100).toFixed(2)}%`} of the raise is Fee Address 2 (partner 1).
                Frozen once the sale starts.
              </p>
            </div>

            {/* Fee Address 3 */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="fee3-addr">
                  FEE ADDR 3 (PARTNER 2) {sale?.feeAddress3 && sale.feeAddress3 !== ZERO_ADDRESS ? `(current: ${shortAddr(sale.feeAddress3)})` : "(none set)"}
                </Label>
                <Input id="fee3-addr" className="font-mono text-sm" spellCheck={false} value={feeAddress3Draft}
                  onChange={(e) => setFeeAddress3Draft(e.target.value.trim())} placeholder="0x…" />
              </div>
              <ActionBtn busy={busy} can={canTransact && actionAllowedInState("setFeeAddress3", st) && feeAddress3Ok}
                onClick={() => requestConfirm("setFeeAddress3", () => ({ kind: "setFeeAddress3", feeAddress: feeAddress3Draft as Address }))}>
                SET FEE ADDR 3
              </ActionBtn>
              <p className="pb-2 text-xs text-[#8a8a8a]">
                {sale?.feeAddress3Bps === undefined ? "4.00%" : `${(sale.feeAddress3Bps / 100).toFixed(2)}%`} of the raise is Fee Address 3 (partner 2).
                Frozen once the sale starts.
              </p>
            </div>

            <Separator className="my-3" />

            {/* Fee legs can be switched off. This is the remedy for a fee address that
                turns out to be wrong or unreachable; before it existed the only exit was
                abandoning the sale. A disabled leg falls to the owner. */}
            <p className="mb-2 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">FEE LEGS</p>
            <div className="space-y-2">
              {([1, 2, 3] as const).map((id) => {
                const disabled =
                  id === 1 ? sale?.feeDisabled1 : id === 2 ? sale?.feeDisabled2 : sale?.feeDisabled3;
                return (
                  <div key={id} className="flex flex-wrap items-center gap-2 rounded border border-[#333] p-2">
                    <span className="font-mono text-xs text-[#ededea]">FEE ADDR {id}</span>
                    <span className="font-mono text-[11px] text-[#8a8a8a]">
                      {/* Three states: an unread flag is not "enabled". */}
                      {disabled === undefined ? "state unread" : disabled ? "DISABLED" : "enabled"}
                    </span>
                    <span className="flex-1" />
                    <ActionBtn
                      busy={busy}
                      can={canTransact && !sale?.proceedsWithdrawn}
                      onClick={() =>
                        runAction(`${disabled ? "Enable" : "Disable"} fee address ${id}`, {
                          kind: "setFeeEnabled",
                          feeAddressId: id,
                          enabled: !!disabled,
                        })
                      }
                    >
                      {disabled ? `ENABLE FEE ADDR ${id}` : `DISABLE FEE ADDR ${id}`}
                    </ActionBtn>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-[#8a8a8a]">
              A disabled leg is paid nothing and its share falls to the owner. Allowed in any state
              until the proceeds are withdrawn, and frozen by that. A fee address that cannot receive
              ETH no longer needs any of this: its leg is redirected to the owner in the same
              transaction rather than being left in the contract.
            </p>

            <Separator className="my-3" />

            <p className="mb-2 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">REFERRAL SCOOP</p>
            <p className="mb-2 text-xs text-[#8a8a8a]">
              {sale?.referralBps === undefined ? "4.00%" : `${(sale.referralBps / 100).toFixed(2)}%`} of the
              raise is taken off the top before the fee split, to fund the referral ETH rebate. It goes
              to{" "}
              <span className="font-mono text-[#ededea]">
                {sale?.referralPotRecipient === undefined
                  ? "—"
                  : sale.referralPotRecipient === ZERO_ADDRESS
                    ? "the owner (unset)"
                    : sale.referralPotRecipient}
              </span>
              . Unset is a working configuration, not a missing one.
            </p>

            <Separator className="my-3" />

            <p className="mb-2 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">BURN UNCLAIMED</p>
            <p className="mb-2 text-xs text-[#8a8a8a]">
              {sale?.unclaimedBurned === true
                ? "Already burned. Claiming is closed and reverts with a readable error."
                : burnAvailableAt === null
                  ? "Opens 60 days after the close. The exact time is unknown here because a read has not answered; the contract still decides."
                  : burnReady
                    ? "Open now. Run DISTRIBUTE over the whole contributor list first, then burn what is left."
                    : `Opens after ${burnAvailableAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`}
            </p>
            <ActionBtn
              busy={busy}
              can={canTransact && !burnGated && sale?.unclaimedBurned !== true}
              onClick={() => runAction("Burn unclaimed sale tokens", { kind: "burnUnclaimed" })}
            >
              BURN UNCLAIMED SALE TOKENS
            </ActionBtn>
          </Card>

          {/* contribution limits — set minInitialContribution & contributionStep */}
          <Card className="mb-4 p-4">
            <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">CONTRIBUTION LIMITS</p>
            <div className="mb-3 grid gap-2 text-xs text-[#8a8a8a] sm:grid-cols-2">
              <div>
                <span className="text-[#8a8a8a]">Current min first contribution: </span>
                <span className="font-mono text-[#ededea]">
                  {sale?.minInitialContribution !== undefined
                    ? `${sale.minInitialContribution.toString()} wei (${formatEther(sale.minInitialContribution)} ETH)`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-[#8a8a8a]">Current contribution step: </span>
                <span className="font-mono text-[#ededea]">
                  {sale?.contributionStep !== undefined
                    ? `${sale.contributionStep.toString()} wei (${formatEther(sale.contributionStep)} ETH)`
                    : "—"}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="min-init-limit">
                  MIN FIRST (WEI)
                </Label>
                <Input
                  id="min-init-limit"
                  className="font-mono text-sm"
                  value={minInitialDraft}
                  onChange={(e) => setMinInitialDraft(e.target.value.trim())}
                  placeholder={
                    sale?.minInitialContribution !== undefined
                      ? sale.minInitialContribution.toString()
                      : "5000000000000000"
                  }
                />
              </div>
              <div className="w-48">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="step-limit">
                  STEP INCREMENT (WEI)
                </Label>
                <Input
                  id="step-limit"
                  className="font-mono text-sm"
                  value={stepDraft}
                  onChange={(e) => setStepDraft(e.target.value.trim())}
                  placeholder={
                    sale?.contributionStep !== undefined ? sale.contributionStep.toString() : "1000000000000000"
                  }
                />
              </div>
              <ActionBtn
                busy={busy}
                can={canTransact && actionAllowedInState("setContributionLimits", st) && limitsValid}
                onClick={() =>
                  requestConfirm("setContributionLimits", () => ({
                    kind: "setContributionLimits",
                    minInitialContribution: minInitialBig!,
                    contributionStep: stepBig!,
                  }))
                }
              >
                SET LIMITS
              </ActionBtn>
            </div>
            <p className="mt-2 text-xs text-[#8a8a8a]">
              The contract requires minInitial ≥ step, step &gt; 0, and minInitial % step == 0. Allowed in Pending, Active, or Paused states.
            </p>
          </Card>

          {/* referral eligibility rules — stored in site_config */}
          <Card className="mb-4 p-4">
            <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">REFERRAL ELIGIBILITY RULES (SITE_CONFIG)</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="ref-min-wallets">
                  MIN PEOPLE (BUYERS)
                </Label>
                <Input
                  id="ref-min-wallets"
                  className="font-mono text-sm"
                  type="number"
                  min="1"
                  step="1"
                  value={refWalletsDraft}
                  onChange={(e) => setRefWalletsDraft(e.target.value.trim())}
                  placeholder="1"
                />
              </div>
              <div className="w-64">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="ref-min-wei">
                  MIN WEI BROUGHT IN
                </Label>
                <Input
                  id="ref-min-wei"
                  className="font-mono text-sm"
                  value={refWeiDraft}
                  onChange={(e) => setRefWeiDraft(e.target.value.trim())}
                  placeholder="100000000000000000"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={savingReferralRules || !refWalletsDraft.trim() || !refWeiDraft.trim()}
                onClick={() => void saveReferralRules()}
              >
                {savingReferralRules ? "SAVING…" : "SAVE REFERRAL RULES"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-[#8a8a8a]">
              Distinct credited buyers and combined wei a referrer must bring in to share the 4% referrer pool.
              Saved directly to site_config.
            </p>
          </Card>

          {/* distribution */}
          <Card className="mb-4 p-4">
            <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">DISTRIBUTION</p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-28">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="distribute-count">
                  CHUNK SIZE
                </Label>
                <Input id="distribute-count" className="font-mono" inputMode="numeric" value={distributeCount}
                  onChange={(e) => setDistributeCount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="25" />
                <p className="mt-1 font-mono text-[10px] text-[#4a4a4a]">contributors per call — a plain count</p>
              </div>
              <ActionBtn busy={busy}
                can={canTransact && actionAllowedInState("distribute", st) && sale?.distributionComplete !== true && distributeCountBn !== null && !distributeTooLarge}
                onClick={() => distributeCountBn !== null && runAction("Distribute", { kind: "distribute", count: distributeCountBn })}>
                {sale?.distributionComplete === true ? "DISTRIBUTION COMPLETE" : `DISTRIBUTE ${distributeCount || "—"}`}
              </ActionBtn>
              {/* distribute() is a cursor over contributors — without this you click
                  it blind and cannot tell when you are done. "—" for an unread value. */}
              <span className="font-mono text-[11px] text-[#8a8a8a]">
                cursor{" "}
                <span className="text-[#ededea]">
                  {sale?.distributionCursor === undefined ? "—" : Number(sale.distributionCursor)}
                </span>
                {" / "}
                <span className="text-[#ededea]">
                  {sale?.contributorCount === undefined ? "—" : Number(sale.contributorCount)}
                </span>
                {sale?.distributionComplete === true && <span className="ml-2 text-[#8fbf6a]">done</span>}
              </span>
              <span className="text-xs text-[#8a8a8a]">max {DISTRIBUTE_CHUNK_MAX} per call</span>
            </div>
            {distributeTooLarge && (
              <p className="mt-2 text-xs text-[#d9c96a]">
                A chunk that large can outgrow the block gas limit. Keep it at or below {DISTRIBUTE_CHUNK_MAX}.
              </p>
            )}
          </Card>

          {/* treasury + recovery — every field here is fund-moving */}
          <Card className="mb-4 p-4">
            <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">TREASURY &amp; RECOVERY</p>

            <div className="flex flex-wrap items-center gap-3">
              <ActionBtn busy={busy}
                can={canTransact && st === SALE_STATE.CLOSED && !!sale?.totalRaised && sale.totalRaised > 0n && sale?.proceedsWithdrawn !== true}
                danger onClick={() => requestConfirm("withdrawProceeds", () => ({ kind: "withdrawProceeds" }))}>
                {sale?.proceedsWithdrawn === true ? "PROCEEDS WITHDRAWN" : "WITHDRAW PROCEEDS"}
              </ActionBtn>
              <span className="text-xs text-[#8a8a8a]">
                pays the whole raise once — 80% deployer/LP, 8% fee address 1 (team), 8% fee address 2 (partner 1), 4% fee address 3 (partner 2); unpayable fee shares defer
              </span>
            </div>

            <Separator className="my-3" />

            {/* withdrawUnsoldTokens moves the ENTIRE balance, so the recipient is
                typed, confirmed, and never silently the connected wallet. */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="unsold-to">
                  UNSOLD-TOKEN RECIPIENT
                </Label>
                <Input id="unsold-to" className="font-mono text-sm" spellCheck={false} value={unsoldTo}
                  onChange={(e) => setUnsoldTo(e.target.value.trim())} placeholder="0x…" />
              </div>
              <ActionBtn busy={busy}
                can={canTransact && actionAllowedInState("withdrawUnsoldTokens", st) && unsoldToOk}
                danger
                onClick={() => requestConfirm("withdrawUnsoldTokens", () => (unsoldToOk ? { kind: "withdrawUnsoldTokens", to: unsoldTo as Address } : null))}>
                WITHDRAW UNSOLD TOKENS
              </ActionBtn>
              <span className="pb-2 text-xs text-[#8a8a8a]">
                moves the entire {tokenAmt(sale?.saleTokenBalance)} balance to the address above
              </span>
            </div>

            <Separator className="my-3" />

            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="sweep-to">STRAY SWEEP RECIPIENT</Label>
                <Input id="sweep-to" className="font-mono text-sm" spellCheck={false} value={sweepTo}
                  onChange={(e) => setSweepTo(e.target.value.trim())} placeholder="0x…" />
              </div>
              <ActionBtn busy={busy}
                can={canTransact && actionAllowedInState("sweepStray", st) && sweepToOk && !!sale?.totalStray && sale.totalStray > 0n}
                danger
                onClick={() => requestConfirm("sweepStray", () => (sweepToOk ? { kind: "sweepStray", to: sweepTo as Address } : null))}>
                SWEEP STRAY ETH
              </ActionBtn>
              <span className="pb-2 text-xs text-[#8a8a8a]">
                unclaimed stray: {fmt(eth(sale?.totalStray))}
                {sale?.straySwept === true && " (swept once already, so senders can no longer claim; this can run again on anything new)"}
              </span>
            </div>

            <Separator className="my-3" />

            {/* recoverERC20's amount is parsed against the TYPED token's own
                on-chain decimals (USDC: 6, most memecoins: 18) — read live
                once the address is valid. */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="recover-token">STRAY TOKEN CONTRACT</Label>
                <Input id="recover-token" className="w-72 font-mono text-sm" spellCheck={false} value={recoverForm.erc20}
                  onChange={(e) => setRecoverForm((f) => ({ ...f, erc20: e.target.value.trim() }))} placeholder="0x…" />
              </div>
              <div>
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="recover-to">RECIPIENT</Label>
                <Input id="recover-to" className="w-72 font-mono text-sm" spellCheck={false} value={recoverForm.to}
                  onChange={(e) => setRecoverForm((f) => ({ ...f, to: e.target.value.trim() }))} placeholder="0x…" />
              </div>
              <div className="w-40">
                <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="recover-amount">
                  AMOUNT{recoverToken && typeof recoverTokenDecimals === "number" ? ` (${recoverTokenDecimals} dp)` : ""}
                </Label>
                <Input id="recover-amount" className="font-mono" inputMode="decimal" value={recoverForm.amount}
                  onChange={(e) => setRecoverForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.0" />
              </div>
              <ActionBtn
                busy={busy || (recoverDecimalsLoading ? "reading token…" : null)}
                can={canTransact && recoverArgs !== null} danger
                onClick={() => requestConfirm("recoverERC20", () => (recoverArgs ? { kind: "recoverERC20", ...recoverArgs } : null))}>
                RECOVER TOKEN
              </ActionBtn>
              <span className="pb-2 text-xs text-[#8a8a8a]">the sale token itself is refused</span>
            </div>
          </Card>

          {/* Ownership rotation in flight is a fact, not a control. */}
          {pendingOwnerShown && (
            <Card className="mb-4 p-4">
              <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">OWNERSHIP TRANSFER PENDING</p>
              <p className="text-sm text-[#d9c96a]">
                An ownership rotation to <span className="font-mono text-[#ededea]">{sale?.pendingOwner}</span> was
                started and is waiting for that address to call acceptOwnership. Until then{" "}
                <span className="text-[#ededea]">{sale?.owner ? shortAddr(sale.owner) : "the current owner"}</span> still
                signs everything here.
              </p>
            </Card>
          )}
        </>
      ) : (
        <Card className="mb-6 p-4">
          <p className="text-xs text-[#8a8a8a]">
            {wallet.isConnected
              ? `Connected wallet is not this sale's owner${sale?.owner ? ` (owner is ${shortAddr(sale.owner)})` : ""} — owner controls are hidden.`
              : "Connect the owner wallet to see owner controls."}
          </p>
        </Card>
      )}

      {/* ── CONFIRM DIALOG — typed word, not window.confirm ── */}
      <Dialog open={confirm !== null} onOpenChange={onConfirmDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[#e0897a]">{confirm?.label}</DialogTitle>
            <DialogDescription className="whitespace-pre-line text-[13px] leading-relaxed">
              {confirm?.body}
            </DialogDescription>
          </DialogHeader>
          {confirm?.extra?.map((f) => (
            <div key={f.name} className="text-sm">
              <span className="text-[#8a8a8a]">{f.label}: </span>
              <span className={f.mono ? "font-mono" : ""}>{f.value}</span>
            </div>
          ))}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label htmlFor="confirm-word">
                Type <span className="font-mono font-bold text-[#e0897a]">{confirm?.word}</span> to continue
              </Label>
              {confirm?.word && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-[#8a8a8a] hover:text-[#ededea]"
                  onClick={() => {
                    navigator.clipboard?.writeText(confirm.word).then(() => {
                      toast({ title: "Copied confirmation word", duration: ONE_SHOT_MS });
                    }).catch(() => {});
                  }}
                >
                  Copy
                </Button>
              )}
            </div>
            <Input
              id="confirm-word"
              className="font-mono"
              value={confirm?.typed ?? ""}
              autoFocus
              onChange={(e) => setConfirm((c) => (c ? { ...c, typed: e.target.value } : c))}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSend();
              }}
              placeholder={confirm?.word}
            />
            {confirm?.build() === null && (
              <p className="mt-1 text-xs text-[#e0897a]">
                Cannot execute: the required parameters or preconditions for this action are incomplete or invalid.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirm?.typed.trim().toUpperCase() !== confirm?.word || confirm?.build() === null}
              onClick={confirmSend}
            >
              CONFIRM {confirm?.label.toUpperCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A deploy aid, not a contract read: tokensForSale_ is a constructor
          argument, so it has to be right BEFORE any of the panel above can
          read anything. Wrong by 10^18 is unrecoverable once start() runs. */}
      <UnitConverter saleDecimals={dec} sym={sym} />

      <InfoPanel title="HOW TO TEST ON THE TESTNET">
        <p>
          Build with <code>NEXT_PUBLIC_ALLOW_TESTNET_CHAIN=true</code> + testnet RPC, deploy
          TokenSale there manually (constructor: owner, token, tokensForSale, feeAddress1, feeAddress2, feeAddress3),
          fund it with the sale token, then set the address above and walk the state machine:
          PENDING → fund → START → contribute → CLOSE → claim. A direct ETH send (not
          contribute()) lands in STRAY and is pull-back-able — that row tests exactly this.
        </p>
        <p className="text-[#4a4a4a]">
          The TESTNET button only exists in opt-in builds; production bundles never carry the testnet
          network, so the wallet cannot be switched onto it from a public deploy.
        </p>
      </InfoPanel>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

function Notice({ ok, children, tone }: { ok: boolean; children: ReactNode; tone?: "warning" }) {
  const cls =
    tone === "warning"
      ? "border-[#8a6d1f] bg-[#1c1a14] text-[#d9c96a]"
      : ok
        ? "border-[#3d5c3d] bg-[#141c14] text-[#8fbf6a]"
        : "border-[#8a3a30] bg-[#1c1414] text-[#e0897a]";
  return <p className={`mb-6 border px-4 py-3 text-sm leading-relaxed ${cls}`}>{children}</p>;
}

/**
 * `unit` is not decoration. Every figure on this page is one of three things —
 * ETH (18dp, `uint256` wei on chain), a token amount (the SALE token's own
 * decimals, `uint256` raw units), or a plain count — and mistaking one for
 * another is how a deploy gets funded 10^18 times wrong. The rendered value is
 * always the human scale; this line names what the contract actually stores.
 */
function Stat({ label, value, unit, hint }: { label: string; value: string | number; unit?: string; hint?: string }) {
  return (
    <div className="border border-border bg-card px-5 py-5">
      <div className="text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="mt-2 text-[11px] tracking-[0.16em] text-muted-foreground">{label}</div>
      {unit && <div className="mt-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/60">{unit}</div>}
      {hint && <div className="mt-1 text-[11px] leading-snug text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

function FundingCell({ label, value, sub, unit }: { label: string; value: string; sub?: string; unit?: string }) {
  return (
    <div className="min-w-0 border border-border bg-background px-4 py-4">
      {/* break-all + a smaller step: a raw uint256 is 25+ digits and was
          running straight out of the card, clipping the very number this
          panel exists to show exactly. */}
      <div className="break-all text-lg font-bold tabular-nums text-foreground sm:text-xl">{value}</div>
      {sub && <div className="mt-0.5 break-all text-xs text-muted-foreground">{sub}</div>}
      <div className="mt-1.5 text-[11px] tracking-[0.16em] text-muted-foreground">{label}</div>
      {unit && <div className="mt-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/60">{unit}</div>}
    </div>
  );
}

/**
 * One COMPLETE class string per variant — never `${btn} ${btnAccent}`. Composing
 * them emitted conflicting bg classes on the same element, and Tailwind resolves
 * that by stylesheet order, not attribute order: which one won was arbitrary.
 */
function ActionBtn({
  children,
  onClick,
  can,
  busy,
  accent = false,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  can: boolean;
  busy: string | null;
  accent?: boolean;
  danger?: boolean;
}) {
  const base = "border px-3 py-2 font-mono text-[11px] tracking-[0.12em] transition-colors disabled:cursor-not-allowed";
  const cls = !can || busy !== null
    ? `${base} border-[#232323] bg-[#111] text-[#4a4a4a]`
    : accent
      ? `${base} border-[#ccff00] bg-[#ccff00] text-[#0a0a0a] hover:bg-[#d9ff33] hover:border-[#d9ff33]`
      : danger
        ? `${base} border-[#8a3a30] bg-[#1c1414] text-[#e0897a] hover:border-[#e0897a]`
        : `${base} border-[#2a2a2a] bg-[#141414] text-[#ededea] hover:border-[#8a8a8a]`;
  return (
    <button className={cls} disabled={!can || busy !== null} onClick={onClick}
      title={can ? undefined : "Needs: valid address · connected wallet · right network · sale in the required state"}>
      {busy ? "…" : children}
    </button>
  );
}

/**
 * Whole tokens <-> raw units, for the numbers that are typed OUTSIDE this app.
 *
 * `tokensForSale_` is a constructor argument and `start()` demands the funded
 * balance equal it EXACTLY, so both are entered before the panel above can read
 * anything — in a deploy script and a wallet's send field, where nothing
 * converts for you. Getting the scale wrong there is not a typo you fix, it is
 * a redeploy (over the target, every exit is shut).
 *
 * Decimals are an INPUT, not read from the sale token: at deploy time the sale
 * contract does not exist yet. It defaults to the sale token's own decimals
 * once those are readable, so the common case needs no thought, and stays
 * editable for the case that matters.
 */
function UnitConverter({ saleDecimals, sym }: { saleDecimals?: number; sym: string }) {
  const [decimals, setDecimals] = useState<string>("");
  const [whole, setWhole] = useState("");
  const [raw, setRaw] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // The sale token's decimals when known, the field's value when the operator
  // has typed one. 18 is the last resort and is LABELLED as an assumption —
  // a silent 18 is exactly the guess this whole panel exists to prevent.
  const effective = (() => {
    const typed = decimals.trim();
    if (typed !== "") {
      const n = Number(typed);
      return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
    }
    return saleDecimals ?? 18;
  })();
  const assumed = decimals.trim() === "" && saleDecimals === undefined;

  const fromWhole = (v: string) => {
    setWhole(v);
    if (effective === null) return setRaw("");
    try {
      setRaw(v.trim() === "" ? "" : parseUnits(v.trim(), effective).toString());
    } catch {
      setRaw("");
    }
  };
  const fromRaw = (v: string) => {
    const cleaned = v.replace(/[^0-9]/g, "");
    setRaw(cleaned);
    if (effective === null) return setWhole("");
    try {
      setWhole(cleaned === "" ? "" : formatUnits(BigInt(cleaned), effective));
    } catch {
      setWhole("");
    }
  };
  const copy = (text: string, which: string) => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1200);
    });
  };

  const field = "w-full border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] outline-none focus:border-[#ccff00]";

  return (
    <Card className="mb-6 p-4">
      <p className="mb-1 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">
        UNIT CONVERTER — WHOLE TOKENS ↔ RAW UNITS
      </p>
      <p className="mb-3 text-xs text-[#8a8a8a]">
        For the values you type somewhere else: the constructor&apos;s{" "}
        <code className="text-[#ededea]">tokensForSale_</code> and the funding transfer. Both are
        raw units, and <code className="text-[#ededea]">start()</code> demands they match exactly.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem]">
        <div className="min-w-0">
          <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="conv-whole">
            WHOLE TOKENS
          </Label>
          <Input id="conv-whole" className={field} value={whole} onChange={(e) => fromWhole(e.target.value)}
            placeholder="3000000" inputMode="decimal" spellCheck={false} />
          <p className="mt-1 font-mono text-[10px] text-[#4a4a4a]">what a human says — {sym}</p>
        </div>
        <div className="min-w-0">
          <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="conv-raw">
            RAW UNITS (uint256)
          </Label>
          <Input id="conv-raw" className={field} value={raw} onChange={(e) => fromRaw(e.target.value)}
            placeholder="3000000000000000000000000" inputMode="numeric" spellCheck={false} />
          <p className="mt-1 font-mono text-[10px] text-[#4a4a4a]">what the contract stores</p>
        </div>
        <div className="min-w-0">
          <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="conv-dec">
            DECIMALS
          </Label>
          <Input id="conv-dec" className={field} value={decimals} onChange={(e) => setDecimals(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={String(saleDecimals ?? 18)} inputMode="numeric" />
          <p className={`mt-1 font-mono text-[10px] ${assumed ? "text-[#d9c96a]" : "text-[#4a4a4a]"}`}>
            {decimals.trim() !== ""
              ? "typed"
              : saleDecimals !== undefined
                ? `${sym} reads ${saleDecimals}`
                : "assuming 18 — unread"}
          </p>
        </div>
      </div>
      {effective === null && (
        <p className="mt-3 text-xs text-[#e0897a]">Decimals must be a whole number between 0 and 36.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!raw} onClick={() => copy(raw, "raw")}>
          {copied === "raw" ? "COPIED" : "COPY RAW UNITS"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!whole} onClick={() => copy(whole, "whole")}>
          {copied === "whole" ? "COPIED" : "COPY WHOLE"}
        </Button>
      </div>
    </Card>
  );
}
