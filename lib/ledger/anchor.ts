import { createWalletClient, http, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodChain } from "../config/chain";
import { rpc } from "../rpc/client";
import { getUnanchoredHead, isHeadAnchored, recordAnchor } from "../data/anchor";

/**
 * Anchor the current ledger head on Robinhood Chain (§7.4).
 * The Robin wallet sends a 0-value tx to itself whose calldata is the head
 * hash — a public, timestamped commitment to every verdict up to that point.
 * Run periodically (cron), not per-verdict, to keep gas ~free.
 */
export async function anchorLedgerHead(): Promise<
  | { anchored: true; txHash: string; headHash: string; upToVerdictId: number }
  | { anchored: false; reason: string }
> {
  const pk = process.env.ROBIN_ANCHOR_PRIVATE_KEY;
  if (!pk || !pk.startsWith("0x")) {
    return { anchored: false, reason: "ROBIN_ANCHOR_PRIVATE_KEY not configured" };
  }

  const head = await getUnanchoredHead();
  if (!head) return { anchored: false, reason: "ledger is empty" };

  // skip if this head is already anchored
  const anchored = await isHeadAnchored(head.entryHash);
  if (anchored) return { anchored: false, reason: "head already anchored" };

  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(
      process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"
    ),
  });

  const txHash = await wallet.sendTransaction({
    to: account.address,
    value: 0n,
    data: stringToHex(`robincalls:ledger:${head.entryHash}`),
  });

  const receipt = await rpc().waitForTransactionReceipt({ hash: txHash });

  await recordAnchor(
    head.entryHash,
    head.id,
    txHash,
    Number(receipt.blockNumber)
  );

  return {
    anchored: true,
    txHash,
    headHash: head.entryHash,
    upToVerdictId: head.id,
  };
}
