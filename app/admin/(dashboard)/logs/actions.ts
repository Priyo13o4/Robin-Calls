"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import { updateErrorEventStamp } from "@/lib/data/observability";
import { toResult, type ActionResult } from "@/lib/admin/action-result";

/**
 * Acknowledge/resolve transitions for error events (PRD §20.4). Both stamp the
 * acting admin's identity; resolving implies the error was seen, so it also
 * fills a missing acknowledgement.
 */

async function stampErrorEvent(formData: FormData, kind: "acknowledge" | "resolve") {
  const session = await requireAdmin();
  const id = Number.parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Missing error-event id.");

  const actor =
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin";
  const now = new Date().toISOString();
  const patch =
    kind === "acknowledge"
      ? { acknowledged_at: now, acknowledged_by: actor }
      : { acknowledged_at: now, acknowledged_by: actor, resolved_at: now, resolved_by: actor };

  await updateErrorEventStamp(id, patch);
  revalidatePath("/admin/logs");
}


export async function acknowledgeErrorAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await stampErrorEvent(formData, "acknowledge");
  });
}

export async function resolveErrorAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await stampErrorEvent(formData, "resolve");
  });
}
