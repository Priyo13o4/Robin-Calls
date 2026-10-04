"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import { upsertSiteConfigKeys } from "@/lib/data/site-config";
import { isAddressConfigured } from "@/lib/config/chain";
import { KNOWN_SALE_CHAINS } from "@/lib/config/sale-chains";
import { TOKEN_SALE_ADDRESS_KEY, TOKEN_SALE_CHAIN_ID_KEY } from "@/lib/sale/address";
import { TOKEN_SALE_ENDS_AT_KEY, TOKEN_SALE_STARTS_AT_KEY } from "@/lib/sale/schedule";
import { REFERRAL_MIN_WALLETS_KEY, REFERRAL_MIN_WEI_KEY } from "@/lib/referrals/config";
import type { ActionResult } from "@/lib/admin/action-result";

/**
 * Publish the panel's target address to site_config.
 *
 * Its own action rather than the Settings form's: this is the PUBLISH step of
 * the cockpit's deploy -> point -> drive -> publish flow, and routing it
 * through a form that also writes custody thresholds and referral bounds
 * would put unrelated dials one bad submit away from a sale change.
 *
 * `/token-sale` is revalidated too, and that is the point of the whole action:
 * this key is what the PUBLIC page resolves, so saving here changes what
 * visitors see, not just this panel.
 */
export async function saveSaleAddressAction(address: string, chainId?: number): Promise<ActionResult> {
  const session = await requireAdmin();

  const value = address.trim();
  if (!isAddressConfigured(value)) {
    return { ok: false, error: "Not a valid address. Expected 0x followed by 40 hex characters." };
  }

  // An unsupported id is not a smaller version of a supported one: `saleReader`
  // has no client for it and throws, so every server-side read of the sale
  // stops. Refused here rather than written and discovered by the index job.
  if (chainId === undefined || !KNOWN_SALE_CHAINS[chainId]) {
    return {
      ok: false,
      error: "Pick a chain the sale can be read on: Robinhood Chain or Robinhood Chain Testnet.",
    };
  }

  const actor =
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin";

  try {
    // Lowercased at the boundary, always (§10): a mixed-case value with a bad
    // checksum makes every viem readContract throw downstream.
    // The pair is written together, always: an address published without its
    // chain inherits whatever chain the previous sale was on.
    await upsertSiteConfigKeys([
      { key: TOKEN_SALE_ADDRESS_KEY, value: value.toLowerCase(), updatedBy: actor },
      { key: TOKEN_SALE_CHAIN_ID_KEY, value: String(chainId), updatedBy: actor },
    ]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not write the setting." };
  }

  revalidatePath("/admin/token-sale");
  revalidatePath("/admin/settings");
  revalidatePath("/token-sale");
  return { ok: true, message: "The public sale page now points here." };
}

/**
 * Save referral eligibility rules (minReferredWallets, minReferredWei) from the
 * token-sale cockpit.
 */
export async function saveReferralRulesAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const actor =
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin";

  const rows: { key: string; value: string; updatedBy: string }[] = [];
  const walletsRaw = String(formData.get(REFERRAL_MIN_WALLETS_KEY) ?? "").trim();
  if (walletsRaw) {
    if (!/^\d+$/.test(walletsRaw) || BigInt(walletsRaw) < 1n) {
      return { ok: false, error: "Referrer minimum: people must be a whole number of at least 1." };
    }
    rows.push({ key: REFERRAL_MIN_WALLETS_KEY, value: walletsRaw, updatedBy: actor });
  }

  const weiRaw = String(formData.get(REFERRAL_MIN_WEI_KEY) ?? "").trim();
  if (weiRaw) {
    if (!/^\d+$/.test(weiRaw) || BigInt(weiRaw) < 1n) {
      return { ok: false, error: "Referrer minimum: wei brought in must be a whole number greater than 0." };
    }
    rows.push({ key: REFERRAL_MIN_WEI_KEY, value: weiRaw, updatedBy: actor });
  }

  if (rows.length === 0) {
    return { ok: false, error: "Both fields were blank; nothing to save." };
  }

  try {
    await upsertSiteConfigKeys(rows);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save referral rules." };
  }

  revalidatePath("/admin/token-sale");
  return { ok: true, message: "Referral rules updated." };
}

/**
 * The landing countdown's window. Display only (lib/sale/schedule.ts): the
 * contract opens on start(), not on this date. Blank clears a side.
 */
export async function saveSaleScheduleAction(startsAt: string, endsAt: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const actor =
    (session.user as { username?: string; email?: string }).username ??
    session.user.email ??
    "admin";

  const parse = (v: string) => (v.trim() ? Date.parse(v.trim()) : null);
  const start = parse(startsAt);
  const end = parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return { ok: false, error: "Not a valid date and time." };
  if (start === null && end !== null) return { ok: false, error: "Set a start time before an end time." };
  if (start !== null && end !== null && end <= start) return { ok: false, error: "The end must be after the start." };

  try {
    await upsertSiteConfigKeys([
      { key: TOKEN_SALE_STARTS_AT_KEY, value: start === null ? "" : new Date(start).toISOString(), updatedBy: actor },
      { key: TOKEN_SALE_ENDS_AT_KEY, value: end === null ? "" : new Date(end).toISOString(), updatedBy: actor },
    ]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save the schedule." };
  }

  revalidatePath("/admin/token-sale");
  revalidatePath("/");
  return { ok: true, message: "The landing countdown now uses these times." };
}
