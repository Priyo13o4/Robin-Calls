import { X_OAUTH } from "./config";

/**
 * Minimal X API v2 client — identity only.
 *
 * COST NOTE: `getMe` is the single metered X API call in the entire onboarding
 * flow (one read per connect, free tier). The engagement steps (follow / like /
 * post) do NOT go through the API — they're x.com/intent/* links opened in the
 * user's own browser (see xIntents in config.ts), which cost nothing. Do not
 * add write calls back here without reading docs/prds/optimizations.md §1.
 */

export class XApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "XApiError";
  }
}

export interface XUser {
  id: string;
  username: string;
  name: string;
}

/** Read the connecting account's identity. The one metered call we make. */
export async function getMe(accessToken: string): Promise<XUser> {
  const res = await fetch(`${X_OAUTH.apiBase}/users/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const msg =
      (json as { title?: string; detail?: string })?.detail ||
      (json as { title?: string })?.title ||
      `X API ${res.status}`;
    throw new XApiError(msg, res.status, json);
  }
  return (json as { data: XUser }).data;
}
