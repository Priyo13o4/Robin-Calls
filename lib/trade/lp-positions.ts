import { decodeAbiParameters, type Hex } from "viem";
import {
  V4_POOL_MANAGER,
  V4_MODIFY,
  V3_MINT,
  V3_BURN,
  NPM_INCREASE_LIQUIDITY,
  NPM_DECREASE_LIQUIDITY,
  type RawLpLog,
} from "./lp-events";

export const V4_POSITION_MANAGER = "0x58daec3116aae6d93017baaea7749052e8a04fa7";
/** V3 NFT position managers seen pairing with pool Mints on chain (2026-10-02). Their pool events are never direct positions. */
export const V3_POSITION_MANAGERS: ReadonlySet<string> = new Set([
  "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  "0x07f44c47743a2f36414a82b9f558ecfcf0eedcef",
  "0x2ebd7b85a4e08d5b508b04ba147976c94afe6590",
  "0xe62a5f67516dbdba2aa28b1512c8ff44e42cb5c3",
]);

export interface PositionPiece {
  block: number;
  delta: bigint;
}

export interface PositionDelta {
  protocol: "v3" | "v4";
  manager: string | null;
  tokenId: bigint | null;
  holder: string | null;
  tickLower: number;
  tickUpper: number;
  delta: bigint;
  lastBlock: number;
  pieces: PositionPiece[];
}

export interface UnpairedLiquidity {
  tx: string;
  /** Null for a manager-owned pool Mint/Burn whose NFT event did not pair. */
  tokenId: bigint | null;
}

export interface FoldedPositions {
  deltas: Map<string, Map<string, PositionDelta>>;
  unpaired: UnpairedLiquidity[];
}

interface IntermediateDelta {
  pool: string;
  positionKey: string;
  protocol: "v3" | "v4";
  manager: string | null;
  tokenId: bigint | null;
  holder: string | null;
  tickLower: number;
  tickUpper: number;
  delta: bigint;
  block: number;
  logIndex: number;
}

interface V3MintCandidate {
  pool: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  amount: bigint;
  block: number;
  logIndex: number;
  paired: boolean;
}

interface V3BurnCandidate {
  pool: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  amount: bigint;
  block: number;
  logIndex: number;
  paired: boolean;
}

interface NpmLiquidityLog {
  tx: string;
  npm: string;
  tokenId: bigint;
  liquidity: bigint;
  block: number;
  logIndex: number;
}

