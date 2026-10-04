/**
 * Client-side token-icon resolver (docs/launchpad-aggregator-prd.md).
 *
 * Best-effort throughout: any failure falls back to the explorer icon,
 * DexScreener, or a noir monogram. Pure, browser-safe functions.
 */

// Measured 2026-09-15: filebase path and 4everland subdomain return 200 with CORS * and immutable cache headers.
export const IMAGE_GATEWAYS = [
  (cid: string) => `https://ipfs.filebase.io/ipfs/${cid}`,
  (cid: string) => `https://${cid}.ipfs.4everland.io/`,
] as const;

/** A bare IPFS CID (v0 Qm… / v1 baf…), no scheme. */
const looksLikeCid = (s: string): boolean =>
  /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[0-9a-z]{20,})$/.test(s.trim());

/** Base32 v1 (`baf…`) is lowercase and DNS-safe; v0 (`Qm…`) is neither. */
const isSubdomainSafeCid = (cid: string): boolean => /^baf[0-9a-z]{20,}$/.test(cid);

/**
 * The CID inside a pointer, or null when it is already a plain URL or invalid.
 * Preserves a trailing path for directory CIDs in /ipfs/<cid>/... path form.
 */
export function cidOf(pointer: string): string | null {
  if (!pointer) return null;
  const s = pointer.trim();
  if (!s) return null;

  // ipfs://<cid>
  if (s.startsWith("ipfs://")) {
    const raw = s.slice("ipfs://".length).replace(/^\/+/, "").replace(/\/+$/, "");
    const parts = raw.split("/");
    const root = parts[0];
    if (looksLikeCid(root)) {
      return parts.length > 1 && parts.slice(1).join("/")
        ? `${root}/${parts.slice(1).join("/")}`
        : root;
    }
    return looksLikeCid(raw) ? raw : null;
  }

  // Bare CID (v0 Qm… 46 chars or v1 baf…)
  if (looksLikeCid(s)) return s;

  // http(s) URL
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);

      // Subdomain form: <cid>.ipfs.<gateway>
      const subMatch = u.hostname.match(/^([a-z0-9]+)\.ipfs\..+$/i);
      if (subMatch && looksLikeCid(subMatch[1])) {
        return subMatch[1];
      }

      // Path form: /ipfs/<cid> or /ipfs/<cid>/<rest>
      if (u.pathname.startsWith("/ipfs/")) {
        const after = u.pathname.slice("/ipfs/".length).replace(/\/+$/, "");
        const slashIdx = after.indexOf("/");
        const root = slashIdx === -1 ? after : after.slice(0, slashIdx);
        if (looksLikeCid(root)) {
          if (slashIdx === -1) return root;
          const rest = after.slice(slashIdx + 1);
          return rest ? `${root}/${rest}` : root;
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Working gateway URLs for a CID. Filebase path first, then 4everland subdomain
 * for base32 v1. When the CID's last char code is odd, 4everland is placed first.
 */
export function gatewayUrls(cid: string): string[] {
  const root = cid.split("/")[0];
  const rest = cid.slice(root.length);
  const filebase = IMAGE_GATEWAYS[0](cid);
  if (!isSubdomainSafeCid(root)) {
    return [filebase];
  }
  const fourEverland = rest
    ? `https://${root}.ipfs.4everland.io${rest.startsWith("/") ? rest : `/${rest}`}`
    : IMAGE_GATEWAYS[1](root);
  const lastChar = root.charCodeAt(root.length - 1);
  return lastChar % 2 === 1 ? [fourEverland, filebase] : [filebase, fourEverland];
}

function iconCandidatesInner(pointer: string | null, allowJson: boolean): string[] {
  if (!pointer) return [];
  const p = pointer.trim();
  if (!p) return [];

  // Bare inline image.
  if (p.startsWith("data:image/")) return [p];

  // Inline JSON blob: {"image":"data:…" | "https…" | "<cid>"}.
  if (allowJson && p.startsWith("{")) {
    try {
      const parsed = JSON.parse(p) as { image?: unknown };
      if (typeof parsed?.image === "string") {
        return iconCandidatesInner(parsed.image, false);
      }
      return [];
    } catch {
      return [];
    }
  }

  // CID-bearing pointer (bare, ipfs://, or rewritten from gateway URLs).
  const cid = cidOf(p);
  if (cid) return gatewayUrls(cid);

  // Other https URLs pass through; http/javascript/other return empty array.
  if (/^https:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      if (u.protocol === "https:") return [p];
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Renderable icon candidate URLs for a metadata pointer.
 */
export function iconCandidates(pointer: string | null): string[] {
  return iconCandidatesInner(pointer, true);
}

/**
 * Fetches the first candidate URL of a pointer with a 5s timeout. If the
 * response is JSON with a string `.image`, returns its icon candidates.
 */
export async function imageFromJsonPointer(
  pointer: string,
  signal?: AbortSignal
): Promise<string[]> {
  const candidates = iconCandidates(pointer);
  const firstUrl = candidates[0];
  if (!firstUrl) return [];

  const timeoutSignal = AbortSignal.timeout(5000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  try {
    const res = await fetch(firstUrl, { signal: combinedSignal });
    if (!res.ok) return [];
    const data = (await res.json()) as { image?: unknown };
    if (typeof data?.image === "string") {
      return iconCandidates(data.image);
    }
    return [];
  } catch {
    // Decorative. A failed fetch (CORS, network, parse) falls through to the
    // explorer tier rather than breaking the card.
    return [];
  }
}
