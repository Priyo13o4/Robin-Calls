"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { CheckCircle2, AlertTriangle, XCircle, Info, Loader2, X } from "lucide-react";

/**
 * Toast, on the Lightswind API (ToastProvider / useToast / Toaster, variants,
 * positions, progress bar) with two deliberate departures.
 *
 * CSS keyframes, not framer-motion. A toast's whole job is to appear at the
 * busiest moment the main thread gets, right after a transaction or a failed
 * read. A JS-driven timeline stops where it is when the ticker stalls, which is
 * the landing-intro failure again on a smaller surface.
 *
 * `skin` is ours, not Lightswind's: the noir set already speaks in hard borders,
 * offset shadows and halftone dots, so a toast rendered in generic rose/emerald
 * would read as another site's component dropped into this one.
 */

export type ToastVariant = "default" | "success" | "warning" | "destructive" | "info" | "loading";
export type ToastSkin = "solid" | "card" | "pill";
export type ToastPosition =
  | "top-right" | "top-left" | "top-center"
  | "bottom-right" | "bottom-left" | "bottom-center";

/* ── variant → colour, per skin ────────────────────────────────────────── */

const SOLID: Record<ToastVariant, string> = {
  default: "bg-[#EDEDEA] border-[#EDEDEA] text-[#0A0A0A] halftone-light",
  success: "bg-[#CCFF00] border-[#CCFF00] text-[#0A0A0A] halftone-light",
  warning: "bg-[#D9C96A] border-[#D9C96A] text-[#0A0A0A] halftone-light",
  destructive: "bg-[#E05252] border-[#E05252] text-[#0A0A0A] halftone-light",
  info: "bg-[#7FD4E8] border-[#7FD4E8] text-[#0A0A0A] halftone-light",
  loading: "bg-[#EDEDEA] border-[#EDEDEA] text-[#0A0A0A] halftone-light",
};

const CARD: Record<ToastVariant, string> = {
  default: "bg-[#141414] border-[#2A2A2A] text-[#EDEDEA] halftone-dark",
  success: "bg-[#141414] border-[#CCFF00] text-[#EDEDEA] halftone-dark",
  warning: "bg-[#141414] border-[#8A6D1F] text-[#EDEDEA] halftone-dark",
  destructive: "bg-[#141414] border-[#8A3A30] text-[#EDEDEA] halftone-dark",
  info: "bg-[#141414] border-[#3A6A7A] text-[#EDEDEA] halftone-dark",
  loading: "bg-[#141414] border-[#2A2A2A] text-[#EDEDEA] halftone-dark",
};

const PILL: Record<ToastVariant, string> = {
  default: "bg-[#141414] border-[#1F1F1F] text-[#A0A09A]",
  success: "bg-[#141C14] border-[#3D5C3D] text-[#8FBF6A]",
  warning: "bg-[#1C1A14] border-[#8A6D1F] text-[#D9C96A]",
  destructive: "bg-[#1C1414] border-[#7F2F2F] text-[#E8A0A0]",
  info: "bg-[#141414] border-[#1F1F1F] text-[#A0A09A]",
  loading: "bg-[#141414] border-[#1F1F1F] text-[#A0A09A]",
};

/** The accent the progress bar and icon use, per variant. */
const ACCENT: Record<ToastVariant, string> = {
  default: "#8A8A8A",
  success: "#CCFF00",
  warning: "#D9C96A",
  destructive: "#E05252",
  info: "#7FD4E8",
  loading: "#8A8A8A",
};

const ICONS: Record<ToastVariant, React.ComponentType<{ className?: string }> | null> = {
  default: null,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
  info: Info,
  loading: Loader2,
};

