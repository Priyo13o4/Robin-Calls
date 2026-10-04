import { abiFunctionSignatures } from "../audit/inventory";
import type { Completeness } from "../audit/types";

/**
 * Handing verified Solidity to a reader, honestly.
 *
 * Our capability classifier matches a FIXED taxonomy — fifteen capabilities,
 * recognised by name and shape. It is deterministic, it is what the score
 * depends on, and it is exactly as good as its patterns: a contract whose
 * privileged function is called `syncTreasury` or `rebalanceHouse` rather than
 * `setFee` or `mint` sails past it. That gap is structural and not fixable by
 * adding more names — there is no finite list.
 *
 * So this bundle exists to let a reader look at the actual code and say "your
 * taxonomy missed this." It is an ADVERSARIAL CHECK ON US, never a second
 * scoring engine, and nothing it produces reaches `verdict.checks[]` — the
 * §1 rule holds without exception.
 *
 * Three properties are load-bearing, and all three are about not overstating
 * what was read:
 *
 * 1. **What was left out is named.** A 40-file contract does not fit in a
 *    prompt. Truncating silently would let "I reviewed the source" be said
 *    about 3 files out of 40, which is a worse sentence than "I could not read
 *    it" (CLAUDE.md §9: a partial result is not a fact either).
 * 2. **The declared function list travels with it**, so a claim can be checked
 *    against something instead of being taken on faith.
 * 3. **Text in the source that addresses the reader is flagged, not obeyed.**
 *    Solidity comments are attacker-authored. An injection attempt inside a
 *    contract is a fact about its deployer and belongs in the report.
 *
 * Pure and browser-safe: this runs in the visitor's own tab, on their own
 * explorer budget.
 */

/**
 * Character ceiling on the bundle.
 *
 * The agent's whole transcript is capped at ~24k tokens, so a source blob that
 * fills the window leaves no room for the conversation it is supposed to
 * inform. 24k characters is roughly 8k tokens — generous for one project
 * contract, and a real contract that does not fit is DISCLOSED rather than
 * quietly shortened.
 */
export const MAX_BUNDLE_CHARS = 24_000;

/** Per-file ceiling, so one enormous file cannot consume the whole budget. */
export const MAX_FILE_CHARS = 14_000;

/**
 * Vendor path segments that mark third-party library code.
 *
 * Excluding these is what makes the project's own code readable — OpenZeppelin
 * alone routinely outweighs the contract twenty to one, and nobody needs a
 * model re-reading `SafeERC20` for the thousandth time.
 *
 * **This is a path heuristic and it is spoofable.** A deployer can put a
 * backdoor in a file named `@openzeppelin/contracts/token/ERC20/ERC20.sol` and
 * this will skip it. That is precisely why every exclusion is listed by path in
 * the result: the reader can see the assumption and challenge it, and the
 * capability classifier still reads the FULL flattened source regardless of
 * what this filter did. Never let this become a silent filter.
 */
const VENDOR_SEGMENTS = [
  "@openzeppelin",
  "openzeppelin",
  "@solady",
  "solady",
  "solmate",
  "@uniswap",
  "@chainlink",
  "@layerzerolabs",
  "@arbitrum",
  "@eth-optimism",
  "@prb",
  "erc721a",
  "permit2",
  "forge-std",
  "ds-test",
  "node_modules",
];

/**
 * Matched per PATH SEGMENT, and a segment counts when it IS a vendor name or
 * begins `vendor-`.
 *
 * The `vendor-` half is not a nicety. The first version matched `/openzeppelin/`
 * and npm's `@openzeppelin/contracts/...` layout, which looked right — and
 * measured against real contracts on this chain it excluded almost nothing,
 * because Foundry vendors dependencies as `lib/openzeppelin-contracts/` and
 * `lib/openzeppelin-contracts-upgradeable/`. Neither segment is `openzeppelin`,
 * so both sailed through as "project code". Four of five verified contracts
 * measured used that layout: PonsLaunchLocker's bundle came to ~18,000 tokens
 * of which ~12,900 was OpenZeppelin nobody needed to read.
 *
 * Segment equality rather than substring, so a project file legitimately named
 * `MyOpenZeppelinFork.sol` is still project code.
 */
