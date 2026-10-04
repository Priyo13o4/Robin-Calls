import { parseAbi, parseAbiItem, toFunctionSelector } from "viem";
import {
  DANGEROUS_SELECTOR_DEFINITIONS,
  V4_HOOK_HONEYPOT_SIGNATURES,
} from "../security/selector-core";

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function owner() view returns (address)",
]);

/** Uniswap V3 QuoterV2 — used for the cheap honeypot pass (§7.3 pass 1). */
export const quoterV2Abi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/**
 * V3 SwapRouter `exactInputSingle` comes in TWO on-chain shapes and the deep
 * sell sim must encode the one the target router actually exposes, or the call
 * reverts on a *selector mismatch* and looks identical to a real sell-block
 * (a false honeypot). Verified on Robinhood Chain 4663: the primary Uniswap
 * router is a SwapRouter02 (`0x04e45aaf`, NO deadline), while SushiSwap and
 * PancakeSwap V3 use the classic SwapRouter (`0x414bf389`, WITH deadline).
 * `lib/dex/v3.ts::v3RouterFlavor` probes the router's bytecode to pick between
 * these; see that function.
 */

/** SwapRouter02 `exactInputSingle` — NO deadline field (selector 0x04e45aaf). */
export const swapRouterAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

/** Classic V3 SwapRouter `exactInputSingle` — WITH deadline (selector 0x414bf389). */
export const swapRouterClassicAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

/** Identity reads used to ensure all configured V3 periphery contracts agree. */
export const v3PeripheryIdentityAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
]);

/** Detect an accidental Uniswap V3 pool input before treating it as a token. */
export const v3PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function factory() view returns (address)",
  "function fee() view returns (uint24)",
]);

/**
 * V3 pool state reads for pool-scoped LP custody (§15.10).
 *
 * `liquidity()` is the pool's ACTIVE in-range liquidity, and it is exactly the
 * sum of the in-range positions' liquidity — which makes it the one honest
 * denominator for "what share of this pool does that wallet control?". No tick
 * math, no price assumptions, and a share can never exceed 100%.
 *
 * `positions(bytes32)` is keyed by keccak256(abi.encodePacked(owner, tickLower,
 * tickUpper)) — the pool's own per-owner-per-range accounting. For NFT positions
 * the `owner` is the NonfungiblePositionManager, not the human, so the NPM's
 * book has to be resolved separately (see lib/dex/v3-custody.ts).
 */
export const v3PoolStateAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function positions(bytes32 key) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

/**
 * Slipstream `CLPool` state. Identical to V3 except `slot0`, which has SIX
 * fields — there is no `feeProtocol` (CL takes its protocol cut through the
 * gauge's `unstakedFee`). Decoding it with V3's seven-field ABI throws
 * "position out of bounds", which is the first read `readV3LpCustody` makes, so
 * a shared reader without this ABI cannot custody a single CL pool.
 * `positions(bytes32)` and the NPM's `positions(uint256)` DO match V3 exactly
 * (5 and 12 words, verified on chain 2026-08-18).
 */
export const clPoolStateAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function positions(bytes32 key) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

/**
 * V3 pool `Mint` — every liquidity add on this pool. `owner` is indexed, so the
 * pool's own address filter plus this topic is a precise, token-scoped index of
 * who ever added liquidity HERE. For NFT positions `owner` is the NPM; the real
 * holder is recovered from the NPM `IncreaseLiquidity` log in the same tx.
 */
export const v3MintEvent = parseAbiItem(
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);

/**
 * V3/CL pool `Initialize` — emitted exactly once, in the transaction that opens
 * the pool. A5 (KNOWN-PROBLEMS L58) reads this to recover the pool's OWN opening
 * tick: `slot0().tick` has since moved, so it cannot answer "was the launch
 * mint's tickLower the pool's first price, or a position added onto one already
 * seeded?" — only the Initialize log can.
 */
/**
 * V3/CL pool `Burn` — the mirror of `Mint`: liquidity leaving a range. `owner`
 * is indexed and, for an NFT position, is the NonfungiblePositionManager rather
 * than the human — so `owner == deployer` catches only a DIRECT position and the
 * common case has to be attributed through the transaction's sender
 * (KNOWN-PROBLEMS L61, lib/dex/liquidity-pulls.ts).
 *
 * A zero-`amount` Burn is a fee "poke", not a removal; counting one as a pull
 * would accuse a deployer of pulling liquidity for collecting fees.
 */
