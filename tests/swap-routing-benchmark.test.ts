import test from "node:test";
import assert from "node:assert/strict";
import { TransportMeterManager } from "../scripts/benchmark-swap-routing";

test("benchmark meter reserves in-flight budget and stops queued requests at its cap", async () => {
  const meter = new TransportMeterManager("http://mock-rpc", 2, 1);
  const release1 = await meter.acquirePermit();
  let secondStarted = false;
  const second = meter.acquirePermit().then((release) => { secondStarted = true; return release; });
  await Promise.resolve();
  assert.equal(secondStarted, false);
  release1();
  const release2 = await second;
  const third = assert.rejects(meter.acquirePermit(), /hard cap/);
  assert.equal(meter.totalPhysicalRequests, 2);
  release2();
  await third;
});

test("benchmark counts actual HTTP attempts, pinned blocks and JSON-RPC errors", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: { method: string }[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return new Response(JSON.stringify(body.method === "eth_call"
      ? { jsonrpc: "2.0", id: body.id, result: "0x42" }
      : { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "probe failure" } }), { status: 200 });
  };
  const meter = new TransportMeterManager("http://mock-rpc", 3, 1);
  try {
    meter.attach();
    const provider = meter.wrapEthersProvider({});
    assert.equal(await provider.send("eth_call", [{}, "0x123"]), "0x42");
    await assert.rejects(provider.send("eth_getCode", ["0x01", "0x123"]), /probe failure/);
    await fetch("http://mock-rpc/", { method: "POST", body: JSON.stringify({method:"eth_call",params:[{},"0x123"]}) });
    assert.equal(bodies.length, 3);
    assert.equal(meter.totalPhysicalRequests, 3);
    assert.deepEqual(meter.methodCounts, { eth_call: 2, eth_getCode: 1 });
    assert.deepEqual(meter.rawEvidence.map((e) => [e.source,e.status,e.blockNumber]), [
      ["ethers","ok","0x123"],["ethers","error","0x123"],["viem","ok","0x123"],
    ]);
    await assert.rejects(provider.send("eth_call", [{},"0x123"]), /hard cap/);
    assert.equal(bodies.length, 3);
  } finally { meter.detach(); globalThis.fetch = originalFetch; }
});