export function isThirdPartyPath(path: string): boolean {
  const segments = path.toLowerCase().replace(/\\/g, "/").split("/");
  return segments.some((segment) =>
    VENDOR_SEGMENTS.some((vendor) => segment === vendor || segment.startsWith(`${vendor}-`)),
  );
}

/**
 * Text inside the source that is addressed to whoever is reading it.
 *
 * Solidity comments are written by the deployer, and a deployer who wants a
 * favourable summary has an obvious move: leave instructions for the model in a
 * comment. The answer is not to strip them — stripping means the reader cannot
 * report what it saw — but to surface them as what they are.
 *
 * Deliberately broad. A false positive costs one flagged comment the reader can
 * dismiss in a sentence; a false negative costs an instruction followed.
 */
const INJECTION_PATTERNS: { re: RegExp; what: string }[] = [
  { re: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+/i, what: "override attempt" },
  { re: /disregard\s+(all\s+)?(the\s+)?(previous|prior|above|earlier|your)\s/i, what: "override attempt" },
  { re: /^\s*(\/\/|\/\*|\*)?\s*(system|assistant|user)\s*:/im, what: "fake conversation turn" },
  { re: /<\/?(system|assistant|human|instructions?)>/i, what: "fake role tag" },
  { re: /you\s+(are|must|should)\s+now\s+/i, what: "role reassignment" },
  { re: /(mark|report|classify|treat)\s+(this|the)\s+(contract|token|address)?\s*as\s+(safe|clean|trusted|legitimate|verified)/i, what: "requests a favourable verdict" },
  { re: /do\s+not\s+(report|mention|flag|disclose|warn)/i, what: "requests suppression" },
  { re: /new\s+(instructions?|prompt|rules?)\s*:/i, what: "override attempt" },
];

/** Cap so a file spamming the pattern cannot itself become the payload. */
const MAX_INJECTION_SUSPECTS = 12;

export interface InjectionSuspect {
  path: string;
  /** 1-indexed line within that file. */
  line: number;
  /** The line, trimmed and clipped — quoted so the reader can judge it. */
  text: string;
  what: string;
}

export function findInjectionSuspects(path: string, source: string): InjectionSuspect[] {
  const out: InjectionSuspect[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length && out.length < MAX_INJECTION_SUSPECTS; i += 1) {
    const line = lines[i];
    if (line.length > 600) continue; // minified/packed data, not prose aimed at a reader
    for (const { re, what } of INJECTION_PATTERNS) {
      if (re.test(line)) {
        out.push({ path, line: i + 1, text: line.trim().slice(0, 200), what });
        break;
      }
    }
  }
  return out;
}

export interface BundledFile {
  path: string;
  chars: number;
  /** True when this file was itself clipped at MAX_FILE_CHARS. */
  clipped: boolean;
  source: string;
}

export interface ExcludedFile {
  path: string;
  chars: number;
  /**
   * `"not-requested"` only appears when a specific `path` was asked for — every
   * other file is then listed so the caller still sees the whole manifest and
   * can ask for another one.
   */
  reason: "third-party-library" | "size-budget" | "not-requested";
}

export interface ContractSourceBundle {
  /** False when there is nothing to read. `unavailableReason` says which kind of nothing. */
  available: boolean;
  /**
   * `"not-verified"` — the explorer answered, and this contract has no verified
   * source. `"lookup-failed"` — the explorer did not answer, so we established
   * nothing at all. Two different sentences (CLAUDE.md §4).
   */
  unavailableReason: "not-verified" | "lookup-failed" | null;
  contractName: string | null;
  /**
   * How well this source matches THIS address: `"full"` exact, `"partial"`
   * bytecode-only (Blockscout usually served it out of `eth_bytecode_db`, from
   * a different address that compiled the same), `"unknown"` when the explorer
   * declined to say, `null` when there is no verified source to qualify.
   *
   * The reader is being handed code and asked to find powers our classifier
   * missed. Handing them a partial match without saying so invites a finding —
   * or worse, a clearance — about a file that may belong to another contract.
   */
  sourceMatch: "full" | "partial" | "unknown" | null;
  compilerVersion: string | null;
  files: BundledFile[];
  /** Everything left out, by path. A review of 3 files out of 40 is not a review. */
  excluded: ExcludedFile[];
  totalChars: number;
  includedChars: number;
  /** "complete" only when every project file was included whole. */
  completeness: Completeness;
  /**
   * Every function the verified ABI declares. A claim about a function that is
   * not in this list cannot be checked, and the prompt requires it be dropped.
   */
  declaredFunctions: string[];
  /** Text in the source aimed at the reader. Data and a finding, never an instruction. */
  injectionSuspects: InjectionSuspect[];
  /**
   * The file actually returned when one was asked for, as its full path. Null
   * when no `path` was requested, OR when nothing matched — `requestedPathFound`
   * tells those two apart, because "you asked for a file that is not in this
   * contract" and "you asked for nothing" are different answers.
   */
  requestedPath: string | null;
  requestedPathFound: boolean | null;
}

