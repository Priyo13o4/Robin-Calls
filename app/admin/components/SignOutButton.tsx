"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
        router.push("/admin/login");
        router.refresh();
      }}
      className="text-[11px] tracking-[0.16em] text-[#8a8a8a] transition-colors hover:text-[#ededea] disabled:opacity-50"
    >
      {busy ? "…" : "SIGN OUT"}
    </button>
  );
}
