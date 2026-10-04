'use client';

import { useWhitelistStatusContext } from './WhitelistStatusContext';
import { useWalletIcon } from './useWalletIcon';
import { flags } from '@/lib/config/flags';

/**
 * Drawer whitelist action — SiteNav's mobile/marketing menu, in the slot
 * below SCAN and ROBIN KNIGHT. Same shape as those two (a full-width brutalist
 * block), NOT a persistent top-bar item: the bar itself only ever carried
 * the wordmark + SCAN + the menu trigger, and a second always-visible button
 * there crowded the 375px bar and duplicated what the drawer already exists
 * to hold (see SiteNav's own "one drawer, every breakpoint" note).
 *
 * Reads wallet/status from `WhitelistStatusContext` rather than owning its
 * own — see that file for why a per-component copy was two separate bugs.
 *
 * Takes `onOpenModal` rather than owning a `WhitelistModal` itself: this
 * button lives inside `#site-drawer`, which is `translate-x-*` for its slide
 * animation — and a `transform` on an ancestor makes it the containing block
 * for any `position: fixed` descendant. A modal rendered in here would sail
 * off-screen with the drawer the instant `onNavigate` (close) fires, fixed
 * only relative to a panel that's translating itself away — not the
 * viewport. SiteNav renders the actual modal as a sibling of the drawer,
 * outside that transform.
 */
export function WhitelistDrawerAction({
  onNavigate,
  onOpenModal,
}: {
  onNavigate: () => void;
  onOpenModal: () => void;
}) {
  const { wallet, checked, status } = useWhitelistStatusContext();
  const icon = useWalletIcon();
  if (!flags.whitelist) return null;
  const connected = wallet.isConnected && checked;

  if (!connected) {
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate();
          onOpenModal();
        }}
        className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light mt-3 block w-full text-center font-inter text-[12px] font-bold uppercase tracking-[0.18em] text-[#0a0a0a] bg-[#ccff00] border-[#ccff00] py-3.5 cursor-pointer"
      >
        Get Whitelisted
      </button>
    );
  }

  const label = status?.approved
    ? `${wallet.address!.slice(0, 6)}…${wallet.address!.slice(-4)}`
    : 'Finish Whitelisting';

  return (
    <button
      type="button"
      onClick={() => {
        onNavigate();
        onOpenModal();
      }}
      className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light mt-3 flex w-full items-center justify-center gap-2.5 text-center font-inter text-[12px] font-bold uppercase tracking-[0.18em] py-3.5 cursor-pointer text-[#0a0a0a] bg-[#ededea] border-[#ededea]"
    >
      {icon && (
        <img src={icon} alt="" width={16} height={16} className="rounded-full object-contain" />
      )}
      {label}
    </button>
  );
}
