"use client";

import { useRef, useState, type ReactNode } from "react";
import { toast, ONE_SHOT_MS } from "@/components/ui/use-toast";
import type { ActionResult } from "@/lib/admin/action-result";

/**
 * A form whose server action reports back.
 *
 * `<form action={serverAction}>` submits and renders nothing on success, so
 * every admin save looked identical to a dead button. This calls the action
 * itself and turns the result into a toast.
 *
 * A failure here never reached the chain, so it is a closed event and may
 * auto-dismiss (see ONE_SHOT_MS). That is not true of the token-sale panel's
 * transaction toasts, which is why this component is not used there.
 */
export function ActionForm({
  action,
  children,
  className,
  /** Shown when the action returns ok without its own message. */
  successMessage = "Saved.",
  title,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className={className}
      // Not `action={}`: that hands submission to React and the return value is
      // dropped, which is the whole thing we need.
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const data = new FormData(e.currentTarget);
        try {
          const res = await action(data);
          if (res.ok) {
            toast({ variant: "success", title, description: res.message || successMessage, duration: ONE_SHOT_MS });
          } else {
            toast({ variant: "destructive", title: title ?? "Not saved", description: res.error, duration: ONE_SHOT_MS });
          }
        } catch (err) {
          // The action itself failed to run: a network drop, or a redacted
          // server fault. Nothing was written, so this is still closed.
          console.warn("[admin-action]", err);
          toast({
            variant: "destructive",
            title: title ?? "Not saved",
            description: "The change could not be sent. Nothing was saved. Try again.",
            duration: ONE_SHOT_MS,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
