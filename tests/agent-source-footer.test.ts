import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientReadFooter } from "../app/components/agent/MessageStates";
import type { TraceEntry } from "../lib/agent/types";

const read = (provenance: TraceEntry["provenance"]): TraceEntry => ({
  id: "read", name: "web_search", locale: "client", outcome: "found", durationMs: 10, provenance,
});

test("external source footer never claims a chain block or chain verification", () => {
  const html = renderToStaticMarkup(React.createElement(ClientReadFooter, { entries: [
    read({ source: "parallel-mcp", fetchedAt: new Date().toISOString(), completeness: "complete" }),
    read({ source: "dexscreener", fetchedAt: new Date().toISOString(), completeness: "complete" }),
  ] }));
  assert.match(html, /Parallel Search/);
  assert.match(html, /DexScreener/);
  assert.match(html, /advisory/);
  assert.doesNotMatch(html, /CHAIN 4663|BLOCK|VERIFIED/);
});

test("mixed source footer assigns the block only to the RPC read", () => {
  const html = renderToStaticMarkup(React.createElement(ClientReadFooter, { entries: [
    read({ source: "client-rpc", chainId: 4663, blockNumber: 1234, endpointHost: "rpc.example.com", observedAt: new Date().toISOString() }),
    read({ source: "parallel-mcp", fetchedAt: new Date().toISOString(), completeness: "complete" }),
  ] }));
  assert.match(html, /CHAIN 4663/);
  assert.match(html, /1,234/);
  assert.match(html, /Parallel Search/);
});