export const v3BurnEvent = parseAbiItem(
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);

export const v3PoolInitializeEvent = parseAbiItem(
  "event Initialize(uint160 sqrtPriceX96, int24 tick)",
);

/**
 * A2 (KNOWN-PROBLEMS L58) — `LaunchFactory 0xf592…7e87`'s own events, read
 * from its verified ABI on Blockscout 2026-08-28. Both `token` and `creator`
 * are indexed, so a scan for one specific token is a single targeted
 * `eth_getLogs` topic filter per registered factory — never a genesis walk of
 * the factory's whole history. `DevBuy` in the SAME transaction hash as
 * `TokenLaunched` is the structural fact A2 exists to surface: chain-verified,
 * 10 of this factory's 14 launches qualify, 4 do not (lib/dex/launch-insider-buy.ts).
 */
export const launchFactoryTokenLaunchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, address pool, uint256 positionTokenId, string name, string symbol, bool antiSnipe)",
);
export const launchFactoryDevBuyEvent = parseAbiItem(
  "event DevBuy(address indexed token, address indexed creator, uint256 ethIn, uint256 tokensOut)",
);

/**
 * NPM `IncreaseLiquidity` — carries the position's tokenId. Emitted in the SAME
 * transaction as the pool's `Mint`, which is what lets a pool-scoped Mint log be
 * joined to an NFT and therefore to a real owner (`ownerOf`).
 */
export const npmIncreaseLiquidityEvent = parseAbiItem(
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
);

/**
 * NPM `Collect` — A3 (KNOWN-PROBLEMS, lock-terms-and-launch-forensics). Fired
 * whenever ANY caller pulls accrued fees off a position, `recipient` set by
 * whoever called `collect` (for a UNCX-locked position, the lock's
 * `additionalCollector`/`collectAddress`, per lock-terms.ts). Chain-verified
 * 2026-08-28 against NOCK's real position (NPM 0x73991a25c8…de0d3, tokenId
 * 527211): topic0 0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01
 * matches 13 real, decodable logs on that exact tokenId.
 */
export const npmCollectEvent = parseAbiItem(
  "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
);

/** NonfungiblePositionManager — LP custody pipeline (§7.2 lp_custody). */
export const npmAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
]);

export const v3FactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);

export const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;

// ── Uniswap V2 ──────────────────────────────────────────────────────────────
/** V2 factory — deterministic pair lookup; getPair returns zero when absent. */
export const v2FactoryAbi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address)",
  "function allPairsLength() view returns (uint256)",
]);

/** V2 pair — constant-product reserves + fungible LP token (ERC-20). */
export const v2PairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function factory() view returns (address)",
]);

/**
 * ERC-20 `Transfer`, with both parties INDEXED. For a Uniswap V2 pair (which is
 * itself the LP token), a `removeLiquidity` sends the caller's LP tokens INTO the
 * pair to be burned — `Transfer(from = LP owner, to = pair)`. So a topic-filtered
 * `getLogs` on the pair with `{from: deployer, to: pair}` is precise, token-scoped
 * proof that the deployer pulled liquidity from THIS pair (§15.9). We attribute on
 * this, NOT on the `Burn` event: a router-mediated removal emits `Burn(to =
 * router)`, so the reserves' recipient is the router, not the deployer.
 */
export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Classic Router02 — identity views + the two sell paths used by the V2 sim. */
export const v2Router02Abi = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  // Plain sell: returns amounts; reverts for fee-on-transfer tokens (K-invariant).
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  // Fee-tolerant sell: returns nothing; the honest exit path for taxed tokens.
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  // Buy probe (WOOD-class guard): a sell revert only convicts when buying works.
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
]);

// ── Uniswap V4 ──────────────────────────────────────────────────────────────
// V4 is a singleton: pools live inside PoolManager, keyed by a PoolKey whose
// hash is the poolId. State is read through the StateView periphery. The hooks
// address in the PoolKey is itself a honeypot vector — a malicious hook can
// block or tax swaps — so the adapter must inspect it, not just the swap.
export const v4StateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
]);

