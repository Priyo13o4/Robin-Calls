"use client";

import { createPublicClient, http, erc20Abi, isAddress, type PublicClient } from "viem";
import {
  clientDexScreenerSearch,
  clientWebFetch,
  clientWebSearch,
  type BriefCompleteness,
} from "@/lib/mcp/parallel-search-client";

/**
 * Browser-side executors for CLIENT-locale agent tools.
 *
 * Chain reads run in the visitor's own browser against a public, keyless RPC
 * endpoint. Web and DexScreener tools use their own public HTTPS providers and
 * deliberately skip all RPC setup. That is the whole economic point: a free-tier conversation can
 * read the chain without spending a single call from our provider budget,
 * which is what makes the free tier viable *and* leaves the paid tier
 * something real to sell (failover, circuit breakers, CU limiting, deadline
 * preservation).
 *
 * ── Two rules ───────────────────────────────────────────────────────────────
 *
 * **Only endpoints the server handed us.** `RPC_ENDPOINTS_JSON` on the server
 * carries secrets — an Alchemy key in a path, a Goldsky `?secret=` query — and
 * must never reach this file. The endpoints below arrive from
 * `GET /agent/config`, which serves a separate keyless allowlist that the
 * agent's settings validate for credential shapes at load time. Never hardcode
 * an endpoint here and never accept one from the page URL.
 *
 * **Every result is labelled.** A client RPC that is 500 blocks behind returns
 * confidently stale data with no error at all, and a user pointed at another
 * chain gets a real, well-formed, wrong answer for any address — which is
 * every address, since addresses are not chain-scoped. So each result carries
 * a provenance envelope and the server re-checks it before the model sees it.
 * Trusting the browser is not the model here; labelling it is.
 *
 * Nothing honeypot-shaped may ever be added to this file. viem throws
 * identically for a revert and a timeout, `isTransientRpcError` is what tells
 * them apart, and it lives server-side — a client sell simulation cannot
 * distinguish "you cannot sell" from "the node did not answer", and a hostile
 * endpoint could manufacture "you can sell fine" on a token that traps
 * everyone.
 */

export const AGENT_CHAIN_ID = 4663;

export interface ClientRpcConfig {
  chainId: number;
  endpoints: string[];
  maxBlockLag: number;
  /**
   * Where a client-side contract audit fetches verified source.
   *
   * Served by `GET /agent/config` for the same reason the endpoints are, and
   * validated keyless by the same rule: a URL that reaches the browser is
   * public forever. Optional so an older agent build (or a test fixture)
   * without the field degrades to no live audit rather than to a wrong one.
   */
  explorerApiUrl?: string;
}

export interface Provenance {
  source: "client-rpc" | "parallel-mcp" | "dexscreener";
  endpointHost?: string;
  chainId?: number;
  blockNumber?: number;
  observedAt?: string;
  fetchedAt?: string;
  completeness?: BriefCompleteness;
}

export interface ClientToolResult {
  value: unknown;
  provenance: Provenance;
}

export interface ClientToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ClientToolOutcome {
  tool_use_id: string;
  name: string;
  result?: ClientToolResult;
  error?: string;
}

function address(args: Record<string, unknown>, key: string): `0x${string}` {
  const raw = String(args[key] ?? "").trim();
  // `strict: false` deliberately — this must accept exactly what
  // `lib/internal/reads.ts` accepts. viem's default validates EIP-55 checksums
  // on mixed-case input while the server lowercases and regex-tests, so the
  // same tool call from the same model succeeded server-locale and failed
  // client-locale on any address a user pasted with the wrong casing. One
  // argument, one meaning, on both sides of the same tool.
  if (!isAddress(raw, { strict: false })) throw new Error(`\`${key}\` is not a valid address.`);
  return raw.toLowerCase() as `0x${string}`;
}

const CREDENTIAL_HINT = /(api[-_]?key|apikey|secret|token|auth|password|access[-_]?key|bearer)/i;

/**
 * Refuse any endpoint that could carry a provider credential.
 *
 * A deliberate duplicate of `assert_keyless` in `services/agent/app/settings.py`,
 * and the duplication is the point: that validator runs on a list the server
 * loaded from its own environment, while *this* function runs on whatever
 * object reaches the browser. The security argument for client-side RPC is the
 * allowlist — and an allowlist enforced only where the values are already
 * trusted is not enforcement, it is a comment.
 *
 * Rejects on shape rather than against a list of known providers, because the
 * next provider we add will not be on that list. A false rejection costs one
 * config edit; a false acceptance ships a paid key to every visitor's devtools,
 * permanently and irreversibly.
 */
