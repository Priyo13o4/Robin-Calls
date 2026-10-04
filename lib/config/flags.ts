/**
 * Feature flags. Everything defaults OFF so a fresh deploy is safe — features
 * light up only when explicitly enabled in the environment.
 */
const truthy = (v: string | undefined) =>
  v === "true" || v === "1" || v === "yes";

// Lives in ./env, not here: this module is mocked by several suites, and
// anything importing `firstSet` from it inherits those mocks.
import { firstSet } from "./env";

/**
 * Kill switches default ON: they exist to shed load in an emergency
 * (PRD §20.6), so absence of the variable must mean "feature is live".
 */
const notDisabled = (v: string | undefined) =>
  v !== "false" && v !== "0" && v !== "no";

export const flags = {
  /** Master switch for POST /api/scan. */
  get publicScan() {
    return notDisabled(process.env.ENABLE_PUBLIC_SCAN);
  },
  /** When off, only cached/database verdicts are served — no new pipelines. */
  get freshScan() {
    return notDisabled(process.env.ENABLE_FRESH_SCAN);
  },
  /** When off, scans complete but write no new ledger receipts. */
  get ledgerAppend() {
    return notDisabled(process.env.ENABLE_LEDGER_APPEND);
  },
  /**
   * MCP. Retired from Next.js on 2026-08-02 — the server now lives at `/mcp`
   * on the FastAPI agent plane (`services/agent`), which nginx routes to a
   * separate upstream. Nothing in *this* process reads the flag to serve a
   * request any more — it is read by `settings.py` on the Python side, where
   * off means `/mcp` returns 404. What this value still drives here is the
   * capacity dashboard, so the two must agree: for one release nothing read
   * the flag at all, the tile rendered "MCP server: off", and the endpoint
   * served the internet.
   *
   * The cutover cost nothing because `ENABLE_MCP` had never been turned on in
   * production, so `/api/mcp` returned 404 and no client config pointed at it.
   * That window is now closed: `/mcp` is the one true endpoint.
   */
  mcp: truthy(process.env.ENABLE_MCP),
  /** Wanted Board ingestion — gated on PRD §7.6 rug criteria (open item). */
  wantedIngestion: truthy(process.env.ENABLE_WANTED_INGESTION),
  /** Phase 3 #4 — funding-lineage tracing job (writes wallet_stains). */
  lineageTrace: truthy(process.env.ENABLE_LINEAGE_TRACE),
  /** Phase 3 §4.3 — slow-rug (gradual-drain) monitor job. */
  slowRugMonitor: truthy(process.env.ENABLE_SLOW_RUG_MONITOR),
  /** Wave D — Uniswap V2 adapter (constant-product pairs). */
  uniswapV2: truthy(process.env.ENABLE_UNISWAP_V2),
  /** Wave D — Uniswap V4 adapter (singleton PoolManager + hooks). */
  uniswapV4: truthy(process.env.ENABLE_UNISWAP_V4),
  /**
   * Whitelist onboarding — RETIRED 2026-09-04, dormant by construction.
   *
   * Deliberately NOT read from env: the surface is being stood down, not
   * merely switched off, so setting NEXT_PUBLIC_ENABLE_WHITELIST can no longer
   * bring it back. The public buttons are gone (see AppSidebar, SiteNav,
   * app/page.tsx, RwaDetailClient); this literal is what keeps POST
   * /api/whitelist refusing and the modal unmountable behind them.
   *
   * The typed `false` is load-bearing — it makes every `flags.whitelist &&`
   * call site statically dead, so anything still reachable through the flag
   * shows up as an unused import rather than hiding until runtime.
   *
   * To revive: restore the env read here AND re-add the call sites. Admin
   * (/admin/whitelist) and the GET read path stay live on purpose — existing
   * signups are a record, and deleting the record is not what "off" means.
   */
  whitelist: false as const,
  /**
   * Launch registry ingest job (ARCHITECTURE.md §6).
   * Retired in favor of the realtime sequencer stream (lib/sequencer/).
   * Default OFF; overridable with ENABLE_LAUNCH_INGEST="true" for emergency rollback.
   */
  get launchIngest() {
    return truthy(process.env.ENABLE_LAUNCH_INGEST);
  },
  /**
   * Arbitrum Nitro sequencer WebSocket stream ingest (PRD §2, §6).
   * Default ON: live block/tx streaming from local relay into real-time pipelines.
   */
  get sequencerIngest() {
    return notDisabled(process.env.ENABLE_SEQUENCER_INGEST) && !truthy(process.env.ENABLE_LAUNCH_INGEST);
  },
  /** Daily copy of Uniswap's public hook list. Kill switch: reference text only, no RPC. */
  get hooklistSync() {
    return notDisabled(process.env.ENABLE_HOOKLIST_SYNC);
  },
  /** One-time V4 Initialize backfill from genesis into v4_pools. Built, off by default. */
  get v4PoolBackfill() {
    return truthy(process.env.ENABLE_V4_POOL_BACKFILL);
  },
  /** Sweeps pool liquidity and reserves to update pool_depth. Default OFF. */
  get poolDepthSweep() {
    return truthy(process.env.ENABLE_POOL_DEPTH_SWEEP);
  },
  /** LP position recording and custody reads. Default OFF until explicitly enabled. */
  get lpPositions() {
    return truthy(process.env.ENABLE_LP_POSITIONS);
  },
  /**
   * M8 — wires the built-but-orphaned contract/authority audit (lib/audit/*)
   * into the scan pipeline and verdict. Off by default: the audit engine
   * (M1-M7) is unit-tested in isolation but has never run inside a real scan.
   * When off, a scan is byte-identical to today (docs/ways-of-work/plan/
   * contract-audit/full-contract-authority-audit/implementation-plan.md).
   */
  contractAuthorityAudit: truthy(process.env.ENABLE_CONTRACT_AUTHORITY_AUDIT),
  /**
   * A5 (KNOWN-PROBLEMS L58) — recognise the one-sided full-supply V3 launch
   * shape and fold it into the LP_CONCENTRATED hedge sentence. Recognition
   * only: `decideCustodyState` has no parameter for this label and cannot
   * read it — see lib/dex/launch-shape.ts's hard constraint. Off by default
   * until traced against a second live token beyond NOCK.
   */
  launchShapeRecognition: truthy(process.env.ENABLE_LAUNCH_SHAPE_RECOGNITION),
  /**
   * A4 (KNOWN-PROBLEMS L58) — split `launchpad_provenance`'s SKIP prose into
   * "deployed by a one-shot contract" (counts the deployer's lifetime
   * TokenLaunched-class events) vs "registry does not know this factory". No
   * score change — see lib/scanner/checks/provenance-history.ts.
   */
  oneShotLaunchClassification: truthy(process.env.ENABLE_ONE_SHOT_LAUNCH_CLASSIFICATION),
  /**
   * A2 (KNOWN-PROBLEMS L58) — flag an insider buy that lands in the SAME
   * transaction as the pool's own Initialize (structurally impossible for an
   * outsider to reach). Distinct from the removed `sniper` tag (2026-08-07),
   * which was a time-window heuristic — this is an exact same-tx fact, no
   * sampling. See lib/dex/launch-insider-buy.ts.
   */
  launchTxInsiderBuy: truthy(process.env.ENABLE_LAUNCH_TX_INSIDER_BUY),
  /**
   * A3 (KNOWN-PROBLEMS L58) — surface cumulative LP-owner fee collection
   * (UNCX `collect`, which carries no time gate) as prose. No scoring until a
   * population count justifies a threshold — see lib/dex/lp-fee-collection.ts.
   */
  lpFeeCollectionSurface: truthy(process.env.ENABLE_LP_FEE_COLLECTION_SURFACE),
  /** First-party analytics ingest job (analytics PRD). Off until migration applied. */
  analyticsIngest: truthy(process.env.ENABLE_ANALYTICS_INGEST),
  /** Per-pool Mint/Burn/Collect/ModifyLiquidity history index. Default OFF: prod gets the
   *  locally built store imported first, so the job only ever appends the tail there. */
  get liquidityHistory() {
    return truthy(process.env.ENABLE_LIQUIDITY_HISTORY);
  },
  /**
   * Single swap deploy ceiling. The /admin/swap settings remain independent
   * operator gates for execution, venues, and optional multihop routing.
   */
  get swapTrading() {
    const master = process.env.ENABLE_SWAP_TRADING;
    return truthy(master);
  },
  /** Compatibility aliases for existing quote and config call sites. */
  get swapQuotes() {
    const master = process.env.ENABLE_SWAP_TRADING;
    return truthy(master);
  },
  get swapExecution() {
    const master = process.env.ENABLE_SWAP_TRADING;
    return truthy(master);
  },
  /**
   * P1 same-family two-hop Universal Router routes (docs/cross-dex-router/MULTIHOP-ROUTER-PRD.md).
   * OFF by default; when off, direct swap planning remains byte-identical.
   */
  get swapMultihop() {
    return truthy(process.env.ENABLE_SWAP_TRADING);
  },
  /** Gasless routing is retired; no environment variable can enable it. */
  /** Env is the deploy ceiling; the runtime switch lives in /admin/swap (lib/swap/config.ts). */
  equityBasis: truthy(process.env.ENABLE_EQUITY_BASIS),
  /**
   * The wallet-connect surface itself (the sidebar connect/disconnect action),
   * deliberately independent of `whitelist` — the wallet must be able to ship
   * without whitelist onboarding standing up behind it, which is exactly the
   * production shape: wallet ON, whitelist OFF.
   *
   * MUST be NEXT_PUBLIC: AppSidebar renders client-side, so a bare server var
   * is not readable there and would render the button as permanently off.
   * That also makes it BUILD-time — changing it needs a rebuild, not a restart.
   * `NEXT_PUBLIC_ENABLE_WALLET_TESTING` is still honoured so an already-set
   * environment keeps working; prefer the new name.
   */
  wallet: truthy(
    firstSet(process.env.NEXT_PUBLIC_ENABLE_WALLET, process.env.NEXT_PUBLIC_ENABLE_WALLET_TESTING),
  ),
  /**
   * The PUBLIC /token-sale route. Off = the route 404s; the admin cockpit at
   * /admin/token-sale is NOT gated by this (it is requireAdmin-only and is how
   * the sale gets driven and tested while the public page stays dark).
   *
   * Deliberately NOT NEXT_PUBLIC: the gate runs in the page's own server render
   * (the route is already force-dynamic), so a bare var works — and that makes
   * it a RUNTIME kill switch, flippable with an env edit + restart instead of a
   * rebuild. Note the sale is inert without an address anyway
   * (lib/sale/address.ts); this is the switch that also removes the surface.
   */
  /**
   * Also gates the referral plane — codes, the contribution mirror, the
   * leaderboards and the airdrop snapshot (docs/prds/REFERRALS.md). ONE switch, not
   * two: referrals have no meaning without a sale, and a second flag would let
   * the two disagree, which is a referral surface live on a page that 404s.
   */
  tokenSale: truthy(process.env.ENABLE_TOKEN_SALE),
} as const;

