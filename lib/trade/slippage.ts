/**
 * Slippage parsing, validation, and formatting primitives for direct-router swaps.
 *
 * Requirements:
 * - Server validates slippageBps as integer 1..5000 (0.01% to 50.00%).
 * - "auto" is sent as "auto"; the server resolves it per trade (lib/swap/auto-slippage.ts), 0.5% floor.
 *   Its figure is known only from a plan, so the label shows a number only when one exists.
 * - Custom slippage input: 0.01 to 50.00 percent, maximum two decimal places.
 * - Exact conversion to integer bps without float rounding errors (e.g. 0.29% -> 29 bps, not 28).
 * - Reject blank, malformed, exponent, zero, >50%, and >2 decimal places.
 * - customExecute expects percentage number and must receive 0.5 for Auto (not 1.0).
 */

export const MIN_SLIPPAGE_BPS = 1; // 0.01%
export const MAX_SLIPPAGE_BPS = 5000; // 50.00%
export const AUTO_SLIPPAGE_BPS = 50; // 0.50%, the Auto floor
export const AUTO_SLIPPAGE_PERCENT = 0.5;

export const DEFAULT_SLIPPAGE_PRESETS: readonly number[] = [0.5, 1.0, 3.0] as const;

export const AUTO_SLIPPAGE_LABEL = "Auto";

export type SlippageRejectReason =
  | "blank"
  | "malformed"
  | "exponent"
  | "zero"
  | "out_of_range"
  | "precision";

export type ParseSlippageResult =
  | {
      valid: true;
      bps: number;
      percent: number;
      formatted: string;
    }
  | {
      valid: false;
      reason: SlippageRejectReason;
      error: string;
    };

/**
 * Pure parser and validator for custom slippage percentages.
 * Converts decimal percentage string to exact integer bps without float rounding error.
 */
export function parseCustomSlippage(input: unknown): ParseSlippageResult {
  if (input === null || input === undefined) {
    return {
      valid: false,
      reason: "blank",
      error: "Enter a slippage percentage between 0.01% and 50%.",
    };
  }

  let raw: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return {
        valid: false,
        reason: "malformed",
        error: "Enter a valid number between 0.01 and 50.00.",
      };
    }
    raw = input.toString();
  } else if (typeof input === "string") {
    raw = input.trim();
  } else {
    return {
      valid: false,
      reason: "malformed",
      error: "Enter a valid number between 0.01 and 50.00.",
    };
  }

  if (raw === "") {
    return {
      valid: false,
      reason: "blank",
      error: "Enter a slippage percentage between 0.01% and 50%.",
    };
  }

  // Reject exponent notation (e.g. 1e-2, 1e5, 2E1)
  if (/[eE]/.test(raw)) {
    return {
      valid: false,
      reason: "exponent",
      error: "Exponential notation is not supported.",
    };
  }

  // Reject explicit signs (+, -)
  if (/[+-]/.test(raw)) {
    return {
      valid: false,
      reason: "malformed",
      error: "Enter a valid positive percentage.",
    };
  }

  // Must match integer or decimal with at least one digit before and optional digits after '.'
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return {
      valid: false,
      reason: "malformed",
      error: "Enter a valid number between 0.01 and 50.00.",
    };
  }

  const [wholeStr, fracStr = ""] = raw.split(".");

  // Reject more than two decimal places
  if (fracStr.length > 2) {
    return {
      valid: false,
      reason: "precision",
      error: "Slippage can have at most 2 decimal places.",
    };
  }

  // Exact integer bps computation without floating-point math:
  // whole * 100 + frac (normalized to two places: "5" -> 50, "05" -> 5, "50" -> 50)
  const whole = parseInt(wholeStr, 10);
  let frac = 0;
  if (fracStr.length === 1) {
    frac = parseInt(fracStr, 10) * 10;
  } else if (fracStr.length === 2) {
    frac = parseInt(fracStr, 10);
  }

  const bps = whole * 100 + frac;

  // Reject zero
  if (bps === 0) {
    return {
      valid: false,
      reason: "zero",
      error: "Slippage must be at least 0.01%.",
    };
  }

  // Reject greater than 50.00% (5000 bps)
  if (bps > MAX_SLIPPAGE_BPS) {
    return {
      valid: false,
      reason: "out_of_range",
      error: "Slippage cannot exceed 50.00%.",
    };
  }

  const percent = bps / 100;
  const formatted = formatSlippagePercent(bps);

  return {
    valid: true,
    bps,
    percent,
    formatted,
  };
}

