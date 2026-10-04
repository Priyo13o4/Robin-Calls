"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import {
  addLaunchpadRecord,
  setLaunchpadEnabledRecord,
  getLaunchpadById,
  updateLaunchpadProbeRecord,
  deleteLaunchpadRecord,
} from "@/lib/data/launchpads";
import { PAD_FAMILIES, detectLaunchpad, probeLaunchpad, type ProbeResult } from "@/lib/launches/probe";
import type { LauncherFamily } from "@/lib/launches/types";
import { toResult, type ActionResult } from "@/lib/admin/action-result";

/**
 * Launchpad registry mutations (docs/prds/launchpad-aggregator-prd.md §5.6).
 * Adding a pad runs the auto-verification probe; a pad only starts enabled
 * when every probe check passes. The probe result is stored on the row so
 * the page can show WHY a pad was left disabled. Picking "auto" for the adapter
 * runs detection — it tries every preset and classifies the pad as a bonding
 * curve or a direct launcher, so the admin never has to know the internals.
 */


function refresh() {
  revalidatePath("/admin/launchpads");
  revalidatePath("/night-market");
}

export async function addLaunchpad(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const curveAddress = String(formData.get("curve_address") ?? "").trim().toLowerCase();
  const adapterField = String(formData.get("adapter") ?? "auto");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const targetOverride = String(formData.get("target_wei_override") ?? "").trim();

  if (!name || !slug) throw new Error("Name and slug are required.");
  if (!/^0x[0-9a-f]{40}$/.test(curveAddress)) throw new Error("Invalid curve address.");
  if (targetOverride && !/^\d+$/.test(targetOverride)) {
    throw new Error("Target override must be a wei integer.");
  }

  const config: Record<string, unknown> = {};
  if (targetOverride) config.targetWeiOverride = targetOverride;

  let family: LauncherFamily;
  let probe: ProbeResult;
  if (adapterField === "auto") {
    const detected = await detectLaunchpad(curveAddress);
    if (!detected.family) {
      const why = detected.probe.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`).join(" · ");
      throw new Error(`Auto-detect could not match this address to a known launcher family. ${why}`);
    }
    family = detected.family;
    probe = detected.probe;
  } else {
    if (!PAD_FAMILIES.includes(adapterField as LauncherFamily)) throw new Error("Unknown launcher family.");
    family = adapterField as LauncherFamily;
    probe = await probeLaunchpad(curveAddress, family, config);
  }
  if (family === "curve-events-v1" && !targetOverride) config.targetParam = "ethA";

  await addLaunchpadRecord({
    slug,
    name,
    address: curveAddress,
    family,
    config,
    notes,
    enabled: probe.ok,
    lastProbe: probe,
  });
  refresh();
  });
}

export async function setLaunchpadEnabled(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const enabled = formData.get("enabled") === "true";
  await setLaunchpadEnabledRecord(id, enabled);
  refresh();
  });
}

export async function reprobeLaunchpad(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await requireAdmin();
  const id = Number(formData.get("id"));

  const pad = await getLaunchpadById(id);
  if (!pad) throw new Error("Launchpad not found.");

  const probe = await probeLaunchpad(pad.address, pad.family);
  await updateLaunchpadProbeRecord(id, probe);
  refresh();
  });
}

/** Refused while the pad has recorded launches: registry rows are never deleted. */
export async function deleteLaunchpad(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await requireAdmin();
  const id = Number(formData.get("id"));
  await deleteLaunchpadRecord(id);
  refresh();
  });
}
