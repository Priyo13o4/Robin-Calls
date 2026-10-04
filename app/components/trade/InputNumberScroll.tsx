"use client";

import NumberFlow from "@number-flow/react";

/**
 * True when the odometer can show `raw` without changing it.
 *
 * Prevents:
 *   "0.0"        -> Intl dropping trailing zero to "0"
 *   "0.0000005"  -> 6-digit cap rounding up to "0.000001"
 *
 * So the gate is a round trip (String(Number(raw)) === raw) and the fraction cap
 * is the typed precision, never a constant.
 */
export function exactlyRenderable(raw: string): boolean {
  if (raw === "") return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  // Round trip catches trailing zeros, a trailing dot, leading zeros and
  // exponent-form values ("0.0000005" -> "5e-7") in one test.
  if (String(n) !== raw) return false;
  // Intl caps fraction digits at 20; past that it would round again.
  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
  return decimals <= 20;
}

export interface InputNumberScrollProps {
  /** The raw input string or numeric value to display with odometer roll animation */
  value: string | number | null | undefined;
  /** Custom fallback text when empty or invalid (defaults to "0.0") */
  placeholder?: string;
  /** Color class for placeholder text (defaults to "text-[#8a8a8a]") */
  placeholderColor?: string;
  /** Maximum fraction digits when value is a number (defaults to 6) */
  maximumFractionDigits?: number;
  className?: string;
}

/**
 * Uniswap / RobinCalls input number scroll component.
 * Uses NumberFlow for fluid, physics-based odometer digit rolling
 * with zero clipping, perfect typography, and exact verbatim rendering for in-progress typing.
 */
export function InputNumberScroll({
  value,
  placeholder = "0.0",
  placeholderColor = "text-[#8a8a8a]",
  maximumFractionDigits = 6,
  className = "",
}: InputNumberScrollProps) {
  if (value === null || value === undefined || value === "" || value === ".") {
    return <span className={placeholderColor}>{placeholder}</span>;
  }

  // If passed a number directly (like in receive estimate)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return <span className={placeholderColor}>{placeholder}</span>;
    return (
      <NumberFlow
        value={value}
        locales="en-US"
        className={className}
        format={{ maximumFractionDigits }}
        transformTiming={{ duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }}
        spinTiming={{ duration: 620, easing: "cubic-bezier(.2,.8,.2,1)" }}
      />
    );
  }

  // If passed a string (like `raw` typed input or formatted string)
  const rawStr = String(value);
  const n = Number(rawStr);
  const decimals = rawStr.includes(".") ? (rawStr.split(".")[1]?.length ?? 0) : 0;

  // If not exactly renderable (e.g. typing "0.", "12.0", "0.00"), render verbatim so keystrokes aren't mutated
  if (!exactlyRenderable(rawStr)) {
    return <span className={`whitespace-pre ${className}`}>{rawStr}</span>;
  }

  return (
    <NumberFlow
      value={n}
      locales="en-US"
      className={className}
      format={{ maximumFractionDigits: decimals }}
      transformTiming={{ duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" }}
      spinTiming={{ duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }}
    />
  );
}

// Aliases for compatibility
export { InputNumberScroll as NumberScroll, InputNumberScroll as TypedAmount };