// Uniswap ReservesLens. The return tuple has unnamed members, so viem decodes it
// positionally: [0] coreAmount0, [1] coreAmount1, [12] hasCustomAccounting.
export const v4ReservesLensAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function getPoolTVL(address poolManager, PoolKey key) view returns ((uint256, uint256, uint256, uint256, uint256, uint256, uint160, int24, uint128, uint256, address, uint16, bool, uint8))",
]);

export const v4PoolManagerAbi = parseAbi([
  "function extsload(bytes32 slot) view returns (bytes32)",
]);

/**
 * V4Quoter — the periphery contract that simulates a swap through the singleton's
 * unlock/callback and, crucially, runs the pool's HOOK (beforeSwap/afterSwap).
 * `quoteExactInputSingle` is state-changing (it reverts internally to return the
 * result) so it is called via `eth_call`, never a `view`. A revert on the sell
 * direction while the buy direction quotes fine is the hook-level honeypot tell.
 * It does NOT settle real token balances, so it exercises the pool + hook, not
 * the token's own transfer restrictions — a PASS here is a pool/hook clearance,
 * not a full transfer clearance.
 */
export const v4QuoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  "error UnexpectedRevertBytes(bytes revertReason)",
]);

/**
 * PoolManager `Initialize` — emitted once per pool. `currency0`/`currency1` are
 * INDEXED, so a token's pools (hooked ones included) are found by a topic-filtered
 * `getLogs` rather than blind tier enumeration, and the log carries the full
 * PoolKey (fee, tickSpacing, hooks) needed to quote and to compute the poolId.
 */
export const v4InitializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

/**
 * PoolManager `ModifyLiquidity` — every liquidity add/remove inside the
 * singleton. `id` (the poolId) is INDEXED, so one topic-filtered getLogs gives
 * the complete liquidity history of ONE pool without touching any other. The
 * net sum of `liquidityDelta` per (sender, tickLower, tickUpper, salt) IS that
 * position's current liquidity — modifyLiquidity is the only way it changes.
 *
 * `sender` is the contract that called the PoolManager (the PositionManager for
 * NFT positions, or a hook / custom LP contract), NOT necessarily the human. For
 * PositionManager positions `salt` is bytes32(tokenId), which is what lets the
 * real owner be recovered via ownerOf (see lib/dex/v4-custody.ts).
 */
export const v4ModifyLiquidityEvent = parseAbiItem(
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
);

/** V4 PositionManager — ERC-721 over singleton positions; salt = bytes32(tokenId). */
export const v4PositionManagerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

/** Which pool a V4 PositionManager tokenId sits in; `info` packs ticks and is not decoded here. */
export const v4PositionInfoAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns (PoolKey poolKey, uint256 info)",
]);

/** CompoundingSeedTimelock (GAGE seed, verified 2026-09-15): one V4 NFT, released to TREASURY at releaseAt. */
export const compoundingSeedTimelockAbi = parseAbi([
  "function tokenId() view returns (uint256)",
  "function releaseAt() view returns (uint40)",
  "function released() view returns (bool)",
  "function TREASURY() view returns (address)",
  "function POSM() view returns (address)",
]);

/**
 * Uniswap V4 encodes a hook's callback permissions in the LOW 14 bits of its
 * address. The swap-affecting flags are the honeypot-relevant ones: a hook that
 * runs before/after a swap — or returns a delta from it — can tax, block, or
 * confiscate. This is descriptive evidence, never proof on its own.
 */
export const V4_HOOK_FLAGS = {
  BEFORE_SWAP: 1 << 7,
  AFTER_SWAP: 1 << 6,
  BEFORE_SWAP_RETURNS_DELTA: 1 << 3,
  AFTER_SWAP_RETURNS_DELTA: 1 << 2,
} as const;

/** A V4 PoolKey identifies a pool inside the singleton. */
export interface V4PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
  /**
   * The `Initialize` log's transaction — WHO opened this pool (L69(b)).
   *
   * Not part of the pool's identity: `poolIdOf` names its five fields
   * explicitly, so this cannot reach the hash. Optional because rows cached
   * before this field existed do not carry it, and because ABSENT MUST READ AS
   * "we do not know who opened it", never as "a stranger did" — the accusation
   * this enables is the one an unknown opener must not be able to trigger.
   */
  initTxHash?: `0x${string}`;
}

