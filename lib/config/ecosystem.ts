/**
 * Directory category taxonomy + per-category submission fields.
 *
 * Single source of truth (docs/directory-form-research.md): the /ecosystem
 * submission form, the /api/ecosystem/submit validator, the admin review
 * card, and the public filter pills all read from here. Adding a category or
 * a field is a one-entry change; the migration check constraint
 * (supabase/migrations/0015_directory_categories.sql) must list the same
 * category values.
 *
 * Every per-category field is optional — the base form stays short, the
 * details block only appears once a category is picked. Values live in
 * `directory_platforms.category_details` (jsonb):
 *   select → string (one of options) · multiselect → string[] (subset)
 *   text   → string (≤ MAX_TEXT_LEN) · toggle → boolean
 */

export type DirectoryFieldType = "select" | "multiselect" | "text" | "toggle";

export interface DirectoryField {
  key: string;
  label: string;
  type: DirectoryFieldType;
  options?: readonly string[];
  placeholder?: string;
  hint?: string;
}

export interface DirectoryCategoryDef {
  value: string;
  label: string;
  emoji: string;
  fields: readonly DirectoryField[];
}

export const MAX_TEXT_LEN = 300;

/**
 * AI-readiness block, asked for EVERY category — the directory's whole thesis
 * is "the agent era, indexed". The two toggles map onto the first-class
 * has_mcp / has_agent columns (card badges); the strings ride category_details.
 */
export const COMMON_FIELDS: readonly DirectoryField[] = [
  {
    key: "has_mcp",
    label: "MCP SERVER AVAILABLE",
    type: "toggle",
    hint: "Agents can connect via Model Context Protocol",
  },
  {
    key: "mcp_endpoint",
    label: "MCP PACKAGE / URL",
    type: "text",
    placeholder: "npx @scope/mcp-server or https://…/mcp",
  },
  {
    key: "has_agent",
    label: "AGENT / PUBLIC API",
    type: "toggle",
    hint: "Programmatic access beyond the UI",
  },
  {
    key: "agent_docs_url",
    label: "API / AGENT DOCS URL",
    type: "text",
    placeholder: "https://docs.…",
  },
] as const;

