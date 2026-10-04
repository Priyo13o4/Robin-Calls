/**
 * Pre-trade check for one token, read-only, run locally:
 *   npx tsx scripts/pre-trade-check.ts <token> [--verbose] [--skip-hooks]
 * Prints a verdict, a few findings a buyer can act on, and what to do. --verbose adds the
 * per-pool quote table and the raw facts behind each line. Exit code: 2 blocker, 1 warning, 0 none.
 * Public RPC, DexScreener, and the Blockscout PRO holder list when EXPLORER_API_KEY is in
 * .env.local (KNOWN-PROBLEMS L191, L212).
 */
import { readFileSync } from "node:fs";
import { createPublicClient, decodeAbiParameters, http, parseAbi, type Hex } from "viem";
import { DEFAULTS, LOG_SPAN, QUOTE_ABI, main as hookCheck, type PoolAssessment } from "./v4-hook-check";
import { v4ReservesLensAbi } from "../lib/rpc/abis";
import { addresses } from "../lib/config/chain";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const POSITION_MANAGER = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
const INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const MODIFY = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec";
const PONS_LP_VAULT = "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
const ZERO = "0x0000000000000000000000000000000000000000";
// Nobody holds these keys: an LP NFT sent here is locked for good, never "a wallet that can pull".
const BURN = new Set(["0x000000000000000000000000000000000000dead", ZERO]);
const NOT_SELLERS = new Set([PM, POSITION_MANAGER, PONS_LP_VAULT, ...BURN]);
/**
 * Near-identical balances among the top holders. Context, never a blocker: 9 of 14 live tokens
 * sampled 2026-09-28 showed it, since snipers buying the same capped size look alike (L191).
 */
const BUNDLE = { minWallets: 6, spread: 0.15, minSupplyPct: 0.5 };

const erc20 = parseAbi(["function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function symbol() view returns (string)"]);
const nftAbi = parseAbi(["function ownerOf(uint256) view returns (address)"]);

