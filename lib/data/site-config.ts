import { inArray } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { siteConfig } from "@/lib/db/schema";

export async function readSiteConfigKeys(
  keys: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const conn = database();
  if (!conn) return out;

  const rows = await conn
    .select({
      key: siteConfig.key,
      value: siteConfig.value,
    })
    .from(siteConfig)
    .where(inArray(siteConfig.key, keys));

  for (const r of rows) {
    if (r.value) out[r.key] = r.value;
  }

  return out;
}

export async function upsertSiteConfigKeys(
  rows: Array<{ key: string; value: string; updatedBy: string }>
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  const nowIso = new Date().toISOString();

  for (const r of rows) {
    await conn
      .insert(siteConfig)
      .values({
        key: r.key,
        value: r.value,
        updatedAt: nowIso,
        updatedBy: r.updatedBy,
      })
      .onConflictDoUpdate({
        target: siteConfig.key,
        set: {
          value: r.value,
          updatedAt: nowIso,
          updatedBy: r.updatedBy,
        },
      });
  }
}
