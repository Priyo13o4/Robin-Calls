import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertRpcUrl } from "../lib/data/rpc-endpoints";

// L148, 2026-09-15: the OrbitFlare row was saved as `?api_key= KEY`. It parsed, it
// passed the http(s) check, and every call answered 403 "invalid API key".

test("a space inside the key is refused, the shape that reached prod", () => {
  assert.throws(() => assertRpcUrl("https://robinhood.rpc.example.com/?api_key= ORBIT-abc"), /whitespace/);
});

test("tabs and newlines anywhere are refused too", () => {
  assert.throws(() => assertRpcUrl("https://rpc.example.com/?k=\tabc"), /whitespace/);
  assert.throws(() => assertRpcUrl("https://rpc.example.com/v2/abc\n"), /whitespace/);
});

test("a clean http(s) URL passes unchanged, and other schemes do not", () => {
  const ok = "https://robinhood.rpc.example.com/?api_key=ORBIT-abc";
  assert.equal(assertRpcUrl(ok), ok);
  assert.throws(() => assertRpcUrl("wss://rpc.example.com"), /http\(s\)/);
});

test("the admin save action runs every URL through the guard", () => {
  const src = readFileSync(join(import.meta.dirname, "../app/admin/(dashboard)/rpc/actions.ts"), "utf8");
  assert.match(src, /const finalUrl = assertRpcUrl\(url \|\| existingUrl\);/);
});