/** Pure fold: aggregates V3/V4 position deltas across logs, sorted by block and logIndex. */
export function foldPositionDeltas(logs: readonly RawLpLog[]): FoldedPositions {
  const intermediate: IntermediateDelta[] = [];
  const unpaired: UnpairedLiquidity[] = [];

  // Group logs by tx for V3 pairing while sorting all entries by (block, logIndex).
  const txOrder: string[] = [];
  const byTx = new Map<string, RawLpLog[]>();
  const sorted = [...logs].sort((a, b) => {
    const bA = Number(BigInt(a.blockNumber));
    const bB = Number(BigInt(b.blockNumber));
    if (bA !== bB) return bA - bB;
    const iA = Number(BigInt(a.logIndex ?? 0));
    const iB = Number(BigInt(b.logIndex ?? 0));
    return iA - iB;
  });

  for (const log of sorted) {
    const tx = String(log.transactionHash).toLowerCase();
    let list = byTx.get(tx);
    if (!list) {
      list = [];
      byTx.set(tx, list);
      txOrder.push(tx);
    }
    list.push(log);
  }

  for (const tx of txOrder) {
    const txLogs = byTx.get(tx) ?? [];
    const mints: V3MintCandidate[] = [];
    const burns: V3BurnCandidate[] = [];
    const increases: NpmLiquidityLog[] = [];
    const decreases: NpmLiquidityLog[] = [];

    for (const log of txLogs) {
      const t0 = log.topics[0];
      const emitter = log.address.toLowerCase();
      const block = Number(BigInt(log.blockNumber));
      const logIndex = Number(BigInt(log.logIndex ?? 0));

      // V4 ModifyLiquidity: PoolManager emitter only; delta 0 settles fees.
      if (t0 === V4_MODIFY && emitter === V4_POOL_MANAGER.toLowerCase()) {
        try {
          if (!log.topics[1] || !log.topics[2]) continue;
          const pool = log.topics[1].toLowerCase();
          const [sender] = decodeAbiParameters([{ type: "address" }], log.topics[2]);
          const senderLower = sender.toLowerCase();
          const [tickLower, tickUpper, delta, salt] = decodeAbiParameters(
            [{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }],
            log.data
          );
          if (delta === 0n) continue;

          const isNpm = senderLower === V4_POSITION_MANAGER.toLowerCase();
          const manager = isNpm ? V4_POSITION_MANAGER.toLowerCase() : null;
          const tokenId = isNpm ? BigInt(salt) : null;
          const holder = isNpm ? null : senderLower;
          const positionKey = `${senderLower}:${tickLower}:${tickUpper}:${salt.toLowerCase()}`;

          intermediate.push({
            pool,
            positionKey,
            protocol: "v4",
            manager,
            tokenId,
            holder,
            tickLower,
            tickUpper,
            delta,
            block,
            logIndex,
          });
        } catch {
          // Lookalike or malformed payload.
        }
        continue;
      }

      // V3 Mint
      if (t0 === V3_MINT) {
        try {
          if (!log.topics[1] || !log.topics[2] || !log.topics[3]) continue;
          const [owner] = decodeAbiParameters([{ type: "address" }], log.topics[1]);
          const [tickLower] = decodeAbiParameters([{ type: "int24" }], log.topics[2]);
          const [tickUpper] = decodeAbiParameters([{ type: "int24" }], log.topics[3]);
          const [, amount] = decodeAbiParameters(
            [{ type: "address" }, { type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
            log.data
          );
          if (amount === 0n) continue;
          mints.push({
            pool: emitter,
            owner: owner.toLowerCase(),
            tickLower,
            tickUpper,
            amount,
            block,
            logIndex,
            paired: false,
          });
        } catch {
          // Malformed Mint.
        }
        continue;
      }

      // V3 Burn
      if (t0 === V3_BURN) {
        try {
          if (!log.topics[1] || !log.topics[2] || !log.topics[3]) continue;
          const [owner] = decodeAbiParameters([{ type: "address" }], log.topics[1]);
          const [tickLower] = decodeAbiParameters([{ type: "int24" }], log.topics[2]);
          const [tickUpper] = decodeAbiParameters([{ type: "int24" }], log.topics[3]);
          const [amount] = decodeAbiParameters(
            [{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
            log.data
          );
          if (amount === 0n) continue;
          burns.push({
            pool: emitter,
            owner: owner.toLowerCase(),
            tickLower,
            tickUpper,
            amount,
            block,
            logIndex,
            paired: false,
          });
        } catch {
          // Malformed Burn.
        }
        continue;
      }

      // NPM IncreaseLiquidity
      if (t0 === NPM_INCREASE_LIQUIDITY) {
        try {
          if (!log.topics[1]) continue;
          const [tokenId] = decodeAbiParameters([{ type: "uint256" }], log.topics[1]);
          const [liquidity] = decodeAbiParameters(
            [{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
            log.data
          );
          if (liquidity === 0n) continue;
          increases.push({
            tx,
            npm: emitter,
            tokenId,
            liquidity,
            block,
            logIndex,
          });
        } catch {
          // Malformed IncreaseLiquidity.
        }
        continue;
      }

      // NPM DecreaseLiquidity
      if (t0 === NPM_DECREASE_LIQUIDITY) {
        try {
          if (!log.topics[1]) continue;
          const [tokenId] = decodeAbiParameters([{ type: "uint256" }], log.topics[1]);
          const [liquidity] = decodeAbiParameters(
            [{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
            log.data
          );
          if (liquidity === 0n) continue;
          decreases.push({
            tx,
            npm: emitter,
            tokenId,
            liquidity,
            block,
            logIndex,
          });
        } catch {
          // Malformed DecreaseLiquidity.
        }
        continue;
      }
    }

    // Pair IncreaseLiquidity with nearest earlier V3 Mint in same tx within 5 logIndexes.
    for (const inc of increases) {
      let matchedMint: V3MintCandidate | null = null;
      for (const m of mints) {
        if (m.paired || m.logIndex >= inc.logIndex || inc.logIndex - m.logIndex > 5) continue;
        if (m.owner === inc.npm) {
          if (!matchedMint || m.logIndex > matchedMint.logIndex) {
            matchedMint = m;
          }
        }
      }

      if (matchedMint) {
        matchedMint.paired = true;
        intermediate.push({
          pool: matchedMint.pool,
          positionKey: `${inc.npm}:${inc.tokenId.toString()}`,
          protocol: "v3",
          manager: inc.npm,
          tokenId: inc.tokenId,
          holder: null,
          tickLower: matchedMint.tickLower,
          tickUpper: matchedMint.tickUpper,
          delta: inc.liquidity,
          block: inc.block,
          logIndex: inc.logIndex,
        });
      } else {
        unpaired.push({ tx: inc.tx, tokenId: inc.tokenId });
      }
    }

    // Pair DecreaseLiquidity with nearest earlier V3 Burn in same tx within 5 logIndexes.
    for (const dec of decreases) {
      let matchedBurn: V3BurnCandidate | null = null;
      for (const b of burns) {
        if (b.paired || b.logIndex >= dec.logIndex || dec.logIndex - b.logIndex > 5) continue;
        if (b.owner === dec.npm) {
          if (!matchedBurn || b.logIndex > matchedBurn.logIndex) {
            matchedBurn = b;
          }
        }
      }

      if (matchedBurn) {
        matchedBurn.paired = true;
        intermediate.push({
          pool: matchedBurn.pool,
          positionKey: `${dec.npm}:${dec.tokenId.toString()}`,
          protocol: "v3",
          manager: dec.npm,
          tokenId: dec.tokenId,
          holder: null,
          tickLower: matchedBurn.tickLower,
          tickUpper: matchedBurn.tickUpper,
          delta: -dec.liquidity,
          block: dec.block,
          logIndex: dec.logIndex,
        });
      } else {
        unpaired.push({ tx: dec.tx, tokenId: dec.tokenId });
      }
    }

    // A manager's unpaired pool event belongs to an NFT we could not name; storing it with the manager
    // as holder would publish the wrong party, so it is counted as unpaired instead.
    const managers = new Set([...V3_POSITION_MANAGERS, ...increases.map((x) => x.npm), ...decreases.map((x) => x.npm)]);
    const managerOwned = (owner: string) => managers.has(owner);

    // Unpaired Mints become direct positions.
    for (const m of mints) {
      if (m.paired) continue;
      if (managerOwned(m.owner)) { unpaired.push({ tx, tokenId: null }); continue; }
      intermediate.push({
        pool: m.pool,
        positionKey: `${m.owner}:${m.tickLower}:${m.tickUpper}`,
        protocol: "v3",
        manager: null,
        tokenId: null,
        holder: m.owner,
        tickLower: m.tickLower,
        tickUpper: m.tickUpper,
        delta: m.amount,
        block: m.block,
        logIndex: m.logIndex,
      });
    }

    // Unpaired Burns become direct positions.
    for (const b of burns) {
      if (b.paired) continue;
      if (managerOwned(b.owner)) { unpaired.push({ tx, tokenId: null }); continue; }
      intermediate.push({
        pool: b.pool,
        positionKey: `${b.owner}:${b.tickLower}:${b.tickUpper}`,
        protocol: "v3",
        manager: null,
        tokenId: null,
        holder: b.owner,
        tickLower: b.tickLower,
        tickUpper: b.tickUpper,
        delta: -b.amount,
        block: b.block,
        logIndex: b.logIndex,
      });
    }
  }

  // Sort deltas across all txs by (block, logIndex) and sum per position.
  intermediate.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

  const deltas = new Map<string, Map<string, PositionDelta>>();
  for (const item of intermediate) {
    let poolMap = deltas.get(item.pool);
    if (!poolMap) {
      poolMap = new Map();
      deltas.set(item.pool, poolMap);
    }
    const existing = poolMap.get(item.positionKey);
    if (!existing) {
      poolMap.set(item.positionKey, {
        protocol: item.protocol,
        manager: item.manager,
        tokenId: item.tokenId,
        holder: item.holder,
        tickLower: item.tickLower,
        tickUpper: item.tickUpper,
        delta: item.delta,
        lastBlock: item.block,
        pieces: [{ block: item.block, delta: item.delta }],
      });
    } else {
      existing.delta += item.delta;
      existing.lastBlock = item.block;
      existing.pieces.push({ block: item.block, delta: item.delta });
    }
  }

  return { deltas, unpaired };
}