/**
 * Formats bps into a clean percentage string.
 */
export function formatSlippagePercent(bps: number): string {
  const percent = bps / 100;
  if (bps % 100 === 0) {
    return `${percent}%`;
  }
  if (bps % 10 === 0) {
    return `${percent.toFixed(1)}%`;
  }
  return `${percent.toFixed(2)}%`;
}

/**
 * Returns display label for currently selected slippage setting.
 */
export function formatSelectedSlippageDisplay(
  slippage: number | "auto",
  isCustom: boolean,
  customInput: string,
  customParsed?: ParseSlippageResult
): string {
  if (!isCustom) {
    if (slippage === "auto") {
      return AUTO_SLIPPAGE_LABEL;
    }
    return `${slippage}%`;
  }
  if (customParsed?.valid) {
    return `${customInput.trim()}%`;
  }
  return "Invalid";
}

/**
 * Returns effective slippageBps to send to plan router or SwapRequest.
 * For "auto", sends "auto" (server resolves to 50 bps).
 * For presets, sends exact integer bps (e.g. 1% -> 100).
 * For valid custom input, sends exact integer bps (1..5000).
 * For invalid/blank custom input, fails closed (returns NaN) and NEVER falls back to "auto".
 */
export function getEffectiveSlippageBps(
  slippage: number | "auto",
  isCustom: boolean,
  customBps?: number
): number | "auto" {
  if (isCustom) {
    if (
      typeof customBps === "number" &&
      Number.isInteger(customBps) &&
      customBps >= MIN_SLIPPAGE_BPS &&
      customBps <= MAX_SLIPPAGE_BPS
    ) {
      return customBps;
    }
    return NaN;
  }
  if (slippage === "auto") {
    return "auto";
  }
  return Math.round(slippage * 100);
}

/**
 * Returns percentage number for customExecute path.
 * Must receive actual 0.5 for Auto, not 1.0.
 * For invalid/blank custom input, fails closed (returns NaN) and NEVER falls back to 0.5.
 */
export function getCustomExecuteSlippage(
  slippage: number | "auto",
  isCustom: boolean,
  customPercent?: number
): number {
  if (isCustom) {
    if (
      typeof customPercent === "number" &&
      Number.isFinite(customPercent) &&
      customPercent >= MIN_SLIPPAGE_BPS / 100 &&
      customPercent <= MAX_SLIPPAGE_BPS / 100
    ) {
      return customPercent;
    }
    return NaN;
  }
  if (slippage === "auto") {
    return AUTO_SLIPPAGE_PERCENT;
  }
  return slippage;
}

/**
 * Formats truthful slippage mode label for UI card and served plan display.
 * - In Auto mode:
 *   - without active plan: "Auto (0.5% fixed)"
 *   - with active plan: "Auto (${plan.slippageBps / 100}% fixed)"
 * - In Manual mode:
 *   - displays "Manual (${percent}% / ${bps} bps)", e.g. "Manual (1% / 100 bps)"
 */
export function formatTruthfulSlippageLabel(options: {
  isManual: boolean;
  manualBps?: number | null;
  activePlan?: { slippageMode: "auto" | "manual"; slippageBps: number } | null;
}): string {
  if (options.activePlan) {
    if (options.activePlan.slippageMode === "manual") {
      const bps = options.activePlan.slippageBps;
      return `Manual (${formatSlippagePercent(bps)} / ${bps} bps)`;
    }
    return `Auto (${options.activePlan.slippageBps / 100}%)`;
  }
  if (
    options.isManual &&
    typeof options.manualBps === "number" &&
    Number.isInteger(options.manualBps) &&
    options.manualBps >= MIN_SLIPPAGE_BPS &&
    options.manualBps <= MAX_SLIPPAGE_BPS
  ) {
    return `Manual (${formatSlippagePercent(options.manualBps)} / ${options.manualBps} bps)`;
  }
  return AUTO_SLIPPAGE_LABEL;
}
