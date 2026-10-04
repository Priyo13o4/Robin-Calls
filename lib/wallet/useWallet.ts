'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import {
  useAccount,
  useDisconnect,
  useSignMessage,
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
} from 'wagmi';
import { getAccount, getCapabilities, sendCalls as sendCallsAction, waitForCallsStatus, watchAccount, type WaitForCallsStatusReturnType } from '@wagmi/core';
import type { TypedDataDefinition } from 'viem';
import { ensureAppKitReady, getAppKit, getWagmiAdapter, warmAppKit } from './appkit-config';
import { activeSaleChainId, subscribeSaleChainId } from '@/lib/config/chain';
import { describeTransportFailure, isUserRejection, logFailure, type Failure } from './failure';

/**
 * docs/wallet-integration/WAYS-OF-WORK.md — Reown AppKit + wagmi backend,
 * replacing the hand-rolled window.ethereum calls this file used to make
 * directly (§3: "same interface, new backend"). Old reconnect-race guard
 * (waitForEthereum/PREVIOUSLY_CONNECTED_KEY) is gone per W3/§8 risk —
 * AppKit+wagmi (ssr:true) own session restore now; running both would be
 * two competing reconnect paths.
 */

/**
 * Wagmi/viem wrap a wallet's raw EIP-1193 4001 rejection inside nested error
 * classes (UserRejectedRequestError etc.) instead of a flat `.code` — walk
 * `.cause` a few levels rather than the old single-level `'code' in err`
 * check, which would silently stop matching on the new error shapes.
 */
/**
 * One plain sentence per failure. Previously this returned viem's
 * `shortMessage`, or the raw `.message` when there was none, so a wallet fault
 * could put "HTTP request failed. Status: 429 URL: https://…" in front of a
 * user. The raw error still reaches the console through logFailure.
 */
function errorMessage(err: unknown, fallback: string): Failure {
  logFailure('wallet', err);
  return describeTransportFailure(err, fallback);
}

/**
 * The account as of NOW, not the render-time snapshot a caller's closure holds.
 * `await wallet.connect()` resolving and the very next `wallet.sign()` run
 * against the same React commit, where `address` is still null — a
 * snapshot-trusting sign() early-returns on the first attempt and only works
 * after a re-render. checkConnection already reads the live store for the
 * same reason.
 */
function liveAddress(): string | null {
  return getAccount(getWagmiAdapter().wagmiConfig).address ?? null;
}

/* ------------------------------------------------------------------ */
/*  Hook return type                                                   */
/* ------------------------------------------------------------------ */
export interface UseWalletReturn {
  /** Current connected wallet address (checksummed) or null */
  address: string | null;
  /** True while a connect/sign/send/switch request is in progress */
  isLoading: boolean;
  /** Last error message, cleared on next action */
  error: string | null;
  /** True when the failure in `error` is known NOT to have reached the chain,
   *  so a notice about it may auto-dismiss. False whenever it might have. */
  errorSettled: boolean;
  /** Kept for back-compat (see definition below) — always true post-AppKit. */
  isMetaMaskInstalled: boolean;
  /** Whether a wallet is currently connected */
  isConnected: boolean;
  /** Opens the AppKit connect modal (named picker + QR + search) */
  connect: () => Promise<string | null>;
  /** Warm AppKit on hover/focus of a connect control — see appkit-config. */
  prepare: () => void;
  /** Silently check for an already-restored session — no popup, no prompt */
  checkConnection: () => Promise<string | null>;
  /** Sign a message with personal_sign (zero gas) — returns the signature hex */
  sign: (message: string) => Promise<string | null>;
  /** Disconnect the wagmi session */
  disconnect: () => void;
  /** Clear a stuck in-flight state so the user can retry. */
  reset: () => void;
  /** Human label for the connected wallet (e.g. "MetaMask", "Rabby"). */
  providerName: string;
  /* ---- Phase 3 additions (additive per §4 principle 1) ---- */
  /** Connected wallet's current chain id, or null when disconnected. */
  chainId: number | null;
  /** True when connected but on a chain other than the one this build
   *  transacts on: the chain of the configured sale, not a build flag. */
  isWrongChain: boolean;
  /** Prompts wallet_switchEthereumChain — wagmi falls back to
   *  wallet_addEthereumChain on its own when the wallet returns 4902
   *  (chain never added), using the payload from lib/config/chain.ts. */
  switchChain: () => Promise<boolean>;
  /**
   * eth_sendTransaction. Returns the tx hash, or null on rejection/failure.
   *
   * Pass `chainId` whenever the caller knows which chain the tx belongs to:
   * wagmi then throws ChainMismatchError instead of broadcasting on whatever
   * network the wallet happens to be on. A render-time gate is not enough on
   * its own — the user can switch networks in their wallet after the button
   * unlocks and before they confirm, and value-bearing calls live here.
   * Left optional because the admin cockpit deliberately targets a chain the
   * operator picks, rather than this build's own.
   */
  sendTransaction: (tx: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
    chainId?: number;
  }) => Promise<`0x${string}` | null>;
  /** eth_signTypedData_v4 (EIP-712) — the swap router's Permit2 primitive. */
  signTypedData: (typedData: TypedDataDefinition) => Promise<`0x${string}` | null>;
  /** EIP-5792: can the connected wallet run several calls atomically on this chain? */
  supportsAtomicBatch: (chainId: number) => Promise<boolean>;
  /** wallet_sendCalls with forceAtomic. Returns the batch id, or null on rejection/failure. */
  sendCalls: (calls: { to: `0x${string}`; data: `0x${string}`; value: bigint }[], chainId: number) => Promise<string | null>;
  /** Waits for a batch's receipts. Throws on timeout, like waitForTransactionReceipt. */
  waitForCalls: (id: string, timeoutMs: number) => Promise<WaitForCallsStatusReturnType>;
}

