import type { AuditSmartContract } from "../explorer/types";
import { computeBytecodeHash } from "../scanner/bytecode-hash";
import { auditMaxSourceBytes } from "./deadline";
import { classifyCapabilities } from "./capabilities/classify";
import { buildContractIdentity } from "./inventory";
import {
  computeExactRuntimeHash,
  hashAbi,
  hashSource,
  normalizeAbi,
  normalizeSource,
} from "./normalize";
import type { Completeness, ContractIdentity } from "./types";

/**
 * Read-through cache for verified-source/ABI static analysis inputs (M4),
 * keyed on the EXACT runtime bytecode hash (correction 5) — never the
 * CBOR-stripped `template_hash`, which is stored alongside purely for
 * clone-family grouping. Table: `contract_audit_artifact` (0030 migration).
 */

export interface AuditArtifact {
  id: string;
  runtimeCodeHash: string;
  templateHash: string | null;
  abiHash: string | null;
  sourceHash: string | null;
  capabilities: unknown[];
  /** Name, verification state and callable surface. Cached on the same key: same bytecode, same source, same identity. */
  identity: ContractIdentity;
  completeness: Completeness;
  sourceBytes: number | null;
  /**
   * When this row was last written. Absent on a freshly built artifact (it has
   * no cache age yet) and supplied by `findArtifactRecord` for a stored one.
   * Maintained by the `contract_audit_artifact_updated_at` trigger (0030), so
   * it is honest across the upsert's ON CONFLICT path too.
   */
  cachedAt?: string | null;
}

/** What `upsertArtifactRecord` is handed. Named here so the deps below can be typed without importing `lib/data/`. */
export interface ArtifactUpsert {
  chainId: number;
  runtimeCodeHash: string;
  templateHash: string | null;
  ruleVersion: string;
  abiHash: string | null;
  sourceHash: string | null;
  capabilities: unknown[];
  identity: ContractIdentity;
  completeness: Completeness;
  sourceBytes: number | null;
}

/**
 * Every piece of I/O this module performs, supplied by the caller.
 *
 * All three are REQUIRED. They used to default to the real explorer and the
 * real Drizzle repository, which made this module import a database — and the
 * contract audit has to be able to run in a browser, where there is no
 * database and must never be one. The defaults are now assembled in
 * `lib/audit/server-run.ts`, which is the only place that knows what "the
 * server" means.
 *
 * A no-op find/upsert pair is a legitimate value (see `client-run.ts`) and is
 * NOT the same as omitting them — omission used to silently reach for Drizzle.
 */
export interface ArtifactCacheDeps {
  fetchArtifact: (address: string) => Promise<AuditSmartContract | null>;
  /**
   * Did `fetchArtifact` return null because nobody answered, rather than
   * because the contract is unverified? `explorer.smartContractFull` returns
   * null for BOTH, and only one of them is a fact about the contract.
   *
   * Passed in rather than looked up, for the reason `deadline.ts` gives about
   * its own scan clock: the answer lives in AsyncLocalStorage, and importing
   * that here would make this module — and through it the whole audit —
   * unloadable in a browser. Required, not optional, for the reason the other
   * three are: an omitted dep here would default to `undefined`, every faulted
   * read would be cached again, and the bug would come back silently. "We
   * cannot tell" has to be STATED — see `browserArtifactDeps`.
   */
  artifactReadFaulted: () => boolean;
  findArtifactRecord: (
    chainId: number,
    runtimeCodeHash: string,
    ruleVersion: string,
  ) => Promise<AuditArtifact | null>;
  upsertArtifactRecord: (record: ArtifactUpsert) => Promise<string>;
}

/**
 * Build the artifact from a Blockscout response (or null, if unverified /
 * shadow-audit fault) plus the runtime bytecode already available to the
 * caller. Pure — no I/O — split out so normalize/hash logic is directly
 * testable. Exported for that reason: the docstring has claimed it was
 * directly testable since it was written, while the missing `export` meant
 * every test had to reach it through `getOrCreateArtifact` and a deps stub.
 */
