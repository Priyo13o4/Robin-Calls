import { AdminHeading } from "../../components/AdminShell";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import {
  CUSTODY_THRESHOLD_DEFAULTS,
  CUSTODY_THRESHOLD_KEYS,
  UNREAD_SURFACE_WEIGHT_KEY,
} from "@/lib/config/custody-thresholds";
import { TOTAL_WEIGHT, UNREAD_SURFACE_WEIGHT_DEFAULT } from "@/lib/config/formula";
import { dexEnablementKey } from "@/lib/config/dex-enablement";
import { dexes } from "@/lib/config/dex-registry";
import { updateSiteConfigAction } from "./actions";
import { ActionForm } from "@/app/admin/components/ActionForm";

export const dynamic = "force-dynamic";

const DEFAULTS: Record<string, string> = {
  x_profile_url: "https://x.com/RobinCalls",
  x_pinned_post_url: "https://x.com/RobinCalls",
};

const FIELDS = [
  {
    key: "x_profile_url",
    label: "X profile URL",
    hint: "The @handle link opened by “Connect & Follow”.",
    placeholder: "https://x.com/RobinCalls",
    type: "url",
  },
  {
    key: "x_pinned_post_url",
    label: "X pinned-post URL",
    hint: "The specific post opened by “Engage with pinned post”. Change this whenever the pinned/featured post changes — no deploy needed.",
    placeholder: "https://x.com/RobinCalls/status/…",
    type: "url",
  },
] as const;

const THRESHOLD_FIELDS = [
  {
    key: CUSTODY_THRESHOLD_KEYS.deployerMaterialPct,
    label: "Deployer material share",
    hint: "A deployer's PULLABLE share at which the pool counts as theirs. 0.05 = 5%.",
  },
  {
    key: CUSTODY_THRESHOLD_KEYS.pullerMaterialPct,
    label: "Holder material share",
    hint: "Same line for a non-deployer holder. §15.10 holds both to one standard.",
  },
  {
    key: CUSTODY_THRESHOLD_KEYS.protectedHeadlinePct,
    label: "Protected headline share",
    hint: "Burned/locked share at which BURNED or LOCKED becomes the headline, among pools where nothing material is pullable. Tested after both danger rungs, so it names a safe pool — it cannot clear one.",
  },
  {
    key: CUSTODY_THRESHOLD_KEYS.coverageMinPct,
    label: "Coverage minimum",
    hint: "Attribution below which an all-clear is not earned and custody returns UNKNOWN.",
  },
] as const;

/**
 * NOT a member of THRESHOLD_FIELDS, and that is the whole point.
 *
 * Every field in that array renders `min=0.001 max=1 step=0.001` because they
 * are all SHARES. This one is a POINTS weight whose default is 10, so being
 * listed there gave it max=1 — the browser then refused to submit the form at
 * all, and the only way to save an unrelated field (the sale address) was to
 * type 1 here, which silently tells the scanner to cap a verdict the moment a
 * single point of surface goes unread. A units mismatch in a shared control,
 * paid for by a formula input.
 */
const UNREAD_SURFACE_FIELD = {
  key: UNREAD_SURFACE_WEIGHT_KEY,
  label: "Unread surface cap (points)",
  hint: `How many points of scoring surface must go unread before the score is capped at 84 (top of CAUTION). Counts only checks that could not get their data — a check that stood down because the token has no such subject does not count. Whole points between 1 and ${TOTAL_WEIGHT}; default ${UNREAD_SURFACE_WEIGHT_DEFAULT}, so any one of lp_custody (18), holder_concentration (10), ownership (10) or liquidity_depth (10) is enough on its own.`,
} as const;