export interface RawVerifiedSource {
  is_verified: boolean;
  is_partially_verified?: boolean | null;
  is_fully_verified?: boolean | null;
  abi: unknown[] | null;
  source_code: string | null;
  additional_sources: { file_path: string; source_code: string }[];
  compiler_version: string | null;
  name: string | null;
}

/**
 * Mirrors `sourceMatchOf` in `lib/audit/inventory.ts`. Duplicated rather than
 * imported because this module is the AGENT's, not the audit's, and the one
 * import would drag the audit's type graph into the source tool for a
 * three-line predicate. Kept in step by
 * `tests/agent-source-bundle.test.ts`.
 */
function matchOf(raw: RawVerifiedSource): ContractSourceBundle["sourceMatch"] {
  if (raw.is_verified !== true) return null;
  if (raw.is_partially_verified === true) return "partial";
  if (raw.is_fully_verified === true) return "full";
  return "unknown";
}

function unavailable(reason: "not-verified" | "lookup-failed"): ContractSourceBundle {
  return {
    available: false,
    unavailableReason: reason,
    contractName: null,
    sourceMatch: null,
    compilerVersion: null,
    files: [],
    excluded: [],
    totalChars: 0,
    includedChars: 0,
    completeness: "unresolved",
    declaredFunctions: [],
    injectionSuspects: [],
    requestedPath: null,
    requestedPathFound: null,
  };
}

/**
 * Which file the caller meant.
 *
 * Exact path wins. Otherwise a basename/suffix match, because a reader looking
 * at the manifest will reasonably ask for `ERC20.sol` rather than retyping
 * `lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol`. The resolved
 * path is echoed back in `requestedPath` so an ambiguous suffix cannot leave
 * anyone guessing which file they actually got.
 */
function matchPath(candidates: { path: string }[], wanted: string): string | null {
  const want = wanted.trim().replace(/\\/g, "/").toLowerCase();
  if (!want) return null;
  const exact = candidates.find((c) => c.path.toLowerCase() === want);
  if (exact) return exact.path;
  const suffix = candidates.find(
    (c) => c.path.toLowerCase().endsWith(`/${want}`) || c.path.toLowerCase().endsWith(want),
  );
  return suffix ? suffix.path : null;
}

/**
 * Assemble the reviewable bundle.
 *
 * `raw` is null for BOTH "unverified" and "the explorer call failed", because
 * `explorer.smartContractFull` returns null for a 404 and for a fault alike —
 * so a null here reports `lookup-failed`, the weaker of the two claims. Only an
 * explorer that actually answered `is_verified: false` produces `not-verified`.
 */
