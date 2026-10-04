import type { ReactNode } from "react";

/**
 * Navigation glyphs for the collapsed sidebar rail.
 *
 * These exist because of the rail, not for decoration: at 64px the labels are
 * gone and the icon is the only thing identifying a destination. That sets the
 * bar — each one has to be recognisable at 19px with no word beside it.
 *
 * Drawn to match the line work already in the landing page's SVGs: 20×20 box,
 * 1.3–1.4 stroke, `currentColor` so the item's own hover/active colour flows
 * through, no fills. Two of them (`compare`, `tokenomics`) are conventions
 * rather than depictions — the scales and the coin — which is why the rail
 * keeps tooltips as a real affordance rather than a nicety.
 */
export type NavIconKey =
  | "scan"
  | "robin-knight"
  | "swap"
  | "wanted"
  | "night-market"
  | "rwa"
  | "ledger"
  | "ecosystem"
  | "overview"
  | "methodology"
  | "compare"
  | "tokenomics"
  | "wallet";

const PATHS: Record<NavIconKey, ReactNode> = {
  // Magnifier over a crosshair — reading a contract, not searching a list.
  scan: (
    <>
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 6.4v5.2M6.4 9h5.2" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
  // Two directional arrows for swapping tokens.
  swap: (
    <>
      <path d="M4.5 7.5h11M12 4l3.5 3.5L12 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 12.5h-11M8 16l-3.5-3.5L8 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Speech bubble with a tail — the one glyph here that means "ask".
  "robin-knight": (
    <>
      <path
        d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H8l-4 3v-3H4.5A1.5 1.5 0 0 1 3 12.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.5 7.6h7M6.5 10.4h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  // A wanted poster: framed portrait, not a generic person icon.
  wanted: (
    <>
      <rect x="3.5" y="2.5" width="13" height="15" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M6.4 14.6c.7-1.7 2-2.5 3.6-2.5s2.9.8 3.6 2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),
  "night-market": (
    <>
      <path
        d="M1.8 10S4.8 4.6 10 4.6 18.2 10 18.2 10 15.2 15.4 10 15.4 1.8 10 1.8 10Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  // Classical facade — the "real world" half of real-world assets.
  rwa: (
    <>
      <path d="M2.6 7.6 10 3.2l7.4 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4.4 8.6v6.8M8.1 8.6v6.8M11.9 8.6v6.8M15.6 8.6v6.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.6 16.8h14.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // A bound book, spine left — the permanent record.
  ledger: (
    <>
      <path
        d="M4 3.4h9.2a2 2 0 0 1 2 2v11.2H6a2 2 0 0 1-2-2V3.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M7 7h5.4M7 10h5.4M7 13h3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  // Four tiles, one faded — a directory that is still filling up.
  ecosystem: (
    <>
      <rect x="3" y="3" width="5.6" height="5.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.4" y="3" width="5.6" height="5.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3" y="11.4" width="5.6" height="5.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.4" y="11.4" width="5.6" height="5.6" stroke="currentColor" strokeWidth="1.2" opacity=".5" />
    </>
  ),
  // A folded map — the whole project in one sheet, the lay of the land.
  overview: (
    <>
      <path
        d="M3 5.4 7.6 3.4l4.8 2 4.6-2v11.2l-4.6 2-4.8-2-4.6 2V5.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M7.6 3.4v11.2M12.4 5.4v11.2" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
  methodology: (
    <>
      <path d="M4.6 2.6h7L15.4 6.4v11H4.6v-14.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11.4 2.6v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7.2 10.4h5.2M7.2 13.2h5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  // Balance scales. A convention, and the weakest glyph here — tooltip carries it.
  compare: (
    <>
      <path d="M10 2.8v14.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3.4 6.2h13.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M6.2 6.2 3.6 11.4h5.2L6.2 6.2ZM13.8 6.2l-2.6 5.2h5.2l-2.6-5.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </>
  ),
  tokenomics: (
    <>
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 5.6v8.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M7.6 8.2h3.2a1.8 1.8 0 0 1 0 3.6H7.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // A billfold with a coin catch — the connect action proves wallet control.
  wallet: (
    <>
      <path
        d="M3 6.2a1.8 1.8 0 0 1 1.8-1.8h9.8a1.8 1.8 0 0 1 1.8 1.8v7.6a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 13.8V6.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M3 8.4h14" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13.4" cy="11.4" r="1.1" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
};

export function NavIcon({ name, size = 19 }: { name: NavIconKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
