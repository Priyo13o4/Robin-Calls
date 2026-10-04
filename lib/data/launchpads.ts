import { eq, asc, count } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { launchpads, launches } from "@/lib/db/schema";
import type { LauncherFamily, LauncherInstance } from "@/lib/launches/types";
import { POOL_FAMILIES } from "@/lib/launches/labels";

export function mapLauncherInstance(r: typeof launchpads.$inferSelect): LauncherInstance {
  return {
    id: Number(r.id),
    slug: r.slug,
    name: r.name,
    family: r.adapter as LauncherFamily,
    address: r.curveAddress.toLowerCase(),
    config: (r.config as Record<string, unknown>) ?? {},
  };
}

export async function readEnabledLauncherInstances(): Promise<LauncherInstance[]> {
  const conn = database();
  if (!conn) return [];
  const rows = await conn
    .select()
    .from(launchpads)
    .where(eq(launchpads.enabled, true))
    .orderBy(asc(launchpads.id));
  return rows.map(mapLauncherInstance);
}

/** Every pad, enabled or not, for the Night Market filter labels and admin. */
export async function readAllLaunchpadsAdmin() {
  const conn = database();
  if (!conn) return [];
  return conn.select().from(launchpads).orderBy(asc(launchpads.id));
}

/** Enabled pads with display fields, for the Night Market picker. */
export async function readEnabledLaunchpads(): Promise<{ id: number; slug: string; name: string; config: Record<string, unknown> }[]> {
  const conn = database();
  if (!conn) return [];
  const rows = await conn
    .select({ id: launchpads.id, slug: launchpads.slug, name: launchpads.name, config: launchpads.config })
    .from(launchpads)
    .where(eq(launchpads.enabled, true))
    .orderBy(asc(launchpads.id));
  return rows.map((r) => ({ id: Number(r.id), slug: r.slug, name: r.name, config: (r.config as Record<string, unknown>) ?? {} }));
}

export async function countTokensByLaunchpad(launchpadId: number): Promise<number> {
  const conn = database();
  if (!conn) return 0;
  const res = await conn.select({ count: count() }).from(launches).where(eq(launches.launchpadId, launchpadId));
  return res[0]?.count ?? 0;
}

export async function getLaunchpadById(id: number): Promise<{ address: string; family: LauncherFamily } | null> {
  const conn = database();
  if (!conn) return null;
  const rows = await conn
    .select({ address: launchpads.curveAddress, family: launchpads.adapter })
    .from(launchpads)
    .where(eq(launchpads.id, id))
    .limit(1);
  const r = rows[0];
  return r ? { address: r.address, family: r.family as LauncherFamily } : null;
}

export async function addLaunchpadRecord(values: {
  slug: string;
  name: string;
  address: string;
  family: LauncherFamily;
  config?: Record<string, unknown>;
  notes?: string | null;
  enabled: boolean;
  lastProbe?: unknown;
}): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");
  await conn.insert(launchpads).values({
    slug: values.slug,
    name: values.name,
    curveAddress: values.address.toLowerCase(),
    adapter: values.family,
    config: values.config ?? {},
    notes: values.notes ?? null,
    enabled: values.enabled,
    lastProbe: values.lastProbe ?? null,
    venueModel: POOL_FAMILIES.has(values.family) ? "DEX_RESTRICTED" : "BONDING_CURVE",
    updatedAt: new Date().toISOString(),
  });
}

export async function setLaunchpadEnabledRecord(id: number, enabled: boolean): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");
  await conn.update(launchpads).set({ enabled, updatedAt: new Date().toISOString() }).where(eq(launchpads.id, id));
}

export async function updateLaunchpadProbeRecord(id: number, probe: unknown): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");
  await conn.update(launchpads).set({ lastProbe: probe, updatedAt: new Date().toISOString() }).where(eq(launchpads.id, id));
}

/** Refused by the FK while any launch references the pad: registry rows are never deleted. Disable instead. */
export async function deleteLaunchpadRecord(id: number): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");
  if ((await countTokensByLaunchpad(id)) > 0) {
    throw new Error("This launchpad has recorded launches. Disable it instead; launches are never deleted.");
  }
  await conn.delete(launchpads).where(eq(launchpads.id, id));
}
