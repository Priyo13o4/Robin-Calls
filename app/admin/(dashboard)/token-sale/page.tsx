import { AdminHeading } from "../../components/AdminShell";
import { resolveSaleAddress } from "@/lib/sale/address";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import { REFERRAL_MIN_WALLETS_KEY, REFERRAL_MIN_WEI_KEY } from "@/lib/referrals/config";
import { DEFAULT_REFERRAL_RULES } from "@/lib/referrals/rules";
import { readSaleSchedule } from "@/lib/sale/schedule";
import { SaleScheduleCard } from "./SaleScheduleCard";
import { TokenSalePanel } from "./TokenSalePanel";

export const dynamic = "force-dynamic";

/**
 * Test cockpit for the TokenSale contract (manual deploy; this page is the
 * UI). Lives under (dashboard) so requireAdmin already guards it — it is a
 * testing surface for now, not the public sale page.
 */
export default async function TokenSalePage() {
  const [resolved, schedule] = await Promise.all([resolveSaleAddress(), readSaleSchedule()]);
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const referralConfig = await readSiteConfigKeys([
    REFERRAL_MIN_WALLETS_KEY,
    REFERRAL_MIN_WEI_KEY,
  ]);
  const initialReferralRules = {
    minReferredWallets:
      referralConfig[REFERRAL_MIN_WALLETS_KEY] ?? String(DEFAULT_REFERRAL_RULES.minReferredWallets),
    minReferredWei:
      referralConfig[REFERRAL_MIN_WEI_KEY] ?? DEFAULT_REFERRAL_RULES.minReferredWei.toString(),
  };

  return (
    <>
      <AdminHeading
        title="Token Sale"
        sub="Drive a manually-deployed TokenSale contract: contribute, claim, and walk the owner lifecycle."
      />
      {resolved.kind === "unavailable" && (
        <p className="mb-4 border border-[#8a6d1f] bg-[#1c1a14] px-4 py-3 text-sm text-[#d9c96a]">
          Could not reach the database to read the configured sale address
          (site_config key <code>token_sale_address</code>) — the box below is
          empty because we could not look, not because nothing is set.
        </p>
      )}
      {/* A confirmed-empty read, not a failed one. Distinct from "unavailable"
          above because the remedy differs: publish an address vs. fix the DB. */}
      {resolved.kind === "unconfigured" && (
        <p className="mb-4 border border-[#2a2a2a] bg-[#141414] px-4 py-3 text-sm text-[#a0a09a]">
          No sale address is published yet, so the public sale page has none. Paste a deployed
          contract below to drive it here, then press PUBLISH to make it the live one.
        </p>
      )}
      <SaleScheduleCard
        startsAt={schedule.kind === "read" ? iso(schedule.startsAt) : null}
        endsAt={schedule.kind === "read" ? iso(schedule.endsAt) : null}
        unavailable={schedule.kind === "unavailable"}
      />
      <TokenSalePanel
        defaultAddress={resolved.kind === "address" ? resolved.address : ""}
        defaultChainId={resolved.kind === "address" ? resolved.chainId : undefined}
        initialReferralRules={initialReferralRules}
      />
    </>
  );
}
