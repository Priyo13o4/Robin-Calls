'use client';

import { useEffect, useState } from 'react';
import { useConnection } from 'wagmi';
import { getAppKit } from '@/lib/wallet/appkit-config';

/**
 * The connected wallet's REAL brand icon — the wallet identifies itself via
 * EIP-6963, and two surfaces carry that mark:
 *
 *   1. wagmi's `connector.icon` — populated by the EIP-6963 provider discovery
 *      the injected connector wraps. Primary, because it resolves the moment
 *      wagmi's account does, with no AppKit involvement.
 *   2. AppKit's `getWalletInfo()` — resolves a beat later (and is the only
 *      source for a WalletConnect-relayed wallet). Subscribed so a late
 *      resolution re-renders.
 *
 * Two sources, because they resolve on different clocks: AppKit alone was the
 * bug — an injected MetaMask read as unbranded whenever AppKit hadn't finished
 * its metadata handshake, and the sidebar showed a generic wallet glyph for a
 * fox it had in hand one layer down.
 *
 * No bundled marks, no fallback art: an unbranded result has nothing true to
 * draw and renders nothing.
 */
export function useWalletIcon(): string | null {
  const connectorIcon = useConnection().connector?.icon;
  const [appkitIcon, setAppkitIcon] = useState<string | null>(() => {
    const info = getAppKit()?.getWalletInfo();
    return typeof info?.icon === 'string' && info.icon ? info.icon : null;
  });

  useEffect(() => {
    const modal = getAppKit();
    if (!modal) return;
    const info = modal.getWalletInfo();
    setAppkitIcon(typeof info?.icon === 'string' && info.icon ? info.icon : null);
    const unsubscribe = modal.subscribeWalletInfo?.((newWalletInfo?: { icon?: string }) => {
      setAppkitIcon(typeof newWalletInfo?.icon === 'string' && newWalletInfo.icon ? newWalletInfo.icon : null);
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  return connectorIcon ?? appkitIcon;
}
