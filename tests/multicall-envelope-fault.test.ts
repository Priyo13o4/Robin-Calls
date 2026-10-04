import test from "node:test";
import assert from "node:assert/strict";

// Set before the module graph loads: `addresses.multicall3` is read at import.
process.env.MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";

const call = (id: number) => ({ address: "0x0000000000000000000000000000000000000001" as const, abi: [], functionName: "ownerOf", args: [BigInt(id)] });

function fakeClient(multicall: (args: { contracts: unknown[] }) => Promise<unknown[]>) {
  return { getCode: async () => "0x60", multicall } as never;
}

test("a rejected envelope is not a revert: viem's shared failure is re-asked call by call", async () => {
  const { batchRead, _mockSingleReader, _resetMulticallAvailability } = await import("../lib/rpc/multicall");
  _resetMulticallAvailability();
  const asked: number[] = [];
  _mockSingleReader(async (c) => {
    const id = Number((c.args ?? [])[0]);
    asked.push(id);
    if (id === 1) throw new Error("socket hang up");
    return `owner-${id}`;
  });
  try {
    const envelopeError = new Error("No healthy RPC provider is available for Robinhood Chain.");
    const results = await batchRead<string>([0, 1, 2].map(call), {
      client: fakeClient(async ({ contracts }) => contracts.map(() => ({ status: "failure", error: envelopeError }))),
    });
    assert.deepEqual(asked, [0, 1, 2], "every call in the rejected envelope is asked again on its own");
    assert.deepEqual(results, [
      { status: "success", value: "owner-0" },
      { status: "faulted" },
      { status: "success", value: "owner-2" },
    ]);
    assert.equal(results.some((r) => r.status === "reverted"), false);
  } finally {
    _mockSingleReader(null);
    _resetMulticallAvailability();
  }
});

test("positive control: subcalls that failed with their own errors stay reverted, nothing re-asked", async () => {
  const { batchRead, _mockSingleReader, _resetMulticallAvailability } = await import("../lib/rpc/multicall");
  _resetMulticallAvailability();
  let individual = 0;
  _mockSingleReader(async () => { individual++; return "x"; });
  try {
    const results = await batchRead<string>([0, 1, 2].map(call), {
      client: fakeClient(async () => [
        { status: "success", result: "owner-0" },
        { status: "failure", error: new Error("reverted A") },
        { status: "failure", error: new Error("reverted B") },
      ]),
    });
    assert.equal(individual, 0);
    assert.deepEqual(results, [{ status: "success", value: "owner-0" }, { status: "reverted" }, { status: "reverted" }]);
  } finally {
    _mockSingleReader(null);
    _resetMulticallAvailability();
  }
});