/**
 * Stamped on every rug row so any indictment is re-derivable against the exact
 * rules that produced it. Bump this whenever the criteria's *math* changes, not
 * just its wording — 0.2 counts a confirmed honeypot's trapped liquidity as
 * harm (was: drained-only, which scored a live trap at $0); 0.3 retires
 * criterion C as an indictment source (a USD-TVL decline alone is not evidence
 * of a withdrawal — see lib/wanted/rug-criteria.ts).
 *
 * 0.4 — criterion A's math is unchanged, but it can now RECEIVE evidence it
 * never could: `deployer_pulled_liquidity` gained V3/V4 legs (L61). With C
 * retired at 0.3, a tradeable V4 rug was reachable by no criterion at all, so
 * every candidate judged under 0.3 was judged over a hole. Bumping is what
 * re-evaluates them.
 *
 * CODE-ONLY, deliberately — this used to read `process.env.RUG_CRITERIA_VERSION`
 * and the production container pinned it to `0.2-draft`, so the default below
 * was dead and two bumps never took effect. `processRugCandidate` supersedes a
 * board row when this string moves, which makes it the mechanism for retracting
 * a published accusation: an env var that can freeze it is an env var that can
 * freeze a correction in place (KNOWN-PROBLEMS L16; same shape as the
 * prompt-version pin resolved 2026-08-18).
 *
 * A dial whose whole purpose is to force re-evaluation must not be overridable
 * by configuration that then goes stale. `tests/wanted-producer.test.ts` pins
 * the absence of the override.
 */
export const RUG_CRITERIA_VERSION = "0.4-draft";
