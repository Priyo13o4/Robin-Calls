import { SITE_URL } from "@/lib/config/site";

export interface RouteSeoConfig {
  primary: string;
  title: string;
  description: string;
  keywords: string[];
}

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * One primary search phrase per page, never shared. Every sentence here is a
 * claim about the product: check the code before adding one (no "anchored",
 * no "free", no explorer or trading features). No em dashes.
 */
export const SEO_ROUTES = {
  home: {
    primary: "robinhood chain intelligence platform",
    title: "RobinCalls | Robinhood Chain RWA, Token Scanner, Night Market, Swap, Ecosystem & Robin Knight",
    description:
      "The definitive intelligence platform for Robinhood Chain (chain 4663). Verify authentic RWAs and tokenized stocks, scan tokens for contract risks, track live Night Market launches, swap tokens across DEXs, explore the dApp ecosystem, and consult the Robin Knight AI copilot.",
    keywords: [
      "robincalls",
      "robincalls rwa",
      "robincalls token scanner",
      "robincalls night market",
      "robincalls swap",
      "robincalls ecosystem",
      "robincalls robin knight",
      "robincalls ledger",
      "robincalls wanted",
      "robinhood chain rwa",
      "robinhood chain tokenized stocks",
      "robinhood chain token scanner",
      "robinhood chain launchpads",
      "robinhood chain swap",
      "chain 4663",
      "robinhood l2",
    ],
  },
  rwa: {
    primary: "robinhood chain tokenized stocks",
    title: "Robinhood Chain Tokenized Stocks: RWA | RobinCalls",
    description:
      "Tokenized stocks and ETFs on Robinhood Chain, each checked against the contracts behind Robinhood's real stock tokens, not just a matching ticker.",
    keywords: [
      "robincalls rwa",
      "robinhood chain tokenized stocks",
      "robinhood chain tokenized stock list",
      "robinhood chain rwa",
      "tokenized stocks on robinhood chain",
      "fake tokenized stock check",
      "rwa robinhood chain",
    ],
  },
  scan: {
    primary: "check a token on robinhood chain",
    title: "Check a Token on Robinhood Chain: The Verdict | RobinCalls",
    description:
      "Paste a Robinhood Chain token address to check it for honeypots, rug pull risks, locked liquidity and holder concentration before you buy.",
    keywords: [
      "robincalls token scanner",
      "check a token on robinhood chain",
      "is this robinhood chain token safe",
      "robinhood chain rug pull checker",
      "robinhood chain honeypot checker",
      "robinhood chain token safety check",
      "chain 4663 token scanner",
    ],
  },
  nightMarket: {
    primary: "robinhood chain launchpad aggregator",
    title: "Robinhood Chain Launchpads: The Night Market | RobinCalls",
    description:
      "New token launches from Robinhood Chain launchpads in one live feed: bonding curves still filling, graduated tokens and direct DEX launches.",
    keywords: [
      "robincalls night market",
      "robinhood chain launchpad aggregator",
      "robinhood chain launchpads",
      "new token launches on robinhood chain",
      "all robinhood chain launchpads in one place",
      "robinhood chain new tokens",
      "robinhood chain memecoins",
    ],
  },
  swap: {
    primary: "robinhood chain swap",
    title: "Robinhood Chain Swap: Instant DEX & Cross-Pool Trading | RobinCalls",
    description:
      "Instant on-chain token swap and cross-DEX execution for Robinhood Chain (chain 4663). Route through verified liquidity pools with exact transaction simulation and slippage protection.",
    keywords: [
      "robincalls swap",
      "robinhood chain swap",
      "swap tokens on robinhood chain",
      "trade robinhood chain tokens",
      "robinhood chain dex aggregator",
      "instant swap chain 4663",
      "cross dex swap robinhood",
    ],
  },
  ecosystem: {
    primary: "robinhood chain ecosystem",
    title: "Robinhood Chain Ecosystem: DApps & Projects | RobinCalls",
    description:
      "A reviewed directory of projects on Robinhood Chain (chain 4663): launchpads, DEXs, wallets, DeFi, AI tools and more, each with its own page.",
    keywords: [
      "robincalls ecosystem",
      "robinhood chain ecosystem",
      "robinhood chain projects list",
      "robinhood chain dapps",
      "robinhood chain launchpads",
      "robinhood chain dex",
      "robinhood chain defi",
    ],
  },
  robinKnight: {
    primary: "robinhood chain ai agent",
    title: "Robinhood Chain AI Agent & Copilot: Robin Knight | RobinCalls",
    description:
      "Robin Knight is the native on-chain AI intelligence copilot for Robinhood Chain (chain 4663). Consult the agent for real-time token safety verdicts, contract forensic explanations, and ecosystem intelligence.",
    keywords: [
      "robincalls robin knight",
      "robinhood chain ai agent",
      "robin knight ai",
      "robinhood chain ai copilot",
      "robin knight on-chain agent",
      "crypto ai copilot",
      "robinhood chain token scanner ai",
      "token verdict explained",
    ],
  },
  ledger: {
    primary: "robinhood chain verdict ledger",
    title: "Robinhood Chain Verdict Ledger: The Ledger | RobinCalls",
    description:
      "Every token verdict RobinCalls has published on Robinhood Chain, in one hash-chained public record. A past verdict cannot be quietly edited.",
    keywords: [
      "robincalls ledger",
      "robinhood chain verdict ledger",
      "robinhood chain token verdicts",
      "hash-chained verdict record",
      "chain 4663",
    ],
  },
  wanted: {
    primary: "robinhood chain rug pulls",
    title: "Robinhood Chain Rug Pulls: The Wanted Board | RobinCalls",
    description:
      "Tokens on Robinhood Chain whose liquidity was pulled, grouped by the wallet that deployed them, with the on-chain evidence for each rug.",
    keywords: [
      "robincalls wanted",
      "robinhood chain rug pulls",
      "robinhood chain scam tokens",
      "robinhood chain rugged tokens",
      "robinhood chain rug list",
      "the wanted board",
    ],
  },
  methodology: {
    primary: "robinhood chain token safety check",
    title: "Robinhood Chain Token Safety Check: Method | RobinCalls",
    description:
      "How RobinCalls scores Robinhood Chain tokens: every check, its weight and deduction, the sell simulation and the liquidity lock rules, in public.",
    keywords: [
      "robinhood chain token safety check",
      "how token safety scores work",
      "honeypot detection method",
      "liquidity lock check",
    ],
  },
  compare: {
    primary: "robinhood chain scanner comparison",
    title: "Robinhood Chain Scanner Comparison | RobinCalls",
    description:
      "How RobinCalls differs from one-off token checkers on Robinhood Chain: every verdict is kept, dated and open to re-checking, not shown once and lost.",
    keywords: [
      "robinhood chain scanner comparison",
      "robinhood chain rug checker comparison",
      "token scanner comparison",
    ],
  },
  overview: {
    primary: "robinhood chain scanner",
    title: "Robinhood Chain Scanner: Project Overview | RobinCalls",
    description:
      "What RobinCalls is: the token scanner and public verdict record for Robinhood Chain. What is live, what is being built, and the roadmap.",
    keywords: [
      "robinhood chain scanner",
      "robincalls overview",
      "robinhood chain trust layer",
      "chain 4663",
    ],
  },
  story: {
    primary: "robinhood chain trust layer",
    title: "The Robinhood Chain Trust Layer: Story | RobinCalls",
    description:
      "Why RobinCalls exists: a token scanner for Robinhood Chain that keeps every verdict on record, so the people who rug are remembered.",
    keywords: [
      "robinhood chain trust layer",
      "robincalls story",
      "robinhood chain token safety",
    ],
  },
  tokenSale: {
    primary: "robincalls token sale",
    title: "ROBINCALLS Token Sale on Robinhood Chain | RobinCalls",
    description:
      "Contribute ETH to a fixed pool of ROBINCALLS tokens while the sale is open, then claim your pro-rata share. If the sale is abandoned, claim a refund.",
    keywords: [
      "robincalls token sale",
      "robincalls token",
      "robinhood chain token sale",
    ],
  },
} as const satisfies Record<string, RouteSeoConfig>;

