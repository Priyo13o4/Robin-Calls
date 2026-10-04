"use client";

import * as React from "react";
import type { ToastPosition, ToastSkin, ToastVariant } from "./toast";

/**
 * Toast store. Module-level rather than context so a toast can be raised from
 * anywhere, including a callback that has no React tree above it (a wallet
 * rejection resolving after the component that fired it has unmounted).
 */

export interface ToastRecord {
  id: string;
  variant: ToastVariant;
  skin?: ToastSkin;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** null pins it open: a standing problem must not time out. */
  duration: number | null;
  showProgress: boolean;
  closable: boolean;
  /** Set while the exit animation runs, so the row can fade instead of vanish. */
  leaving?: boolean;
  /** How many identical toasts this row stands for; shown as ×N from 2. */
  count: number;
  contentKey: string | null;
  /** Changes on every repeat, so the progress bar restarts with the timer. */
  bump: number;
}

export interface ToastOptions {
  variant?: ToastVariant;
  skin?: ToastSkin;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  duration?: number | null;
  showProgress?: boolean;
  closable?: boolean;
  /** Reuse an id to REPLACE rather than stack. Repeated failures of the same
   *  read must not pile up one row per retry. */
  id?: string;
}

/**
 * A closed, one-shot failure (rejected in the wallet, a save that never left
 * the browser) gets a countdown and a progress bar. A STANDING condition, or
 * anything that might already be on chain, passes `duration: null` instead:
 * a bar draining under a message that says "check the explorer" is a promise
 * we cannot keep.
 */
export const ONE_SHOT_MS = 10_000;

const LIMIT = 4;
const EXIT_MS = 180;

let toasts: ToastRecord[] = [];
const listeners = new Set<(t: ToastRecord[]) => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** id -> ms still owed when the timer was last armed, and when that happened.
 *  Hover pauses the CSS bar; without this the row would still expire under a
 *  paused bar, which is the bar lying about what is about to happen. */
const deadlines = new Map<string, { remaining: number; armedAt: number }>();

function emit() {
  // New array each time or useSyncExternalStore sees the same reference.
  const snapshot = toasts;
  listeners.forEach((l) => l(snapshot));
}

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function arm(id: string, ms: number) {
  clearTimer(id);
  deadlines.set(id, { remaining: ms, armedAt: Date.now() });
  timers.set(id, setTimeout(() => dismissToast(id), ms));
}

/** Hold the countdown while the pointer is over the toast. */
export function pauseToast(id: string) {
  const d = deadlines.get(id);
  if (!d || !timers.has(id)) return;
  clearTimer(id);
  deadlines.set(id, { remaining: Math.max(0, d.remaining - (Date.now() - d.armedAt)), armedAt: Date.now() });
}

export function resumeToast(id: string) {
  const d = deadlines.get(id);
  if (!d || timers.has(id)) return;
  if (d.remaining <= 0) {
    dismissToast(id);
    return;
  }
  arm(id, d.remaining);
}

export function dismissToast(id: string) {
  clearTimer(id);
  deadlines.delete(id);
  const target = toasts.find((t) => t.id === id);
  if (!target || target.leaving) return;

  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();

  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

export function dismissAllToasts() {
  toasts.forEach((t) => dismissToast(t.id));
}

let seq = 0;

/** Text-only content identity; a toast carrying React nodes never merges. */
function contentKey(o: ToastOptions): string | null {
  const text = (v: React.ReactNode) => (v === undefined || v === null || typeof v === "string" || typeof v === "number" ? String(v ?? "") : null);
  const title = text(o.title);
  const description = text(o.description);
  if (title === null || description === null || o.action !== undefined) return null;
  return `${o.variant ?? "default"}\u0000${title}\u0000${description}`;
}

export function toast(options: ToastOptions): string {
  // An identical toast already on screen counts up instead of adding a row.
  // An explicit id still replaces; it only counts up when the text is unchanged.
  const key = contentKey(options);
  const twin = options.id !== undefined || key === null ? undefined : toasts.find((t) => !t.leaving && t.contentKey === key);
  const id = options.id ?? twin?.id ?? `t${++seq}`;
  const previous = toasts.find((t) => t.id === id && !t.leaving);
  const record: ToastRecord = {
    contentKey: key,
    count: previous && key !== null && previous.contentKey === key ? previous.count + 1 : 1,
    bump: (previous?.bump ?? 0) + 1,
    id,
    variant: options.variant ?? "default",
    skin: options.skin,
    title: options.title,
    description: options.description,
    action: options.action,
    duration: options.duration === undefined ? 5000 : options.duration,
    showProgress: options.showProgress ?? true,
    closable: options.closable ?? true,
  };

  clearTimer(id);
  const existing = toasts.findIndex((t) => t.id === id);
  if (existing >= 0 && record.count > 1) {
    // A repeat moves to the front of the deck.
    toasts = [...toasts.filter((t) => t.id !== id), record];
  } else if (existing >= 0) {
    toasts = toasts.map((t, i) => (i === existing ? record : t));
  } else {
    toasts = [...toasts, record].slice(-LIMIT);
  }
  emit();

  if (record.duration !== null && record.duration > 0) {
    arm(id, record.duration);
  }
  return id;
}

/** Convenience wrappers, so a call site names the meaning rather than a colour. */
toast.success = (description: React.ReactNode, o: ToastOptions = {}) =>
  toast({ ...o, variant: "success", description });
toast.error = (description: React.ReactNode, o: ToastOptions = {}) =>
  toast({ ...o, variant: "destructive", description, duration: o.duration ?? null });
toast.warning = (description: React.ReactNode, o: ToastOptions = {}) =>
  toast({ ...o, variant: "warning", description });
toast.info = (description: React.ReactNode, o: ToastOptions = {}) =>
  toast({ ...o, variant: "info", description });
toast.loading = (description: React.ReactNode, o: ToastOptions = {}) =>
  toast({ ...o, variant: "loading", description, duration: o.duration ?? null, showProgress: false });

/** The current rows, for tests and non-React readers. */
export function toastSnapshot(): readonly ToastRecord[] {
  return toasts;
}

const subscribe = (l: (t: ToastRecord[]) => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const EMPTY: ToastRecord[] = [];

export function useToast() {
  const list = React.useSyncExternalStore(
    subscribe,
    () => toasts,
    // The server renders no toasts; a store read here would differ between the
    // two passes and hydrate mismatched.
    () => EMPTY,
  );
  return {
    toasts: list,
    toast,
    dismiss: dismissToast,
    dismissAll: dismissAllToasts,
    pause: pauseToast,
    resume: resumeToast,
  };
}

export type { ToastPosition };
