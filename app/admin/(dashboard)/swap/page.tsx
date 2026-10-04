import Link from "next/link";
import { AdminHeading } from "../../components/AdminShell";
import { ActionForm } from "@/app/admin/components/ActionForm";
import {
  refreshSwapConfig,
  SWAP_CONFIG_KEYS,
  type SwapFeatureName,
  type FeatureState,
} from "@/lib/swap/config";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import { updateSwapConfigAction } from "./actions";

export const dynamic = "force-dynamic";

interface FeatureDescriptor {
  name: SwapFeatureName;
  label: string;
  hint: string;
  /**
   * Set when the switch resolves correctly and NOTHING reads the result, so the
   * control cannot be offered as if it did anything (§8 #10, with a UI on it).
   * Remove this the day a consumer exists; the test below fails until you do.
   */
  dormant?: string;
}

const FEATURES: readonly FeatureDescriptor[] = [
  {
    name: "execution",
    label: "Execution",
    hint: "Plain swaps through each DEX's own router.",
  },
  {
    name: "equityBasis",
    label: "Equity premium display",
    hint: "Display equity basis and premium.",
  },
  {
    name: "v4",
    label: "Uniswap V4 pools",
    hint: "Route through Uniswap V4 pools.",
  },
  {
    name: "venueUniswap",
    label: "Uniswap venue",
    hint: "Route through Uniswap routers.",
  },
  {
    name: "venuePancake",
    label: "Pancake venue",
    hint: "Route through PancakeSwap routers.",
  },
  {
    name: "venueSushi",
    label: "Sushi venue",
    hint: "Route through SushiSwap routers.",
  },
  {
    name: "multihop",
    label: "P1a two-hop V2/V3 routes",
    hint: "Allow same-family V2/V3 routes through the configured bridge tokens. Requires swap trading enabled in the environment and swap execution enabled here.",
  },
  {
    name: "routeGraph",
    label: "Pool graph routes (1 to 3 pools)",
    hint: "Add routes of up to three Uniswap or Pancake pools from the pool graph, through ETH, USDG or verified stock tokens only. Each is tested on chain like any other route. Needs the pool graph loaded.",
  },
] as const;

function renderFeatureStatus(state: FeatureState): string {
  if (state.on) {
    return "On";
  }
  if (state.reason === "config-unavailable") {
    return "Settings could not be read";
  }
  if (state.reason === "admin-off") {
    return "Off here";
  }
  if (state.reason === "requires-off") {
    if (state.detail.includes("ENABLE_SWAP_TRADING")) {
      return "Off in the environment: ENABLE_SWAP_TRADING";
    }
    return "Waiting on: Execution";
  }
  if (state.reason === "env-off") {
    if (state.detail.includes("ENABLE_SWAP_TRADING")) {
      return "Off in the environment: ENABLE_SWAP_TRADING";
    }
    const match = state.detail.match(/ENABLE_[A-Z_]+/);
    if (match) {
      return `Off in the environment: ${match[0]}`;
    }
    return `Off in the environment: ${state.detail}`;
  }
  return "Off";
}

