import type { ExplorerAddressInfo } from "./types";

export interface ProxyVerificationTarget {
  /** Address to read verification precision at, lowercased. */
  target: string;
  /** The implementation we followed, or null when we read the address itself. */
  resolvedVia: string | null;
  /**
   * True when this IS a proxy but we could not name a single implementation —
   * an absent list, or a multi-facet diamond. The target falls back to the
   * requested address, so the precision read describes the FORWARDER and the
   * caller must not present it as the contract's (§4).
   */
  proxyUnresolved: boolean;
}

/**
 * Pick the address whose verification precision describes this token.
 *
 * An EIP-1167 clone has no verification record of its own, so asking at the
 * token address returned null and `source_verification` published its
 * unqualified "verified" sentence — 11 of 14 such rows in prod. The
 * implementation is already in the `/addresses` payload we fetch anyway, so
 * this costs no additional read.
 *
 * Multi-implementation proxies stay unresolved on purpose: one facet's
 * verification says nothing about its siblings, and labelling the whole
 * contract from `implementations[0]` is a claim about a fraction of it.
 */
export function proxyVerificationTarget(
  address: string,
  info: Pick<ExplorerAddressInfo, "proxy_type" | "implementations"> | null | undefined
): string;
export function proxyVerificationTarget(
  address: string,
  info: Pick<ExplorerAddressInfo, "proxy_type" | "implementations"> | null | undefined,
  opts: { detail: true }
): ProxyVerificationTarget;
export function proxyVerificationTarget(
  address: string,
  info: Pick<ExplorerAddressInfo, "proxy_type" | "implementations"> | null | undefined,
  opts?: { detail: true }
): string | ProxyVerificationTarget {
  const self = address.toLowerCase();
  const isProxy = typeof info?.proxy_type === "string" && info.proxy_type !== "";
  const impls = (info?.implementations ?? [])
    .map((i) => i?.address_hash)
    .filter((h): h is string => typeof h === "string" && h !== "");

  // Exactly one implementation is the only case we can attribute; `info` being
  // null is an unreadable payload, not a confirmed non-proxy.
  const target = isProxy && impls.length === 1 ? impls[0].toLowerCase() : self;
  const result: ProxyVerificationTarget = {
    target,
    resolvedVia: target === self ? null : target,
    proxyUnresolved: isProxy && impls.length !== 1,
  };
  return opts?.detail ? result : result.target;
}
