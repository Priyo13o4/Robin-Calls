import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHooklist } from "../lib/hooks/sync";
import { hookFacts, hookFlagWords } from "../lib/hooks/describe";
import type { UniswapHookInfo } from "../lib/hooks/types";

const PONS = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
// Shape copied from the live list (2026-09-29): the Pons V2 graduated-pool hook.
const entry = (over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => ({
  hook: { address: "0xE5E702641ea86F4Ae6cC3cDAed2b886f976be044", chain: "robinhood", chainId: 4663, name: "V2MemeHook",
    description: "Singleton Uniswap v4 hook shared by all graduated launchpad v2 memecoin pools.", deployer: "", verifiedSource: true, auditUrl: "", ...over },
  flags: { beforeInitialize: true, afterSwap: true, afterSwapReturnsDelta: true, beforeSwap: false },
  properties: { dynamicFee: false, upgradeable: false, requiresCustomSwapData: false, vanillaSwap: false, swapAccess: "none", ...props },
});

test("parse keeps only our chain, lowercases, drops malformed entries and non-https audit links", () => {
  const rows = parseHooklist([
    entry(),
    entry({ chainId: 8453, address: "0x1111111111111111111111111111111111111111" }),
    entry({ address: "not-an-address" }),
    entry({ address: "0x2222222222222222222222222222222222222222", auditUrl: "javascript:alert(1)" }),
    { nonsense: true },
  ], 4663, "2026-09-29T00:00:00.000Z");
  assert.deepEqual(rows.map((r) => r.address), [PONS, "0x2222222222222222222222222222222222222222"]);
  assert.equal(rows[0].name, "V2MemeHook");
  assert.equal(rows[1].auditUrl, "", "only https links are kept");
  assert.throws(() => parseHooklist({ not: "a list" }, 4663, "x"), /hooklist_not_an_array/);
});

const info = (props: Record<string, unknown>, verified: boolean | null = true): UniswapHookInfo => ({
  chainId: 4663, address: PONS, name: "X", description: "", deployer: "", verifiedSource: verified, auditUrl: "",
  flags: { afterSwap: true, afterSwapReturnsDelta: true, beforeSwap: false }, properties: props, fetchedAt: "",
});

test("facts: risky properties warn in plain words; nothing ever says safe", () => {
  const warn = (p: Record<string, unknown>, v: boolean | null = true) => hookFacts(info(p, v)).filter((f) => f.tone === "warn").map((f) => f.text).join(" ");
  assert.match(warn({ swapAccess: "allowlist" }), /limit who is allowed to swap, and that includes selling/);
  assert.match(warn({ swapAccess: "temporal" }), /limit when trading is allowed, such as set hours or a cutoff, and that includes selling/);
  assert.match(warn({ swapAccess: "governance" }), /Someone controls whether swapping/);
  assert.match(warn({ upgradeable: true }), /code can be changed after you buy/);
  assert.match(warn({ dynamicFee: true }), /fee can change/);
  assert.match(warn({}, false), /not verified/);
  assert.equal(warn({ swapAccess: "none", upgradeable: false }), "", "benign properties are neutral, not warnings");
  for (const f of hookFacts(info({ swapAccess: "none", upgradeable: false }))) assert.doesNotMatch(f.text, /\bsafe\b/i);
  assert.equal(hookFacts(info({})).length, 0, "a property the list does not set says nothing");
  for (const f of hookFacts(info({ swapAccess: "allowlist", upgradeable: true, dynamicFee: true }))) assert.doesNotMatch(f.text, /—/);
});

test("flag words: only callbacks that are on", () => {
  assert.deepEqual(hookFlagWords({ afterSwap: true, afterSwapReturnsDelta: true, beforeSwap: false }), ["after each swap", "take or add tokens after a swap"]);
});

test("WIRING: daily job, kill switch, rate limit, and every surface renders the details", () => {
  const job = readFileSync("app/api/jobs/hooklist-sync/route.ts", "utf8");
  assert.match(job, /requireJobAuth\(req\)/);
  assert.ok(job.indexOf("requireJobAuth") < job.indexOf("flags.hooklistSync"), "secret first, flag second (§6)");
  assert.match(readFileSync("supabase/migrations/0102_sequencer_sync_lockers_hooks.sql", "utf8"), /rc_schedule_job\('robincalls-hooklist-sync', '17 4 \* \* \*', '\/api\/jobs\/hooklist-sync'\)/);
  const sync = readFileSync("lib/hooks/sync.ts", "utf8");
  assert.match(sync, /rows\.length < before \* MIN_KEEP_RATIO/, "a shrunken download never replaces the list");
  assert.match(readFileSync("app/components/trade/ModernTradingCard.tsx", "utf8"), /<HookDetails address=\{hook\.address\} \/>/);
  assert.match(readFileSync("app/components/trade/TradeWarningsModal.tsx", "utf8"), /<HookDetails address=\{hook\.address\} \/>/);
  assert.match(readFileSync("app/components/site/VerdictView.tsx", "utf8"), /<PoolHooksPanel token=\{verdict\.tokenAddress\} \/>/);
  const details = readFileSync("app/components/trade/HookDetails.tsx", "utf8");
  assert.match(details, /aria-expanded=\{open\}/, "expandable");
  assert.match(details, /lookup\.looked \? "Not in Uniswap's hook list"/, "not listed only when the list was actually read (§4)");
});

test("the hooks route validates input and reports an unread list as unknown", async () => {
  const { GET } = await import("../app/api/hooks/route");
  assert.equal((await GET(new Request("http://x/api/hooks?addresses=0x12"))).status, 400);
  assert.equal((await GET(new Request("http://x/api/hooks?token=nope"))).status, 400);
  const res = await GET(new Request(`http://x/api/hooks?addresses=${PONS}`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.looked, false, "no database: the list was not read, so nothing may be called unlisted");
  assert.equal(res.headers.get("cache-control"), "no-store");
});