export default async function SettingsPage() {
  const venues = dexes();
  const loaded = await readSiteConfigKeys([
    "x_profile_url",
    "x_pinned_post_url",
    ...Object.values(CUSTODY_THRESHOLD_KEYS),
    UNREAD_SURFACE_WEIGHT_KEY,
    ...venues.map((d) => dexEnablementKey(d.id)),
  ]);
  const values: Record<string, string> = { ...DEFAULTS, ...loaded };
  const thresholdValues: Record<string, string> = {
    [CUSTODY_THRESHOLD_KEYS.deployerMaterialPct]: String(CUSTODY_THRESHOLD_DEFAULTS.deployerMaterialPct),
    [CUSTODY_THRESHOLD_KEYS.pullerMaterialPct]: String(CUSTODY_THRESHOLD_DEFAULTS.pullerMaterialPct),
    [CUSTODY_THRESHOLD_KEYS.protectedHeadlinePct]: String(CUSTODY_THRESHOLD_DEFAULTS.protectedHeadlinePct),
    [CUSTODY_THRESHOLD_KEYS.coverageMinPct]: String(CUSTODY_THRESHOLD_DEFAULTS.coverageMinPct),
    [UNREAD_SURFACE_WEIGHT_KEY]: String(UNREAD_SURFACE_WEIGHT_DEFAULT),
    ...loaded,
  };


  return (
    <>
      <AdminHeading
        title="Settings · Site Config"
        sub="Values the whitelist flow reads at runtime. Editable here so links can change without a code deploy."
      />

      <ActionForm
        action={updateSiteConfigAction}
        title="Site config"
        className="flex max-w-2xl flex-col gap-6 border border-[#2a2a2a] bg-[#141414] p-6"
      >
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1.5">
            <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
              {f.label.toUpperCase()}
            </span>
            <span className="text-xs text-[#8a8a8a]">{f.hint}</span>
            <input
              name={f.key}
              type={f.type}
              defaultValue={values[f.key]}
              placeholder={f.placeholder}
              className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
            />
          </label>
        ))}

        <div className="border-t border-[#2a2a2a] pt-6">
          <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
            LP CUSTODY THRESHOLDS
          </span>
          <p className="mt-1.5 text-xs text-[#8a8a8a]">
            Formula inputs: changing one moves published scores without a score-version
            change. Every scan records the values it used on the custody evidence
            (<code>effectiveThresholds</code>), so a receipt diff still explains itself.
            Shares are fractions between 0 and 1.
          </p>
        </div>

        {THRESHOLD_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1.5">
            <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
              {f.label.toUpperCase()}
            </span>
            <span className="text-xs text-[#8a8a8a]">{f.hint}</span>
            <input
              name={f.key}
              type="number"
              step="0.001"
              min="0.001"
              max="1"
              defaultValue={thresholdValues[f.key]}
              className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
            />
          </label>
        ))}

        {/* Bounds mirror the server action's own branch (1..TOTAL_WEIGHT), and
            max is DERIVED, never typed: re-weighting a check moves the real
            ceiling, and a hardcoded one here would start rejecting legal
            values with no way to tell why from the browser. */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
            {UNREAD_SURFACE_FIELD.label.toUpperCase()}
          </span>
          <span className="text-xs text-[#8a8a8a]">{UNREAD_SURFACE_FIELD.hint}</span>
          <input
            name={UNREAD_SURFACE_FIELD.key}
            type="number"
            step="1"
            min="1"
            max={TOTAL_WEIGHT}
            defaultValue={thresholdValues[UNREAD_SURFACE_FIELD.key]}
            className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
          />
        </label>

        <div className="border-t border-[#2a2a2a] pt-6">
          <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
            DEX VENUES
          </span>
          <p className="mt-1.5 text-xs text-[#8a8a8a]">
            Which venues discovery searches. Switching one off hides every pool on
            it, so the pools that remain become the whole denominator — a scan that
            searched less says so (<code>venuesDisabled</code>), and its pool set is
            no longer reported as complete. A venue with no configured factory is
            inert whatever this says.
          </p>
        </div>

        <input type="hidden" name="dex_enablement_present" value="1" />

        {venues.map((d) => {
          const key = dexEnablementKey(d.id);
          const stored = loaded[key];
          return (
            <label key={d.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                name={key}
                defaultChecked={stored === undefined ? d.enabled : stored === "true"}
                className="mt-0.5 h-4 w-4 accent-[#ccff00]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
                  {d.name.toUpperCase()}
                </span>
                <span className="text-xs text-[#8a8a8a]">
                  {[d.v2 && "V2", d.v3 && "V3", d.v4 && "V4"].filter(Boolean).join(" · ") ||
                    "no factory configured"}
                  {stored === undefined && " · following the cold-start default"}
                  {d.id === "uniswap" &&
                    " · holds every V4 pool on this chain — turning it off blinds custody"}
                </span>
              </span>
            </label>
          );
        })}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="border-2 border-[#ccff00] bg-[#ccff00] px-6 py-2.5 text-[11px] font-bold tracking-[0.18em] text-[#0a0a0a] transition-opacity hover:opacity-90"
          >
            SAVE
          </button>
          <span className="text-xs text-[#8a8a8a]">
            Blank fields are left unchanged.
          </span>
        </div>
      </ActionForm>
    </>
  );
}