export const SCANNER_WEB_APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${SITE_URL}/scan#webapp`,
  name: "RobinCalls Token Scanner",
  url: `${SITE_URL}/scan`,
  applicationCategory: "SecurityApplication",
  operatingSystem: "All",
  description:
    "Token scanner for Robinhood Chain (chain 4663). Checks whether a token can be sold, whether its liquidity can be pulled, and who holds the supply.",
};

export const SCAN_FAQ_ITEMS: FaqItem[] = [
  {
    q: "How do I check if a Robinhood Chain token is safe?",
    a: "Paste the token's contract address above. The scanner reads the contract and its pools on Robinhood Chain and returns a score with every check it ran and the evidence behind it.",
  },
  {
    q: "What does the scan check?",
    a: "Whether the token can be sold, whether its liquidity is locked or can be pulled, how concentrated its holders are, and what the contract's owner can still change.",
  },
  {
    q: "How does the honeypot check work?",
    a: "The scanner simulates selling the token against its live pool, the way a real trader's transaction would run. If the sell fails or is heavily taxed, the verdict says so.",
  },
  {
    q: "Can a verdict be changed later?",
    a: "No. Every verdict is added to a public, hash-chained ledger. A rescan adds a new verdict; the old one stays on the record.",
  },
  {
    q: "Is RobinCalls part of Robinhood?",
    a: "No. RobinCalls is an independent project. It is not affiliated with or endorsed by Robinhood Markets.",
  },
];

