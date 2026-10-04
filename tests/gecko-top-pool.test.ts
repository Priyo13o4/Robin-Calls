import assert from "node:assert/strict";
import test from "node:test";
import { selectTopPool, type GeckoPoolData } from "../lib/trade/gecko-top-pool";

const TOKEN = `0x${"a".repeat(40)}`;
const OTHER = `0x${"b".repeat(40)}`;
const LOW = `0x${"1".repeat(64)}`;
const HIGH = `0x${"2".repeat(64)}`;

function pool(address: string, reserve: string, subject: string, side: "base" | "quote"): GeckoPoolData {
  return {
    id: `robinhood_${address}`,
    attributes: { address, name: "TOKEN / ETH", reserve_in_usd: reserve, volume_usd: { h24: "240" } },
    relationships: {
      base_token: { data: { id: `robinhood_${side === "base" ? subject : OTHER}` } },
      quote_token: { data: { id: `robinhood_${side === "quote" ? subject : OTHER}` } },
    },
  };
}

test("Gecko chart selects the deepest positive pool that contains the requested token", () => {
  const pools = [
    pool(LOW, "1000", TOKEN, "base"),
    pool(HIGH, "9000", TOKEN, "quote"),
    pool(`0x${"3".repeat(64)}`, "100000", OTHER, "base"),
    pool(`0x${"4".repeat(64)}`, "0", TOKEN, "base"),
  ];
  const selected = selectTopPool(pools, TOKEN);
  assert.equal(selected?.poolAddress, HIGH);
  assert.equal(selected?.reserveInUsd, 9000);
  assert.equal(selected?.volume24hUsd, 240);
});
