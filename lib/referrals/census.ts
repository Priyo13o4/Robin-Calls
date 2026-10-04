import type { Address } from "viem";
import { createPublicClient, http, type PublicClient } from "viem";

import { rpc } from "@/lib/rpc/client";
import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";
import { KNOWN_SALE_CHAINS } from "@/lib/config/sale-chains";
import { tokenSaleAbi } from "@/lib/sale/abi";

/**
 * Reading the sale contract's own contribution census — the reads that
 * replaced the log walker.
 *
 * The contract keeps every fact the walker used to reconstruct from events:
 * `contributorCount()`, `contributors(i)` (push order == first-contribution
 * order), `contributed(wallet)` (a wallet's CURRENT total, top-ups included),
 * `totalRaised()`. State reads have the property walking logs never had: a
 * failed read is simply retried, with no gap to go back for and no cursor to
 * corrupt.
 *
 * Per-transaction rows (`sale_contributions`) come from the CLAIM path —
 * the browser posts the hash and the server verifies the receipt (contribution.ts).
 * The census numbers here are WALLET TOTALS, and they are what the
 * reconciler diffs against the mirror.
 *
 * `undefined` everywhere means "could not read", never zero. `contributed(w)
 * == 0` means "not yet", never "never": a lagging node returns 0 for a real
 * contribution, and caching that as a negative is §8 #4.
 */

/**
 * The reader for the chain the SALE is on — `site_config.token_sale_chain_id`,
 * carried here by the caller.
 *
 * Mainnet keeps the pooled transport (failover, circuit breakers, wrong-chain
 * rejection). Any other supported sale chain gets a plain client: no pool is
 * configured for it, a single point of failure accepted for testing. Never
 * `rpc()` blindly — that client is pinned to mainnet, and a testnet sale would
 * read the wrong chain while every row said otherwise.
 *
 * Resolved from `KNOWN_SALE_CHAINS`, never from a build-time constant. It was
 * compared against `activeChain`, which on the SERVER is always mainnet
 * (`getSaleChain()` reads a browser global that does not exist there), so
 * every server read for a testnet sale threw here — the index job, the
 * snapshot job and the claim verifier alike. §8 #11: if a parameter is named
 * for a fact, use the fact.
 */
export function saleReader(chainId: number): PublicClient {
  if (chainId === ROBINHOOD_CHAIN_ID) return rpc();
  const chain = KNOWN_SALE_CHAINS[chainId];
  if (!chain) {
    throw new Error(`sale read asked for chain ${chainId}, which is not a supported sale chain`);
  }
  return createPublicClient({ chain, transport: http() }) as PublicClient;
}

import { makeReadMany } from "@/lib/sale/reads";

type ReadOutcome = { ok: true; value: unknown } | { ok: false };

/**
 * One round of view reads through the caller's client, using the unified
 * makeReadMany with batchSize: 0 and fallback to per-call reads.
 */
async function readMany(
  client: PublicClient,
  calls: { address: Address; functionName: string; args?: readonly unknown[] }[],
): Promise<ReadOutcome[]> {
  if (calls.length === 0) return [];
  const runner = makeReadMany(client);
  return runner(
    calls.map((c) => ({
      label: c.functionName,
      address: c.address,
      abi: tokenSaleAbi,
      functionName: c.functionName,
      args: c.args,
    })),
  );
}

/** `contributorCount()`, `totalRaised()` and `state()`, or undefined when unread. */
export interface CensusHead {
  contributorCount: bigint | undefined;
  totalRaised: bigint | undefined;
  /** SALE_STATE. Read here because `claimRefund()` moves neither of the two
   *  numbers above, so nothing else in a cycle can tell refunds are possible. */
  state: number | undefined;
}

/**
 * The two totals that decide whether anything changed since the last cycle.
 * Two calls in one envelope; most reconciler cycles read these, compare, and
 * stop. Undefined fields are unread — a cycle that cannot read them must
 * not conclude "unchanged".
 */
export async function readCensusHead(client: PublicClient, sale: Address): Promise<CensusHead> {
  const [count, raised, state] = await readMany(client, [
    { address: sale, functionName: "contributorCount" },
    { address: sale, functionName: "totalRaised" },
    { address: sale, functionName: "state" },
  ]);
  return {
    contributorCount: count.ok && typeof count.value === "bigint" ? count.value : undefined,
    totalRaised: raised.ok && typeof raised.value === "bigint" ? raised.value : undefined,
    state: state.ok && typeof state.value === "number" ? state.value : undefined,
  };
}

/**
 * The census entries `fromIndex..toIndex`, each with that wallet's CURRENT
 * `contributed` total and `refunded` flag. A slot is `undefined` when its read
 * faulted — an address we could not read gets no balance invented for it,
 * and a balance we could not read is not zero.
 */
export interface CensusEntry {
  index: number;
  walletAddress: Address | undefined;
  contributedWei: bigint | undefined;
  refunded: boolean | undefined;
}

