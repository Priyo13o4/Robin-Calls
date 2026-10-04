import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";

import { referralMessage } from "@/lib/referrals/proof";
import { verifyReferralProof, verifyWalletSignature } from "@/lib/referrals/verify";

/**
 * The chain, stubbed at the TRANSPORT, not at the seam.
 *
 * The tests below that omit the `client` argument are the ones that matter:
 * every production caller omits it, and the first attempt at issue 10 shipped a
 * broken shipped-path because every test injected a fake through that parameter
 * (§8 #10). So the parameter stays omitted here and `rpc()` is really
 * constructed and really used — a client that cannot be built still fails this
 * file.
 *
 * What is replaced is `fetch`, so nothing leaves the machine. §7: these tests
 * take no network. Talking to the public RPC made the suite depend on somebody
 * else's uptime to say whether OUR verifier works.
 *
 * `eth_getCode` answers "0x" (no code), which is what the assertions expect.
 * `eth_chainId` has to answer 4663 or the pool rejects the endpoint as
 * wrong-chain and every verdict comes back `unavailable` instead.
 */
const realFetch = globalThis.fetch;
let rpcMethods: string[] = [];

before(() => {
  globalThis.fetch = (async (_url: unknown, init: { body?: unknown } = {}) => {
    const parsed = JSON.parse(String(init.body ?? "{}"));
    const calls: { id?: number; method?: string }[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of calls) if (c.method) rpcMethods.push(c.method);
    const answer = (c: { id?: number; method?: string }) => ({
      jsonrpc: "2.0",
      id: c.id ?? 1,
      result: c.method === "eth_chainId" ? "0x1237" : "0x",
    });
    const body = Array.isArray(parsed) ? calls.map(answer) : answer(calls[0]);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(KEY);
const wallet = account.address.toLowerCase();
const now = () => new Date().toISOString();

test("a good signature over the exact action verifies", async () => {
  const issuedAt = now();
  const action = { kind: "bind", code: "0BCD2345" } as const;
  const signature = await account.signMessage({ message: referralMessage(wallet, action, issuedAt) });
  assert.equal(await verifyReferralProof(wallet, action, issuedAt, signature), null);
});

test("a signature for one code cannot bind a different one", async () => {
  // The attack: collect a proof while the user applies a friend's code, then
  // replay it to bind your own. The code is IN the message, so it cannot.
  const issuedAt = now();
  const signature = await account.signMessage({
    message: referralMessage(wallet, { kind: "bind", code: "0BCD2345" }, issuedAt),
  });
  const error = await verifyReferralProof(wallet, { kind: "bind", code: "ZZZZ9999" }, issuedAt, signature);
  assert.ok(error, "a proof over a different code must not verify");
});

test("a profile signature cannot be replayed as a binding", async () => {
  // The reason the action is named in the message rather than the message being
  // a bare "prove you own this wallet": one such signature would be a bearer
  // token for every write on this surface.
  const issuedAt = now();
  const signature = await account.signMessage({
    message: referralMessage(wallet, { kind: "profile", nickname: "n", emoji: "", socials: "[]" }, issuedAt),
  });
  assert.ok(await verifyReferralProof(wallet, { kind: "bind", code: "0BCD2345" }, issuedAt, signature));
});

test("another wallet's signature does not prove control of this one", async () => {
  const issuedAt = now();
  const other = "0x2222222222222222222222222222222222222222";
  const signature = await account.signMessage({
    message: referralMessage(other, { kind: "bind", code: "0BCD2345" }, issuedAt),
  });
  assert.ok(await verifyReferralProof(other, { kind: "bind", code: "0BCD2345" }, issuedAt, signature));
});

test("a stale signature expires", async () => {
  const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const action = { kind: "bind", code: "0BCD2345" } as const;
  const signature = await account.signMessage({ message: referralMessage(wallet, action, stale) });
  const error = await verifyReferralProof(wallet, action, stale, signature);
  assert.match(String(error), /expired/i);
});

test("a missing or unreadable signature is a bad request, not an outage", async () => {
  const action = { kind: "bind", code: "0BCD2345" } as const;
  assert.ok(await verifyReferralProof(wallet, action, now(), undefined));
  assert.ok(await verifyReferralProof(wallet, action, undefined, "0xdead"));
  assert.ok(await verifyReferralProof(wallet, action, "not-a-date", "0xdead"));
  // Malformed signatures throw inside viem; the sentence must still come back
  // rather than the error escaping as a 500.
  assert.ok(await verifyReferralProof(wallet, action, now(), "0xnothex"));
});

test("the message names the wallet, the action and the payload", () => {
  const msg = referralMessage(wallet, { kind: "profile", nickname: "Vito", emoji: "🎩", socials: "[]" }, "2026-09-06T00:00:00.000Z");
  assert.ok(msg.includes(wallet));
  assert.ok(msg.includes("Action: profile"));
  assert.ok(msg.includes("Nickname: Vito"));
  assert.ok(msg.includes("Emoji: 🎩"));
  assert.ok(msg.includes("Issued: 2026-09-06T00:00:00.000Z"));
  // An empty nickname is a real edit — it is how a name is cleared — so its
  // line must still be present and the payload unambiguous.
  const cleared = referralMessage(wallet, { kind: "profile", nickname: "", emoji: "", socials: "[]" }, "2026-09-06T00:00:00.000Z");
  assert.ok(cleared.includes("Nickname: "));
});

test("the prefix differs from the whitelist surface's, so proofs do not cross", () => {
  // `/api/whitelist` signs "RobinCalls whitelist: <wallet>\nIssued: <iso>". If
  // this surface produced the same string, one signature would open both.
  const msg = referralMessage(wallet, { kind: "bind", code: "0BCD2345" }, "2026-09-06T00:00:00.000Z");
  assert.ok(msg.startsWith("RobinCalls referral"));
  assert.notEqual(msg, `RobinCalls whitelist: ${wallet}\nIssued: 2026-09-06T00:00:00.000Z`);
});

/** A client seam with only what verifyWalletSignature uses, plus the nonce the
 *  fake needs to tell its two calls apart. */
function fakeWalletClient(opts: { hasCode: boolean; isValid: boolean; failGetCode?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    async getCode({ address }: { address: string }) {
      calls.push(`getCode:${address}`);
      if (opts.failGetCode) throw new Error("connection reset");
      return opts.hasCode ? "0x6080604052" : "0x";
    },
    async request({ method }: { method: string }) {
      calls.push(method);
      // The eth_call behind readContract. A Safe answers the 1271 check itself.
      if (method === "eth_call") {
        if (opts.isValid) return "0x1626ba7e00000000000000000000000000000000000000000000000000000000";
        // A wallet that reverts the check has ANSWERED — the error must be
        // classified definitive, not transient, so assert through the same
        // shape viem produces for a raw revert.
        const err = new Error("execution reverted");
        throw err;
      }
      throw new Error(`unexpected method ${method}`);
    },
  };
}

test("a smart contract wallet verifies through ERC-1271 (issue 10)", async () => {
  // Offline ECDSA recovery cannot validate a Safe's dynamic byte string. The
  // chain read is the only proof there is, and without it every Safe user got
  // "that signature does not match this wallet" — for a permanent decision.
  const fake = fakeWalletClient({ hasCode: true, isValid: true });
  const verdict = await verifyWalletSignature(wallet, "message", "0xdeadbeef", fake as never);
  assert.equal(verdict, "verified");
  assert.ok(fake.calls.some((c) => c.startsWith("getCode:")));
  assert.ok(fake.calls.includes("eth_call"));
});

test("a contract wallet that REJECTS the 1271 check is invalid, not unavailable", async () => {
  const fake = fakeWalletClient({ hasCode: true, isValid: false });
  const verdict = await verifyWalletSignature(wallet, "message", "0xdeadbeef", fake as never);
  assert.equal(verdict, "invalid");
});

test("an EOA verifies on the offline path with no chain read", async () => {
  const fake = fakeWalletClient({ hasCode: true, isValid: true });
  const issuedAt = now();
  const action = { kind: "bind", code: "0BCD2345" } as const;
  const signature = await account.signMessage({ message: referralMessage(wallet, action, issuedAt) });
  const verdict = await verifyWalletSignature(wallet, referralMessage(wallet, action, issuedAt), signature, fake as never);
  assert.equal(verdict, "verified");
  assert.deepEqual(fake.calls, [], "an ECDSA recovery needs no RPC call at all");
});

test("a getCode fault is unavailable, never invalid", async () => {
  // §4: we could not look at the wallet's code, so the 1271 path is unreachable
  // and there is no answer to publish. A wallet signing during an RPC blip must
  // be asked to retry, not told its signature is wrong.
  const fake = fakeWalletClient({ hasCode: true, isValid: true, failGetCode: true });
  const verdict = await verifyWalletSignature(wallet, "message", "0xdeadbeef", fake as never);
  assert.equal(verdict, "unavailable");
});

test("NO CLIENT: the shipped three-argument call reaches the chain (issue 10)", async () => {
  // The only call shape production uses is the three-argument one: the bind,
  // profile and whitelist routes all omit the client. This covers that shape.
  //
  // It does NOT, however, catch the original bug, and the claim that it would
  // was checked and is false. That bug was a dynamic import of the path alias
  // "@/lib/rpc/client", which Node cannot resolve; tsx CAN, through tsconfig
  // paths, so reintroducing it leaves this test green. §8 #17: the probe sits
  // in a different environment from the user, in the one field that decides the
  // answer. The guard that does catch it is the source assertion in
  // referral-wiring.test.ts that this module holds no dynamic import at all.
  // Verified by mutation, both directions, 2026-09-06.
  const issuedAt = now();
  const action = { kind: "bind", code: "0BCD2345" } as const;
  const signature = await account.signMessage({ message: referralMessage(wallet, action, issuedAt) });
  // A wrong address forces the chain-backed half: recovery succeeds but names
  // another wallet, so the verdict must come from real chain state.
  const before = rpcMethods.length;
  const verdict = await verifyWalletSignature(
    "0x2222222222222222222222222222222222222222",
    referralMessage("0x2222222222222222222222222222222222222222", action, issuedAt),
    signature,
  );
  // 0x2222… holds no code, so the definitive answer is invalid. Any other
  // outcome, a throw above all, means the shipped path broke.
  assert.equal(verdict, "invalid");
  // And it got there by really building the pooled client and really calling
  // it. Without this the test passes on an early return and proves nothing
  // about the path it is named for.
  assert.ok(
    rpcMethods.slice(before).includes("eth_getCode"),
    "the three-argument call must reach the transport, not return before it",
  );
});
