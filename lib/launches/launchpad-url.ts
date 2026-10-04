import type { LaunchFeedRow } from "./feed-types";

export interface LaunchpadConfigLike {
  slug: string;
  name?: string;
  config?: {
    website?: unknown;
    tokenUrlTemplate?: unknown;
  } | null;
}

/**
 * Resolves the outbound URL for a launchpad card or table row.
 * Reusable helper following the canonical contract established in NightMarketTabs:
 * 1. Uses `config.tokenUrlTemplate` if configured (replacing `{token}`).
 * 2. Falls back to `config.website` if a valid absolute URL.
 * 3. Falls back to verified canonical Robinhood Chain launchpad URLs from migrations.
 * 4. Invariant: Never synthesise a URL from a slug (e.g. `https://${slug}.xyz`).
 *    Returns null when unknown.
 */
export function resolveLaunchpadUrl(
  row: Pick<LaunchFeedRow, "token_address"> & {
    launchpad_slug?: string | null;
    launchpad_name?: string | null;
  },
  launchpads?: LaunchpadConfigLike[]
): string | null {
  const token = row.token_address.toLowerCase();
  const slug = row.launchpad_slug?.toLowerCase().trim();
  const name = row.launchpad_name?.toLowerCase().trim();

  // 1. Check passed launchpad configurations (from DB launchpads table)
  if (launchpads && slug) {
    const pad = launchpads.find((p) => p.slug.toLowerCase() === slug);
    const template = pad?.config?.tokenUrlTemplate;
    const website = pad?.config?.website;

    if (typeof template === "string" && template.includes("{token}")) {
      return template.replace("{token}", token);
    }
    if (typeof website === "string" && /^https?:\/\//i.test(website)) {
      return website;
    }
  }

  // 2. Canonical verified Robinhood Chain launchpads (matches migrations 0014, 0016, 0036, 0063, 0093)
  const key = slug || name || "";

  if (key.includes("pons")) {
    return `https://www.ponsfamily.com/launchpad/${token}`;
  }
  if (key.includes("flap")) {
    return `https://flap.sh/robinhood/${token}`;
  }
  if (key.includes("robinfun") || key.includes("robin.fun")) {
    return `https://robinfun.live/token/${token}`;
  }
  if (key.includes("cashcat") || key.includes("letscash")) {
    return `https://letscash.fun/token/${token}`;
  }
  if (key.includes("doppler")) {
    return "https://long.xyz";
  }
  if (key.includes("pair")) {
    return "https://pair.fun";
  }
  if (key.includes("party")) {
    return "https://party.app";
  }

  return null;
}