export const DIRECTORY_CATEGORIES: readonly DirectoryCategoryDef[] = [
  {
    value: "LAUNCHPAD",
    label: "LAUNCHPAD",
    emoji: "🚀",
    fields: [
      {
        key: "launch_model",
        label: "LAUNCH MODEL",
        type: "select",
        options: [
          "Bonding curve → DEX graduation",
          "Direct launch (instant DEX pool)",
          "Curated IDO / presale",
          "Fair launch",
          "Auction",
        ],
      },
      {
        key: "graduation_target",
        label: "GRADUATION TARGET",
        type: "text",
        placeholder: "e.g. 2.31 ETH raised → pool seeded",
      },
      {
        key: "fees",
        label: "FEE STRUCTURE",
        type: "text",
        placeholder: "e.g. 1% per trade · 0.5% graduation",
      },
      {
        key: "graduation_dex",
        label: "GRADUATES TO",
        type: "text",
        placeholder: "e.g. Uniswap V3",
      },
      {
        key: "curve_address",
        label: "FACTORY / CURVE CONTRACT",
        type: "text",
        placeholder: "0x…",
        hint: "Onboarded manually — lets us track your launches on the Night Market",
      },
      {
        key: "token_url_template",
        label: "TOKEN PAGE URL",
        type: "text",
        placeholder: "https://yoursite.com/token/{token}",
        hint: "{token} is replaced with the contract address",
      },
    ],
  },
  {
    value: "TRADING",
    label: "TRADING",
    emoji: "💹",
    fields: [
      {
        key: "trading_type",
        label: "TRADING TYPE",
        type: "select",
        options: [
          "AMM spot DEX",
          "Orderbook DEX",
          "Perps / derivatives",
          "DEX aggregator",
          "Trading bot / terminal",
          "Copy trading",
        ],
      },
      {
        key: "markets",
        label: "MARKETS",
        type: "text",
        placeholder: "e.g. Robinhood Chain memecoins, ETH perps",
      },
      {
        key: "fees",
        label: "FEES",
        type: "text",
        placeholder: "e.g. 0.3% swap · maker/taker 0.02/0.05%",
      },
    ],
  },
  {
    value: "AI",
    label: "AI",
    emoji: "🤖",
    fields: [
      {
        key: "ai_type",
        label: "AI TYPE",
        type: "select",
        options: [
          "Agent platform / framework",
          "MCP tool suite",
          "Trading agent",
          "Research / analytics copilot",
          "Chat assistant",
          "Model / inference infra",
        ],
      },
      {
        key: "integrations",
        label: "WORKS WITH",
        type: "text",
        placeholder: "e.g. Claude, ChatGPT, Cursor, Grok",
      },
      {
        key: "pricing_model",
        label: "PRICING",
        type: "select",
        options: ["Free", "Freemium", "Subscription", "Usage-based", "Token-gated"],
      },
    ],
  },
  {
    value: "WALLET",
    label: "WALLETS",
    emoji: "👛",
    fields: [
      {
        key: "custody_model",
        label: "CUSTODY MODEL",
        type: "select",
        options: [
          "Self-custody (seed phrase)",
          "Smart account (passkey / AA)",
          "MPC",
          "Custodial",
          "Hardware",
        ],
      },
      {
        key: "platforms",
        label: "PLATFORMS",
        type: "multiselect",
        options: ["Browser extension", "Mobile", "Desktop", "Web", "Embedded SDK"],
      },
      {
        key: "wallet_features",
        label: "FEATURES",
        type: "multiselect",
        options: [
          "In-app swap",
          "Fiat on-ramp",
          "Staking",
          "NFT gallery",
          "Multi-chain",
          "Gasless transactions",
        ],
      },
    ],
  },
  {
    value: "DEFI",
    label: "DEFI",
    emoji: "💰",
    fields: [
      {
        key: "defi_type",
        label: "DEFI TYPE",
        type: "select",
        options: [
          "Lending / borrowing",
          "Yield / vaults",
          "Staking / LST",
          "Stablecoin",
          "Derivatives",
          "RWA",
          "Insurance",
        ],
      },
      { key: "tvl", label: "TVL", type: "text", placeholder: "e.g. $2.4M (DefiLlama)" },
      {
        key: "audits",
        label: "AUDITS",
        type: "text",
        placeholder: "auditor + report link",
      },
      { key: "native_token", label: "NATIVE TOKEN", type: "text", placeholder: "ticker, if any" },
    ],
  },
  {
    value: "NFT",
    label: "NFTS",
    emoji: "🎨",
    fields: [
      {
        key: "nft_type",
        label: "NFT TYPE",
        type: "select",
        options: ["Marketplace", "Mint / launchpad", "Collection", "Tooling / analytics"],
      },
      {
        key: "standards",
        label: "STANDARDS",
        type: "text",
        placeholder: "e.g. ERC-721, ERC-1155",
      },
      {
        key: "fees",
        label: "FEES / ROYALTIES",
        type: "text",
        placeholder: "e.g. 2% platform · creator royalties honored",
      },
    ],
  },
  {
    value: "GAMING",
    label: "GAMING",
    emoji: "🎮",
    fields: [
      {
        key: "game_status",
        label: "STATUS",
        type: "select",
        options: ["Live", "Beta", "Playable demo", "In development"],
      },
      { key: "genre", label: "GENRE", type: "text", placeholder: "e.g. strategy, casino, RPG" },
      {
        key: "onchain_assets",
        label: "ON-CHAIN ASSETS",
        type: "multiselect",
        options: ["NFT items", "Token rewards", "Fully on-chain logic"],
      },
    ],
  },
  {
    value: "ANALYTICS",
    label: "ANALYTICS",
    emoji: "📊",
    fields: [
      {
        key: "analytics_focus",
        label: "FOCUS",
        type: "multiselect",
        options: [
          "Charts / screener",
          "Wallet tracking",
          "Security / rug checks",
          "Portfolio",
          "On-chain data API",
          "Market intelligence",
        ],
      },
      {
        key: "data_api",
        label: "PUBLIC DATA API",
        type: "toggle",
        hint: "Machine-readable access to the data",
      },
      {
        key: "data_sources",
        label: "DATA SOURCES",
        type: "text",
        placeholder: "e.g. own indexer, Blockscout, DEX subgraphs",
      },
    ],
  },
  {
    value: "DEVTOOLS",
    label: "DEV TOOLS",
    emoji: "🛠",
    fields: [
      {
        key: "devtool_type",
        label: "TOOL TYPE",
        type: "select",
        options: [
          "SDK / library",
          "API service",
          "Contract framework",
          "Indexer / data",
          "Testing / CI",
          "Node & RPC tooling",
        ],
      },
      {
        key: "install_command",
        label: "INSTALL",
        type: "text",
        placeholder: "e.g. npm i @scope/sdk",
      },
      { key: "docs_url", label: "DOCS URL", type: "text", placeholder: "https://docs.…" },
      { key: "open_source", label: "OPEN SOURCE", type: "toggle" },
    ],
  },
  {
    value: "INFRASTRUCTURE",
    label: "INFRA",
    emoji: "🌉",
    fields: [
      {
        key: "infra_type",
        label: "INFRA TYPE",
        type: "select",
        options: [
          "RPC provider",
          "Bridge",
          "Oracle",
          "Indexer",
          "Storage",
          "Identity",
          "Rollup / appchain tooling",
        ],
      },
      {
        key: "networks",
        label: "NETWORKS",
        type: "text",
        placeholder: "chains served, e.g. Robinhood Chain, Arbitrum",
      },
      { key: "docs_url", label: "DOCS URL", type: "text", placeholder: "https://docs.…" },
    ],
  },
  {
    value: "PAYMENTS",
    label: "PAYMENTS",
    emoji: "💳",
    fields: [
      {
        key: "payments_type",
        label: "PAYMENTS TYPE",
        type: "select",
        options: [
          "Fiat on/off-ramp",
          "Checkout / merchant",
          "P2P transfers",
          "Card",
          "Streaming / payroll",
          "Invoicing",
        ],
      },
      {
        key: "regions",
        label: "REGIONS / CURRENCIES",
        type: "text",
        placeholder: "e.g. US, EU · USD, EUR",
      },
      {
        key: "kyc",
        label: "KYC",
        type: "select",
        options: ["No KYC", "KYC above threshold", "Full KYC"],
      },
      {
        key: "settlement_assets",
        label: "SETTLEMENT ASSETS",
        type: "text",
        placeholder: "e.g. ETH, USDC",
      },
    ],
  },
  {
    value: "SECURITY",
    label: "SECURITY",
    emoji: "🛡",
    fields: [
      {
        key: "security_type",
        label: "SECURITY TYPE",
        type: "select",
        options: [
          "Audit firm",
          "Scanner / rug check",
          "Monitoring / alerts",
          "Bug bounty platform",
          "Wallet security",
          "Incident response",
        ],
      },
      {
        key: "coverage",
        label: "COVERAGE",
        type: "text",
        placeholder: "chains / contract types covered",
      },
      {
        key: "reports_url",
        label: "PUBLIC REPORTS",
        type: "text",
        placeholder: "https://… (portfolio / published audits)",
      },
    ],
  },
  {
    value: "SOCIAL",
    label: "SOCIAL",
    emoji: "🌐",
    fields: [
      {
        key: "social_type",
        label: "SOCIAL TYPE",
        type: "select",
        options: [
          "SocialFi platform",
          "Community / DAO tooling",
          "Messaging",
          "Creator monetization",
          "Reputation / identity",
        ],
      },
      { key: "token_gated", label: "TOKEN-GATED", type: "toggle" },
      {
        key: "community_url",
        label: "COMMUNITY LINK",
        type: "text",
        placeholder: "https://t.me/… or discord.gg/…",
      },
    ],
  },
] as const;