export function buildArtifact(
  runtimeCode: string,
  raw: AuditSmartContract | null
): Omit<AuditArtifact, "id"> {
  const runtimeCodeHash = computeExactRuntimeHash(runtimeCode);
  const templateHash = computeBytecodeHash(runtimeCode);

  if (!raw) {
    // Unverified contract, or the shadow-audit fetch itself faulted — degrade
    // to unresolved. The exact runtime hash never depends on Blockscout, so
    // it's always available. Bytecode-selector capability hints still run —
    // they need no verified source — so an unverified contract isn't left
    // with zero capability evidence.
    return {
      runtimeCodeHash,
      templateHash,
      abiHash: null,
      sourceHash: null,
      capabilities: classifyCapabilities({ abi: null, sourceNormalized: null, runtimeCode }),
      // Identity still resolves here, and this is the case it was built for:
      // no source, so the dispatcher is enumerated from the bytecode instead.
      // `sourceVerified` comes back null rather than false — a null `raw` is
      // "unverified OR the fetch faulted", and only one of those is a fact.
      identity: buildContractIdentity({ raw: null, runtimeCode }),
      completeness: "unresolved",
      sourceBytes: null,
    };
  }

  // A PARTIAL match is not a complete read.
  //
  // Blockscout sets `is_verified` for both a full and a partial match, so
  // testing it alone answers "is there source?" when the audit is asking "is
  // this source provably this contract's?". A partial match means the runtime
  // bytecode agrees but the metadata hash does not — usually because the source
  // was pulled out of `eth_bytecode_db` from a DIFFERENT address that compiled
  // to the same code. The capabilities read out of it are still worth having;
  // what is not defensible is calling the result `complete` and letting the
  // absence of a finding be published as an all-clear (§9).
  //
  // Only an explicit `true` demotes. Null means the explorer did not say, and
  // inventing a partial match out of silence would be the same error pointed
  // the other way.
  let completeness: Completeness = !raw.is_verified
    ? "unresolved"
    : raw.is_partially_verified === true
      ? "partial"
      : "complete";
  const abiHash = raw.abi ? hashAbi(normalizeAbi(raw.abi)) : null;

  let sourceHash: string | null = null;
  let sourceBytes: number | null = null;
  let sourceNormalized: string | null = null;
  if (raw.source_code) {
    sourceBytes =
      raw.source_code.length +
      raw.additional_sources.reduce((sum, s) => sum + s.source_code.length, 0);
    if (sourceBytes > auditMaxSourceBytes()) {
      // Oversized: skip normalizing/hashing the source, but the ABI hash
      // above (if any) is still kept — a partial artifact beats none.
      completeness = "partial";
    } else {
      sourceNormalized = normalizeSource(raw.source_code, raw.additional_sources);
      sourceHash = hashSource(sourceNormalized);
    }
  } else if (raw.is_verified) {
    // Verified per Blockscout but no source text came back — don't silently
    // claim "complete" for evidence we don't actually have.
    completeness = "partial";
  }

  return {
    runtimeCodeHash,
    templateHash,
    abiHash,
    sourceHash,
    capabilities: classifyCapabilities({
      abi: raw.abi ?? null,
      sourceNormalized,
      runtimeCode,
      contractName: raw.name,
    }),
    identity: buildContractIdentity({ raw, runtimeCode }),
    completeness,
    sourceBytes,
  };
}



/**
 * How long a cached artifact may answer for, by what it managed to establish.
 *
 * A `complete` artifact never expires, and that is not laziness: the cache key
 * is the EXACT RUNTIME BYTECODE HASH, and verified source for a given bytecode
 * cannot un-verify. The other two states are not facts about the contract, they
 * are statements about what the explorer knew at one moment, and both can
 * improve later — which is exactly what went wrong (L52): STONKATM was scanned
 * at 15:26 while unverified, cached `unresolved`, verified on Blockscout at
 * 21:48, and every server-side scan for the next full day replayed the stale
 * row because neither the bytecode hash nor the rule version changes when a
 * contract gets verified.
 *
 * Plain constants, deliberately not `intEnv`: a re-read dial that env can pin
 * is how `RUG_CRITERIA_VERSION` and `CURVE_BONDING_SURFACE_BPS` both spent
 * weeks running at a value the code denied (L49).
 */
