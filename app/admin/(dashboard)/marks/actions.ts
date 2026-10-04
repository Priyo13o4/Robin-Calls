"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import { liftMark } from "@/lib/scanner/record";
import { toResult, type ActionResult } from "@/lib/admin/action-result";

/**
 * Admin pardon: lift a honeypot mark. The reason is mandatory and becomes a
 * public note on the token's Record — this is the audited escape hatch for
 * genuine false positives (tokens scanned pre-enableTrading, later verified).
 */
export async function liftMarkAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const session = await requireAdmin();
  const token = String(formData.get("token") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!token) throw new Error("Missing token address.");
  if (reason.length < 8) throw new Error("A substantive reason is required to lift a mark.");

  const actor =
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin";
  await liftMark(token, reason, actor);
  revalidatePath("/admin/marks");
  revalidatePath(`/scan/${token}`);
  });
}
