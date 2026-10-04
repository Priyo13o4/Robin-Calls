'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useWallet, type UseWalletReturn } from '@/lib/wallet/useWallet';
import { flags } from '@/lib/config/flags';

export interface WhitelistStatus {
  approved: boolean;
  eligible: boolean;
}

interface WhitelistStatusContextValue {
  wallet: UseWalletReturn;
  checked: boolean;
  status: WhitelistStatus | null;
  /** Re-run wallet detection + the DB status read. Call after anything that
   *  could have changed either (closing WhitelistModal, most reliably). */
  refresh: () => void;
}

const WhitelistStatusContext = createContext<WhitelistStatusContextValue | null>(null);

/**
 * ONE wallet + whitelist-status instance for the whole app, mounted in the
 * root layout (persists across every client-side navigation — unlike
 * `NoirShell`, which is instantiated fresh per top-level page and previously
 * left `SiteNav`'s drawer button and `AppSidebar`'s rail button each running
 * their own independent `useWallet()` + status fetch).
 *
 * That duplication was two real bugs, not just waste:
 *   1. "Whitelisting on one page doesn't show on another" — each surface
 *      had its own status snapshot from its own mount; nothing told the
 *      other one anything had changed.
 *   2. "I keep getting rate-limited" — `/api/whitelist?wallet=` shares a
 *      10-req/60s-per-IP budget with the onboarding POSTs, and SiteNav +
 *      AppSidebar were both mounted (one CSS-hidden) on every interior page,
 *      so a few page changes alone could burn half that budget on GETs that
 *      told the user nothing new.
 */
export function WhitelistStatusProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<WhitelistStatus | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // Whitelist "disabled" (flags.whitelist off) was only ever gating the
    // BUTTONS/modal (see AppSidebar/SiteNav/WhitelistModal) — this provider
    // is mounted unconditionally in the root layout and, with no gate of its
    // own, called wallet.checkConnection() on every page for every visitor
    // regardless, silently probing window.ethereum (and, for anyone with a
    // stale rc_wallet_previously_connected flag from before whitelist was
    // turned off, a real eth_accounts call). Some extensions visibly react to
    // that even though it's spec-silent — the "wallet popup even though it's
    // disabled" report. Nothing downstream needs this when the flag is off:
    // every real consumer (WhitelistNavButton, SiteNav, AppSidebar) already
    // checks flags.whitelist itself before reading `checked`/`status`.
    //
    // Since the 2026-09-04 retirement this branch is the ONLY one that runs —
    // flags.whitelist is a hardcoded false. The status fetch below is kept,
    // not deleted, because it is the revival path and because this provider
    // still owns the wallet the whole app reads. Do not read `status` as a
    // fact about a member: it is permanently null.
    if (!flags.whitelist) {
      setChecked(true);
      setStatus(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const addr = await wallet.checkConnection();
      if (cancelled) return;
      if (!addr) {
        setChecked(true);
        setStatus(null);
        return;
      }
      try {
        const res = await fetch(`/api/whitelist?wallet=${addr}`);
        const data = await res.json();
        if (cancelled) return;
        setStatus(
          data && data.status !== 'not_found'
            ? { approved: data.status === 'approved', eligible: Boolean(data.eligible) }
            : null,
        );
      } catch {
        /* best-effort — falls back to the CTA */
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return (
    <WhitelistStatusContext.Provider value={{ wallet, checked, status, refresh }}>
      {children}
    </WhitelistStatusContext.Provider>
  );
}

export function useWhitelistStatusContext(): WhitelistStatusContextValue {
  const ctx = useContext(WhitelistStatusContext);
  if (!ctx) {
    throw new Error('useWhitelistStatusContext() called outside WhitelistStatusProvider — check app/layout.tsx');
  }
  return ctx;
}
