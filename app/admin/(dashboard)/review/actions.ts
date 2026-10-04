"use server";

import { toResult, type ActionResult } from "@/lib/admin/action-result";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import {
  resolveUncertaintyRecord,
  trustLockerAndResolveUncertainty,
} from "@/lib/data/observability";

/**
 * Review queue for scan uncertainties (scan_uncertainties table): every place
 * a scan was indefinite, waiting for a human verdict. Resolving a row records
 * who and why; the "trust as locker" shortcut closes the loop for the
 * contract-custodian case by promoting the subject straight into
 * trusted_lockers (BULL's StoxesFun locker is exactly this path).
 */

async function actor(): Promise<string> {
  const session = await requireAdmin();
  return (
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin"
  );
}

export async function resolveUncertaintyAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const by = await actor();
  const id = Number(formData.get("id"));
  const resolution = String(formData.get("resolution") ?? "").trim();
  if (!Number.isFinite(id)) throw new Error("Missing row id.");
  if (resolution.length < 4) throw new Error("A short resolution note is required.");

  await resolveUncertaintyRecord(id, resolution, by);
  revalidatePath("/admin/review");
  });
}

/**
 * Verify-and-trust shortcut: the subject of a contract-custodian-unclassified
 * row becomes a trusted locker, and the row is resolved in the same stroke.
 * The label/kind come from the admin — the human verification IS the point.
 */
export async function trustAsLockerAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const by = await actor();
  const id = Number(formData.get("id"));
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const label = String(formData.get("label") ?? "").trim();
  const kind = String(formData.get("kind") ?? "timelock");
  if (!Number.isFinite(id)) throw new Error("Missing row id.");
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Not a valid 0x address.");
  if (label.length < 3) throw new Error("A label is required.");
  if (kind !== "permanent" && kind !== "timelock") throw new Error("Bad kind.");

  await trustLockerAndResolveUncertainty({
    id,
    address,
    label,
    kind,
    by,
  });

  revalidatePath("/admin/review");
  revalidatePath("/admin/lockers");
  });
}
