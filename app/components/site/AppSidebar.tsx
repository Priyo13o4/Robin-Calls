"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import type { UseWalletReturn } from "@/lib/wallet/useWallet";
import { ensureAppKitReady } from "@/lib/wallet/appkit-config";
import { NavIcon } from "./nav-icons";
import {
  ROBIN_KNIGHT_LINK,
  NAV_GROUPS,
  SCAN_LINK,
  isActive,
  type NavLink,
} from "./nav-links";
import { useWhitelistStatusContext } from "./WhitelistStatusContext";
import { useWalletIcon } from "./useWalletIcon";
import { ChainSelector } from "./ChainSelector";
import { flags } from "@/lib/config/flags";
import { PRODUCT_ACCENT } from "./landing/palette";

/**
 * The app shell's left sidebar. Desktop only (`lg` and up) — below that,
 * `SiteNav` keeps the top bar and its full-screen drawer.
 *
 * Open by default, collapsing to a 64px icon rail. The rail (rather than a
 * bare spine, or hiding it entirely) is a deliberate trade: it costs ten glyphs
 * to design and keeps tooltips load-bearing, and it buys the ability to
 * navigate *while collapsed* — one click, no expand step.
 *
 * It sits in the flex flow rather than `fixed`, so the content column reflows
 * on its own and nothing has to be told the sidebar's width. That matters
 * because `RobinKnightDock` already pads `<main>` from the right; two `fixed`
 * rails both reaching for the same element is how the earlier nav collision
 * happened (see RobinKnightDock:130-141).
 *
 * Lime budget (DESIGN.md): one fill (the connected wallet action) plus the
 * active item's edge. It spent two until the whitelist action retired. The
 * Robin Knight used to be the second lime fill; it moved to the "black button
 * type" (bg-[#0a0a0a], `#ededea` border/text) so it stops changing colour the
 * moment you leave the landing page, where the drawer already renders it that
 * way (SiteNav.tsx's ROBIN_KNIGHT_LINK styling). Do not add a third fill.
 */

const STORAGE_KEY = "rc_sidebar_collapsed";
/** Same-tab change signal — `storage` only fires in *other* tabs. */
const CHANGE_EVENT = "rc:sidebar";

/**
 * The collapsed flag lives in localStorage, so it is external state and is read
 * through `useSyncExternalStore` rather than mirrored into React with an effect.
 *
 * The effect version was the obvious first pass and is wrong twice over: the
 * repo's `react-hooks/set-state-in-effect` rule rejects it, and it renders once
 * expanded before correcting — a visible flash of the wrong width for anyone
 * whose preference is collapsed. This subscribes instead, so the first client
 * render already has the stored value, and a second tab toggling the sidebar
 * updates this one.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage throws in some privacy modes. Expanded is the documented default,
    // so there is nothing to recover — just don't take the shell down with it.
    return false;
  }
}

/**
 * The server has no preference to read, and "open by default" is the spec — so
 * the server snapshot is the intended state, not a placeholder.
 */
function serverCollapsed(): boolean {
  return false;
}