export function assertKeylessEndpoint(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Client RPC endpoint is not a URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Client RPC endpoints must be https.");
  }
  if (parsed.search) {
    // Goldsky's form is `?secret=…`. No public RPC needs a query string, so
    // refusing all of them is cheaper than trying to classify them.
    throw new Error("Query strings are not allowed on a client RPC URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Userinfo credentials are not allowed on a client RPC URL.");
  }
  if (CREDENTIAL_HINT.test(parsed.pathname)) {
    throw new Error("Client RPC URL path looks like it contains a credential.");
  }
  // Alchemy's form is `/v2/<long opaque key>` — a random-looking final segment.
  for (const segment of parsed.pathname.split("/")) {
    if (segment.length >= 20 && /^[A-Za-z0-9_-]+$/.test(segment)) {
      throw new Error(`Client RPC URL path segment ${segment} looks like an API key.`);
    }
  }
  return parsed;
}

/**
 * A client over the first endpoint the server allowed.
 *
 * Deliberately no failover across the list. Failover state that lives in one
 * browser tab is invisible to everyone else and teaches us nothing, and a
 * client-side read that fails simply degrades to the server-locale path for
 * that turn — which is the correct outcome, not a problem to engineer around.
 */
function clientFor(config: ClientRpcConfig): { client: PublicClient; host: string } {
  const url = config.endpoints[0];
  if (!url) throw new Error("No client RPC endpoint was configured.");
  const parsed = assertKeylessEndpoint(url);
  return {
    client: createPublicClient({ transport: http(parsed.toString()) }) as PublicClient,
    host: parsed.hostname,
  };
}

type Executor = (
  client: PublicClient,
  args: Record<string, unknown>,
  config: ClientRpcConfig,
  signal?: AbortSignal
) => Promise<unknown>;

/**
 * One entry per CLIENT-locale tool in `services/agent/app/tools.toml`.
 *
 * `services/agent/tests/test_registry.py` pins the two files against each
 * other — it is the only place that can see both halves. A
 * client-locale tool declared with no executor here would be offered to the
 * model, requested, and fail every single time — silently, since the failure
 * looks exactly like an RPC hiccup.
 */
