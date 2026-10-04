"use client";

import Link from "next/link";

// L230: a read that throws during a server render (DB drop, RPC fault) lands here instead of
// Next's bare "This page couldn't load". Says only that loading failed: never a claim about a token.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-cinzel text-2xl text-[#d8dcd5]">This page did not load</h1>
      <p className="max-w-md text-sm text-[#9aa29a]">
        One of our data sources did not answer in time. Nothing on this page was checked or changed. Try again in a moment.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md border border-[#f5b942]/60 px-4 py-2 text-sm text-[#f5b942] hover:bg-[#f5b942]/10"
        >
          Try again
        </button>
        <Link href="/" className="rounded-md border border-white/15 px-4 py-2 text-sm text-[#d8dcd5] hover:bg-white/5">
          Home
        </Link>
      </div>
    </main>
  );
}
