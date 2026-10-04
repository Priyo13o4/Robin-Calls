"use server";

import { revalidatePath } from "next/cache";
import { toResult, type ActionResult } from "@/lib/admin/action-result";
import { requireAdmin } from "@/lib/auth/guard";
import { upsertSiteConfigKeys } from "@/lib/data/site-config";
import { CUSTODY_THRESHOLD_KEYS, UNREAD_SURFACE_WEIGHT_KEY } from "@/lib/config/custody-thresholds";
import { TOTAL_WEIGHT } from "@/lib/config/formula";
import { dexEnablementKey } from "@/lib/config/dex-enablement";
import { dexes } from "@/lib/config/dex-registry";

/** URL keys an admin may edit from the Settings page. */
const EDITABLE_KEYS = ["x_profile_url", "x_pinned_post_url"] as const;

/**
 * Custody thresholds are formula inputs, so a change here moves published
 * scores with no FORMULA_VERSION to explain it. That is only acceptable because
 * every custody evidence bundle records the values it used
 * (`effectiveThresholds`) — keep that invariant if you add a dial here.
 */
const SHARE_KEYS = Object.values(CUSTODY_THRESHOLD_KEYS);

const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/** Upsert the whitelisted site_config keys the Settings form submits. */
export async function updateSiteConfigAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  const session = await requireAdmin();

  const actor =
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin";

  const rows: { key: string; value: string; updatedBy: string }[] = [];
  for (const key of EDITABLE_KEYS) {
    const value = String(formData.get(key) ?? "").trim();
    if (!value) continue; // skip blank fields — don't wipe an existing value
    if (!isHttpUrl(value)) throw new Error(`"${key}" must be a valid http(s) URL.`);
    rows.push({ key, value, updatedBy: actor });
  }
  for (const key of SHARE_KEYS) {
    const value = String(formData.get(key) ?? "").trim();
    if (!value) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 1) {
      throw new Error(`"${key}" must be a share greater than 0 and at most 1.`);
    }
    rows.push({ key, value, updatedBy: actor });
  }

  // A WEIGHT, not a share, so it gets its own branch rather than joining
  // SHARE_KEYS — the (0,1] validator above would reject every legal value.
  // Bounds mirror parseWeightThreshold: 0 would cap every scan, and anything
  // over the total weighted surface could never fire, and a cap that cannot
  // fire is indistinguishable from one that is working.
  {
    const value = String(formData.get(UNREAD_SURFACE_WEIGHT_KEY) ?? "").trim();
    if (value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > TOTAL_WEIGHT) {
        throw new Error(`"${UNREAD_SURFACE_WEIGHT_KEY}" must be between 1 and ${TOTAL_WEIGHT} points.`);
      }
      rows.push({ key: UNREAD_SURFACE_WEIGHT_KEY, value, updatedBy: actor });
    }
  }

  // Checkboxes submit nothing when unchecked, so every DEX is written on every
  // save — reading only what was posted would make "off" indistinguishable from
  // "not on this form" and could never turn a venue back off. The marker is
  // what separates those two: without it, a form that simply does not render
  // this section would switch every venue off and shrink discovery silently.
  if (formData.get("dex_enablement_present") === "1") {
    for (const dex of dexes()) {
      const key = dexEnablementKey(dex.id);
      rows.push({
        key,
        value: String(formData.get(key) === "on"),
        updatedBy: actor,
      });
    }
  }

  if (rows.length === 0) throw new Error("Every field was blank, so there was nothing to save.");

  await upsertSiteConfigKeys(rows);

  revalidatePath("/admin/settings");
  // Naming the count is the difference between "it worked" and knowing WHICH
  // save worked, on a form where blank fields are deliberately skipped.
  return `Saved ${rows.length} ${rows.length === 1 ? "setting" : "settings"}.`;
  });
}