export type DirectoryCategoryValue = (typeof DIRECTORY_CATEGORIES)[number]["value"];

export const DIRECTORY_CATEGORY_VALUES = DIRECTORY_CATEGORIES.map((c) => c.value);

/**
 * Human-readable category name for prose and page titles — "Launchpad", not
 * "LAUNCHPAD".
 *
 * `label` is the UI's chip text and is deliberately shouty; a <title> and a
 * meta description are sentences, and ALL CAPS in a search result reads as
 * spam. Title-cased here rather than by changing `label`, which would restyle
 * every chip on the grid.
 *
 * Falls back to the raw value, so an unrecognised category renders something
 * rather than "undefined" in a title a crawler will index.
 */
export function categoryLabel(value: string): string {
  const raw = categoryDef(value)?.label ?? value;
  return PROSE_LABELS[raw] ?? titleCase(raw);
}

/**
 * Category names whose correct prose casing is not a rule — DeFi, NFTs, and
 * DEV TOOLS all break title-casing in different ways. A short exception table
 * beats a cleverer algorithm that will get the next one wrong too.
 */
const PROSE_LABELS: Record<string, string> = {
  DEFI: "DeFi",
  NFTS: "NFTs",
  "DEV TOOLS": "Developer Tools",
  INFRA: "Infrastructure",
  AI: "AI",
};

const titleCase = (s: string): string =>
  s
    .split(/\s+/)
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");

export function categoryDef(value: string): DirectoryCategoryDef | undefined {
  return DIRECTORY_CATEGORIES.find((c) => c.value === value);
}

/**
 * Validate submitted category_details against the category's field specs plus
 * the common AI-readiness block. Unknown keys are dropped, select values must
 * match an option, multiselects must be subsets, text is trimmed and capped.
 * Returns the cleaned jsonb payload and the two first-class column flags.
 */
export function sanitizeDetails(
  category: string,
  raw: unknown
): { details: Record<string, string | string[] | boolean>; hasMcp: boolean; hasAgent: boolean } {
  const def = categoryDef(category);
  const specs = [...(def?.fields ?? []), ...COMMON_FIELDS];
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const details: Record<string, string | string[] | boolean> = {};

  for (const spec of specs) {
    const v = input[spec.key];
    if (v == null) continue;
    switch (spec.type) {
      case "toggle":
        if (v === true) details[spec.key] = true;
        break;
      case "select":
        if (typeof v === "string" && spec.options?.includes(v)) details[spec.key] = v;
        break;
      case "multiselect": {
        if (!Array.isArray(v)) break;
        const picked = v.filter(
          (x): x is string => typeof x === "string" && !!spec.options?.includes(x)
        );
        if (picked.length) details[spec.key] = picked;
        break;
      }
      case "text": {
        const s = String(v).trim().slice(0, MAX_TEXT_LEN);
        if (s) details[spec.key] = s;
        break;
      }
    }
  }

  const hasMcp = details.has_mcp === true;
  const hasAgent = details.has_agent === true;
  // The toggles are promoted to first-class columns; don't duplicate in jsonb.
  delete details.has_mcp;
  delete details.has_agent;
  return { details, hasMcp, hasAgent };
}