const toastVariants = cva(
  "rc-toast pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden transition-colors",
  {
    variants: {
      skin: {
        // The hero CTA treatment: solid fill, hard 2px border, offset shadow,
        // dots over the top.
        solid: "brutalist-box brutalist-shadow-dark px-4 py-3",
        // The feature-card treatment: dark panel, coloured border, dots.
        card: "brutalist-box brutalist-shadow-dark px-4 py-3",
        // Quiet rounded pill, closest to the rest of the sale page chrome.
        pill: "rounded-2xl border px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-sm",
      },
    },
    defaultVariants: { skin: "solid" },
  },
);

const POSITION: Record<ToastPosition, string> = {
  "top-right": "top-4 right-4 items-end",
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
};

/* ── primitives ────────────────────────────────────────────────────────── */

export function ToastViewport({
  position = "bottom-right",
  className,
  children,
}: {
  position?: ToastPosition;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[70] flex max-h-screen w-full max-w-[min(26rem,calc(100vw-2rem))] flex-col gap-3 p-0",
        POSITION[position],
        className,
      )}
      role="region"
      aria-label="Notifications"
    >
      {children}
    </div>
  );
}

export interface ToastProps extends VariantProps<typeof toastVariants> {
  variant?: ToastVariant;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  duration?: number | null;
  showProgress?: boolean;
  closable?: boolean;
  onClose?: () => void;
  leaving?: boolean;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Identical repeats merged into this toast; a badge shows from 2. */
  count?: number;
  /** Remounts the progress bar so it restarts with a repeat's fresh timer. */
  progressKey?: number;
}

export function Toast({
  variant = "default",
  skin = "solid",
  title,
  description,
  action,
  icon,
  duration = 5000,
  showProgress = true,
  closable = true,
  onClose,
  leaving = false,
  className,
  onMouseEnter,
  onMouseLeave,
  count = 1,
  progressKey,
}: ToastProps) {
  const palette = skin === "solid" ? SOLID : skin === "pill" ? PILL : CARD;
  const Icon = ICONS[variant];
  const accent = ACCENT[variant];
  // On a solid fill the accent IS the background, so the bar has to darken
  // rather than tint or it disappears into the panel.
  const barColor = skin === "solid" ? "rgba(10,10,10,0.55)" : accent;

  return (
    <div
      className={cn(toastVariants({ skin }), palette[variant], leaving && "rc-toast-out", className)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role={variant === "destructive" ? "alert" : "status"}
      aria-live={variant === "destructive" ? "assertive" : "polite"}
    >
      {(icon ?? Icon) && (
        <span className="mt-px flex-none" style={{ color: skin === "solid" ? undefined : accent }}>
          {icon ?? (Icon ? <Icon className={cn("size-4", variant === "loading" && "animate-spin")} /> : null)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {title && (
          <p className="font-mono text-[11px] font-extrabold uppercase tracking-[0.16em]">{title}</p>
        )}
        {description && (
          <p className={cn("text-[13px] font-semibold leading-snug", title && "mt-1 opacity-90")}>{description}</p>
        )}
        {action && <div className="mt-2 flex gap-2">{action}</div>}
      </div>

      {count > 1 && (
        <span className="flex-none self-center rounded-full bg-black/15 px-1.5 font-mono text-[11px] font-bold tabular-nums" aria-label={`Shown ${count} times`}>
          ×{count}
        </span>
      )}

      {closable && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-mr-1 flex-none opacity-50 transition-opacity hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}

      {/* Progress runs only while the toast actually expires. A bar that empties
          on a toast which then stays put is a lie about what is about to happen. */}
      {showProgress && duration !== null && duration > 0 && (
        <span
          key={progressKey}
          className="rc-toast-progress absolute bottom-0 left-0 h-[2px]"
          style={{ backgroundColor: barColor, animationDuration: `${duration}ms` }}
        />
      )}
    </div>
  );
}

export function ToastAction({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-2 border-current px-2.5 py-1 font-mono text-[10px] font-extrabold uppercase tracking-[0.16em] transition-opacity hover:opacity-70",
        className,
      )}
    >
      {children}
    </button>
  );
}

export { toastVariants };
