import type { ReactNode } from "react";

/**
 * Landing-page line glyphs, for the places `NavIcon` has no entry: the hero's
 * trust row, the RWA verified chip, the "why" feature list.
 *
 * Same drawing rules as nav-icons.tsx so the two sets can sit in one layout
 * without reading as two icon libraries: 20x20 box, 1.3-1.4 stroke,
 * `currentColor`, no fills. Anything that already exists there is imported
 * from there rather than redrawn here.
 */
export type LandingIconKey =
  "search" | "shield" | "document" | "blocks" | "verified" | "community" | "signal" | "arrow";

const PATHS: Record<LandingIconKey, ReactNode> = {
  search: (
    <>
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  // Shield with a tick — "nothing of yours is required to use this".
  shield: (
    <>
      <path
        d="M10 2.6 4.2 4.9v5c0 3.4 2.3 6.3 5.8 7.5 3.5-1.2 5.8-4.1 5.8-7.5v-5L10 2.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="m7.4 9.6 2 2 3.4-3.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // A sheet with a folded corner and ruled lines — the written-down verdict.
  document: (
    <>
      <path
        d="M4.8 2.6h6.4L15.6 7v10.4H4.8V2.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M11.2 2.6V7h4.4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path
        d="M7.4 10.6h5.2M7.4 13.4h5.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),
  // Two linked blocks — a chain of records, not a generic database.
  blocks: (
    <>
      <rect x="2.6" y="6.4" width="7" height="7" stroke="currentColor" strokeWidth="1.4" />
      <rect
        x="10.4"
        y="6.4"
        width="7"
        height="7"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity=".55"
      />
      <path d="M9.6 9.9h.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  verified: (
    <>
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m6.8 10.2 2.2 2.2 4.2-4.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // Three figures, the middle one forward — a crowd, not a single user.
  community: (
    <>
      <circle cx="10" cy="6.4" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.8 16.2c0-2.4 1.9-4 4.2-4s4.2 1.6 4.2 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M4.6 7.6a1.9 1.9 0 1 0 0-.1M2.6 14.4c0-1.7 1-2.8 2.4-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M15.4 7.6a1.9 1.9 0 1 1 0-.1M17.4 14.4c0-1.7-1-2.8-2.4-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </>
  ),
  // Rising bars — traction that is actually there, against noise.
  signal: (
    <>
      <path
        d="M3.6 16.4V11M8.5 16.4V7.2M13.4 16.4v-3.2M16.8 16.4V4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  arrow: (
    <path
      d="M3.5 10h13m-5-4.6L16.5 10l-5 4.6"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

export function LandingIcon({ name, size = 20 }: { name: LandingIconKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  );
}
