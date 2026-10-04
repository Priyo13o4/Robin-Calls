/**
 * Social links on the leaderboards. Pure and browser safe: the editor previews
 * with the same function the server enforces with (see profile.ts for why).
 *
 * A link on a public board is a phishing surface, so a provider only accepts
 * its own hosts. Anything else is dropped, never rewritten into something
 * that merely looks valid. Only an icon is ever shown, so the real
 * destination must be trustworthy by construction.
 */

export const SOCIALS_MAX = 3;
const URL_MAX = 200;

export const SOCIAL_PROVIDERS = [
  { id: "x", label: "X", hosts: ["x.com", "twitter.com"] },
  { id: "telegram", label: "Telegram", hosts: ["t.me", "telegram.me"] },
  { id: "discord", label: "Discord", hosts: ["discord.gg", "discord.com"] },
  { id: "instagram", label: "Instagram", hosts: ["instagram.com"] },
  { id: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { id: "github", label: "GitHub", hosts: ["github.com"] },
  { id: "tiktok", label: "TikTok", hosts: ["tiktok.com"] },
  { id: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"] },
] as const;

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]["id"];
export interface Social {
  provider: SocialProviderId;
  url: string;
}

const BY_ID = new Map<string, (typeof SOCIAL_PROVIDERS)[number]>(SOCIAL_PROVIDERS.map((p) => [p.id, p]));

export function providerLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** The canonical https URL for this provider, or null if it is not one of its own. */
export function cleanSocialUrl(provider: string, input: unknown): string | null {
  const def = BY_ID.get(provider);
  if (!def || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > URL_MAX) return null;
  // Pasting "x.com/name" is the common case, so a missing scheme is added, but
  // any other scheme (javascript:, http:, data:) is refused outright.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    // Not parseable as a URL: refused, the editor tells the person.
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!(def.hosts as readonly string[]).includes(host)) return null;
  // A bare domain names the platform, not a person.
  if (url.pathname.replace(/\/+$/, "").length === 0) return null;
  return `https://${host}${url.pathname.replace(/\/+$/, "")}`;
}

/** Valid entries only, one per provider, at most SOCIALS_MAX. Never throws. */
export function cleanSocials(input: unknown): Social[] {
  if (!Array.isArray(input)) return [];
  const out: Social[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (out.length >= SOCIALS_MAX) break;
    if (!item || typeof item !== "object") continue;
    const { provider, url } = item as Record<string, unknown>;
    if (typeof provider !== "string" || seen.has(provider)) continue;
    const clean = cleanSocialUrl(provider, url);
    if (!clean) continue;
    seen.add(provider);
    out.push({ provider: provider as SocialProviderId, url: clean });
  }
  return out;
}

/**
 * The line the wallet signs. JSON-escaped tuples, so a newline inside a pasted
 * URL cannot forge an extra line in the signed message.
 */
export function socialsSigned(raw: unknown): string {
  if (!Array.isArray(raw)) return "[]";
  return JSON.stringify(
    raw.map((r) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return [String(o.provider ?? ""), String(o.url ?? "")];
    }),
  );
}
