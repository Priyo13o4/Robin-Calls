import type { NavIconKey } from "./nav-icons";

/** Single source of truth for interior-site navigation (PRD v4 site map). */
export interface NavLink {
  href: string;
  label: string;
  /**
   * Glyph for the collapsed rail. Not optional: at 64px this is the *only*
   * thing identifying the destination, so a link without one would silently
   * become an unlabelled blank row. Making it required means the compiler
   * catches that when a new product ships.
   */
  icon: NavIconKey;
  /**
   * Shorter label for widths where the full one does not fit on one line.
   *
   * Only the action links need this, and only because they are rendered as
   * buttons in a fixed-height bar: "SCAN A TOKEN" wrapped to three lines on a
   * 375px screen, which inflated the app bar to 86px and pushed the wordmark
   * out from under its own link. A button that wraps is a layout bug, not a
   * long label — but shortening the label everywhere would weaken the CTA on
   * the screens that do have room, so it varies by width instead.
   */
  short?: string;
}

export interface NavGroup {
  /** Section label in the drawer. A heading, never a link. */
  title: string;
  links: NavLink[];
}

/**
 * The two actions, held out of the groups on purpose.
 *
 * SCAN is the product's front door and sits at the top of the drawer above
 * everything else. THE ROBIN KNIGHT is a tool you invoke, not a page you browse
 * — filing it under "Intelligence" beside Wanted and Night Market would put a verb
 * in a list of nouns.
 */
export const SCAN_LINK: NavLink = {
  href: "/scan",
  label: "SCAN A TOKEN",
  short: "SCAN",
  icon: "scan",
};
export const SWAP_LINK: NavLink = {
  href: "/swap",
  label: "SWAP",
  short: "SWAP",
  icon: "swap",
};
export const ROBIN_KNIGHT_LINK: NavLink = {
  href: "/robin-knight",
  label: "ASK ROBIN KNIGHT",
  icon: "robin-knight",
};

/**
 * The ten interior links, grouped.
 *
 * Grouping exists because the flat row outgrew the bar: ten links plus the
 * SCAN action collided with the wordmark at 1440 once the Robin Knight rail
 * displaced `<main>` (see RobinKnightDock's note on why it pads `<main>` and
 * not `<body>`). The fix is the drawer — and a drawer holding ten
 * undifferentiated items is a list, not navigation.
 *
 * The axis is what the reader is trying to do, not what we happened to build:
 *   INTELLIGENCE — live judgements about what is happening right now
 *   THE RECORD   — the permanent archive, and who is on it
 *   REFERENCE    — how it works, what it costs, why any of it should be trusted
 *
 * Keep in sync when a product ships or a page is retired. If a new link fits
 * none of the three, that is a signal about the link, not about the grouping.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "INTELLIGENCE",
    links: [
      { href: "/swap", label: "SWAP", icon: "swap" },
      { href: "/wanted", label: "WANTED", icon: "wanted" },
      { href: "/night-market", label: "NIGHT MARKET", icon: "night-market" },
      { href: "/rwa", label: "RWAs", icon: "rwa" },
    ],
  },
  {
    title: "THE RECORD",
    links: [
      { href: "/ledger", label: "LEDGER", icon: "ledger" },
      { href: "/ecosystem", label: "ECOSYSTEM", icon: "ecosystem" },
    ],
  },
  {
    title: "REFERENCE",
    links: [
      { href: "/overview", label: "PROJECT OVERVIEW", icon: "overview" },
      { href: "/methodology", label: "METHODOLOGY", icon: "methodology" },
      { href: "/compare", label: "COMPARE", icon: "compare" },
      { href: "/tokenomics", label: "TOKENOMICS", icon: "tokenomics" },
      { href: "/token-sale", label: "TOKEN SALE", icon: "tokenomics" },
    ],
  },
];

/** Flattened, for anything that needs every interior link without its section. */
export const NAV_LINKS: NavLink[] = NAV_GROUPS.flatMap((g) => g.links);

/** True when `pathname` is `href` or nested under it (e.g. /scan/0xabc). */
export function isActive(pathname: string, href: string): boolean {
  // Hash links ("/#tokenomics") name a section of the landing page, not a
  // route. `pathname` never carries a fragment, so these can never be active —
  // saying so explicitly beats letting the comparison below imply it.
  if (href.includes("#")) return false;
  return pathname === href || pathname.startsWith(href + "/");
}
