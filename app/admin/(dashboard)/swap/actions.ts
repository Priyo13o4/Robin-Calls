"use server";

import { revalidatePath } from "next/cache";
import { toResult, type ActionResult } from "@/lib/admin/action-result";
import { requireAdmin } from "@/lib/auth/guard";
import { upsertSiteConfigKeys } from "@/lib/data/site-config";
import {
  SWAP_CONFIG_KEYS,
  validateFeeRecipient,
  parseFeeBps,
  refreshSwapConfig,
  type SwapFeatureName,
} from "@/lib/swap/config";

const FEATURE_NAMES: readonly SwapFeatureName[] = [
  "execution",
  "equityBasis",
  "v4",
  "venueUniswap",
  "venuePancake",
  "venueSushi",
  "multihop",
  "routeGraph",
] as const;

export async function updateSwapConfigAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    const session = await requireAdmin();

    const actor =
      (session.user as { username?: string; email?: string }).username ??
      session.user.email ??
      "admin";

    const rows: { key: string; value: string; updatedBy: string }[] = [];

    if (formData.get("swap_features_present") === "1") {
      for (const name of FEATURE_NAMES) {
        const key = SWAP_CONFIG_KEYS[name];
        rows.push({
          key,
          value: String(formData.get(key) === "on"),
          updatedBy: actor,
        });
      }
    }

    const clearRecipient = formData.get("clear_fee_recipient") === "on";
    const rawRecipient = String(formData.get(SWAP_CONFIG_KEYS.feeRecipient) ?? "").trim();

    if (clearRecipient) {
      rows.push({
        key: SWAP_CONFIG_KEYS.feeRecipient,
        value: "",
        updatedBy: actor,
      });
    } else if (rawRecipient) {
      const validation = validateFeeRecipient(rawRecipient);
      if (!validation.ok) {
        throw new Error(validation.detail);
      }
      rows.push({
        key: SWAP_CONFIG_KEYS.feeRecipient,
        value: validation.address,
        updatedBy: actor,
      });
    }

    const rawBps = formData.get(SWAP_CONFIG_KEYS.feeBps);
    if (rawBps !== null && String(rawBps).trim() !== "") {
      const trimmed = String(rawBps).trim();
      const bpsValidation = parseFeeBps(trimmed);
      if (!bpsValidation.ok) {
        throw new Error(bpsValidation.detail);
      }
      rows.push({
        key: SWAP_CONFIG_KEYS.feeBps,
        value: String(bpsValidation.bps),
        updatedBy: actor,
      });
    }

    if (rows.length === 0) {
      throw new Error("Every field was blank, so there was nothing to save.");
    }

    await upsertSiteConfigKeys(rows);
    await refreshSwapConfig();

    revalidatePath("/admin/swap");
    revalidatePath("/trade");

    return `Saved ${rows.length} ${rows.length === 1 ? "setting" : "settings"}.`;
  });
}