/* ------------------------------------------------------------------ */
/*  useWallet hook                                                     */
/* ------------------------------------------------------------------ */
export function useWallet(): UseWalletReturn {
  /* The classified failure, not just its sentence: `settled` says whether the
     transaction is known never to have left, which is what decides if a notice
     may auto-dismiss. `error` below stays a string for existing consumers. */
  const [failure, setFailure] = useState<Failure | null>(null);
  /**
   * How many wallet actions are in flight, NOT a boolean.
   *
   * connect/sign share `lockRef` and cannot overlap, but switchChain,
   * sendTransaction and signTypedData take no lock — deliberately, since a
   * wrong-chain prompt has to be answerable while a send is pending. With a
   * boolean, whichever of two concurrent actions settled first wrote `false`
   * and un-disabled a button whose transaction was still awaiting
   * confirmation, which is a double-send. A counter cannot describe two
   * actions with one flag.
   */
  const [pending, setPending] = useState(0);
  const begin = useCallback(() => {
    setFailure(null);
    setPending((n) => n + 1);
  }, []);
  const end = useCallback(() => setPending((n) => Math.max(0, n - 1)), []);

  // guard against double-click race conditions
  const lockRef = useRef(false);

  const account = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();

  const address = account.address ?? null;
  const isConnected = account.isConnected && address !== null;
  const chainId = account.chainId ?? null;
  // Subscribed, not called: on a prerendered page the sale's chain is unknown
  // at mount and arrives when a sale surface resolves it. A plain call would
  // leave this component holding the mainnet guess with no reason to re-render.
  // Same reader for both snapshots: on the server it has no window and no
  // resolved value, so it answers mainnet there and the hydration render agrees.
  const saleChainId = useSyncExternalStore(subscribeSaleChainId, activeSaleChainId, activeSaleChainId);
  const isWrongChain = isConnected && chainId !== saleChainId;
  // wagmi's "reconnecting"/"connecting" statuses cover session-restore and an
  // in-flight connect — surfaced as isLoading so a consumer gating a button
  // on it doesn't flash a "Connect" CTA that's about to disappear.
  const isLoading = pending > 0 || account.status === 'reconnecting' || account.status === 'connecting';
  const providerName = account.connector?.name ?? 'wallet';

  /**
   * Was `typeof window.ethereum !== 'undefined'` pre-AppKit. Meaningless now:
   * the AppKit modal always offers a WalletConnect QR path, no extension
   * required — that is the entire point of Phase 2. Kept `true`
   * unconditionally, not renamed, per §4 principle 1 (no consumer changes) —
   * WhitelistModal's `!wallet.isMetaMaskInstalled` ("Install a Wallet")
   * branch now simply never renders, which is the intended outcome.
   */
  const isMetaMaskInstalled = true;

  /* ── connect ── */
  const connect = useCallback(async (): Promise<string | null> => {
    if (lockRef.current) return null;
    lockRef.current = true;
    begin();
    try {
      // Built on first use, not at import: a page load must not register
      // connectors for a visitor who never asked for a wallet (see
      // appkit-config.ts::hasPriorWalletSession). `prepare()` on hover usually
      // means this is already resolved by the time the click lands.
      const modal = await ensureAppKitReady();

      // No injected-only fallback. A second connect backend meant the
      // picker/QR this revamp exists for silently wasn't the one that ran
      // whenever the project id was missing — and the missing id went
      // unnoticed precisely because connecting still "worked".
      if (!modal) {
        setFailure({ sentence: 'Wallet connection is not set up on this site yet.', settled: true });
        return null;
      }
      if (modal.getIsConnectedState()) {
        return modal.getAddress() ?? null;
      }

      return await new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (result: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubAccount();
          unsubState();
          resolve(result);
        };
        const unsubAccount = modal.subscribeAccount((state) => {
          if (state.isConnected && state.address) finish(state.address);
        });
        // Modal closed without a connection completing (user dismissed it) —
        // not an error, matches the old "wallet window closed" dismiss path.
        const unsubState = modal.subscribeState((state) => {
          if (!state.open && !modal.getIsConnectedState()) finish(null);
        });
        // Backstop so a hung WalletConnect relay session can't wedge the UI
        // in "Waiting for wallet…" forever — reset() is also available.
        const timer = setTimeout(() => finish(null), 5 * 60 * 1000);
        void modal.open({ view: 'Connect' });
      });
    } catch (err: unknown) {
      setFailure(isUserRejection(err) ? { sentence: 'You rejected the connection request in your wallet.', settled: true } : errorMessage(err, 'The wallet could not be connected. Try again.'));
      return null;
    } finally {
      end();
      lockRef.current = false;
    }
  }, [begin, end]);

  /* ── prepare ── */
  // Hover/focus on a connect control. Buys AppKit the head start its async
  // connector registration needs, without any of it happening on page load.
  const prepare = useCallback(() => {
    warmAppKit();
  }, []);

  /* ── checkConnection ── */
  // AppKit/wagmi restore a prior session automatically on mount (ssr:true +
  // AppKit's own storage) — this waits out the brief "reconnecting" window
  // rather than driving the restore itself. Reads the live wagmi store via
  // @wagmi/core (not the account snapshot closed over by this useCallback),
  // since a snapshot would never observe the status change it's waiting for.
  const checkConnection = useCallback(async (): Promise<string | null> => {
    const current = getAccount(getWagmiAdapter().wagmiConfig);
    if (current.status === 'connected') return current.address ?? null;
    if (current.status !== 'reconnecting') return null;
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unwatch();
        resolve(result);
      };
      const unwatch = watchAccount(getWagmiAdapter().wagmiConfig, {
        onChange: (next) => {
          if (next.status === 'connected') finish(next.address ?? null);
          else if (next.status === 'disconnected') finish(null);
        },
      });
      const timer = setTimeout(() => finish(null), 2000);
    });
  }, []);

  /* ── sign ── */
  const sign = useCallback(
    async (message: string): Promise<string | null> => {
      if (lockRef.current) return null;
      lockRef.current = true;
      begin();
      try {
        const addr = liveAddress();
        if (!addr) {
          setFailure({ sentence: 'No wallet is connected. Connect one first.', settled: true });
          return null;
        }
        return await signMessageAsync({ message });
      } catch (err: unknown) {
        setFailure(isUserRejection(err) ? { sentence: 'You rejected the signature request in your wallet.', settled: true } : errorMessage(err, 'The message could not be signed. Try again.'));
        return null;
      } finally {
        end();
        lockRef.current = false;
      }
    },
    [signMessageAsync, begin, end],
  );

  /* ── switchChain (Phase 3) ── */
  // §4 principle 4: explicit, visible step — never assumed silently correct.
  const switchChain = useCallback(async (): Promise<boolean> => {
    begin();
    try {
      await switchChainAsync({ chainId: activeSaleChainId() });
      return true;
    } catch (err: unknown) {
      setFailure(isUserRejection(err) ? { sentence: 'You rejected the network switch in your wallet.', settled: true } : errorMessage(err, 'The network could not be switched. Change it in your wallet, then try again.'));
      return false;
    } finally {
      end();
    }
  }, [switchChainAsync, begin, end]);

  /* ── sendTransaction (Phase 3) ── */
  const sendTransaction = useCallback(
    async (tx: {
      to: `0x${string}`;
      data?: `0x${string}`;
      value?: bigint;
      chainId?: number;
    }): Promise<`0x${string}` | null> => {
      begin();
      try {
        // Same live-store read as sign(): a caller that just connected holds a
        // render-time snapshot where address is still null, and wagmi's own
        // error for "no account" is far less legible than this sentence.
        if (!liveAddress()) {
          setFailure({ sentence: 'No wallet is connected. Connect one first.', settled: true });
          return null;
        }
        return await sendTransactionAsync(tx);
      } catch (err: unknown) {
        // §4 principle 3: a missing/failing capability fails loud, never a swallowed catch.
        setFailure(isUserRejection(err) ? { sentence: 'You rejected the transaction in your wallet.', settled: true } : errorMessage(err, 'The transaction did not go through. If you approved it in your wallet, check the explorer before trying again.'));
        return null;
      } finally {
        end();
      }
    },
    [sendTransactionAsync, begin, end],
  );

  /* ── EIP-5792 batches: approve + swap in one confirmation ── */
  const supportsAtomicBatch = useCallback(async (chainId: number): Promise<boolean> => {
    const addr = liveAddress();
    if (!addr) return false;
    try {
      const caps = await getCapabilities(getWagmiAdapter().wagmiConfig, { account: addr as `0x${string}`, chainId });
      const status = (caps as { atomic?: { status?: string } }).atomic?.status;
      return status === 'supported' || status === 'ready';
    } catch {
      // A wallet without wallet_getCapabilities cannot batch; the step-by-step flow still works.
      return false;
    }
  }, []);

  const sendCalls = useCallback(
    async (calls: { to: `0x${string}`; data: `0x${string}`; value: bigint }[], chainId: number): Promise<string | null> => {
      begin();
      try {
        if (!liveAddress()) {
          setFailure({ sentence: 'No wallet is connected. Connect one first.', settled: true });
          return null;
        }
        const { id } = await sendCallsAction(getWagmiAdapter().wagmiConfig, { calls, chainId, forceAtomic: true });
        return id;
      } catch (err: unknown) {
        setFailure(isUserRejection(err) ? { sentence: 'You rejected the transaction in your wallet.', settled: true } : errorMessage(err, 'The transaction did not go through. If you approved it in your wallet, check the explorer before trying again.'));
        return null;
      } finally {
        end();
      }
    },
    [begin, end],
  );

  const waitForCalls = useCallback(
    (id: string, timeoutMs: number) => waitForCallsStatus(getWagmiAdapter().wagmiConfig, { id, timeout: timeoutMs }),
    [],
  );

  /* ── signTypedData (Phase 3 — Permit2's signing primitive) ── */
  const signTypedData = useCallback(
    async (typedData: TypedDataDefinition): Promise<`0x${string}` | null> => {
      begin();
      try {
        if (!liveAddress()) {
          setFailure({ sentence: 'No wallet is connected. Connect one first.', settled: true });
          return null;
        }
        return await signTypedDataAsync(typedData);
      } catch (err: unknown) {
        setFailure(isUserRejection(err) ? { sentence: 'You rejected the signature request in your wallet.', settled: true } : errorMessage(err, 'The request could not be signed. Try again.'));
        return null;
      } finally {
        end();
      }
    },
    [signTypedDataAsync, begin, end],
  );

  /* ── disconnect ── */
  const disconnect = useCallback(() => {
    setFailure(null);
    // Through AppKit when it exists: it owns `@appkit/connection_status`, and
    // that key is what decides whether the NEXT page load may touch the wallet
    // at all (appkit-config::hasPriorWalletSession). A wagmi-only disconnect
    // leaves it reading "connected" and re-arms the eager restore.
    const modal = getAppKit();
    void Promise.resolve(modal ? modal.disconnect() : disconnectAsync()).catch(() => {
      /* best-effort — wagmi's own state is the source of truth consumers read */
    });
  }, [disconnectAsync]);

  /* ── reset ── */
  // Release a stuck attempt (closed popup/modal that never resolved) so retry works.
  const reset = useCallback(() => {
    lockRef.current = false;
    setPending(0);
    setFailure(null);
  }, []);

  return {
    address,
    isLoading,
    error: failure?.sentence ?? null,
    errorSettled: failure?.settled ?? false,
    isMetaMaskInstalled,
    isConnected,
    connect,
    prepare,
    checkConnection,
    sign,
    disconnect,
    reset,
    providerName,
    chainId,
    isWrongChain,
    switchChain,
    sendTransaction,
    signTypedData,
    supportsAtomicBatch,
    sendCalls,
    waitForCalls,
  };
}
