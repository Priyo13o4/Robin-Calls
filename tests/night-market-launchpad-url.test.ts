import test from "node:test";
import assert from "node:assert/strict";
import { resolveLaunchpadUrl } from "../lib/launches/launchpad-url";
import { launchFeedRowToTokenMarketData } from "../lib/trade/types";
import type { LaunchFeedRow } from "../lib/launches/feed-types";

test("resolveLaunchpadUrl: replaces {token} for launchpads with configured template", () => {
  const url = resolveLaunchpadUrl(
    {
      token_address: "0x1234567890abcdef1234567890abcdef12345678",
      launchpad_slug: "custompad",
    },
    [
      {
        slug: "custompad",
        name: "Custom Pad",
        config: { tokenUrlTemplate: "https://custompad.io/pool/{token}" },
      },
    ]
  );
  assert.equal(url, "https://custompad.io/pool/0x1234567890abcdef1234567890abcdef12345678");
});

test("resolveLaunchpadUrl: uses website if template is not configured", () => {
  const url = resolveLaunchpadUrl(
    {
      token_address: "0x1234567890abcdef1234567890abcdef12345678",
      launchpad_slug: "webpad",
    },
    [
      {
        slug: "webpad",
        name: "Web Pad",
        config: { website: "https://webpad.finance" },
      },
    ]
  );
  assert.equal(url, "https://webpad.finance");
});

test("resolveLaunchpadUrl: resolves canonical Robinhood Chain launchpads when config is absent", () => {
  const token = "0xb09d123456789012345678901234567890123456";

  const pons = resolveLaunchpadUrl({ token_address: token, launchpad_slug: "ponsv2" });
  assert.equal(pons, `https://www.ponsfamily.com/launchpad/${token}`);

  const flap = resolveLaunchpadUrl({ token_address: token, launchpad_slug: "flapsh" });
  assert.equal(flap, `https://flap.sh/robinhood/${token}`);

  const robinfun = resolveLaunchpadUrl({ token_address: token, launchpad_slug: "robinfun" });
  assert.equal(robinfun, `https://robinfun.live/token/${token}`);

  const cashcat = resolveLaunchpadUrl({ token_address: token, launchpad_slug: "cashcat" });
  assert.equal(cashcat, `https://letscash.fun/token/${token}`);

  const doppler = resolveLaunchpadUrl({ token_address: token, launchpad_slug: "doppler" });
  assert.equal(doppler, "https://long.xyz");

  const pair = resolveLaunchpadUrl({ token_address: token, launchpad_slug: "pair" });
  assert.equal(pair, "https://pair.fun");
});

test("resolveLaunchpadUrl: returns null for unknown launchpad, NEVER synthesises .xyz or fake domain", () => {
  const url = resolveLaunchpadUrl({
    token_address: "0x1234567890abcdef1234567890abcdef12345678",
    launchpad_slug: "unknownpad",
    launchpad_name: "Unknown Pad",
  });
  assert.equal(url, null);
});

test("launchFeedRowToTokenMarketData: binds real launchpadUrl into TokenMarketData", () => {
  const fakeRow: LaunchFeedRow = {
    token_address: "0x2222222222222222222222222222222222222222",
    token_name: "Trail Token",
    token_symbol: "TRAIL",
    metadata_uri: null,
    launchpad_name: "Pons V2",
    launchpad_slug: "ponsv2",
    venue_model: "BONDING_CURVE",
    lifecycle_state: "ACTIVE",
    progress_bps: 6300,
    raised_wei: "6300000000000000000",
    quote_token: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    quote_symbol: "WETH",
    quote_decimals: 18,
    liquidity_usd: null,
    volume_24h_usd: null,
    pool_address: null,
    source_kind: "LAUNCHPAD",
    created_at: new Date().toISOString(),
    verdict: null,
  };

  const marketData = launchFeedRowToTokenMarketData(fakeRow, 1);
  assert.equal(marketData.isBondingCurve, true);
  assert.equal(marketData.bondingProgress, 63);
  assert.equal(
    marketData.launchpadUrl,
    "https://www.ponsfamily.com/launchpad/0x2222222222222222222222222222222222222222"
  );
});
