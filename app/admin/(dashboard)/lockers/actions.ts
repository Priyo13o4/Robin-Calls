"use server";

import { toResult, type ActionResult } from "@/lib/admin/action-result";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import {
  upsertTrustedLockerRecord,
  upsertTrustedAddressRecord,
  toggleTrustedLockerRecord,
  toggleTrustedAddressRecord,
  deleteTrustedLockerRecord,
} from "@/lib/data/admin-trust";

/**
 * Trusted-locker registry (trusted_lockers table). An address here is exempt
 * from the LP-whale scan and scores the pool LOCKED, so adding one is a
 * scoring decision: verify the contract first (verified source, no
 * transfer/withdraw/decreaseLiquidity path for a permanent locker; a real
 * unlock schedule for a time-lock). The scanner picks changes up within a
 * minute (lib/config/lockers.ts TTL) — no deploy.
 */

const ADDR = /^0x[0-9a-f]{40}$/;

async function actor(): Promise<string> {
  const session = await requireAdmin();
  return (
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin"
  );
}

export async function addLockerAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const by = await actor();
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const label = String(formData.get("label") ?? "").trim();
  const kind = String(formData.get("kind") ?? "timelock");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!ADDR.test(address)) throw new Error("Not a valid 0x address.");
  if (label.length < 3) throw new Error("A label is required.");
  if (kind !== "permanent" && kind !== "timelock") throw new Error("Bad kind.");

  await upsertTrustedLockerRecord({
    address,
    label,
    kind,
    notes: notes || null,
    enabled: true,
    addedBy: by,
  });

  await upsertTrustedAddressRecord({
    address,
    chainId: 4663,
    category: "lp-locker",
    subtype: kind,
    label,
    metadata: {},
    enabled: true,
    verifyStatus: "ok",
    verifiedAt: new Date().toISOString(),
    createdBy: by,
  });

  revalidatePath("/admin/lockers");
  });
}

export async function toggleLockerAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await actor();
  const address = String(formData.get("address") ?? "").toLowerCase();
  const enable = String(formData.get("enable")) === "true";

  await toggleTrustedLockerRecord(address, enable);
  await toggleTrustedAddressRecord(address, enable, 4663);

  revalidatePath("/admin/lockers");
  });
}

export async function deleteLockerAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await actor();
  const address = String(formData.get("address") ?? "").toLowerCase();

  await deleteTrustedLockerRecord(address);

  revalidatePath("/admin/lockers");
  });
}