export default async function SwapAdminPage() {
  const config = await refreshSwapConfig();
  const rawRows = await readSiteConfigKeys(Object.values(SWAP_CONFIG_KEYS));

  const recipientValue = rawRows[SWAP_CONFIG_KEYS.feeRecipient] ?? "";
  const bpsValue =
    rawRows[SWAP_CONFIG_KEYS.feeBps] ??
    (config.fee.kind === "set" ? String(config.fee.bps) : "100");

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 max-w-2xl">
        <AdminHeading
          title="Swap Router · Settings"
          sub="Cross-DEX execution switches, routing venues, and fee configuration."
        />
        <Link
          href="/admin/swap/logs"
          className="inline-flex items-center gap-1.5 border border-[#2a2a2a] bg-[#141414] px-3.5 py-2 font-mono text-xs text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]"
        >
          VIEW SWAP LOGS →
        </Link>
      </div>

      {config.fee.kind !== "set" && (
        <div className="mb-6 max-w-2xl border border-[#8a3a30] bg-[#1a1212] p-4 text-xs font-mono text-[#d08a8a]">
          Swaps cannot quote:{" "}
          {config.fee.kind === "unavailable"
            ? "Settings could not be read."
            : config.fee.detail}
        </div>
      )}

      <ActionForm
        action={updateSwapConfigAction}
        title="Swap router settings"
        className="flex max-w-2xl flex-col gap-6 border border-[#2a2a2a] bg-[#141414] p-6"
      >
        <div>
          <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
            FEATURE SWITCHES
          </span>
          <p className="mt-1.5 text-xs text-[#8a8a8a]">
            Runtime controls for the swap router. Features light up only when both
            their environment variable and admin switch are enabled.
          </p>
        </div>

        <input type="hidden" name="swap_features_present" value="1" />

        <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-3 text-xs text-[#8a8a8a]">
          <span className="font-mono text-[#ededea]">DIRECT WALLET ROUTING ONLY</span>
          <p className="mt-1">
            Gasless relays are permanently disabled. Every swap is sent by the connected wallet to a verified venue router.
          </p>
        </div>

        {FEATURES.map((f) => {
          const key = SWAP_CONFIG_KEYS[f.name];
          const featureState = config.features[f.name];
          const isChecked = rawRows[key] === "true";

          return (
            <label key={f.name} className="flex items-start gap-3">
              {/* A dormant switch is disabled, and its stored row is carried through
                  unchanged so opening this page cannot quietly rewrite it. */}
              <input
                type="checkbox"
                name={f.dormant ? undefined : key}
                defaultChecked={isChecked}
                disabled={Boolean(f.dormant)}
                className="mt-0.5 h-4 w-4 accent-[#ccff00] disabled:opacity-40"
              />
              {f.dormant && <input type="hidden" name={key} value={isChecked ? "true" : "false"} />}
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="flex items-center justify-between">
                  <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
                    {f.label.toUpperCase()}
                  </span>
                  <span
                    className={`font-mono text-xs ${
                      featureState.on && !f.dormant ? "text-[#ccff00]" : "text-[#8a8a8a]"
                    }`}
                  >
                    {f.dormant ? "Not wired up" : renderFeatureStatus(featureState)}
                  </span>
                </span>
                <span className="text-xs text-[#8a8a8a]">{f.dormant ?? f.hint}</span>
              </span>
            </label>
          );
        })}

        <div className="border-t border-[#2a2a2a] pt-6">
          <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
            FEE
          </span>
          <p className="mt-1.5 text-xs text-[#8a8a8a]">
            Configures the recipient address and fee basis points collected on each swap.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
            RECIPIENT ADDRESS
          </span>
          <span className="text-xs text-[#8a8a8a]">
            Every swap refuses to quote until this is a real wallet you control. Never a router or token address.
          </span>
          <input
            name={SWAP_CONFIG_KEYS.feeRecipient}
            type="text"
            placeholder="0x…"
            defaultValue={recipientValue}
            className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
          />
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="clear_fee_recipient"
            className="mt-0.5 h-4 w-4 accent-[#ccff00]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
              CLEAR RECIPIENT
            </span>
            <span className="text-xs text-[#8a8a8a]">
              Clear current recipient to disable quotes.
            </span>
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] tracking-[0.16em] text-[#ededea]">
            FEE BASIS POINTS (BPS)
          </span>
          <span className="text-xs text-[#8a8a8a]">
            100 = 1%. 1% is also the ceiling several routers enforce.
          </span>
          <input
            name={SWAP_CONFIG_KEYS.feeBps}
            type="number"
            min="0"
            max="100"
            step="1"
            defaultValue={bpsValue}
            className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
          />
        </label>

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