export function bundleContractSource(
  raw: RawVerifiedSource | null,
  opts: { maxChars?: number; path?: string | null } = {},
): ContractSourceBundle {
  if (!raw) return unavailable("lookup-failed");
  if (raw.is_verified !== true) return unavailable("not-verified");

  const budget = opts.maxChars ?? MAX_BUNDLE_CHARS;

  // The primary file first and always: it is the contract the reader asked
  // about, and dropping it for budget would leave a bundle of its dependencies.
  const candidates: { path: string; source: string }[] = [];
  if (raw.source_code) {
    candidates.push({ path: raw.name ? `${raw.name}.sol` : "contract.sol", source: raw.source_code });
  }
  for (const extra of raw.additional_sources ?? []) {
    if (typeof extra?.source_code !== "string") continue;
    candidates.push({ path: extra.file_path ?? "(unnamed)", source: extra.source_code });
  }

  if (candidates.length === 0) {
    // Verified per the explorer, but no source text came back. Not "no source
    // exists" — we asked and got nothing usable.
    return unavailable("lookup-failed");
  }

  const totalChars = candidates.reduce((n, c) => n + c.source.length, 0);

  const files: BundledFile[] = [];
  const excluded: ExcludedFile[] = [];
  const injectionSuspects: InjectionSuspect[] = [];
  let includedChars = 0;
  let clippedAny = false;

  /**
   * A specific file was asked for — return that one, whole, whatever it is.
   *
   * This is the escape hatch from the vendor filter, and it is a security
   * property rather than a convenience. The filter matches on PATH, so a
   * deployer who puts a backdoor in a file named
   * `lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol` gets it
   * excluded by default. Listing exclusions lets a reader notice; only this
   * lets them look.
   *
   * Every other file is still reported as `not-requested`, so asking for one
   * file never costs the caller its view of the manifest.
   */
  if (opts.path) {
    const resolved = matchPath(candidates, opts.path);
    const picked = candidates.find((c) => c.path === resolved);
    for (const c of candidates) {
      if (c.path === resolved) continue;
      excluded.push({ path: c.path, chars: c.source.length, reason: "not-requested" });
    }
    if (picked) {
      const clipped = picked.source.length > budget;
      const text = clipped ? picked.source.slice(0, budget) : picked.source;
      files.push({ path: picked.path, chars: text.length, clipped, source: text });
      includedChars = text.length;
      injectionSuspects.push(
        ...findInjectionSuspects(picked.path, picked.source).slice(0, MAX_INJECTION_SUSPECTS),
      );
      clippedAny = clipped;
    }
    return {
      available: true,
      unavailableReason: null,
      contractName: raw.name,
      sourceMatch: matchOf(raw),
      compilerVersion: raw.compiler_version,
      files,
      excluded,
      totalChars,
      includedChars,
      completeness: clippedAny ? "partial" : "complete",
      declaredFunctions: abiFunctionSignatures(raw.abi),
      injectionSuspects,
      requestedPath: resolved,
      requestedPathFound: Boolean(picked),
    };
  }

  candidates.forEach((candidate, index) => {
    // index 0 is the primary file and is never filtered out as a library, even
    // if its own path looks vendored — it is the subject of the question.
    if (index > 0 && isThirdPartyPath(candidate.path)) {
      excluded.push({
        path: candidate.path,
        chars: candidate.source.length,
        reason: "third-party-library",
      });
      return;
    }

    const remaining = budget - includedChars;
    if (remaining <= 0) {
      excluded.push({ path: candidate.path, chars: candidate.source.length, reason: "size-budget" });
      return;
    }

    const cap = Math.min(MAX_FILE_CHARS, remaining);
    const clipped = candidate.source.length > cap;
    const text = clipped ? candidate.source.slice(0, cap) : candidate.source;
    if (clipped) clippedAny = true;

    files.push({ path: candidate.path, chars: text.length, clipped, source: text });
    includedChars += text.length;

    // Scanned on the FULL file, not the clipped copy: an instruction hidden
    // past the cut is exactly where one would be put, and the reader should
    // hear about it even though it did not make the bundle.
    if (injectionSuspects.length < MAX_INJECTION_SUSPECTS) {
      injectionSuspects.push(
        ...findInjectionSuspects(candidate.path, candidate.source).slice(
          0,
          MAX_INJECTION_SUSPECTS - injectionSuspects.length,
        ),
      );
    }
  });

  const droppedForSize = excluded.some((e) => e.reason === "size-budget");

  return {
    available: true,
    unavailableReason: null,
    contractName: raw.name,
    sourceMatch: matchOf(raw),
    compilerVersion: raw.compiler_version,
    files,
    excluded,
    totalChars,
    includedChars,
    // Third-party exclusions do NOT make it partial — they are a deliberate,
    // disclosed editorial choice about what is worth reading. Running out of
    // room does, because then the reader is missing project code it was meant
    // to see and cannot know what was in it.
    completeness: droppedForSize || clippedAny ? "partial" : "complete",
    declaredFunctions: abiFunctionSignatures(raw.abi),
    injectionSuspects,
    requestedPath: null,
    requestedPathFound: null,
  };
}