const ARTIFACT_TTL_MS: Record<Completeness, number | null> = {
  complete: null,
  partial: 24 * 60 * 60 * 1000,
  unresolved: 6 * 60 * 60 * 1000,
};

/** True when a stored artifact is past the TTL for what it established. */
export function isArtifactStale(
  artifact: Pick<AuditArtifact, "completeness" | "cachedAt">,
  nowMs: number,
): boolean {
  const ttl = ARTIFACT_TTL_MS[artifact.completeness];
  if (ttl === null) return false;
  // No timestamp means a row written before this column was read, or a build
  // that never came from the cache. Treat it as stale rather than as eternally
  // fresh: the failure this whole mechanism exists to end is a negative that
  // never gets re-asked.
  if (!artifact.cachedAt) return true;
  const cachedAtMs = Date.parse(artifact.cachedAt);
  if (!Number.isFinite(cachedAtMs)) return true;
  return nowMs - cachedAtMs > ttl;
}

export async function getOrCreateArtifact(
  address: string,
  runtimeCode: string,
  ruleVersion: string,
  chainId: number,
  deps: ArtifactCacheDeps
): Promise<{ artifact: AuditArtifact; cacheStatus: "hit" | "miss" }> {
  const runtimeCodeHash = computeExactRuntimeHash(runtimeCode);

  let stale: AuditArtifact | null = null;
  try {
    const existing = await deps.findArtifactRecord(chainId, runtimeCodeHash, ruleVersion);
    if (existing) {
      if (!isArtifactStale(existing, Date.now())) {
        return { artifact: existing, cacheStatus: "hit" };
      }
      // Kept, not discarded. If the refetch below faults we serve this rather
      // than downgrading a token to "we could not look" on the strength of one
      // bad minute upstream.
      stale = existing;
    }
  } catch {
    // Best-effort read
  }

  const raw = await deps.fetchArtifact(address);

  // THE fix for L52, and the precondition for the TTL above rather than an
  // independent improvement. `fetchArtifact` returns null both for "the
  // explorer says this contract is unverified" (a fact, worth caching for 6h)
  // and for "every adapter faulted" (not a fact at all). Persisting the second
  // is CLAUDE.md §4's "never cache a negative that came from a transient
  // failure", and here it had no TTL to expire it.
  //
  // Order matters: with a TTL now forcing refetches, writing a faulted read
  // would let one outage OVERWRITE a good `complete` artifact — turning a
  // read-only bug into a destructive one.
  const faulted = raw === null && deps.artifactReadFaulted();
  if (faulted) {
    // Serve the stale row when we have one: an expired answer from a healthy
    // explorer beats a fresh non-answer from a dead one.
    if (stale) return { artifact: stale, cacheStatus: "hit" };
    // Otherwise build for THIS scan only (bytecode-only capability hints still
    // run and are worth having) and write nothing.
    const built = buildArtifact(runtimeCode, null);
    return { artifact: { id: "", ...built }, cacheStatus: "miss" };
  }

  const built = buildArtifact(runtimeCode, raw);

  let id = "";
  try {
    id = await deps.upsertArtifactRecord(
      {
        chainId,
        runtimeCodeHash: built.runtimeCodeHash,
        templateHash: built.templateHash,
        ruleVersion,
        abiHash: built.abiHash,
        sourceHash: built.sourceHash,
        capabilities: built.capabilities,
        identity: built.identity,
        completeness: built.completeness,
        sourceBytes: built.sourceBytes,
      }
    );
  } catch {
    // Best-effort write
  }

  return { artifact: { id, ...built }, cacheStatus: "miss" };
}
