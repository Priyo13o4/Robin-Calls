import { eq, and, inArray, desc, asc } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { trustedAddress, trustedLockers, registry } from "@/lib/db/schema";
import type { TrustedAddress } from "@/lib/config/trusted-addresses";

export interface TrustedLockerRow {
  address: string;
  label: string;
  kind: "permanent" | "timelock";
  enabled: boolean;
  notes: string | null;
  added_by: string | null;
  created_at: string;
}

export interface TrustedAddressRow {
  address: string;
  category: string;
  subtype: string | null;
  label: string;
  dex_id: string | null;
  enabled: boolean;
  verify_status: string;
  verified_at: string | null;
  created_by: string | null;
}

export async function readEnabledTrustedAddresses(
  chainId = 4663
): Promise<TrustedAddress[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select({
      address: trustedAddress.address,
      chainId: trustedAddress.chainId,
      category: trustedAddress.category,
      subtype: trustedAddress.subtype,
      label: trustedAddress.label,
      dexId: trustedAddress.dexId,
      metadata: trustedAddress.metadata,
      verifyStatus: trustedAddress.verifyStatus,
    })
    .from(trustedAddress)
    .where(and(eq(trustedAddress.enabled, true), eq(trustedAddress.chainId, chainId)));

  return rows.map((r) => ({
    address: r.address,
    chain_id: Number(r.chainId),
    category: r.category as any,
    subtype: r.subtype,
    label: r.label,
    dex_id: r.dexId,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    verify_status: (r.verifyStatus as any) ?? "unchecked",
  }));
}

export async function readVerifiedRwaRegistry(): Promise<Array<{ address: string; category: string; verify_status: string }>> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select({
      address: registry.address,
      category: registry.category,
      verifyStatus: registry.verifyStatus,
    })
    .from(registry)
    .where(inArray(registry.category, ["stock-token", "etf"]));

  return rows.map((r) => ({
    address: r.address,
    category: r.category ?? "",
    verify_status: r.verifyStatus,
  }));
}

export async function readAllTrustedAddresses(
  chainId = 4663
): Promise<TrustedAddressRow[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(trustedAddress)
    .where(eq(trustedAddress.chainId, chainId))
    .orderBy(asc(trustedAddress.category), asc(trustedAddress.label));

  return rows.map((r) => ({
    address: r.address,
    category: r.category,
    subtype: r.subtype,
    label: r.label,
    dex_id: r.dexId,
    enabled: r.enabled,
    verify_status: r.verifyStatus,
    verified_at: r.verifiedAt ? new Date(r.verifiedAt).toISOString() : null,
    created_by: r.createdBy,
  }));
}

export async function upsertTrustedAddressRecord(
  data: {
    address: string;
    chainId?: number;
    category: string;
    subtype?: string | null;
    label: string;
    dexId?: string | null;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
    verifyStatus: string;
    verifiedAt?: string | null;
    createdBy?: string | null;
  }
): Promise<void> {
  const conn = database();
  if (!conn) return;

  const chainId = data.chainId ?? 4663;

  await conn
    .insert(trustedAddress)
    .values({
      address: data.address.toLowerCase(),
      chainId,
      category: data.category,
      subtype: data.subtype ?? null,
      label: data.label,
      dexId: data.dexId ?? null,
      metadata: data.metadata ?? {},
      enabled: data.enabled ?? true,
      verifyStatus: data.verifyStatus,
      verifiedAt: data.verifiedAt ? new Date(data.verifiedAt).toISOString() : null,
      createdBy: data.createdBy ?? null,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [trustedAddress.address, trustedAddress.chainId],
      set: {
        category: data.category,
        subtype: data.subtype ?? null,
        label: data.label,
        dexId: data.dexId ?? null,
        metadata: data.metadata ?? {},
        enabled: data.enabled ?? true,
        verifyStatus: data.verifyStatus,
        verifiedAt: data.verifiedAt ? new Date(data.verifiedAt).toISOString() : null,
        createdBy: data.createdBy ?? null,
        updatedAt: new Date().toISOString(),
      },
    });
}

export async function toggleTrustedAddressRecord(
  address: string,
  enabled: boolean,
  chainId = 4663
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .update(trustedAddress)
    .set({ enabled, updatedAt: new Date().toISOString() })
    .where(and(eq(trustedAddress.address, address.toLowerCase()), eq(trustedAddress.chainId, chainId)));
}

export async function upsertRegistryRwaRecord(
  data: {
    address: string;
    assetName: string;
    assetSymbol: string;
    category: "stock-token" | "etf";
    verifyStatus: string;
    verifiedAt?: string | null;
    fetchedAt?: string | null;
  }
): Promise<void> {
  const conn = database();
  if (!conn) return;

  const now = new Date().toISOString();

  await conn
    .insert(registry)
    .values({
      address: data.address.toLowerCase(),
      assetName: data.assetName,
      assetSymbol: data.assetSymbol,
      category: data.category,
      verifyStatus: data.verifyStatus,
      verifiedAt: data.verifiedAt ? new Date(data.verifiedAt).toISOString() : now,
      fetchedAt: data.fetchedAt ? new Date(data.fetchedAt).toISOString() : now,
    })
    .onConflictDoUpdate({
      target: registry.address,
      set: {
        assetName: data.assetName,
        assetSymbol: data.assetSymbol,
        category: data.category,
        verifyStatus: data.verifyStatus,
        verifiedAt: data.verifiedAt ? new Date(data.verifiedAt).toISOString() : now,
        fetchedAt: data.fetchedAt ? new Date(data.fetchedAt).toISOString() : now,
      },
    });
}


export async function readTrustedLockers(): Promise<TrustedLockerRow[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(trustedLockers)
    .orderBy(desc(trustedLockers.createdAt));

  return rows.map((r) => ({
    address: r.address,
    label: r.label,
    kind: r.kind as "permanent" | "timelock",
    enabled: r.enabled,
    notes: r.notes ?? null,
    added_by: r.addedBy ?? null,
    created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));
}

export async function upsertTrustedLockerRecord(
  data: {
    address: string;
    label: string;
    kind: "permanent" | "timelock";
    notes?: string | null;
    enabled?: boolean;
    addedBy?: string | null;
  }
): Promise<void> {
  const conn = database();
  if (!conn) return;

  const address = data.address.toLowerCase();

  await conn
    .insert(trustedLockers)
    .values({
      address,
      label: data.label,
      kind: data.kind,
      notes: data.notes || null,
      enabled: data.enabled ?? true,
      addedBy: data.addedBy ?? null,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: trustedLockers.address,
      set: {
        label: data.label,
        kind: data.kind,
        notes: data.notes || null,
        enabled: data.enabled ?? true,
        addedBy: data.addedBy ?? null,
        updatedAt: new Date().toISOString(),
      },
    });
}

export async function toggleTrustedLockerRecord(
  address: string,
  enabled: boolean
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .update(trustedLockers)
    .set({ enabled, updatedAt: new Date().toISOString() })
    .where(eq(trustedLockers.address, address.toLowerCase()));
}

export async function deleteTrustedLockerRecord(
  address: string
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn.delete(trustedLockers).where(eq(trustedLockers.address, address.toLowerCase()));
}
