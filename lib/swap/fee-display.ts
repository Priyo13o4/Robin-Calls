import type { PlanView } from "./types";

export interface FeeLine {
  label: string;
  value: string;
}

/** A displayed tier is a pool parameter, not a promise about every hook charge. */
export function formatPoolFeeTier(feeTier: number | null | undefined): string {
  if (feeTier == null || !Number.isFinite(feeTier) || feeTier < 0) return "rate unavailable";
  // Uniswap V4 reserves this flag for dynamic fees; it is not a numeric rate.
  if (feeTier === 0x800000) return "dynamic rate unavailable";
  return `${(feeTier / 10_000).toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;
}

function formatHookFee(hop: NonNullable<PlanView["route"]>["hops"][number]): string {
  if (hop.hookFeeStatus === "unknown") return "unknown; unavailable";
  if (hop.hookFeeStatus === "dynamic") return "dynamic; rate unavailable";
  if (hop.hookFeeBps != null && Number.isFinite(hop.hookFeeBps) && hop.hookFeeBps >= 0) {
    return `${(hop.hookFeeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  }
  return "rate unavailable";
}

export function selectedPoolFeeSummary(plan: PlanView): FeeLine[] {
  const hops = plan.route?.hops;
  if (hops?.length) {
    return hops.flatMap((hop, index) => {
      const prefix = hops.length > 1 ? `Hop ${index + 1} ` : "";
      const lines: FeeLine[] = [{
        label: `${prefix}${hop.protocol.toUpperCase()} pool fee`,
        value: formatPoolFeeTier(hop.feeTier),
      }];
      if (hop.protocol === "v4" && hop.hookAddress && hop.hookAddress !== "0x0000000000000000000000000000000000000000") {
        lines.push({ label: `${prefix}V4 hook fee`, value: formatHookFee(hop) });
      }
      return lines;
    });
  }

  if (plan.protocol === "aggregator") {
    return [{ label: "Underlying pool fees", value: "not provided by quote" }];
  }
  return [{ label: `${plan.protocol.toUpperCase()} pool fee`, value: formatPoolFeeTier(plan.feeTier) }];
}
