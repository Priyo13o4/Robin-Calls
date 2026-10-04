'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setActiveSaleChainId } from '@/lib/config/chain';
import { ensureAppKit, getWagmiAdapter, hasPriorWalletSession } from './appkit-config';

/**
 * Wraps the app in the wagmi context `useWallet` (and any future direct
 * wagmi-hook consumer) needs. Mounted once in app/layout.tsx, above
 * WhitelistStatusProvider — same "root layout, not NoirShell" reasoning as
 * that provider (persists across client-side navigations).
 *
 * QueryClient is created per-mount (useState, not module scope): wagmi's
 * hooks use it for request de-duping, and a module-level singleton would be
 * shared across requests on the server (Next SSR), leaking cache between
 * users. This mirrors the standard wagmi+Next.js App Router setup.
 */
export function WalletKitProvider({
  children,
  initialChainId,
}: {
  children: ReactNode;
  initialChainId?: number;
}) {
  const [queryClient] = useState(() => new QueryClient());
  // Before the adapter is built below, so a dynamically rendered route hands
  // wagmi the real sale chain. A prerendered one has no id to give (see
  // setActiveSaleChainId); the sale surfaces set it themselves when they mount.
  if (typeof window !== 'undefined' && initialChainId !== undefined) {
    (window as unknown as { __SALE_CHAIN_ID__?: number | null }).__SALE_CHAIN_ID__ = initialChainId;
    setActiveSaleChainId(initialChainId);
  }
  // Read once, at mount. A returning connected user gets the full silent
  // restore; a first-time visitor gets NO wallet activity at all until they
  // click connect — no connectors registered, so nothing calls isAuthorized()
  // and nothing touches window.ethereum. See appkit-config's note on why an
  // eager init reads to the user as "the wallet popped up on page load".
  const [restoring] = useState(hasPriorWalletSession);

  // AppKit owns the session it restores, so it must exist before wagmi's
  // reconnect runs for a returning user. Effect, not module scope: this must
  // not run on the server and must not run for a first-time visitor.
  useEffect(() => {
    if (restoring) ensureAppKit();
  }, [restoring]);

  return (
    <WagmiProvider config={getWagmiAdapter().wagmiConfig} reconnectOnMount={restoring}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