export const CLIENT_TOOLS: Record<string, Executor> = {
  get_block_number: async (client) => ({
    blockNumber: Number(await client.getBlockNumber()),
    observedAt: new Date().toISOString(),
  }),

  get_token_meta: async (client, args) => {
    const token = address(args, "address");
    // Independently nullable on purpose: plenty of real tokens omit name or
    // symbol, and a reverting decimals() is a fact about the token rather than
    // a failure of the read. One rejected call must not void the other three.
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "name" }).catch(() => null),
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
      client
        .readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" })
        .catch(() => null),
    ]);
    return {
      address: token,
      name,
      symbol,
      decimals: decimals === null ? null : Number(decimals),
      totalSupply: totalSupply === null ? null : String(totalSupply),
    };
  },

  get_token_balance: async (client, args) => {
    const token = address(args, "token");
    const holder = address(args, "holder");
    const balance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder],
    });
    // Raw and unscaled. Scaling here would mean assuming decimals, and every
    // USDG impersonator on this chain uses 18 where the real one uses 6.
    return { token, holder, balance: String(balance) };
  },

  /**
   * The full contract-authority audit, run here in the tab.
   *
   * The only executor in this file that is not a single read — and, unlike the
   * three above, it contains no analysis of its own. It builds the browser
   * ENVIRONMENT and hands it to the same `lib/audit/` modules the scan engine
   * runs: the same proxy resolver, the same capability classifier, the same
   * authority resolution. A second implementation living in client code is the
   * thing this whole seam exists to prevent, because it would drift from the
   * engine silently and the disagreement would be about a scored check
   * (CLAUDE.md §1). `tests/audit-transport-seam.test.ts` fails if one appears.
   *
   * **Dynamically imported.** `lib/audit/` pulls in a Solidity parser and the
   * full capability taxonomy — a real chunk, and one that most visitors will
   * never trigger. It has to stay out of the main bundle, so it is loaded on
   * the first audit and cached by the browser thereafter.
   *
   * What comes back may only ever ADD to what is known about a contract. The
   * endpoint belongs to the user, so an absent capability here is "not observed
   * on an RPC we do not control", never "the contract cannot do this" — §4
   * pointed at a transport we did not build. That rule is stated in the tool
   * description and the Auditor prompt rather than enforced here, because the
   * data has the same shape either way; what differs is what may be concluded.
   */
  run_contract_audit: async (client, args, config) => {
    const target = address(args, "address");
    const explorerApiUrl = config.explorerApiUrl;
    if (!explorerApiUrl) {
      // Refused rather than degraded. Without an explorer the audit would still
      // run and would still return findings — from bytecode selectors alone,
      // with `completeness: "unresolved"`. That is a materially weaker analysis
      // wearing the same shape, and silently serving it as "the live audit" is
      // how a partial result becomes a stated fact (CLAUDE.md §9).
      throw new Error(
        "No explorer endpoint was configured for client-side audits, so verified " +
          "source could not be read. This is a gap in our configuration, not a " +
          "finding about the contract."
      );
    }

    const { runBrowserContractAudit } = await import("../audit/client-run");
    const result = await runBrowserContractAudit(target, { client, explorerApiUrl });
    return { address: target, ...result };
  },

  /**
   * The contract's own verified Solidity, bounded and disclosed.
   *
   * This is the deliberate counterweight to the capability classifier. That
   * classifier matches a fixed taxonomy of fifteen capabilities by name and
   * shape; a privileged function called `syncTreasury` instead of `setFee`
   * walks past it, and no finite list closes that gap. So the reader gets the
   * actual code and is asked to find what our patterns missed.
   *
   * The bundling — which files, how much, what was left out, what text in the
   * source is addressed to the reader — is in `lib/agent/source-bundle.ts` and
   * is tested there. This executor is transport.
   *
   * It reads nothing from the chain, so there is no provenance block to build:
   * the explorer's verified source is not block-scoped. It costs the user one
   * HTTP request against their own per-IP explorer budget and costs us nothing.
   */
  read_contract_source: async (client, args, config) => {
    const requested = address(args, "address");
    const path = typeof args.path === "string" && args.path.trim() ? args.path.trim() : null;
    const explorerApiUrl = config.explorerApiUrl;
    if (!explorerApiUrl) {
      throw new Error(
        "No explorer endpoint was configured, so verified source could not be " +
          "read. This is a gap in our configuration, not a finding about the " +
          "contract."
      );
    }

    const [{ browserSourceFetcher }, { bundleContractSource }, { resolveSourceTarget }] =
      await Promise.all([
        import("../audit/client-run"),
        import("./source-bundle"),
        import("../audit/source-target"),
      ]);

    // Follow the proxy first. Blockscout serves the source of the address you
    // ask for, so a proxy returns its own forwarder — 8kB of
    // TransparentUpgradeableProxy and an ABI with zero functions — while the
    // contract the caller means is the implementation behind it. Reviewing that
    // would be a review of `delegatecall`, reported in the same voice as a
    // review of the thing that can move money.
    const resolved = await resolveSourceTarget(client, requested);
    const raw = await browserSourceFetcher(explorerApiUrl)(resolved.target);
    return {
      address: requested,
      sourceOf: resolved.target,
      viaProxy: resolved.target === requested ? null : resolved.proxyKind,
      proxyUnresolved: resolved.unresolved,
      ...bundleContractSource(raw, { path }),
    };
  },

  /**
   * Real-time web search for financial news, market trends, and off-chain data.
   * Runs client-side in the browser via public Parallel Search MCP.
   */
  web_search: async (_client, args, _config, signal) => {
    const objective = String(args.objective ?? "Find current, dated evidence directly relevant to the user's question.");
    const rawQueries = args.queries ?? args.search_queries ?? args.query ?? [];
    const queries = Array.isArray(rawQueries)
      ? (rawQueries as unknown[]).map(String)
      : [String(rawQueries)];
    const result = await clientWebSearch(objective, queries, signal);
    return {
      objective,
      results: result.items,
      source: "parallel-mcp",
      fetchedAt: result.fetchedAt,
      completeness: result.completeness,
    };
  },

  /**
   * Targeted page content and excerpt extraction for external URLs.
   * Runs client-side in the browser via public Parallel Search MCP.
   */
  web_fetch: async (_client, args, _config, signal) => {
    const rawUrls = args.urls ?? (args.url ? [args.url] : []);
    const urls = Array.isArray(rawUrls) ? (rawUrls as unknown[]).map(String) : [String(rawUrls)];
    const objective = args.objective ? String(args.objective) : undefined;
    const fullContent = Boolean(args.full_content);
    const result = await clientWebFetch(urls, objective, fullContent, signal);
    return {
      pages: result.pages,
      source: "parallel-mcp",
      fetchedAt: result.fetchedAt,
      completeness: result.completeness,
    };
  },

  search_token_market: async (_client, args, _config, signal) => {
    const query = String(args.address ?? args.query ?? "").trim();
    const addressArg = typeof args.address === "string" ? args.address.trim() : undefined;
    const result = await clientDexScreenerSearch(query, addressArg, signal);
    return {
      query,
      chain: "robinhood",
      pairs: result.pairs,
      source: "dexscreener",
      fetchedAt: result.fetchedAt,
      completeness: result.completeness,
    };
  },
};