/**
 * EIP-1967 standard storage slots. A non-zero value in the implementation or
 * beacon slot means this address is an upgradeable proxy — the code you audit
 * today can be replaced by whoever controls the admin slot.
 */
export const EIP1967_SLOTS = {
  implementation:
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
} as const;

/**
 * Privileged functions that give a deployer post-launch power over holders.
 * Selectors are derived from signatures at load time (never hand-typed hex, so
 * they can't drift). We scan runtime bytecode for these 4-byte selectors.
 */
export interface DangerousFn {
  signature: string;
  selector: string; // 0x + 8 hex, lowercase
  label: string;
}

export const DANGEROUS_FUNCTIONS: DangerousFn[] = DANGEROUS_SELECTOR_DEFINITIONS.map((d) => ({
  ...d,
  selector: toFunctionSelector(d.signature).toLowerCase(),
}));

/**
 * Known malicious or discriminatory selectors found in Uniswap V4 hook bytecode (L205).
 * Hooks exposing these selectors restrict swaps to specific callers or enforce arbitrary traps.
 */
export const V4_HOOK_HONEYPOT_SELECTORS: ReadonlyMap<string, string> = new Map(
  V4_HOOK_HONEYPOT_SIGNATURES.map((signature) => [
    toFunctionSelector(signature).toLowerCase(),
    signature,
  ]),
);

/**
 * The plain ERC20 surface, and nothing else (§8 #16).
 *
 * Deliberately SHORT, and it must stay that way. `DANGEROUS_SIGNATURES` fails
 * toward an ALL-CLEAR when it is incomplete, so a gap there is unsafe; this list
 * fails toward a HEDGE, so a gap here is merely noisy. Never add a function to
 * this list to quiet a token down. Anything absent from both lists is a function
 * we READ but did not RECOGNISE, and recognition is what the published sentence
 * actually claims.
 */
export const BENIGN_ERC20_SELECTORS: ReadonlySet<string> = new Set(
  [
    "name()",
    "symbol()",
    "decimals()",
    "totalSupply()",
    "balanceOf(address)",
    "allowance(address,address)",
    "transfer(address,uint256)",
    "transferFrom(address,address,uint256)",
    "approve(address,uint256)",
    "increaseAllowance(address,uint256)",
    "decreaseAllowance(address,uint256)",
    "owner()",
    "renounceOwnership()",
    "transferOwnership(address)",
    "nonces(address)",
    "DOMAIN_SEPARATOR()",
    "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  ].map((sig) => toFunctionSelector(sig).toLowerCase())
);

import ozSelectorsJson from "./oz-selectors.json";

/**
 * OpenZeppelin recognition corpus compiled from official contracts.
 *
 * Matching a selector establishes its NAME, never its runtime behavior.
 * Anyone can write a function named after an OpenZeppelin interface that
 * behaves maliciously. It downgrades a function from 'unrecognised' to
 * 'recognised name, behavior unverified'. It must never promote anything
 * to 'verified safe'.
 *
 * Why this list must stay separate from BENIGN_WRITE_FUNCTION_NAMES:
 * BENIGN_WRITE_FUNCTION_NAMES in lib/audit/inventory.ts answers whether
 * an LP custody locker has withdrawal functions; in that domain, transfer()
 * is an asset-moving risk. This corpus answers whether a token dispatcher
 * function matches standard OpenZeppelin interfaces. The two questions
 * have opposite risk polarities and must not be merged.
 */
export const OPENZEPPELIN_SELECTORS: ReadonlyMap<string, string> = new Map(
  Object.entries(ozSelectorsJson as Record<string, string>)
);


// ── Contract & authority audit (docs/ways-of-work/plan/contract-audit/) ────

/** EIP-2535 diamond loupe — enumerate facets within AUDIT_MAX_DIAMOND_FACETS. */
export const diamondLoupeAbi = parseAbi([
  "struct Facet { address facetAddress; bytes4[] functionSelectors; }",
  "function facets() view returns (Facet[])",
  "function facetFunctionSelectors(address facet) view returns (bytes4[])",
  "function facetAddresses() view returns (address[])",
  "function facetAddress(bytes4 functionSelector) view returns (address)",
]);

/**
 * EIP-1167 minimal proxy: fixed 45-byte runtime code, target embedded between a
 * constant prefix and suffix. A clone is identified by exact byte match, not a
 * heuristic — these are the only two possible non-target bytes.
 */
export const MINIMAL_CLONE_PREFIX = "0x363d3d373d3d3d363d73";
export const MINIMAL_CLONE_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3";
/** L146 — Solady LibClone's 44-byte minimal proxy, same shape, different bytes. */
export const SOLADY_CLONE_PREFIX = "0x3d3d3d3d363d3d37363d73";
export const SOLADY_CLONE_SUFFIX = "0x5af43d3d93803e602a57fd5bf3";

/**
 * Gnosis/Safe singleton reads. A Safe proxy's singleton lives at storage slot
 * 0 (not an EIP-1967 slot — Safe predates that standard), so this ABI is
 * called against the address the resolver already read from slot 0, not the
 * proxy itself, except for `nonce()`/`VERSION()` which the proxy forwards via
 * its own fallback delegatecall and are used to corroborate the slot-0 read.
 */
export const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);

