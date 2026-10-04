'use client';

import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createAppKit } from '@reown/appkit/react';
import { watchConnectors } from '@wagmi/core';
import { walletNetworks } from '@/lib/config/chain';
import type { AppKitNetwork } from '@reown/appkit/networks';

/**
 * docs/wallet-integration/WAYS-OF-WORK.md §2/§6 Phase 0–1. `AppKitNetwork` is
 * `viem.Chain | CaipNetwork` (checked against @reown/appkit-common's own
 * .d.ts) — `robinhoodChain` (built with viem's defineChain in lib/config/
 * chain.ts) satisfies it directly. No parallel chain config, confirming the
 * plan doc's Phase 0 assumption rather than leaving it unverified.
 *
 * Networks come from `walletNetworks()`: both Robinhood chains, the sale's own
 * first. wagmi's switchChain can only target a configured chain (it adds it to
 * the wallet via wallet_addEthereumChain from that config), so the list has to
 * carry the chain we might need to move someone TO, not just the one the sale
 * is on. See that function for what the one-entry version cost.
 */
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() ?? '';

/** True when a Reown project id is configured; the only supported backend. */
export const isWalletConfigured = projectId !== '';

/**
 * Always constructed, even with no projectId: `wagmiConfig` must exist for
 * `<WagmiProvider>` regardless. It starts with ZERO connectors on purpose —
 * `createAppKit()` registers them, and until it runs nothing in this app has
 * touched `window.ethereum`. That emptiness is what `hasPriorWalletSession`
 * below protects (see WalletKitProvider). `ssr: true` is wagmi's own
 * SSR-hydration-safe mode (server renders "disconnected", client reconnects
 * after mount) — not an AppKit-specific flag.
 */
let adapter: WagmiAdapter | undefined;

/**
 * Built on FIRST USE, never at module scope. `walletNetworks()` resolves the
 * sale's chain from the id RootLayout injects into the document, and this
 * module is imported by the framework's own `async` chunk scripts — so a
 * module-scope build could run before that inline script and freeze the list
 * to mainnet on a testnet sale. Every reader below goes through here.
 */
export function getWagmiAdapter(): WagmiAdapter {
  if (!adapter) {
    adapter = new WagmiAdapter({
      networks: [...walletNetworks()] as [AppKitNetwork, ...AppKitNetwork[]],
      projectId: projectId || 'MISSING_REOWN_PROJECT_ID',
      ssr: true,
    });
  }
  return adapter;
}

/**
 * Has this browser ever completed a wallet connection on this origin?
 *
 * Keys are written by AppKit and wagmi themselves — deliberately not a marker
 * of our own, which would drift from whatever the libraries actually restore
 * from and would read `false` for everyone already connected when this shipped.
 *
 * Why this exists at all: initialising the wallet stack on every page load for
 * every visitor is what re-introduced "the wallet pops up on page load".
 * `createAppKit()` registers connectors, wagmi's reconnect-on-mount then calls
 * `isAuthorized()` on each, and that probes `window.ethereum` — spec-silent,
 * but extensions visibly react to it. WhitelistStatusContext.tsx carries the
 * first occurrence of the same report and the same fix.
 */
export function hasPriorWalletSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // AppKit's own key, and the same one its `syncExistingConnection` keys
    // off. NOT `wagmi.recentConnectorId`: wagmi's disconnect leaves that set,
    // so it reads "connected" forever once a user has connected even once.
    return window.localStorage.getItem('@appkit/connection_status') === 'connected';
  } catch {
    // Storage blocked (Safari private mode, third-party-frame). Treat as a
    // first-time visitor: the connect button still works, it just won't
    // silently restore. Never fall through to eager init here — that is the
    // exact behaviour this gate exists to prevent.
    return false;
  }
}

let modal: ReturnType<typeof createAppKit> | undefined;
let created = false;