type Level = "block" | "warn" | "ok";
type Finding = { level: Level; text: string };
type Pair = { pairAddress: string; quoteToken: { symbol: string }; liquidity?: { usd?: number }; pairCreatedAt?: number };
type Log = { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex };
type Key = { currency0: Hex; currency1: Hex; fee: number; tickSpacing: number; hooks: Hex };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const num = (x: number, d = 1) => x.toLocaleString("en-US", { maximumFractionDigits: d });
const feePct = (fee: number) => (fee & 0x800000 ? "dynamic" : `${num(fee / 10_000, 2)}%`);

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const token = (args.find((a) => !a.startsWith("--")) ?? "").toLowerCase();
  const verbose = args.includes("--verbose");
  if (!/^0x[0-9a-f]{40}$/.test(token)) {
    console.error("usage: npx tsx scripts/pre-trade-check.ts <token address> [--verbose] [--skip-hooks]");
    return 1;
  }
  const started = Date.now();
  const found: Finding[] = [];
  const facts: string[] = [];
  const add = (level: Level, text: string) => found.push({ level, text });

  // 1. Every V4 pool: does a sell come back, and at what cost.
  let census: PoolAssessment[] = [];
  let censusNote = "";
  let censusComplete = true;
  if (!args.includes("--skip-hooks")) {
    await hookCheck([token], { quiet: !verbose, onResult: (r) => { census = r.assessments; censusNote = r.census; censusComplete = r.censusComplete; } });
  }
  const client = createPublicClient({ transport: http(RPC, { timeout: 15_000, retryCount: 1, fetchOptions: { headers: { "user-agent": "curl/8.7.1" } } }) });
  const [decimals, supplyRaw, symbol] = await Promise.all([
    client.readContract({ address: token as Hex, abi: erc20, functionName: "decimals" }),
    client.readContract({ address: token as Hex, abi: erc20, functionName: "totalSupply" }),
    client.readContract({ address: token as Hex, abi: erc20, functionName: "symbol" }).catch(() => "token"),
  ]);
  const units = (x: bigint, d = decimals) => Number(x) / 10 ** d;
  const supply = units(supplyRaw);
  const head = await client.getBlockNumber();
  const counterOf = (k: Key) => (k.currency0.toLowerCase() === token ? k.currency1 : k.currency0);
  const symbolOf = (p: PoolAssessment) => (p.currency0.toLowerCase() === token ? p.currency1Symbol : p.currency0Symbol) ?? short(counterOf(p));

  const healthy = census
    .filter((p) => p.evidence === "sell-quote-returns-output" && Number(p.roundTripRecoveryBps) >= 5_000)
    .sort((a, b) => Number(b.roundTripRecoveryBps) - Number(a.roundTripRecoveryBps));
  for (const p of census) {
    const name = `${symbolOf(p)} pool ${short(p.poolId)}`;
    if (p.evidence === "buy-only-quote-failure") add("block", `Honeypot route: in the ${name} a buy goes through but a sell reverts.`);
    else if (p.evidence === "sell-quote-zero-output") add("block", `In the ${name} a sell returns nothing.`);
    else if (p.evidence === "sell-quote-returns-output" && Number(p.roundTripRecoveryBps) < 5_000) {
      add("warn", `Avoid the ${name}: its fee is ${feePct(p.fee)}, so a sell there returns ${num(Number(p.roundTripRecoveryBps) / 100, 2)}%.`);
    }
  }
  if (healthy[0]) add("ok", `Sells work: the ${symbolOf(healthy[0])} pool ${short(healthy[0].poolId)} returns ${num(Number(healthy[0].roundTripRecoveryBps) / 100, 2)}% on a round trip.`);
  else if (census.length) add("warn", "No pool returned a healthy sell quote, so a sale could not be confirmed.");
  if (censusNote) facts.push(`pools checked: ${census.length}, ${censusNote}`);
  // L213 #23: two runs disagreed on the decoy pools because one silently used DexScreener's list.
  if (!args.includes("--skip-hooks") && !censusComplete) {
    add("warn", "The chain's full pool list could not be read, so only the pools DexScreener lists were checked. A decoy pool it does not list would be missed.");
  }

  // 2. The main pool, chosen by DexScreener and then checked against the chain, which DexScreener is not (L212).
  const pairs: Pair[] = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`, { signal: AbortSignal.timeout(15_000) })
    .then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const keys = new Map<string, Key>(census.map((p) => [p.poolId.toLowerCase(), p as unknown as Key]));
  const v4 = pairs.filter((p) => p.pairAddress.length === 66 && (p.liquidity?.usd ?? 0) > 1_000)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (pairs.some((p) => p.pairAddress.length !== 66 && (p.liquidity?.usd ?? 0) > 1_000)) facts.push("V2/V3 pools exist and are not checked by this script");

  let main: { pair: Pair; key: Key; logs: Log[]; reserves: readonly unknown[] | null } | null = null;
  for (const pair of v4) {
    const id = pair.pairAddress.toLowerCase() as Hex;
    const logs = await poolLogs(client, id, pair, head).catch(() => null);
    if (!logs) {
      add("warn", `The history of the ${pair.quoteToken.symbol} pool ${short(id)} could not be read, so removals and LP ownership were not checked.`);
      break;
    }
    const init = logs.find((l) => l.topics[0] === INIT);
    const key = keys.get(id) ?? (init ? keyFromInit(init) : undefined);
    if (!key) continue;
    const reserves = await client.readContract({ address: addresses.v4ReservesLens, abi: v4ReservesLensAbi, functionName: "getPoolTVL", args: [PM, key] }).catch(() => null);
    const empty = reserves && !reserves[12] && reserves[0] === 0n && reserves[1] === 0n;
    if (empty) {
      add("block", `The ${pair.quoteToken.symbol} pool ${short(id)} is empty on chain, while DexScreener still shows $${num(pair.liquidity!.usd!, 0)}. Its liquidity was pulled.`);
      continue;
    }
    main = { pair, key, logs, reserves };
    break;
  }
  if (!main) {
    if (!v4.length) add("warn", "No V4 pool with over $1,000 of liquidity, so there is nothing deep enough to sell into.");
    return report(token, symbol, head, started, found, facts, verbose);
  }
  const { pair, key, logs, reserves } = main;
  const q = pair.quoteToken.symbol;
  const counter = counterOf(key);
  const qDecimals = counter === ZERO ? 18 : await client.readContract({ address: counter, abi: erc20, functionName: "decimals" }).catch(() => 18);
  const tokenIs0 = key.currency0.toLowerCase() === token;
  const poolQuoteRaw = reserves ? (tokenIs0 ? reserves[1] : reserves[0]) as bigint : null;
  const poolQuote = poolQuoteRaw === null ? null : units(poolQuoteRaw, qDecimals);
  if (poolQuote !== null) {
    add("ok", `The ${q} pool ${short(pair.pairAddress)} holds ${num(poolQuote, 3)} ${q} on chain${reserves![12] ? " (approximate: its hook can hold more)" : ""}.`);
  }
  const init = logs.find((l) => l.topics[0] === INIT);
  const opener = init ? await client.getTransaction({ hash: init.transactionHash }).then((t) => t.from).catch(() => "unread") : null;
  if (init) facts.push(`main pool opened by ${opener} at block ${Number(init.blockNumber)}`);

  // 3. Removals and who holds the rest. Positions are ranked by size, so the lines speak for the liquidity that matters.
  const mods = logs.filter((l) => l.topics[0] === MODIFY).map((l) => {
    const [lo, hi, d, salt] = decodeAbiParameters([{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }], l.data);
    return { d, salt, pos: `${l.topics[2]}:${lo}:${hi}:${salt}`, via: `0x${l.topics[2].slice(26)}`.toLowerCase(), block: Number(l.blockNumber), tx: l.transactionHash };
  });
  const added = mods.filter((m) => m.d > 0n).reduce((s, m) => s + m.d, 0n);
  const removals = mods.filter((m) => m.d < 0n);
  const removed = removals.reduce((s, m) => s - m.d, 0n);
  if (removals.length) {
    const share = added > 0n ? Number((removed * 1000n) / added) / 10 : 100;
    add(share >= 50 ? "block" : "warn", `${num(share)}% of all liquidity ever added to the ${q} pool has been removed (${removals.length} removal${removals.length > 1 ? "s" : ""}, last in tx ${short(removals.at(-1)!.tx)}).`);
  } else if (mods.length) add("ok", `No liquidity has ever been removed from the ${q} pool.`);

  const net = new Map<string, { l: bigint; via: string; salt: Hex }>();
  for (const m of mods) net.set(m.pos, { l: (net.get(m.pos)?.l ?? 0n) + m.d, via: m.via, salt: m.salt });
  const live = [...net.values()].filter((p) => p.l > 0n).sort((a, b) => (b.l > a.l ? 1 : -1));
  const total = live.reduce((s, p) => s + p.l, 0n);
  const byHolder = new Map<string, { share: number; kind: "burned" | "pons" | "wallet" | "contract"; nft?: bigint }>();
  for (const p of live.slice(0, 8)) {
    const share = Number((p.l * 1000n) / total) / 10;
    let holder = p.via;
    let nft: bigint | undefined;
    if (p.via === POSITION_MANAGER) {
      nft = BigInt(p.salt);
      holder = ((await client.readContract({ address: POSITION_MANAGER, abi: nftAbi, functionName: "ownerOf", args: [nft] }).catch(() => ZERO)) as string).toLowerCase();
    }
    const code = BURN.has(holder) || holder === PONS_LP_VAULT ? null : await client.getCode({ address: holder as Hex }).catch(() => undefined);
    if (code === undefined) { add("warn", `Could not tell whether LP holder ${short(holder)} is a wallet or a contract.`); continue; }
    const kind = BURN.has(holder) ? "burned" : holder === PONS_LP_VAULT ? "pons" : code && code !== "0x" ? "contract" : "wallet";
    const prev = byHolder.get(holder);
    byHolder.set(holder, { share: (prev?.share ?? 0) + share, kind, nft: prev ? undefined : nft });
  }
  const locked = [...byHolder.values()].filter((h) => h.kind === "burned" || h.kind === "pons").reduce((s, h) => s + h.share, 0);
  if (locked >= 99) {
    const only = byHolder.size === 1 ? [...byHolder.values()][0] : null;
    add("ok", only?.kind === "burned" ? `Its liquidity is locked for good: the only LP NFT (#${only.nft}) sits at the burn address.`
      : only?.kind === "pons" ? "Its liquidity is locked in the Pons V2 LP vault." : "All of its liquidity is burned or in the Pons LP vault.");
  }
  for (const [holder, h] of byHolder) {
    if (h.kind === "wallet") add(h.share >= 50 ? "block" : "warn", `${num(h.share)}% of the pool's liquidity belongs to wallet ${short(holder)}, which can pull it at any time.`);
    if (h.kind === "contract" && h.share >= 10) add("warn", `${num(h.share)}% of the pool's liquidity sits with contract ${short(holder)}, which is not a known locker.`);
  }

  // 4. Who could empty the pool by selling, measured with the on-chain Quoter at the real amount.
  const apiKey = (() => { try { return readFileSync(".env.local", "utf8").match(/^EXPLORER_API_KEY=(.*)$/m)?.[1]?.replace(/["'\r]/g, ""); } catch { return undefined; } })();
  if (!apiKey) facts.push("no EXPLORER_API_KEY in .env.local, so holders were not checked");
  else if (poolQuoteRaw && poolQuoteRaw > 0n) {
    const skip = new Set([...NOT_SELLERS, ...census.map((p) => p.hooks.toLowerCase()), ...pairs.map((p) => p.pairAddress.toLowerCase())]);
    const r = await fetch(`https://api.blockscout.com/4663/api/v2/tokens/${token}/holders?apikey=${apiKey}`, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 Chrome/126.0" } }).catch(() => null);
    const items = r?.ok ? ((await r.json()) as { items?: { address: { hash: string; is_contract: boolean }; value: string }[] }).items ?? [] : [];
    const holders = items.filter((i) => !skip.has(i.address.hash.toLowerCase())).slice(0, 20).map((i) => ({ addr: i.address.hash, raw: BigInt(i.value), contract: i.address.is_contract }));
    if (!holders.length) add("warn", "The holder list could not be read, so nobody's ability to dump into the pool was measured.");
    else {
      const top10Raw = holders.slice(0, 10).reduce((s, h) => s + h.raw, 0n);
      const out = await client.simulateContract({
        address: DEFAULTS.quoter as Hex, abi: QUOTE_ABI, functionName: "quoteExactInputSingle",
        args: [{ poolKey: key, zeroForOne: tokenIs0, exactAmount: top10Raw, hookData: "0x" }], blockNumber: head,
      }).then((s) => s.result[0]).catch(() => null);
      const takes = out !== null ? units(out, qDecimals) : null;
      const share = takes !== null && poolQuote ? (100 * takes) / poolQuote : null;
      const bundle = largestCluster(holders.map((h) => units(h.raw)), supply);
      const exit = takes !== null
        ? `If the top 10 sold together they would take ${num(takes, 2)} of the pool's ${num(poolQuote!, 2)} ${q}.`
        : "The on-chain quote for the top 10 selling together did not answer.";
      const lookAlike = bundle ? ` ${bundle.count} of the top 20 hold near-identical amounts (${num(bundle.minPct, 2)}–${num(bundle.maxPct, 2)}% of supply each), typical of launch snipers.` : "";
      if (share === null || share > 50) {
        add("warn", `Thin exit: the top 10 holders own ${num((100 * units(top10Raw)) / supply)}% of supply.${lookAlike} ${exit}`);
      } else add("ok", `No holder group can drain the pool: the top 10 selling together would take ${num(share, 0)}% of it.`);
      const top = holders[0];
      facts.push(`largest seller-side holder ${top.addr} (${top.contract ? "contract" : "wallet"}) has ${num((100 * units(top.raw)) / supply, 2)}% of supply`);
    }
  }
  return report(token, symbol, head, started, found, facts, verbose);
}

/** Largest group among the top holders whose balances sit within BUNDLE.spread of each other. */
export function largestCluster(balances: readonly number[], supply: number) {
  let best: { count: number; total: number; minPct: number; maxPct: number } | null = null;
  for (const anchor of balances) {
    const group = balances.filter((b) => Math.abs(b - anchor) <= BUNDLE.spread * anchor && (100 * b) / supply >= BUNDLE.minSupplyPct);
    if (group.length >= BUNDLE.minWallets && (!best || group.length > best.count)) {
      best = { count: group.length, total: group.reduce((s, b) => s + b, 0), minPct: (100 * Math.min(...group)) / supply, maxPct: (100 * Math.max(...group)) / supply };
    }
  }
  return best;
}

function keyFromInit(init: Log): Key {
  const [fee, tickSpacing, hooks] = decodeAbiParameters([{ type: "uint24" }, { type: "int24" }, { type: "address" }], init.data);
  return { currency0: `0x${init.topics[2].slice(26)}` as Hex, currency1: `0x${init.topics[3].slice(26)}` as Hex, fee, tickSpacing, hooks };
}

/** Initialize and ModifyLiquidity for one pool, one topic per query: an OR'd topic caps the span at 100k blocks. */
async function poolLogs(client: ReturnType<typeof createPublicClient>, poolId: Hex, pair: Pair, head: bigint): Promise<Log[]> {
  const from = BigInt(Math.max(0, Number(head) - Math.ceil((Date.now() - (pair.pairCreatedAt ?? Date.now())) / 100) - 3_000));
  const logs: Log[] = [];
  for (const topic0 of [INIT, MODIFY]) {
    for (let f = from; f <= head; f += LOG_SPAN) {
      const t = f + LOG_SPAN - 1n < head ? f + LOG_SPAN - 1n : head;
      logs.push(...(await client.request({ method: "eth_getLogs", params: [{ address: PM, topics: [topic0 as Hex, poolId], fromBlock: `0x${f.toString(16)}`, toBlock: `0x${t.toString(16)}` }] }) as Log[]));
    }
  }
  return logs.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)));
}

function report(token: string, symbol: string, head: bigint, started: number, found: Finding[], facts: string[], verbose: boolean): number {
  const tty = process.stdout.isTTY;
  const c = (code: number, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const blocks = found.filter((f) => f.level === "block");
  const warns = found.filter((f) => f.level === "warn");
  const verdict = blocks.length ? c(31, "HIGH RISK") : warns.length ? c(33, "CAUTION") : c(32, "NO RED FLAGS FOUND");
  const icon = { block: c(31, "✖"), warn: c(33, "!"), ok: c(32, "✓") };
  console.log(`\n${c(1, symbol)}  ${token}  block ${head.toLocaleString("en-US")}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`\n${c(1, verdict)}  ${blocks.length} blocker${blocks.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"}\n`);
  for (const level of ["block", "warn", "ok"] as const) for (const f of found.filter((x) => x.level === level)) console.log(`  ${icon[level]} ${f.text}`);
  console.log(`\n  ${c(1, "What to do:")} ${advice(found)}`);
  if (verbose) for (const f of facts) console.log(c(2, `  · ${f}`));
  else console.log(c(2, "  --verbose shows the pool-by-pool table and the raw facts."));
  console.log("");
  return blocks.length ? 2 : warns.length ? 1 : 0;
}

function advice(found: Finding[]): string {
  const has = (level: Level, re: RegExp) => found.some((f) => f.level === level && re.test(f.text));
  if (has("block", /Honeypot|returns nothing|empty on chain|has been removed|can pull it/)) return "do not buy.";
  const parts: string[] = [];
  if (has("warn", /^Avoid the /)) parts.push("trade only through the pool marked as working, never the ones to avoid");
  if (has("warn", /Thin exit/)) parts.push("keep it small, the top holders can take most of the pool if they sell");
  if (has("warn", /could not|Could not|did not answer|could not be confirmed/)) parts.push("some checks did not complete, so treat this as unfinished");
  if (!found.some((f) => /Sells work/.test(f.text))) parts.push("a sell was not tested (run without --skip-hooks)");
  return parts.length ? `${parts.join("; ")}.` : "nothing on chain stops a sale right now. That is not a safety guarantee.";
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((e: unknown) => {
    console.error(`pre-trade check failed: ${String(e).slice(0, 300)}`);
    process.exitCode = 1;
  });
}