/** Sentinel module list start address, per Safe's ModuleManager convention. */
export const SAFE_SENTINEL_MODULES = "0x00000000000000000000000000000000000001" as const;

/** OpenZeppelin Ownable / Ownable2Step — the authority resolver's first probe. */
export const ownableAbi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
]);

/** OpenZeppelin AccessControl — role-graph reads for the authority resolver. */
export const accessControlAbi = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
]);

/** OpenZeppelin TimelockController — delay/role reads for the authority resolver. */
export const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
]);

/**
 * UNCX_LiquidityLocker_UniV3 — A1 (KNOWN-PROBLEMS L58). Fully verified on
 * chain 4663 at 0xf28704c691290547924e2129d407da36bda8ce0f; selectors and
 * field order confirmed against a live `getLock` read 2026-08-28 (see
 * lib/dex/lock-terms.ts's fixture). `getLock`'s Lock struct has ONLY static
 * members, so it is ABI-encoded INLINE with no leading offset word — do not
 * hand-decode this differently from what this ABI's own decoder does.
 */
export const uncxLockerAbi = parseAbi([
  "function getLocksLength() view returns (uint256)",
  "function getLock(uint256 _lockId) view returns ((uint256 lockId, address nftPositionManager, address pool, uint256 nftId, address owner, address pendingOwner, address additionalCollector, address collectAddress, uint256 unlockDate, uint16 countryCode, uint256 ucf))",
  "function ETERNAL_LOCK() view returns (uint256)",
]);

/**
 * UNCX_LiquidityLocker_UniV4 — UniV4LiquidityLockerV3 (0x128a800cbc615cc110bff16e475865c67631603a).
 * UNCX Uniswap V4 Liquidity Locker on chain 4663.
 */
export const uncxV4LockerAbi = parseAbi([
  "function getLockInfo(uint256 lockId) view returns ((uint256 lockId, address owner, uint256 tokenId, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 amount, uint256 unlockTime, address collectAddress, bool isNFTized, uint256 ucf))",
  "function ETERNAL_LOCK() view returns (uint256)",
  "function positionManager() view returns (address)",
  "function poolManager() view returns (address)",
]);

/**
 * UNCX_LiquidityLocker_UniV2 — UniswapV2Locker (0xb560307e7e02a58dbb03562aab32700255140e37).
 * UNCX Uniswap V2 Liquidity Locker on chain 4663.
 */
export const uncxV2LockerAbi = parseAbi([
  "function getNumLocksForToken(address _lpToken) view returns (uint256)",
  "function TOKEN_LOCKS(address _lpToken, uint256 _index) view returns (uint256)",
  "function LOCKS(uint256 _lockID) view returns (address lpToken, uint256 lockDate, uint256 amount, uint256 initialAmount, uint256 unlockDate, uint256 lockID, address owner, uint16 countryCode)",
  "function getNumLockedTokens() view returns (uint256)",
  "function getLockedTokenAtIndex(uint256 _index) view returns (address)",
  "function owner() view returns (address)",
  "function uniswapFactory() view returns (address)",
]);