export async function readCensusSlice(
  client: PublicClient,
  sale: Address,
  fromIndex: number,
  toIndex: number,
): Promise<CensusEntry[]> {
  if (toIndex < fromIndex) return [];
  const want = toIndex - fromIndex + 1;

  // One call for the whole slice, falling back to the index-by-index walk when
  // it does not answer — which is also what an older deployment without
  // `censusSlice` looks like from here.
  const packed = await readPackedSlice(client, sale, fromIndex, want);
  const { wallets, amounts } = packed ?? (await readSliceByIndex(client, sale, fromIndex, want));

  // `refunded` has no batched getter, so it stays per-wallet. Calls are built
  // from the SAME filter that maps them back, so a wallet we could not read
  // cannot shift another wallet's flag onto it (lib/rpc/multicall.ts rule 2).
  const present = wallets.filter((a): a is Address => a !== undefined);
  const refunds =
    present.length > 0
      ? await readMany(
          client,
          present.map((a) => ({ address: sale, functionName: "refunded", args: [a] as readonly unknown[] })),
        )
      : [];

  const out: CensusEntry[] = [];
  let b = 0;
  wallets.forEach((wallet, i) => {
    let refunded: boolean | undefined;
    if (wallet !== undefined) {
      const ref = refunds[b++];
      refunded = ref && ref.ok && typeof ref.value === "boolean" ? ref.value : undefined;
    }
    out.push({ index: fromIndex + i, walletAddress: wallet, contributedWei: amounts[i], refunded });
  });
  return out;
}

type SliceReads = { wallets: (Address | undefined)[]; amounts: (bigint | undefined)[] };

/**
 * `censusSlice(offset, count)` — wallets and their totals in one call, read at
 * one block, so the pair can never come from two different states.
 *
 * Null on anything that is not a well-formed answer, which the caller treats as
 * "use the other path". The contract clamps `count` to 500 and to the end of
 * the array, so a SHORT return is expected; the tail is padded undefined and
 * the caller skips those slots rather than inventing wallets for them.
 */
async function readPackedSlice(
  client: PublicClient,
  sale: Address,
  fromIndex: number,
  want: number,
): Promise<SliceReads | null> {
  const [r] = await readMany(client, [
    { address: sale, functionName: "censusSlice", args: [BigInt(fromIndex), BigInt(want)] as readonly unknown[] },
  ]);
  if (!r.ok || !Array.isArray(r.value) || r.value.length < 2) return null;
  const [ws, as] = r.value as [unknown, unknown];
  if (!Array.isArray(ws) || !Array.isArray(as) || ws.length !== as.length) return null;

  const wallets: (Address | undefined)[] = [];
  const amounts: (bigint | undefined)[] = [];
  for (let i = 0; i < want; i++) {
    const w = ws[i];
    const a = as[i];
    const okPair = typeof w === "string" && typeof a === "bigint";
    wallets.push(okPair ? (w as Address) : undefined);
    amounts.push(okPair ? a : undefined);
  }
  return { wallets, amounts };
}

/** The original walk: `contributors(i)` then `contributed(w)`. Kept as the
 *  fallback so a contract without `censusSlice` still reconciles. */
async function readSliceByIndex(
  client: PublicClient,
  sale: Address,
  fromIndex: number,
  want: number,
): Promise<SliceReads> {
  const addresses = await readMany(
    client,
    Array.from({ length: want }, (_, i) => ({
      address: sale,
      functionName: "contributors",
      args: [BigInt(fromIndex + i)] as readonly unknown[],
    })),
  );
  const wallets: (Address | undefined)[] = addresses.map((r) =>
    r.ok && typeof r.value === "string" ? (r.value as Address) : undefined,
  );

  const present = wallets.filter((a): a is Address => a !== undefined);
  const balances =
    present.length > 0
      ? await readMany(
          client,
          present.map((a) => ({ address: sale, functionName: "contributed", args: [a] as readonly unknown[] })),
        )
      : [];

  const amounts: (bigint | undefined)[] = [];
  let b = 0;
  for (const wallet of wallets) {
    if (wallet === undefined) {
      amounts.push(undefined);
      continue;
    }
    const r = balances[b++];
    amounts.push(r && r.ok && typeof r.value === "bigint" ? r.value : undefined);
  }
  return { wallets, amounts };
}

/**
 * `contributed(wallet)` for one wallet — the claim path's cross-check that the
 * census agrees with the log before anything is written. Undefined = unread.
 *
 * A returned 0n with a VERIFIED receipt is an ordering fact, not a negative:
 * it means the node's state view has not caught up with the block the receipt
 * names, so the caller retries rather than concluding the wallet never paid.
 */
export async function readContributed(
  client: PublicClient,
  sale: Address,
  wallet: Address,
): Promise<bigint | undefined> {
  const [r] = await readMany(client, [
    { address: sale, functionName: "contributed", args: [wallet] as readonly unknown[] },
  ]);
  return r.ok && typeof r.value === "bigint" ? (r.value as bigint) : undefined;
}

/**
 * `refunded(wallet)` for one wallet on an abandoned sale. Undefined = unread.
 */
export async function readRefunded(
  client: PublicClient,
  sale: Address,
  wallet: Address,
): Promise<boolean | undefined> {
  const [r] = await readMany(client, [
    { address: sale, functionName: "refunded", args: [wallet] as readonly unknown[] },
  ]);
  return r.ok && typeof r.value === "boolean" ? (r.value as boolean) : undefined;
}
