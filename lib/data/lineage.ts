import { eq, and, inArray, asc, desc, gt, count } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { walletEdges, walletStains, walletHubs, deployers, rugs, compareStats } from "@/lib/db/schema";
import type { LineageEdge } from "@/lib/types";

export interface ActiveStainRow {
  address: string;
  hops: number;
  origin_deployer: string;
  path: LineageEdge[];
}

export async function cacheEdgeRecord(
  funder: string,
  fundee: string,
  info: { txHash: string; block: number | null; valueEth: number | null }
): Promise<void> {
  const conn = database();
  if (!conn) return;

  try {
    await conn
      .insert(walletEdges)
      .values({
        funder: funder.toLowerCase(),
        fundee: fundee.toLowerCase(),
        txHash: info.txHash,
        blockNumber: info.block ?? null,
        valueWei: info.valueEth != null ? Math.round(info.valueEth * 1e18).toString() : null,
        kind: "first_fund",
      })
      .onConflictDoNothing({
        target: [walletEdges.funder, walletEdges.fundee, walletEdges.txHash],
      });
  } catch (error: any) {
    console.error("[RC_DB_WRITE_FAILED] cacheEdgeRecord:", error.message);
  }
}

export async function readActiveStainFor(
  addresses: string[]
): Promise<ActiveStainRow | null> {
  const conn = database();
  if (!conn) return null;

  const lowered = addresses.filter(Boolean).map((a) => a.toLowerCase());
  if (lowered.length === 0) return null;

  const rows = await conn
    .select({
      address: walletStains.address,
      hops: walletStains.hops,
      originDeployer: walletStains.originDeployer,
      path: walletStains.path,
    })
    .from(walletStains)
    .where(and(inArray(walletStains.address, lowered), eq(walletStains.active, true)))
    .orderBy(asc(walletStains.hops))
    .limit(1);

  if (!rows[0]) return null;

  return {
    address: rows[0].address,
    hops: Number(rows[0].hops),
    origin_deployer: rows[0].originDeployer,
    path: (rows[0].path as LineageEdge[]) ?? [],
  };
}

/**
 * Distinct wallets this address has funded, per the edge cache. The
 * shared-surface test for stain attribution (SHARED_FUNDER_MAX_FUNDEES): a
 * wallet paying gas to more than a handful of deployers is a withdrawal
 * address, and a stain delivered through it reads onto nobody.
 */
export async function readWalletFanOut(address: string): Promise<number | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .selectDistinct({ fundee: walletEdges.fundee })
    .from(walletEdges)
    .where(eq(walletEdges.funder, address.toLowerCase()));

  return rows.length;
}

export async function isConfirmedRuggerRecord(
  address: string
): Promise<boolean> {
  const conn = database();
  if (!conn) return false;

  const rows = await conn
    .select({ confirmedRugs: deployers.confirmedRugs })
    .from(deployers)
    .where(eq(deployers.address, address.toLowerCase()))
    .limit(1);

  return (rows[0]?.confirmedRugs ?? 0) > 0;
}

export async function markHubRecord(
  address: string,
  fanout: number
): Promise<void> {
  const conn = database();
  if (!conn) return;

  try {
    await conn
      .insert(walletHubs)
      .values({
        address: address.toLowerCase(),
        source: "auto-fanout",
        fanoutCount: fanout,
      })
      .onConflictDoNothing({ target: walletHubs.address });
  } catch (error: any) {
    console.error("[RC_DB_WRITE_FAILED] markHubRecord:", error.message);
  }
}

export async function isHubRecord(
  address: string
): Promise<boolean> {
  const conn = database();
  if (!conn) return false;

  const rows = await conn
    .select({ address: walletHubs.address })
    .from(walletHubs)
    .where(eq(walletHubs.address, address.toLowerCase()))
    .limit(1);

  return Boolean(rows[0]);
}

export async function writeStainRecord(
  args: {
    address: string;
    originRugId: number;
    originDeployer: string;
    hops: number;
    direction: "upstream" | "downstream";
    path: LineageEdge[];
  }
): Promise<boolean> {
  const conn = database();
  if (!conn) return false;

  try {
    await conn
      .insert(walletStains)
      .values({
        address: args.address.toLowerCase(),
        originRugId: args.originRugId,
        originDeployer: args.originDeployer.toLowerCase(),
        hops: args.hops,
        direction: args.direction,
        path: args.path,
        active: true,
      })
      .onConflictDoUpdate({
        target: [walletStains.address, walletStains.originRugId],
        set: {
          originDeployer: args.originDeployer.toLowerCase(),
          hops: args.hops,
          direction: args.direction,
          path: args.path,
          active: true,
        },
      });
    return true;
  } catch (error: any) {
    console.error("[RC_DB_WRITE_FAILED] writeStainRecord:", error.message);
    return false;
  }
}