/**
 * Builds the AppKit modal on FIRST USE, not at import. Idempotent and safe to
 * call on every connect. Returns `undefined` when unconfigured — callers
 * surface that; there is no injected-only fallback path any more (a second
 * connect backend meant the picker/QR the revamp exists for was never the one
 * that ran when the project id happened to be missing).
 *
 * Registering connectors here rather than at module scope is load-bearing for
 * `hasPriorWalletSession` — see its note. Get a project id at
 * https://cloud.reown.com (free Starter tier; W1 in the plan doc keeps
 * email/socials off so usage stays on the unmetered wallet-only path).
 */
/** The instance if one has been built, without building one. */
export function getAppKit(): ReturnType<typeof createAppKit> | undefined {
  return modal;
}

export function ensureAppKit(): ReturnType<typeof createAppKit> | undefined {
  if (created) return modal;
  created = true;
  if (!projectId) return undefined;
  modal = createAppKit({
    adapters: [getWagmiAdapter()],
    networks: [...walletNetworks()] as [AppKitNetwork, ...AppKitNetwork[]],
    projectId,
    metadata: {
      name: 'RobinCalls',
      description: 'Independent, receipted token verdicts for Robinhood Chain.',
      url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://robincalls.com',
      icons: ['https://robincalls.com/brand/logo.png'],
    },
    // W1 locked: wallet-only, no embedded accounts (§4 principle 2). Swaps/
    // onramp/send/receive are AppKit's own built-in flows for email/social
    // wallets — irrelevant here and left off rather than half-configured.
    features: { email: false, socials: false, swaps: false, onramp: false, send: false, receive: false },
    // Our own banner handles a wrong chain (useWallet.isWrongChain, plus the
    // SWITCH controls on both sale surfaces). Without this AppKit opens its
    // UnsupportedChain view instead, and `ModalUtil.safeClose` refuses to close
    // that one: the X shakes the dialog and nothing else, so the whole UI is
    // held hostage until a reload.
    allowUnsupportedChain: true,
    themeMode: 'dark',
    // Keys are literal, checked against @reown/appkit-common's ThemeVariables
    // — not free-form CSS custom properties.
    themeVariables: {
      '--w3m-accent': '#CCFF00',
      '--w3m-color-mix': '#0A0A0A',
      '--w3m-color-mix-strength': 30,
      '--w3m-border-radius-master': '0px',
      '--w3m-font-family': 'Inter, sans-serif',
    },
  });
  return modal;
}

/**
 * AppKit registers its connectors ASYNCHRONOUSLY after `createAppKit()` — the
 * WalletConnect one last, once its UniversalProvider has initialised. Opening
 * the modal in the same tick as building it therefore renders a picker with no
 * QR row: the mobile/scan path this whole revamp exists for, silently absent
 * and with nothing to indicate it. (Eager init hid this by giving the provider
 * the whole page load as a head start.)
 *
 * Bounded: past the deadline the modal opens anyway with whatever registered.
 * A missing QR row is worse than a slow one, but a modal that never opens is
 * worse than both.
 */
const WALLETCONNECT_READY_TIMEOUT_MS = 4000;

function hasWalletConnectConnector(): boolean {
  return getWagmiAdapter().wagmiConfig.connectors.some((c) => c.id === WALLETCONNECT_CONNECTOR_ID);
}

const WALLETCONNECT_CONNECTOR_ID = 'walletConnect';

/** `ensureAppKit()` plus the wait above. Call this from a connect handler. */
export async function ensureAppKitReady(): Promise<ReturnType<typeof createAppKit> | undefined> {
  const instance = ensureAppKit();
  if (!instance || hasWalletConnectConnector()) return instance;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unwatch();
      resolve();
    };
    const unwatch = watchConnectors(getWagmiAdapter().wagmiConfig, {
      onChange: () => {
        if (hasWalletConnectConnector()) done();
      },
    });
    const timer = setTimeout(done, WALLETCONNECT_READY_TIMEOUT_MS);
  });
  return instance;
}

/**
 * Warm AppKit ahead of the click (hover/focus on a connect control), so the
 * wait above is already over by the time the modal is asked for. Never call
 * this on mount — that is eager init again, and the page-load probe of
 * `window.ethereum` it causes is the bug `hasPriorWalletSession` guards.
 */
export function warmAppKit(): void {
  void ensureAppKitReady();
}
