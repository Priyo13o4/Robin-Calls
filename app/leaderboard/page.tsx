import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { flags } from "@/lib/config/flags";
import { resolveSaleAddress } from "@/lib/sale/address";
import { readSaleSnapshotCached } from "@/lib/sale/server";
import { reportError } from "@/lib/observability/reporter";
import { saleReader } from "@/lib/referrals/census";
import { LeaderboardClient } from "./LeaderboardClient";

/**
 * The sale's two leaderboards.
 *
 * Gated on the sale's own flag, the same one /token-sale uses. Without a sale
 * there is nothing to rank, and a route that renders an empty board still reads
 * as a real product surface to anyone who finds the URL — which is why this
 * 404s rather than degrading.
 *
 * Permanently noindex: a leaderboard is a ranked list of wallet addresses, and
 * there is no reason to put them in a search index.
 */
export const dynamic = "force-dynamic";

// Permanently noindex: a ranked list of wallet addresses should never be indexed.
export const metadata: Metadata = {
  title: "Sale Leaderboard | RobinCalls",
  description: "Who contributed the most to the token sale, and who brought the most people in.",
  robots: { index: false, follow: false },
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  if (!flags.tokenSale) notFound();
  // Resolved on the server so the tab is right on the first paint. Reading it
  // from the URL in the client would render the default first and swap after
  // hydration, which is a visible flip on a link that names its destination.
  const board = (await searchParams).board === "referrals" ? "referrals" : "contributions";
  // The rail's totals are the contract's own counters, so this page needs the
  // same address + first-paint snapshot /token-sale takes. An unresolved
  // address renders "—" in the rail; the boards themselves do not depend on it.
  const resolved = await resolveSaleAddress();
  const contract = resolved.kind === "address" ? resolved.address : "";
  const client = resolved.kind === "address" ? saleReader(resolved.chainId) : undefined;
  // Cached for 5s and single-flighted: this route is force-dynamic, so without
  // it every visitor pays 3 RPC requests for numbers identical to everyone
  // else's. The browser polls live on top of this render anyway.
  const snapshot =
    contract && resolved.kind === "address"
      ? await readSaleSnapshotCached(contract, { client, chainId: resolved.chainId }).catch((error: unknown) => {
          // Same as /token-sale: a transient RPC fault must not replace the page; the client's live poll fills it.
          void reportError({ code: "RC_RPC_UNAVAILABLE", message: "leaderboard first-paint snapshot failed", operation: "sale.leaderboardSnapshot", error });
          return null;
        })
      : null;
  return (
    <LeaderboardClient
      contract={contract}
      snapshot={snapshot}
      chainId={resolved.kind === "address" ? resolved.chainId : undefined}
      initialBoard={board}
    />
  );
}