export async function readActiveStainsAndHubs(
  stainLimit = 200
): Promise<{
  stains: Array<{
    address: string;
    origin_deployer: string;
    hops: number;
    direction: string;
    created_at: string;
  }>;
  hubs: Array<{
    address: string;
    label: string | null;
    source: string;
    fanout_count: number | null;
  }>;
}> {
  const conn = database();
  if (!conn) return { stains: [], hubs: [] };

  const [stainRows, hubRows] = await Promise.all([
    conn
      .select({
        address: walletStains.address,
        originDeployer: walletStains.originDeployer,
        hops: walletStains.hops,
        direction: walletStains.direction,
        createdAt: walletStains.createdAt,
      })
      .from(walletStains)
      .where(eq(walletStains.active, true))
      .orderBy(desc(walletStains.createdAt))
      .limit(stainLimit),
    conn
      .select({
        address: walletHubs.address,
        label: walletHubs.label,
        source: walletHubs.source,
        fanoutCount: walletHubs.fanoutCount,
      })
      .from(walletHubs)
      .orderBy(desc(walletHubs.fanoutCount)),
  ]);

  return {
    stains: stainRows.map((r) => ({
      address: r.address,
      origin_deployer: r.originDeployer,
      hops: r.hops,
      direction: r.direction,
      created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    })),
    hubs: hubRows.map((r) => ({
      address: r.address,
      label: r.label ?? null,
      source: r.source,
      fanout_count: r.fanoutCount != null ? Number(r.fanoutCount) : null,
    })),
  };
}

export async function upsertHubRecord(
  address: string,
  label: string | null,
  source = "manual"
): Promise<void> {
  const normAddress = address.toLowerCase();

  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  await conn
    .insert(walletHubs)
    .values({
      address: normAddress,
      label,
      source,
    })
    .onConflictDoUpdate({
      target: walletHubs.address,
      set: {
        label,
        source,
      },
    });
}

export async function liftStainRecord(
  address: string,
  originDeployer: string,
  liftedReason: string,
  liftedBy: string
): Promise<void> {
  const normAddress = address.toLowerCase();
  const normOrigin = originDeployer.toLowerCase();
  const nowIso = new Date().toISOString();

  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  await conn
    .update(walletStains)
    .set({
      active: false,
      liftedAt: nowIso,
      liftedReason,
      liftedBy,
    })
    .where(and(eq(walletStains.address, normAddress), eq(walletStains.originDeployer, normOrigin)));
}

/**
 * Distinct addresses carrying an ACTIVE stain, oldest first. Paired with
 * `retireContractStains` — the CONTRACT gate in stains.ts is forward-only, so
 * rows written before it exists are only reachable by re-reading them.
 */
export async function readActiveStainAddresses(
  limit = 200,
): Promise<string[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .selectDistinct({ address: walletStains.address })
    .from(walletStains)
    .where(eq(walletStains.active, true))
    .orderBy(asc(walletStains.address))
    .limit(limit);

  return rows.map((r) => r.address);
}

/** Deactivate every active stain on one address, whatever its origin rug. */
export async function retireStainsForAddress(
  address: string,
  liftedReason: string,
  liftedBy: string,
): Promise<number> {
  const conn = database();
  if (!conn) return 0;

  const rows = await conn
    .update(walletStains)
    .set({
      active: false,
      liftedAt: new Date().toISOString(),
      liftedReason,
      liftedBy,
    })
    .where(and(eq(walletStains.address, address.toLowerCase()), eq(walletStains.active, true)))
    .returning({ id: walletStains.id });

  return rows.length;
}

export async function readLineageTraceTargets(
  limit = 25
): Promise<Array<{ address: string }>> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select({ address: deployers.address })
    .from(deployers)
    .where(gt(deployers.confirmedRugs, 0))
    .orderBy(desc(deployers.confirmedRugs))
    .limit(limit);

  return rows.map((r) => ({ address: r.address }));
}

export async function readLatestRugForDeployer(
  deployerAddress: string
): Promise<number | null> {
  const norm = deployerAddress.toLowerCase();

  const conn = database();
  if (!conn) return null;

  const depRows = await conn.select({ id: deployers.id }).from(deployers).where(eq(deployers.address, norm)).limit(1);
  const dep = depRows[0];
  if (!dep) return null;

  const rugRows = await conn
    .select({ id: rugs.id })
    .from(rugs)
    .where(eq(rugs.deployerId, dep.id))
    .orderBy(desc(rugs.createdAt))
    .limit(1);

  return rugRows[0] ? Number(rugRows[0].id) : null;
}

export async function updateStainsStatCount(): Promise<number> {
  const conn = database();
  if (!conn) return 0;

  const countRows = await conn
    .select({ count: count() })
    .from(walletStains)
    .where(eq(walletStains.active, true));

  const total = countRows[0]?.count ?? 0;

  await conn
    .insert(compareStats)
    .values({
      key: "wallets_stained",
      value: total,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: compareStats.key,
      set: {
        value: total,
        updatedAt: new Date().toISOString(),
      },
    });

  return total;
}



