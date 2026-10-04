import { eq, and, desc } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { contractAuditArtifact, contractAuditInstance } from "@/lib/db/schema";
import type { AuditArtifact, ArtifactUpsert } from "@/lib/audit/artifact-cache";
import { decodeIdentity } from "@/lib/audit/inventory";
import type { ContractIdentity } from "@/lib/audit/types";

export async function findArtifactRecord(
  chainId: number,
  runtimeCodeHash: string,
  ruleVersion: string
): Promise<AuditArtifact | null> {

  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(contractAuditArtifact)
    .where(
      and(
        eq(contractAuditArtifact.chainId, chainId),
        eq(contractAuditArtifact.runtimeCodeHash, runtimeCodeHash),
        eq(contractAuditArtifact.ruleVersion, ruleVersion)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    runtimeCodeHash: row.runtimeCodeHash,
    templateHash: row.templateHash ?? null,
    abiHash: row.abiHash ?? null,
    sourceHash: row.sourceHash ?? null,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    // Decoded, not cast. A row written before 0050 holds `{}`, and a cast would
    // hand the caller an object whose `sourceVerified` is `undefined` —
    // falsy, and therefore read downstream as "this source is not verified"
    // (CLAUDE.md §8.9). `decodeIdentity` turns anything it cannot read into the
    // explicit "not established" shape instead.
    identity: decodeIdentity(row.identity),
    completeness: row.completeness as any,
    sourceBytes: row.sourceBytes ? Number(row.sourceBytes) : null,
    // Feeds the artifact TTL (L52). Maintained by the
    // `contract_audit_artifact_updated_at` trigger from 0030, so it stays true
    // across the upsert's ON CONFLICT path, which does not set it itself.
    cachedAt: row.updatedAt ?? row.createdAt ?? null,
  };
}

export async function upsertArtifactRecord(built: ArtifactUpsert): Promise<string> {

  const conn = database();
  if (!conn) return "";

  try {
    const [inserted] = await conn
      .insert(contractAuditArtifact)
      .values({
        chainId: built.chainId,
        runtimeCodeHash: built.runtimeCodeHash,
        templateHash: built.templateHash,
        ruleVersion: built.ruleVersion,
        abiHash: built.abiHash,
        sourceHash: built.sourceHash,
        capabilities: built.capabilities,
        identity: built.identity,
        completeness: built.completeness as any,
        sourceBytes: built.sourceBytes,
      })
      .onConflictDoUpdate({
        target: [
          contractAuditArtifact.chainId,
          contractAuditArtifact.runtimeCodeHash,
          contractAuditArtifact.ruleVersion,
        ],
        set: {
          templateHash: built.templateHash,
          abiHash: built.abiHash,
          sourceHash: built.sourceHash,
          capabilities: built.capabilities,
          identity: built.identity,
          completeness: built.completeness as any,
          sourceBytes: built.sourceBytes,
        },
      })
      .returning({ id: contractAuditArtifact.id });

    return inserted?.id ? String(inserted.id) : "";
  } catch (err) {
    return "";
  }
}

/**
 * Instance-level audit evidence (M8): proxy graph, authorities, findings for
 * ONE address at ONE pinned block, keyed `(address, block_hash, rule_version)`
 * — every proxy instance still gets its own owner/storage/authority analysis
 * even when its implementation's static artifact was already cached (plan
 * §"a reviewed beacon can make future scans recognize the canonical
 * implementation cheaply, but every proxy instance still gets its own...
 * analysis").
 */
export async function upsertInstanceRecord(row: {
  address: string;
  blockHash: string;
  ruleVersion: string;
  artifactId: string;
  proxyGraph: unknown;
  authorities: unknown;
  findings: unknown;
}): Promise<void> {
  const conn = database();
  if (!conn) return;
  if (!row.artifactId) return; // no artifact row was ever persisted — nothing to key the FK against

  try {
    await conn
      .insert(contractAuditInstance)
      .values({
        address: row.address,
        blockHash: row.blockHash,
        ruleVersion: row.ruleVersion,
        artifactId: row.artifactId,
        proxyGraph: row.proxyGraph as any,
        authorities: row.authorities as any,
        findings: row.findings as any,
      })
      .onConflictDoUpdate({
        target: [contractAuditInstance.address, contractAuditInstance.blockHash, contractAuditInstance.ruleVersion],
        set: {
          proxyGraph: row.proxyGraph as any,
          authorities: row.authorities as any,
          findings: row.findings as any,
        },
      });
  } catch {
    // Best-effort write — the verdict already carries the evidence in-memory.
  }
}

/**
 * The stored contract audit for an address — the READ side, which did not exist.
 *
 * `upsertInstanceRecord` above has been writing `contract_audit_instance` since
 * migration 0030 and nothing has ever read it back. That is why the audit is
 * only ever visible on a freshly-computed verdict: `verdicts` has no
 * `contract_audit` column, so a stored verdict carries the audit's *effect* (a
 * `dangerous_selectors` check whose `source` is the audit) but none of its
 * findings. The panel on /scan and the agent's advisory badge both went blank
 * the moment a verdict came from the database rather than a live pipeline.
 *
 * ── Why this is not filtered on the current rule version ────────────────────
 *
 * Filtering would make an audit produced under `audit-v2` indistinguishable
 * from no audit at all, and those are different sentences (CLAUDE.md §4). The
 * row is returned with its own `ruleVersion` and a `staleRules` flag instead,
 * so the caller can say "this was analysed under an older ruleset" rather than
 * "this contract has never been analysed".
 *
 * `blockHash` is returned for the same reason: an authority set is true as of a
 * block, and an owner can be transferred the block after. The reader needs to
 * know how old the answer is to know whether to trust it.
 */
export async function readLatestAuditInstance(
  address: string,
  currentRuleVersion: string
): Promise<{
  address: string;
  blockHash: string;
  ruleVersion: string;
  staleRules: boolean;
  observedAt: string;
  proxyGraph: unknown;
  authorities: unknown;
  findings: unknown;
  capabilities: unknown[];
  identity: ContractIdentity;
  completeness: string;
  runtimeCodeHash: string;
  sourceHash: string | null;
  abiHash: string | null;
} | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select({
      address: contractAuditInstance.address,
      blockHash: contractAuditInstance.blockHash,
      ruleVersion: contractAuditInstance.ruleVersion,
      createdAt: contractAuditInstance.createdAt,
      proxyGraph: contractAuditInstance.proxyGraph,
      authorities: contractAuditInstance.authorities,
      findings: contractAuditInstance.findings,
      capabilities: contractAuditArtifact.capabilities,
      identity: contractAuditArtifact.identity,
      completeness: contractAuditArtifact.completeness,
      runtimeCodeHash: contractAuditArtifact.runtimeCodeHash,
      sourceHash: contractAuditArtifact.sourceHash,
      abiHash: contractAuditArtifact.abiHash,
    })
    .from(contractAuditInstance)
    .innerJoin(
      contractAuditArtifact,
      eq(contractAuditInstance.artifactId, contractAuditArtifact.id)
    )
    .where(eq(contractAuditInstance.address, address.toLowerCase()))
    .orderBy(desc(contractAuditInstance.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    address: row.address,
    blockHash: row.blockHash,
    ruleVersion: row.ruleVersion,
    staleRules: row.ruleVersion !== currentRuleVersion,
    observedAt: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : new Date().toISOString(),
    proxyGraph: row.proxyGraph,
    authorities: row.authorities,
    findings: row.findings,
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    identity: decodeIdentity(row.identity),
    completeness: row.completeness,
    runtimeCodeHash: row.runtimeCodeHash,
    sourceHash: row.sourceHash,
    abiHash: row.abiHash,
  };
}
