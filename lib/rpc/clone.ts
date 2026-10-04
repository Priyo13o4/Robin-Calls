import {
  MINIMAL_CLONE_PREFIX,
  MINIMAL_CLONE_SUFFIX,
  SOLADY_CLONE_PREFIX,
  SOLADY_CLONE_SUFFIX,
} from "./abis";

/**
 * Minimal proxy: exact match against EIP-1167 (45 bytes) or Solady LibClone (44
 * bytes, L146), never a heuristic. Each has exactly one non-target byte range.
 * Pure, so the browser quick check and the server audit share one matcher.
 */
const CLONE_TEMPLATES = [
  [MINIMAL_CLONE_PREFIX, MINIMAL_CLONE_SUFFIX],
  [SOLADY_CLONE_PREFIX, SOLADY_CLONE_SUFFIX],
].map(([pre, suf]) => [pre.slice(2).toLowerCase(), suf.slice(2).toLowerCase()] as const);

export function matchClone1167(codeHex: string | null): string | null {
  if (!codeHex) return null;
  const body = codeHex.replace(/^0x/, "").toLowerCase();
  for (const [prefixHex, suffixHex] of CLONE_TEMPLATES) {
    if (body.length !== prefixHex.length + 40 + suffixHex.length) continue;
    if (!body.startsWith(prefixHex) || !body.endsWith(suffixHex)) continue;
    return `0x${body.slice(prefixHex.length, prefixHex.length + 40)}`;
  }
  return null;
}
