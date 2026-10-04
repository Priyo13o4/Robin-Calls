import { NextResponse } from "next/server";
import { readSiteConfigKeys } from "@/lib/data/site-config";

/**
 * Public, read-only site config. Exposes ONLY the whitelisted, non-sensitive
 * keys below — never dumps the whole table. Read server-side with the secret
 * key (site_config is RLS deny-all). Falls back to compiled-in defaults so the
 * whitelist modal works even before the 0017 migration is applied.
 */
export const dynamic = "force-dynamic";

const PUBLIC_KEYS = ["x_profile_url", "x_pinned_post_url"] as const;

const DEFAULTS: Record<(typeof PUBLIC_KEYS)[number], string> = {
  x_profile_url: "https://x.com/RobinCalls",
  x_pinned_post_url: "https://x.com/RobinCalls",
};

export async function GET() {
  const loaded = await readSiteConfigKeys([...PUBLIC_KEYS]);
  const out = { ...DEFAULTS, ...loaded };
  return NextResponse.json(out);
}
