import { readSiteConfigKeys } from "@/lib/data/site-config";
import { onboardingPostText, parseTweetId, parseXUsername } from "./config";

/**
 * Resolves WHAT the three onboarding actions act on, from the same admin-
 * editable site_config the modal already reads (x_profile_url, x_pinned_post_url)
 * plus optional env overrides. Kept out of config.ts so that stays pure/no-DB.
 */

export interface XTargets {
  /** @handle to follow — fed straight into the follow intent URL. */
  targetUsername: string | null;
  /** Tweet id the user likes — null when no pinned post URL is configured. */
  likeTweetId: string | null;
  /** Text the user posts. */
  postText: string;
}

async function siteConfig(): Promise<Record<string, string>> {
  try {
    return await readSiteConfigKeys(["x_profile_url", "x_pinned_post_url"]);
  } catch {
    return {};
  }
}


export async function resolveTargets(): Promise<XTargets> {
  const cfg = await siteConfig();
  const profileUrl = cfg.x_profile_url ?? "https://x.com/RobinCalls";
  const pinnedUrl = cfg.x_pinned_post_url ?? "";
  return {
    targetUsername: parseXUsername(profileUrl),
    likeTweetId: parseTweetId(pinnedUrl),
    postText: onboardingPostText(),
  };
}
