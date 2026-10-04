"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import { updateDirectoryPlatformStatus, invalidatePublishedPlatformsCache } from "@/lib/data/registry";
import { toResult, type ActionResult } from "@/lib/admin/action-result";

async function setStatus(id: number, status: "published" | "rejected" | "pending") {
  await requireAdmin(); // authoritative check on every mutation
  await updateDirectoryPlatformStatus(id, status);
  invalidatePublishedPlatformsCache(); // revalidatePath busts Next's page cache, not this module-local one
  revalidatePath("/admin/listings");
  revalidatePath("/ecosystem");
}

export async function approveListing(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await setStatus(Number(formData.get("id")), "published");
  });
}
export async function rejectListing(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await setStatus(Number(formData.get("id")), "rejected");
  });
}
export async function unpublishListing(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
  await setStatus(Number(formData.get("id")), "pending");
  });
}
