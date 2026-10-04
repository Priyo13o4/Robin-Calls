"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast, ONE_SHOT_MS } from "@/components/ui/use-toast";
import { saveSaleScheduleAction } from "./actions";

// UTC in and out, never browser-local: a local conversion renders differently
// on the server and the client, and the operator must know which zone they set.
const toInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
const toIso = (v: string) => (v ? `${v}:00Z` : "");

export function SaleScheduleCard({ startsAt, endsAt, unavailable }: { startsAt: string | null; endsAt: string | null; unavailable: boolean }) {
  const router = useRouter();
  const [start, setStart] = useState(toInput(startsAt));
  const [end, setEnd] = useState(toInput(endsAt));
  const [saving, setSaving] = useState(false);

  const save = async (s: string, e: string) => {
    setSaving(true);
    try {
      const res = await saveSaleScheduleAction(toIso(s), toIso(e));
      if (res.ok) {
        toast({ variant: "success", title: "Schedule saved", description: res.message });
        router.refresh();
      } else {
        toast({ variant: "destructive", title: "Not saved", description: res.error, duration: ONE_SHOT_MS });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4 p-4">
      <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-[#4a4a4a]">LANDING COUNTDOWN (SITE_CONFIG)</p>
      {unavailable && (
        <p className="mb-3 text-xs text-[#d9c96a]">Could not read the saved times. The fields are empty because we could not look.</p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="sale-starts-at">
            STARTS AT (UTC)
          </Label>
          <Input id="sale-starts-at" type="datetime-local" className="font-mono text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="w-56">
          <Label className="mb-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]" htmlFor="sale-ends-at">
            ENDS AT (UTC)
          </Label>
          <Input id="sale-ends-at" type="datetime-local" className="font-mono text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" disabled={saving} onClick={() => void save(start, end)}>
          {saving ? "SAVING…" : "SAVE SCHEDULE"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={saving || (!start && !end)}
          onClick={() => {
            setStart("");
            setEnd("");
            void save("", "");
          }}
        >
          CLEAR
        </Button>
      </div>
      <p className="mt-2 text-xs text-[#8a8a8a]">
        The homepage clock counts down to the start, then to the end. Display only: the contract still opens when
        you call start(). Blank start shows &quot;Date announced soon&quot;.
      </p>
    </Card>
  );
}