/** Built at render from the enabled launchpad rows, so the answer cannot name a pad we stopped indexing. */
export function nightMarketFaqItems(padNames: string[]): FaqItem[] {
  const pads = padNames.length
    ? `It follows ${padNames.join(", ")}, plus tokens launched straight onto a DEX.`
    : "It follows the Robinhood Chain launchpads we index, plus tokens launched straight onto a DEX.";
  return [
    {
      q: "What is The Night Market?",
      a: "A live feed of new tokens launched on Robinhood Chain in the last 7 days, from launchpads and from direct DEX launches, in one place.",
    },
    { q: "Which Robinhood Chain launchpads does it cover?", a: pads },
    {
      q: "What is the difference between the Bonding and DEX tabs?",
      a: "Bonding shows tokens still filling their bonding curve. DEX shows tokens that graduated to a DEX pool, plus tokens that launched directly on one.",
    },
    {
      q: "Why don't I see every new token?",
      a: "A bonding launch appears once its curve starts to fill, and a direct DEX launch once it shows real trading. Most launches never get that far.",
    },
  ];
}

export const ECOSYSTEM_FAQ_ITEMS: FaqItem[] = [
  {
    q: "What is on Robinhood Chain?",
    a: "This directory lists projects live on Robinhood Chain (chain 4663): launchpads, DEXs and trading venues, wallets, DeFi, AI tools, analytics, developer tools and more.",
  },
  {
    q: "How does a project get listed?",
    a: "Projects are submitted, then reviewed by the RobinCalls team before they are published here.",
  },
  {
    q: "Is a listing an endorsement?",
    a: "No. A listing means the project was reviewed and is on Robinhood Chain. It is not financial advice, and it is not a safety verdict on any token.",
  },
];

export function buildFaqJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

type SummaryVerdict = {
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  score: number;
  tier: string;
  scoreVersion: string;
  checks: ReadonlyArray<{ status: string }>;
};

function verdictLabel(v: SummaryVerdict): string {
  return v.tokenSymbol?.trim() || v.tokenName?.trim() || `${v.tokenAddress.slice(0, 8)}…`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Fixed table, not toLocaleDateString: ICU versions differ ("Sep" vs "Sept"), so the quoted sentence would change by runtime.
function utcDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The one sentence an answer engine quotes for "is X safe". Dated and versioned
 * because a stored verdict is a reading from that day, never a live one (§4).
 */
export function verdictSummarySentence(v: SummaryVerdict, ledger: { id: number; createdAt: string }): string {
  const day = utcDay(ledger.createdAt);
  const count = (...s: string[]) => v.checks.filter((c) => s.includes(c.status)).length;
  const parts = [`${count("PASS")} passed`];
  const warned = count("WARN");
  const failed = count("FAIL", "CRITICAL");
  const skipped = count("SKIP");
  if (warned) parts.push(`${warned} warned`);
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} could not be run`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return (
    `RobinCalls scored ${verdictLabel(v)} ${v.score}/100 (${v.tier}) on Robinhood Chain under formula v${v.scoreVersion}` +
    `${day ? `, in verdict #${ledger.id} published ${day} (UTC)` : `, in verdict #${ledger.id}`}. ` +
    `Of ${v.checks.length} checks, ${list}.`
  );
}

export function verdictJsonLd(v: SummaryVerdict, ledger: { id: number; createdAt: string }, url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#verdict-${ledger.id}`,
    url,
    name: `Is ${verdictLabel(v)} safe? RobinCalls verdict #${ledger.id}`,
    description: verdictSummarySentence(v, ledger),
    datePublished: ledger.createdAt,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    about: {
      "@type": "Thing",
      name: v.tokenName ?? verdictLabel(v),
      ...(v.tokenSymbol ? { alternateName: v.tokenSymbol } : {}),
      identifier: v.tokenAddress.toLowerCase(),
      description: "Token contract on Robinhood Chain (chain id 4663).",
    },
  };
}
