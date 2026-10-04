"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import {
  assertRpcUrl,
  countRpcEndpoints,
  deleteRpcEndpoint,
  readRpcEndpoints,
  setRpcEndpointEnabled,
  upsertRpcEndpoint,
} from "@/lib/data/rpc-endpoints";
import { primeRpcEndpoints } from "@/lib/config/rpc-endpoints";
import { parseEndpointConfig } from "@/lib/rpc/provider-pool";
import { toResult, type ActionResult } from "@/lib/admin/action-result";

/**
 * The RPC pool's operator controls (migration 0061, KNOWN-PROBLEMS L19).
 *
 * Every mutation force-primes the cache before returning. Two reasons, and the
 * second is the one that bites: a 60s TTL would make "disable" look broken for
 * a minute, and the pool's own rebuild is keyed on the registry GENERATION, so
 * without the forced prime the generation never moves and `buildProviders`
 * keeps its old provider list until the TTL lapses.
 *
 * Per-process. One app container today, so this is exact; behind a second
 * replica the other instance picks the change up on its next TTL expiry
 * (≤60s), never longer. Same contract as every other process cache here (§5).
 */

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

async function actor(): Promise<string> {
  const session = await requireAdmin();
  return (
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin"
  );
}

async function settle(): Promise<void> {
  await primeRpcEndpoints(true);
  revalidatePath("/admin/rpc");
}

function optionalInt(form: FormData, key: string): number | null {
  const raw = String(form.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer.`);
  return n;
}

function methodList(form: FormData, key: string): string[] {
  return String(form.get(key) ?? "")
    .split(/[\s,]+/)
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * One-time import of `RPC_ENDPOINTS_JSON` into the table, so the env var can
 * be deleted from .env.production. Refuses to run over a populated table —
 * re-importing would silently revert every enable/disable the operator has
 * set since, which is the same shape as the fallback this whole module exists
 * to make loud.
 */
export async function seedRpcEndpointsAction(): Promise<ActionResult> {
  return toResult(async () => {
  const by = await actor();
  if ((await countRpcEndpoints()) > 0) {
    throw new Error("Already seeded — delete the rows first if you really mean to re-import.");
  }
  const seed = parseEndpointConfig(process.env);
  let order = 10;
  for (const e of seed) {
    await upsertRpcEndpoint({
      id: e.id,
      url: e.url,
      enabled: true,
      sortOrder: order,
      maxCuPerSecond: e.maxCuPerSecond ?? null,
      maxRequestsPerSecond: e.maxRequestsPerSecond ?? null,
      maxConcurrentRequests: e.maxConcurrentRequests ?? null,
      preferMethods: e.preferMethods ?? [],
      maxLogSpan: e.capabilities?.maxLogSpan ?? null,
      denyMethods: e.capabilities?.denyMethods ?? [],
      allowMethods: e.capabilities?.allowMethods ?? [],
      note: "Imported from RPC_ENDPOINTS_JSON.",
      updatedBy: by,
    });
    order += 10;
  }
  await settle();
  });
}

export async function saveRpcEndpointAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const by = await actor();
  const id = String(formData.get("id") ?? "").trim().toLowerCase();
  const url = String(formData.get("url") ?? "").trim();
  const existingUrl = String(formData.get("existingUrl") ?? "").trim();

  if (!ID.test(id)) throw new Error("id must be lowercase letters, digits and dashes.");
  // An edit form never renders the secret, so a blank url on an EXISTING row
  // means "unchanged", not "clear it". Only a create demands one.
  const finalUrl = assertRpcUrl(url || existingUrl);

  await upsertRpcEndpoint({
    id,
    url: finalUrl,
    enabled: formData.get("enabled") !== null,
    sortOrder: optionalInt(formData, "sortOrder") ?? 100,
    maxCuPerSecond: optionalInt(formData, "maxCuPerSecond"),
    maxRequestsPerSecond: optionalInt(formData, "maxRequestsPerSecond"),
    maxConcurrentRequests: optionalInt(formData, "maxConcurrentRequests"),
    preferMethods: methodList(formData, "preferMethods"),
    maxLogSpan: optionalInt(formData, "maxLogSpan"),
    denyMethods: methodList(formData, "denyMethods"),
    allowMethods: methodList(formData, "allowMethods"),
    note: String(formData.get("note") ?? "").trim() || null,
    updatedBy: by,
    pool: formData.get("pool") === "swap" ? "swap" : "shared",
  });
  await settle();
  });
}

/** Swap rows cannot serve scans, so only a shared row keeps the pool off the env seed. */
async function assertSharedStaysOn(id: string): Promise<void> {
  const rows = await readRpcEndpoints();
  if (rows.find((r) => r.id === id)?.pool === "swap") return;
  if (rows.filter((r) => r.enabled && r.pool === "shared" && r.id !== id).length === 0) {
    throw new Error(
      "That is the last enabled shared endpoint. Add or enable another first. An empty pool falls back to the env seed, which would turn this one straight back on.",
    );
  }
}

/**
 * The kill switch. Refuses to switch off the LAST enabled endpoint: with zero
 * usable rows the pool falls back to `RPC_ENDPOINTS_JSON`, which would
 * silently re-enable the very provider just disabled. Better to refuse the
 * write than to accept it and not honour it.
 */
export async function toggleRpcEndpointAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const by = await actor();
  const id = String(formData.get("id") ?? "").trim();
  const enable = String(formData.get("enable") ?? "") === "true";
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!enable) await assertSharedStaysOn(id);

  await setRpcEndpointEnabled(id, enable, by, note);
  await settle();
  });
}

export async function deleteRpcEndpointAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await actor();
  const id = String(formData.get("id") ?? "").trim();
  await assertSharedStaysOn(id);
  await deleteRpcEndpoint(id);
  await settle();
  });
}
