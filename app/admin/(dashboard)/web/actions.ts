"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import { upsertHubRecord, liftStainRecord } from "@/lib/data/lineage";
import { toResult, type ActionResult } from "@/lib/admin/action-result";

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

/** Manually register a propagation-breaker hub (CEX / faucet / bridge). */
export async function addHubAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await requireAdmin();
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const label = String(formData.get("label") ?? "").trim() || null;
  if (!isAddress(address)) throw new Error("Not a valid address.");

  await upsertHubRecord(address, label, "manual");
  revalidatePath("/admin/web");
  revalidatePath("/wanted");
  });
}

/** Lift a stain (false-positive pardon), mirroring the mark pardon flow. */
export async function liftStainAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const session = await requireAdmin();
  const address = String(formData.get("address") ?? "").trim().toLowerCase();
  const origin = String(formData.get("origin") ?? "").trim().toLowerCase();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isAddress(address)) throw new Error("Not a valid address.");
  if (reason.length < 8) throw new Error("A substantive reason is required.");

  const actor =
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin";

  await liftStainRecord(address, origin, reason, actor);
  revalidatePath("/admin/web");
  });
}
