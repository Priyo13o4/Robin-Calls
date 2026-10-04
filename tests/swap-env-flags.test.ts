import test from "node:test";
import assert from "node:assert/strict";
import { flags } from "../lib/config/flags";

const names = ["ENABLE_SWAP_TRADING", "ENABLE_SWAP_QUOTES", "ENABLE_SWAP_EXECUTION", "ENABLE_SWAP_MULTIHOP"] as const;

test("one swap trading env switch controls quotes and execution", () => {
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.ENABLE_SWAP_QUOTES;
    delete process.env.ENABLE_SWAP_EXECUTION;
    delete process.env.ENABLE_SWAP_TRADING;
    assert.equal(flags.swapTrading, false);
    assert.equal(flags.swapQuotes, false);
    assert.equal(flags.swapExecution, false);

    process.env.ENABLE_SWAP_TRADING = "true";
    assert.equal(flags.swapTrading, true);
    assert.equal(flags.swapQuotes, true);
    assert.equal(flags.swapExecution, true);

    process.env.ENABLE_SWAP_TRADING = "false";
    process.env.ENABLE_SWAP_QUOTES = "true";
    process.env.ENABLE_SWAP_EXECUTION = "true";
    process.env.ENABLE_SWAP_MULTIHOP = "true";
    assert.equal(flags.swapTrading, false);
    assert.equal(flags.swapQuotes, false, "explicit master-off must override legacy enables");
    assert.equal(flags.swapExecution, false, "explicit master-off must override legacy enables");
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("retired swap env flags cannot enable trading when the master is unset", () => {
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.ENABLE_SWAP_TRADING;
    process.env.ENABLE_SWAP_QUOTES = "true";
    process.env.ENABLE_SWAP_EXECUTION = "false";
    assert.equal(flags.swapTrading, false);
    assert.equal(flags.swapQuotes, false);
    assert.equal(flags.swapExecution, false);

    process.env.ENABLE_SWAP_QUOTES = "false";
    process.env.ENABLE_SWAP_EXECUTION = "true";
    assert.equal(flags.swapTrading, false);
    assert.equal(flags.swapQuotes, false);
    assert.equal(flags.swapExecution, false);
    assert.equal(flags.swapMultihop, false);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
