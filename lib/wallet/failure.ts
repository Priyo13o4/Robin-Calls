/**
 * Turns a thrown wallet/RPC error into one plain sentence.
 *
 * Two things this must never do. It must not paste the raw message: viem's
 * `shortMessage` carries URLs, provider versions and hex payloads, which tell a
 * reader nothing and read as broken software. And it must not degrade to
 * "something went wrong", which tells them even less and hides whether their
 * money moved.
 *
 * So every branch names what happened in plain words and, where it can, what to
 * do next. The raw error goes to the console for whoever is debugging.
 *
 * No branch claims the user's money is safe unless it IS. A timeout or a
 * dropped connection can happen after the transaction was broadcast, so
 * "nothing was spent" there is a false all-clear about someone's funds; those
 * branches send the reader to the explorer instead.
 */

/** The user pressed reject in the wallet. EIP-1193 code 4001. */
export function isUserRejection(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 8 && cur; i++) {
    if (typeof cur !== "object" || cur === null) return false;
    const o = cur as { code?: number; name?: string; cause?: unknown };
    if (o.code === 4001) return true;
    if (typeof o.name === "string" && /UserRejected/i.test(o.name)) return true;
    cur = o.cause;
  }
  return false;
}

/** Flattened text of the whole cause chain, for matching only. Never shown. */
function haystack(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 8 && cur; i++) {
    if (typeof cur !== "object" || cur === null) break;
    const o = cur as { message?: unknown; shortMessage?: unknown; name?: unknown; cause?: unknown };
    for (const v of [o.shortMessage, o.message, o.name]) if (typeof v === "string") parts.push(v);
    cur = o.cause;
  }
  return parts.join(" ").toLowerCase();
}

/**
 * A classified failure.
 *
 * `settled` means WE KNOW nothing left the wallet, so the message describes a
 * closed event and may auto-dismiss. It is false whenever the transaction could
 * already be on chain: a timeout or a dropped connection can land after the
 * broadcast, and a notice saying "check the explorer" must not disappear on a
 * timer. The sentence and this flag are decided together, in one table, because
 * a sentence promising nothing was sent while `settled` says otherwise would be
 * the false all-clear these branches exist to avoid.
 */
export interface Failure {
  sentence: string;
  settled: boolean;
}

const BRANCHES: { test: RegExp; sentence: string; settled: boolean }[] = [
  {
    test: /insufficient funds|exceeds the balance|not enough balance/,
    sentence: "This wallet does not have enough ETH to cover the amount plus the gas fee.",
    settled: true,
  },
  {
    // "already known" means it WAS broadcast, so this one is not closed.
    test: /replacement transaction underpriced|nonce too low|already known/,
    sentence: "An earlier transaction from this wallet is still pending. Wait for it to confirm, then try again.",
    settled: false,
  },
  {
    test: /chain mismatch|chain id|does not match the target chain|unsupported chain/,
    sentence: "Your wallet is on a different network than this page. Switch networks and try again.",
    settled: true,
  },
  {
    test: /user denied|denied transaction|denied message/,
    sentence: "You rejected the request in your wallet.",
    settled: true,
  },
  {
    test: /gas required exceeds|cannot estimate gas|gas estimation|intrinsic gas/,
    sentence: "The transaction could not be priced, which usually means it would fail. It was not sent.",
    settled: true,
  },
  {
    test: /timed out|timeout|took too long/,
    sentence:
      "The network took too long to answer. If you approved this in your wallet, check the explorer before trying again, because it may still have gone through.",
    settled: false,
  },
  {
    // A 429 can land on the receipt poll, after the send. Not closed.
    test: /rate limit|too many requests|429/,
    sentence: "The network is busy and turned the request away. Wait a moment, then try again.",
    settled: false,
  },
  {
    test: /fetch failed|network error|failed to fetch|connection|econnrefused|http request failed|socket/,
    sentence:
      "We could not reach the network. If you approved this in your wallet, check the explorer before trying again, because it may still have gone through.",
    settled: false,
  },
  {
    test: /no provider|provider not found|not connected|no wallet|disconnected/,
    sentence: "The wallet is not connected. Connect it and try again.",
    settled: true,
  },
  {
    // Reached only when the revert could not be decoded, so we know it was
    // refused but not why. No claim about gas: a simulation costs nothing, a
    // landed revert still burns it, and the text does not say which this was.
    test: /reverted|execution reverted/,
    sentence: "The contract refused this action.",
    settled: false,
  },
];

/**
 * @param fallback Plain sentence for the case nothing matched. Callers pass one
 *        naming the action, so the unknown branch is still specific about WHAT
 *        failed even when it cannot say why. Never `settled`: an unrecognised
 *        error is exactly where we must not promise the funds are untouched.
 */
export function describeTransportFailure(err: unknown, fallback: string): Failure {
  if (isUserRejection(err)) {
    return { sentence: "You rejected the request in your wallet.", settled: true };
  }

  const h = haystack(err);
  for (const b of BRANCHES) {
    if (b.test.test(h)) return { sentence: b.sentence, settled: b.settled };
  }
  return { sentence: fallback, settled: false };
}

/** Console-only. Keeps the raw error reachable without putting it on screen. */
export function logFailure(scope: string, err: unknown): void {
  console.warn(`[${scope}]`, err);
}
