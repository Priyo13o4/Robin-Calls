"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import { clearTrustedAddressCache, primeTrustedAddresses } from "@/lib/config/trusted-addresses";
import {
  upsertRegistryRwaRecord,
  upsertTrustedAddressRecord,
  toggleTrustedAddressRecord,
} from "@/lib/data/admin-trust";
import { rpc } from "@/lib/rpc/client";
import { verifyRwaToken, verifyTrustedAddress, type TrustCategory } from "@/lib/verify/trusted-address";
import { toResult, type ActionResult } from "@/lib/admin/action-result";

const CATEGORIES: readonly TrustCategory[] = [
  "dex-factory", "dex-router", "dex-quoter", "dex-position-manager", "dex-pool-manager", "dex-state-view", "permit2", "lp-locker", "burn-address", "infra-asset", "rwa-beacon", "rwa-impl", "rwa-factory", "rwa-vault", "rwa-operator", "bridge-system-owner",
  "trusted-proxy",
];
const ADDRESS = /^0x[0-9a-f]{40}$/;
type FormState = { ok?: boolean; message?: string; evidence?: Record<string, unknown> };

async function actor(): Promise<string> {
  const session = await requireAdmin();
  const user = session.user as { username?: string; email?: string };
  return user.username ?? user.email ?? "admin";
}

export async function saveTrustedAddressAction(_: FormState, formData: FormData): Promise<FormState> {
  const created_by = await actor();
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const category = String(formData.get("category") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const subtype = String(formData.get("subtype") ?? "").trim() || null;
  const dex_id = String(formData.get("dex_id") ?? "").trim().toLowerCase() || null;
  const override = formData.get("override") === "on";
  if (!ADDRESS.test(address)) return { message: "Enter a valid lowercase 0x address." };
  if (label.length < 2) return { message: "A label is required." };

  if (category === "rwa-token") {
    const probe = await verifyRwaToken(rpc(), address);
    if (!probe.ok) return { message: probe.reason, evidence: probe.evidence };
    const assetCategory = formData.get("asset_category") === "etf" ? "etf" : "stock-token";
    const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
    if (!symbol) return { message: "A verified RWA still needs its ticker entered before saving.", evidence: probe.evidence };
    await upsertRegistryRwaRecord({
      address,
      assetName: label,
      assetSymbol: symbol,
      category: assetCategory,
      verifyStatus: "ok",
    });
    clearTrustedAddressCache();
    await primeTrustedAddresses(true);
    revalidatePath("/admin/trusted"); revalidatePath("/rwa");
    return { ok: true, message: "Verified RWA saved.", evidence: probe.evidence };
  }
  if (!CATEGORIES.includes(category as TrustCategory)) return { message: "Choose a valid category." };
  let metadata: Record<string, unknown> = {};
  const metadataText = String(formData.get("metadata") ?? "").trim();
  if (metadataText) {
    try { metadata = JSON.parse(metadataText); } catch { return { message: "Metadata must be valid JSON." }; }
  }
  const probe = await verifyTrustedAddress(rpc(), category as TrustCategory, address);
  if (probe.status === "failed" && !override) return { message: `${probe.reason} Tick override only after independent review.`, evidence: probe.evidence };
  if (probe.status === "unprobeable" && !override) return { message: `${probe.reason} Tick override to save this advisory result.`, evidence: probe.evidence };
  // KNOWN-PROBLEMS L66 — persist what the probe MEASURED, not just what the
  // admin typed. `verifyTrustedAddress` computes `keccak256(getCode(addr))` for
  // an lp-locker and this action returned it to the screen and dropped it, so
  // 6 of 8 locker rows in prod carry `verify_status = 'ok'` and no codehash:
  // an all-clear that cannot say WHICH bytecode earned it, and therefore cannot
  // notice the day it changes (L65). Same shape as L70 — a value computed live
  // on every call and never written down.
  //
  // The measurement wins over the typed field on purpose: a hand-entered
  // codehash is exactly the unverified assertion this closes.
  const measured =
    probe.evidence && typeof probe.evidence === "object"
      ? (probe.evidence as Record<string, unknown>)
      : {};
  if (typeof measured.codehash === "string") {
    metadata = { ...metadata, codehash: measured.codehash, codehashVerifiedAt: new Date().toISOString() };
  }
  await upsertTrustedAddressRecord({
    address,
    chainId: 4663,
    category,
    subtype,
    label,
    dexId: dex_id,
    metadata,
    enabled: true,
    verifyStatus: probe.status,
    verifiedAt: probe.status === "ok" ? new Date().toISOString() : null,
    createdBy: created_by,
  });
  clearTrustedAddressCache();
  await primeTrustedAddresses(true);
  revalidatePath("/admin/trusted"); revalidatePath("/rwa");
  return { ok: true, message: `Saved (${probe.status}).`, evidence: probe.evidence };
}

export async function toggleTrustedAddressAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await actor();
  const address = String(formData.get("address") ?? "").toLowerCase();
  const enabled = formData.get("enabled") === "true";
  await toggleTrustedAddressRecord(address, enabled, 4663);
  clearTrustedAddressCache(); await primeTrustedAddresses(true);
  revalidatePath("/admin/trusted"); revalidatePath("/rwa");
  });
}

export async function refreshTrustedAddressesAction(): Promise<ActionResult> {
  return toResult(async () => {
  await actor(); clearTrustedAddressCache(); await primeTrustedAddresses(true);
  revalidatePath("/admin/trusted"); revalidatePath("/rwa");
  });
}