export function AppSidebar() {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, serverCollapsed);
  // Still the wallet's home: the provider owns the connection, and only its
  // whitelist half was retired.
  const { wallet } = useWhitelistStatusContext();

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, readCollapsed() ? "0" : "1");
    } catch {
      // Preference won't persist; the toggle below still won't fire, so the
      // sidebar simply stays put rather than desyncing from its own store.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  /**
   * `/scan` swaps its own form out for a verdict client-side, so a <Link> to
   * `/scan` from `/scan/0x…` is a no-op the router ignores. A full load is the
   * only way back to an empty form. Same reasoning as SiteNav's copy.
   */
  const reload = useCallback(
    (e: React.MouseEvent, href: string) => {
      if (pathname === href || pathname.startsWith(`${href}/`)) {
        e.preventDefault();
        window.location.href = href;
      }
    },
    [pathname]
  );

  return (
    <aside
      aria-label="Main navigation"
      data-collapsed={collapsed}
      className={`sticky top-0 z-30 hidden h-screen flex-none flex-col border-r border-[#2a2a2a] bg-[#141414] transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex ${
        collapsed ? "w-[64px]" : "w-[260px]"
      }`}
    >
      {/* Wordmark doubles as the home link — the top bar is gone up here. */}
      <div
        className={`flex flex-none items-center gap-3 border-b border-[#2a2a2a] px-4 py-4 ${
          collapsed ? "justify-center px-0" : ""
        }`}
      >
        <Link
          href="/"
          aria-label="RobinCalls home"
          className="flex min-w-0 items-center gap-3"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-sm.webp" alt="" className="h-7 w-7 flex-none object-contain" />
          {!collapsed && (
            <span className="truncate font-cinzel text-sm font-bold tracking-[0.22em] text-white">
              ROBINCALLS
            </span>
          )}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4">
        {/* The two actions. Both carry their glyph at every width so the rail
            is a narrowing of the same control, not a different one. */}
        <div className={`flex flex-col gap-2 ${collapsed ? "px-2.5" : "px-3"}`}>
          <SidebarAction
            link={SCAN_LINK}
            collapsed={collapsed}
            tone="paper"
            onClick={(e) => reload(e, SCAN_LINK.href)}
          />
          <SidebarAction
            link={ROBIN_KNIGHT_LINK}
            collapsed={collapsed}
            tone="dark"
            active={isActive(pathname, ROBIN_KNIGHT_LINK.href)}
          />
          {/* The whitelist action sat here until 2026-09-04. Its slot is NOT
              refilled with a TOKENOMICS button: REFERENCE below already links
              /tokenomics (nav-links.ts), and a second control for one route
              is one control with two names (see app/page.tsx's note on the
              hero pair). */}
          {flags.wallet && (
            <div className="flex flex-col gap-1.5">
              <SidebarWalletAction collapsed={collapsed} wallet={wallet} />
              <ChainSelector collapsed={collapsed} />
            </div>
          )}
        </div>

        <div className={`flex flex-col ${collapsed ? "mt-5 gap-3" : "mt-7 gap-6"}`}>
          {NAV_GROUPS.map((group) => (
            <section key={group.title}>
              {/* The heading is what the rail loses; the gap above stands in
                  for it, which is why the spacing tightens when collapsed. */}
              {!collapsed && (
                <h2 className="mb-1 px-4 font-mono text-[10px] font-bold tracking-[0.24em] text-[#e5e5e5]">
                  {group.title}
                </h2>
              )}
              <div className="flex flex-col">
                {group.links.map((l) => (
                  <SidebarItem
                    key={l.href}
                    link={l}
                    collapsed={collapsed}
                    active={isActive(pathname, l.href)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div
        className={`flex flex-none items-center border-t border-[#2a2a2a] px-3 py-3 ${
          collapsed ? "justify-center px-0" : "justify-between"
        }`}
      >
        {!collapsed && (
          <p className="truncate pl-1 font-serif text-xs italic text-[#d4d4d4]">
            On-chain. On record.
          </p>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar-nav"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-7 w-7 flex-none place-items-center border border-[#2a2a2a] text-[#f0f0f0] transition-colors hover:border-[#666] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ccff00]"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={`transition-transform duration-200 motion-reduce:transition-none ${
              collapsed ? "rotate-180" : ""
            }`}
          >
            <path
              d="M10 3 5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

    </aside>
  );
}

/**
 * SCAN and THE ROBIN KNIGHT — the brutalist buttons, carried into the rail.
 *
 * `tone` is the only difference between them: Paper for the scanner, "dark"
 * (black fill, white border/text) for the Robin Knight — the same treatment
 * SiteNav's drawer already gives it on the landing page, so it doesn't change
 * colour the moment `NoirShell` swaps the drawer for this rail.
 */
function SidebarAction({
  link,
  collapsed,
  tone,
  active,
  onClick,
}: {
  link: NavLink;
  collapsed: boolean;
  tone: "paper" | "dark" | "lime";
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  // Dot color has to invert with the fill, same as the hero's own two buttons
  // (app/page.tsx: the paper/lime CTAs are halftone-light, the black `/ledger`
  // link is halftone-dark) — halftone-light's #9CA3AF dots read as barely-there
  // texture on a light or lime fill, but the same dots on `#0a0a0a` are a stark
  // light-gray-on-black grid, which is the "too much opacity" report.
  const palette =
    tone === "lime"
      ? "bg-[#ccff00] border-[#ccff00] text-[#0a0a0a] hover:bg-[#ededea] hover:border-[#ededea] halftone-light"
      : tone === "dark"
        ? "bg-[#0a0a0a] border-[#ededea] text-[#ededea] hover:border-[#ccff00] hover:text-[#ccff00] halftone-dark"
        : "bg-[#ededea] border-[#ededea] text-[#0a0a0a] hover:bg-[#ccff00] hover:border-[#ccff00] halftone-light";

  return (
    <Link
      href={link.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? link.label : undefined}
      className={`brutalist-box brutalist-shadow-dark brutalist-pressable group relative flex cursor-pointer items-center font-inter text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${palette} ${
        collapsed ? "h-[42px] justify-center px-0" : "gap-3 px-3 py-3"
      }`}
    >
      <span className="flex-none">
        <NavIcon name={link.icon} size={17} />
      </span>
      {!collapsed && <span className="truncate">{link.label}</span>}
      {collapsed && <Tooltip>{link.label}</Tooltip>}
    </Link>
  );
}

/**
 * The sidebar wallet chip, in two halves behind one brutalist bar: the left
 * side opens AppKit's account view (the wallet's own panel — send, view on
 * explorer, disconnect live there), the right edge is a dedicated disconnect.
 * Two targets on one control because the account view is where a wallet wants
 * to be opened FROM, while disconnect is the one action that must survive a
 * wedged AppKit — so it never depends on the modal opening at all. Collapsed
 * mode keeps that guarantee with a long-press (600ms) on the chip: click is
 * still the account view, holding is a disconnect that needs no modal.
 *
 * One explicit palette in BOTH icon states (below and resolved): the shell
 * classes set border width/style only, so a conditional that adds colors for
 * one state and not the other makes the chip silently restyle the moment the
 * icon lands.
 *
 * Plain connect before anything is connected. Behind `flags.wallet`
 * (docs/wallet-integration/WAYS-OF-WORK.md) — since the whitelist retired,
 * that flag is the only thing standing between a visitor and this button.
 */
/** Exported so `SiteNav`'s mobile drawer can render the same control — see
 *  its call site there for why the drawer needed one at all. */
export function SidebarWalletAction({
  collapsed,
  wallet,
}: {
  collapsed: boolean;
  wallet: UseWalletReturn;
}) {
  // The wallet's own brand icon: wagmi's EIP-6963 connector metadata first
  // (resolves with the connect), AppKit's wallet info as the WalletConnect
  // fallback — see useWalletIcon.
  const icon = useWalletIcon();
  const [pressTimer, setPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  // Set when a long-press actually disconnected, so the click that the pointer
  // release then synthesises can be swallowed — otherwise a completed
  // long-press also opened the account view of the wallet it just removed.
  const longPressed = useRef(false);

  // Long-press → disconnect, in the collapsed rail where a second button
  // would not fit. Cleared on any release/leave so a plain click never fires it.
  const armDisconnect = () => {
    longPressed.current = false;
    setPressTimer(setTimeout(() => {
      setPressTimer(null);
      longPressed.current = true;
      wallet.disconnect();
    }, 600));
  };
  const disarmDisconnect = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      setPressTimer(null);
    }
  };

  /** Keyboard path to the same guarantee: Enter/Space fire click, which a
   *  pointer long-press never reaches. Shift-click (or Shift+Enter) is the
   *  no-modal disconnect — the one action that must survive a wedged AppKit,
   *  which is exactly the state a keyboard user cannot click out of.
   *
   *  The modifier comes off the EVENT, never `window.event`: that legacy global
   *  is typed as a bare Event, is absent in some browsers, and is not the
   *  synthetic event React just dispatched — so it would read undefined and
   *  silently disable the keyboard path this exists to provide. React's
   *  synthetic click carries `shiftKey` for Enter/Space activations too, which
   *  is what makes one handler cover both. */
  const onChipClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (e.shiftKey) {
      wallet.disconnect();
      return;
    }
    void openAccount();
  };

  if (!wallet.isConnected) {
    return (
      <button
        type="button"
        onClick={() => wallet.connect()}
        // AppKit is built on demand, not at page load — warming it here means
        // the picker opens with its QR row already registered. lib/wallet/appkit-config.ts
        onPointerEnter={wallet.prepare}
        onFocus={wallet.prepare}
        title={collapsed ? "Connect Wallet" : undefined}
        className={`brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light group relative flex cursor-pointer items-center bg-[#ededea] border-[#ededea] text-[#0a0a0a] font-inter text-[10px] font-bold uppercase tracking-[0.18em] transition-colors hover:bg-[#ccff00] hover:border-[#ccff00] ${
          collapsed ? "h-[42px] justify-center px-0" : "gap-3 px-3 py-3"
        }`}
      >
        <span className="flex-none">
          <NavIcon name="wallet" size={17} />
        </span>
        {!collapsed && <span className="truncate">Connect Wallet</span>}
        {collapsed && <Tooltip>Connect Wallet</Tooltip>}
      </button>
    );
  }

  const label = `${wallet.address!.slice(0, 6)}…${wallet.address!.slice(-4)}`;

  /** AppKit's own account view — the wallet's profile (address, explorer,
   *  its disconnect). ensureAppKitReady is the same open path connect() uses,
   *  so a cold AppKit still gets its connector wait before opening. */
  const openAccount = async () => {
    const modal = await ensureAppKitReady();
    if (!modal) return;
    void modal.open({ view: "Account" });
  };

  const iconEl = icon ? (
    // The wallet's own art is on a transparent/coloured field of its
    // choosing — give it a chip so it reads on any background.
    <img
      src={icon}
      alt=""
      width={17}
      height={17}
      className="rounded-full bg-[#0a0a0a]/20 object-contain"
    />
  ) : (
    <NavIcon name="wallet" size={17} />
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onChipClick}
        onPointerDown={armDisconnect}
        onPointerUp={disarmDisconnect}
        onPointerLeave={disarmDisconnect}
        onContextMenu={(e) => e.preventDefault()}
        title={`${label} — click for wallet, hold (or Shift+click) to disconnect`}
        className={`brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light group relative flex h-[42px] cursor-pointer items-center justify-center bg-[#ededea] px-0 font-inter text-[10px] font-bold uppercase tracking-[0.18em] text-[#0a0a0a] transition-colors`}
      >
        {iconEl}
        <Tooltip>{label}</Tooltip>
      </button>
    );
  }

  return (
    <div
      className={`brutalist-box brutalist-shadow-dark halftone-light flex items-stretch bg-[#ededea] font-inter text-[10px] font-bold uppercase tracking-[0.18em] text-[#0a0a0a]`}
    >
      <button
        type="button"
        onClick={() => void openAccount()}
        title="Open wallet"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-3 transition-colors hover:bg-[#ccff00]/40"
      >
        <span className="flex-none">{iconEl}</span>
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={() => wallet.disconnect()}
        aria-label="Disconnect wallet"
        title="Disconnect"
        className="flex flex-none cursor-pointer items-center border-l border-[#0a0a0a]/20 px-3 transition-colors hover:bg-[#e0897a]/30 hover:text-[#8a3a30]"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 1h6a1 1 0 0 1 1 1v1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M10 8.5V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M8 5h4.5M8 8h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// Accent colours for interior navigation links matching landing page products.
export const NAV_ACCENTS: Record<string, string | undefined> = {
  "/swap": "#ccff00",
  "/wanted": PRODUCT_ACCENT.wanted,
  "/night-market": PRODUCT_ACCENT["night-market"],
  "/rwa": PRODUCT_ACCENT.rwa,
  "/ledger": PRODUCT_ACCENT.ledger,
  "/ecosystem": PRODUCT_ACCENT.ecosystem,
  "/overview": undefined,
  "/methodology": undefined,
  "/compare": undefined,
  "/tokenomics": "#ccff00",
  "/token-sale": "#ccff00",
};

function SidebarItem({
  link,
  collapsed,
  active,
}: {
  link: NavLink;
  collapsed: boolean;
  active: boolean;
}) {
  const accent = NAV_ACCENTS[link.href];

  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? link.label : undefined}
      style={accent ? ({ "--nav-accent": accent } as React.CSSProperties) : undefined}
      className={`group relative flex items-center border-l-2 transition-colors ${
        active
          ? accent
            ? "border-l-[var(--nav-accent)] text-white font-bold"
            : "border-l-[#ccff00] text-white font-bold"
          : accent
            ? "border-l-transparent text-[#f0f0f0] hover:bg-white/[0.04] hover:text-[var(--nav-accent)] focus-visible:text-[var(--nav-accent)]"
            : "border-l-transparent text-[#f0f0f0] hover:bg-white/[0.04] hover:text-white"
      } ${collapsed ? "h-[42px] justify-center" : "gap-3 px-4 py-2.5"}`}
    >
      <span className={accent ? "flex-none text-[var(--nav-accent)]" : "flex-none"}>
        <NavIcon name={link.icon} />
      </span>
      {!collapsed && (
        <span className="truncate font-cinzel text-sm font-bold tracking-[0.06em]">
          {link.label}
        </span>
      )}
      {collapsed && <Tooltip>{link.label}</Tooltip>}
    </Link>
  );
}

/**
 * Hover label for the rail. `title` is set on the anchor as well — this is the
 * styled version, the attribute is the one screen readers and slow hovers get.
 */
function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 -translate-y-1/2 -translate-x-1 whitespace-nowrap border border-[#2a2a2a] bg-[#1c1c1c] px-2.5 py-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.16em] text-white opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
    >
      {children}
    </span>
  );
}
