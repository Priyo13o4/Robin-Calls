"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LeaderboardRow } from "@/app/components/referrals/LeaderboardTable";

type Board = "contributions" | "referrals";

/**
 * One board's rows, plus when the census they are summed from was last
 * refreshed.
 *
 * The timestamp travels WITH the rows and is never dropped on the floor: both
 * boards sum the contract's own census as of the reconciler's last pass. A
 * board that cannot say how fresh it is invites a contributor to read a
 * missing entry as a missing contribution.
 */
export function useLeaderboard(board: Board, limit = 50, pollMs = 30_000) {
  /**
   * ONE state, carrying the board it belongs to.
   *
   * Rows and their board have to move together. Held apart, switching tabs
   * relabels the rows before the new ones arrive: the contributors' totals sat
   * for a moment under "BROUGHT IN" and "PEOPLE", publishing the top
   * contributor as having referred 2 ETH of other people's money. A number
   * wearing another number's label is wrong even when it is only wrong for
   * 200ms.
   */
  const [result, setResult] = useState<
    | { board: Board; kind: "ready"; rows: LeaderboardRow[]; mirrorUpdatedAt: string | null }
    | { board: Board; kind: "error" }
    | null
  >(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/referrals/leaderboard?board=${board}&limit=${limit}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        entries: LeaderboardRow[];
        mirrorUpdatedAt: string | null;
      };
      setResult({ board, kind: "ready", rows: body.entries, mirrorUpdatedAt: body.mirrorUpdatedAt });
    } catch {
      // A failed POLL keeps the rows it already has for this board: an empty
      // board and a failed fetch look the same to a reader, and only one of
      // them is a fact about the sale. The error only surfaces when we have
      // nothing to show for the board being asked for.
      setResult((prev) =>
        prev && prev.board === board && prev.kind === "ready" ? prev : { board, kind: "error" },
      );
    } finally {
      inFlight.current = false;
    }
  }, [board, limit]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  // Anything we hold for the OTHER board is not this board's answer arriving
  // early. Until the fetch for this board lands there is nothing to show, and
  // "loading" is the honest word for that.
  const mine = result !== null && result.board === board ? result : null;

  return {
    status: mine === null ? ("loading" as const) : mine.kind,
    rows: mine?.kind === "ready" ? mine.rows : [],
    mirrorUpdatedAt: mine?.kind === "ready" ? mine.mirrorUpdatedAt : null,
    refresh,
  };
}
