"use server";

import { requireAdmin } from "@/lib/auth/guard";
import { readPayoutLedger } from "@/lib/data/sale-payouts";

/**
 * The outstanding-payout export.
 *
 * Deliberately NOT in `actions.ts`. That file holds mutations, and
 * tests/admin-action-feedback.test.ts enforces a contract over it: every action
 * there returns `ActionResult` so its failure text survives Next's production
 * redaction of thrown Server Action errors. This is a READ that hands back a
 * file, so it cannot satisfy that shape without smuggling a CSV through a toast
 * message. It keeps the same discipline in its own type: failures are RETURNED,
 * never thrown past the boundary.
 */

export type ExportResult =
  | { ok: true; filename: string; csv: string }
  | { ok: false; error: string };

/**
 * The outstanding set, as CSV, for working from while sending.
 *
 * A server action rather than a route: an admin-only export needs no public
 * endpoint, and adding one would need its own rate-limit class and a proxy
 * matcher entry to be real (CLAUDE.md §6).
 *
 * One row per (wallet, asset), with the token legs ALREADY SUMMED. That is the
 * shape a batched transfer actually takes: a wallet owed a buyer bonus and a
 * referrer commission gets one token transfer, not two, and exporting them
 * separately invites two sends.
 *
 * Amounts are base-unit integers and there is no human column: a decimals
 * figure here would be a literal standing in for the token's own `decimals()`
 * (§8 #11), and the integer is the only value that should ever be pasted.
 */
function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function exportOutstandingAction(formData: FormData): Promise<ExportResult> {
  try {
    await requireAdmin();
    const snapshotId = field(formData, "snapshotId");
    const ledger = await readPayoutLedger(snapshotId);
    if (ledger.kind === "unavailable") return { ok: false, error: "Could not read the ledger, so nothing was exported." };
    if (ledger.kind === "absent") return { ok: false, error: "No snapshot with that id." };
    if (!ledger.isFinal) {
      return { ok: false, error: "That run is not final. Paying out of a rehearsal sends real money against numbers the gates never cleared." };
    }

    // `stillOwed`, not `paid === null`. A payment the chain CONTRADICTED is the
    // strongest evidence of a missed send there is, and dropping those rows
    // would remove exactly the wallets that need paying again.
    const lines = ["wallet,asset,amount_base_units,kinds"];
    for (const row of ledger.rows) {
      const owedToken = row.lines.filter((l) => l.stillOwed && l.kind !== "referrer_eth");
      const owedEth = row.lines.find((l) => l.kind === "referrer_eth" && l.stillOwed);

      if (owedToken.length > 0) {
        const total = owedToken.reduce((sum, l) => sum + l.owed, 0n);
        lines.push(`${row.walletAddress},token,${total},${owedToken.map((l) => l.kind).join("+")}`);
      }
      if (owedEth) {
        lines.push(`${row.walletAddress},eth,${owedEth.owed},referrer_eth`);
      }
    }

    return { ok: true, filename: `outstanding-${snapshotId}.csv`, csv: lines.join("\n") };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : "The export could not be built.",
    };
  }
}