const WEB_CLIENT_TOOLS = new Set(["web_search", "web_fetch", "search_token_market"]);

export function isClientTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLIENT_TOOLS, name);
}

/**
 * Run one client-locale tool and wrap it in its provenance envelope.
 *
 * RPC results carry chain provenance; public web and market results carry
 * source, fetch time and completeness instead. Only the RPC path reads chain
 * id/block number, and the server keeps those verification rules unchanged.
 */
export async function runClientTool(
  call: ClientToolCall,
  config: ClientRpcConfig,
  signal?: AbortSignal
): Promise<ClientToolOutcome> {
  const executor = CLIENT_TOOLS[call.name];
  if (!executor) {
    return { tool_use_id: call.id, name: call.name, error: `No client executor for ${call.name}.` };
  }

  try {
    // Web and market APIs have their own explicit provider provenance. They are
    // not chain reads and must never trigger RPC chainId/block probes.
    if (WEB_CLIENT_TOOLS.has(call.name)) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const value = await executor(undefined as unknown as PublicClient, call.args, config, signal);
      const record = value as { source?: string; fetchedAt?: string; completeness?: BriefCompleteness };
      const source: Provenance["source"] = call.name === "search_token_market" ? "dexscreener" : "parallel-mcp";
      if (record.source !== source || typeof record.fetchedAt !== "string" ||
          (record.completeness !== "complete" && record.completeness !== "partial")) {
        throw new Error("External tool returned invalid source provenance.");
      }
      return {
        tool_use_id: call.id,
        name: call.name,
        result: {
          value,
          provenance: {
            source,
            fetchedAt: record.fetchedAt,
            completeness: record.completeness,
          },
        },
      };
    }
    const { client, host } = clientFor(config);

    const chainId = await client.getChainId();
    if (chainId !== AGENT_CHAIN_ID) {
      // Caught here as well as server-side: failing early means we never send
      // a wrong-chain answer at all, rather than relying on the far end to
      // reject it.
      return {
        tool_use_id: call.id,
        name: call.name,
        error: `Endpoint is on chain ${chainId}, not Robinhood Chain (${AGENT_CHAIN_ID}).`,
      };
    }

    const [value, blockNumber] = await Promise.all([
      executor(client, call.args, config),
      client.getBlockNumber(),
    ]);

    return {
      tool_use_id: call.id,
      name: call.name,
      result: {
        value,
        provenance: {
          source: "client-rpc",
          endpointHost: host,
          chainId,
          blockNumber: Number(blockNumber),
          observedAt: new Date().toISOString(),
        },
      },
    };
  } catch (err) {
    // Reported as an error, never as an empty value. An empty result would be
    // read by the model as "the chain says nothing is there" (CLAUDE.md §4).
    const message = err instanceof Error ? err.message : String(err);
    return {
      tool_use_id: call.id,
      name: call.name,
      error: staleBuildAdvice(message) ?? message,
    };
  }
}

/**
 * Next fingerprints lazy chunks by content, so a rebuild replaces the exact
 * file an already-open page will ask for. `run_contract_audit` imports its
 * analysis lazily — the Solidity parser has no business in the bundle of a
 * reader who never audits anything — so a tab opened before a deploy can reach
 * this tool and find its code gone.
 *
 * Worth a branch of its own because the generic handling gives ACTIVELY WRONG
 * advice. Everything that fails here is marked `transient`, and the model's
 * reading of transient is "our side hiccuped, try again in a moment" — which it
 * duly told the user. No number of retries brings back a chunk that a newer
 * build replaced; only reloading the page can. Telling someone to wait for a
 * condition that will never change is worse than telling them nothing.
 *
 * The raw text is kept so the exported transcript still says what actually
 * broke — that export is our only copy of a failure (see `toMarkdown`).
 */
const STALE_BUILD_ERROR =
  /(loading chunk|load chunk|chunkloaderror|importing a module script failed|error loading dynamically imported module)/i;

export function staleBuildAdvice(message: string): string | null {
  if (!STALE_BUILD_ERROR.test(message)) return null;
  return (
    "This page was loaded before the server was updated, so part of the app is " +
    "no longer on the server and could not be loaded. Reload the page and ask " +
    "again — retrying without reloading cannot work. This is our deployment, " +
    `not a finding about the contract. (${message})`
  );
}

export async function runClientTools(
  calls: ClientToolCall[],
  config: ClientRpcConfig
): Promise<ClientToolOutcome[]> {
  return Promise.all(calls.map((call) => runClientTool(call, config)));
}
