import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  MAX_BODY_BYTES,
  MAX_SIGNATURE_BYTES,
  MAX_SLIPPAGE_BPS,
  MAX_UINT160,
  MAX_UINT256,
  MAX_UINT48,
  MIN_SLIPPAGE_BPS,
  readBoundedJson,
  validateSwapRequest,
} from "../lib/swap/request-validation";
import { NATIVE, type SwapPlanResponse, type SwapRequest } from "../lib/swap/types";

// Track mock calls to verify buildSwapPlan is only called on valid requests
let buildSwapPlanCalls: SwapRequest[] = [];
let mockPlanResponse: SwapPlanResponse = {
  status: "ready",
  plan: {
    venue: "uniswap-ur",
    family: "uniswap",
    pool: "0x1111111111111111111111111111111111111111",
    protocol: "v3",
    feeTier: 3000,
    tokenIn: NATIVE,
    tokenOut: "0x2222222222222222222222222222222222222222",
    tokenInDisplay: { symbol: "ETH", decimals: 18 },
    tokenOutDisplay: { symbol: "USDC", decimals: 6 },
    amountIn: "1000000000000000000",
    feeBps: 0,
    feeAmount: "0",
    feeAsset: NATIVE,
    feeRecipient: "0x0000000000000000000000000000000000000000",
    quotedOut: "2000000000",
    minOut: "1990000000",
    slippageBps: 50,
    slippageMode: "auto",
    priceImpactBps: 1,
    searchComplete: true,
    alternatives: [],
    excluded: [],
    deadline: 1234567890,
    expiresAt: Date.now() + 60000,
    steps: [],
    simulation: { status: "ok", measuredOut: "2000000000", feePaid: "0", gasUsed: "100000" },
  },
};

mock.module("@/lib/swap/plan", {
  namedExports: {
    buildSwapPlan: async (req: SwapRequest) => {
      buildSwapPlanCalls.push(req);
      return mockPlanResponse;
    },
  },
});


async function getRoute() {
  return await import("../app/api/swap/plan/route");
}

const VALID_ACCOUNT = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"; // vitalik.eth
const VALID_TOKEN_IN = "0x0000000000000000000000000000000000000000";
const VALID_TOKEN_OUT = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC
const VALID_SPENDER = "0x000000000022D473030F116dDEE9F6B43aC78BA3"; // Permit2

function validPermit() {
  return {
    token: VALID_TOKEN_OUT,
    spender: VALID_SPENDER,
    amount: "1000000",
    expiration: 1700000000,
    nonce: 0,
    sigDeadline: "1700000100",
    signature: ("0x" + "aa".repeat(65)) as `0x${string}`,
  };
}

function validNativeRequest(): SwapRequest {
  return {
    account: VALID_ACCOUNT,
    tokenIn: VALID_TOKEN_IN,
    tokenOut: VALID_TOKEN_OUT,
    amountIn: "1000000000000000000",
    slippageBps: "auto",
  };
}

function createStreamRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): NextRequest {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
  return new NextRequest("http://localhost:3000/api/swap/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: stream,
    // @ts-expect-error Node fetch stream duplex
    duplex: "half",
  });
}

// -----------------------------------------------------------------------------
// 1. Pure Validator Tests: Valid Inputs
// -----------------------------------------------------------------------------
test("validator accepts valid native swap request with 'auto' slippage", () => {
  const req = validNativeRequest();
  const res = validateSwapRequest(req);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.account, VALID_ACCOUNT);
  assert.equal(res.value.amountIn, "1000000000000000000");
  assert.equal(res.value.slippageBps, "auto");
  assert.equal(res.value.permit, undefined);
});

test("validator accepts valid request with integer slippage and valid permit", () => {
  const req: SwapRequest = {
    account: VALID_ACCOUNT,
    tokenIn: VALID_TOKEN_OUT,
    tokenOut: VALID_TOKEN_IN,
    amountIn: "500000",
    slippageBps: 50,
    permit: validPermit(),
  };
  const res = validateSwapRequest(req);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.slippageBps, 50);
  assert.ok(res.value.permit);
  assert.equal(res.value.permit.amount, "1000000");
});

// -----------------------------------------------------------------------------
// 2. Pure Validator Tests: AmountIn Boundaries and Invalids
// -----------------------------------------------------------------------------
test("validator accepts boundary amountIn == 2^160 - 1", () => {
  const req = {
    ...validNativeRequest(),
    amountIn: MAX_UINT160.toString(),
  };
  const res = validateSwapRequest(req);
  assert.equal(res.ok, true);
});

test("validator rejects out-of-width amountIn == 2^160", () => {
  const req = {
    ...validNativeRequest(),
    amountIn: (MAX_UINT160 + 1n).toString(),
  };
  const res = validateSwapRequest(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.status, "invalid");
});

test("validator rejects zero, negative, and non-canonical positive integers for amountIn", () => {
  const cases = [
    ["zero", "0"],
    ["multiple zeros", "00"],
    ["leading zero", "0123"],
    ["explicit plus", "+100"],
    ["negative", "-100"],
    ["decimal", "100.5"],
    ["scientific exponent lowercase", "1e18"],
    ["scientific exponent uppercase", "1E6"],
    ["hex", "0x10"],
    ["leading whitespace", " 100"],
    ["trailing whitespace", "100 "],
    ["newline in amount", "100\n"],
    ["empty string", ""],
    ["non-numeric string", "one_hundred"],
    ["boolean true", true],
    ["boolean false", false],
    ["number literal", 1000],
    ["null", null],
    ["undefined", undefined],
  ];

  for (const [label, badAmount] of cases) {
    const req = { ...validNativeRequest(), amountIn: badAmount };
    const res = validateSwapRequest(req);
    assert.equal(res.ok, false, `Expected failure for amountIn: ${label}`);
    if (res.ok) return;
    assert.equal(res.error.status, "invalid");
  }
});

// -----------------------------------------------------------------------------
// 3. Pure Validator Tests: Slippage Boundaries and Invalids
// -----------------------------------------------------------------------------
test("validator accepts slippageBps at boundaries 1 and 5000, and 'auto'", () => {
  for (const slippage of [MIN_SLIPPAGE_BPS, 50, MAX_SLIPPAGE_BPS, "auto"] as const) {
    const req = { ...validNativeRequest(), slippageBps: slippage };
    const res = validateSwapRequest(req);
    assert.equal(res.ok, true, `Expected success for slippage: ${slippage}`);
  }
});

test("validator rejects invalid slippageBps values", () => {
  const cases = [
    ["zero (below 1)", 0],
    ["negative (-1)", -1],
    ["5001 (above 5000)", 5001],
    ["10000 (extreme high)", 10000],
    ["fractional (1.5)", 1.5],
    ["fractional (49.9)", 49.9],
    ["string number ('50')", "50"],
    ["empty string", ""],
    ["wrong string ('manual')", "manual"],
    ["boolean true", true],
    ["null", null],
    ["undefined (missing slippage)", undefined],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ];

  for (const [label, badSlippage] of cases) {
    const req = { ...validNativeRequest(), slippageBps: badSlippage };
    const res = validateSwapRequest(req);
    assert.equal(res.ok, false, `Expected failure for slippageBps: ${label}`);
    if (res.ok) return;
    assert.equal(res.error.status, "invalid");
  }
});

// -----------------------------------------------------------------------------
// 4. Pure Validator Tests: Address Validations and Pair Disjointness
// -----------------------------------------------------------------------------
test("validator rejects invalid addresses for account, tokenIn, tokenOut", () => {
  const invalidAddrs = ["0x123", "not-an-address", "0x" + "0".repeat(39), 12345, null, undefined];

  for (const bad of invalidAddrs) {
    assert.equal(validateSwapRequest({ ...validNativeRequest(), account: bad }).ok, false);
    assert.equal(validateSwapRequest({ ...validNativeRequest(), tokenIn: bad }).ok, false);
    assert.equal(validateSwapRequest({ ...validNativeRequest(), tokenOut: bad }).ok, false);
  }
});

test("validator rejects identical tokenIn and tokenOut (case-insensitive)", () => {
  const checksummed = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // valid EIP-55 checksummed USDC
  const req = {
    ...validNativeRequest(),
    tokenIn: VALID_TOKEN_OUT, // lowercase
    tokenOut: checksummed, // checksummed
  };
  const res = validateSwapRequest(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.detail, "Pick two different tokens.");
});

// -----------------------------------------------------------------------------
// 5. Pure Validator Tests: Unknown Top-Level Keys
// -----------------------------------------------------------------------------
test("validator rejects unknown top-level keys", () => {
  const req = {
    ...validNativeRequest(),
    unexpectedKey: "malicious_payload",
  };
  const res = validateSwapRequest(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.status, "invalid");
  assert.match(res.error.detail, /Unknown field in request/);
});

// -----------------------------------------------------------------------------
// 6. Pure Validator Tests: Permit Object Boundaries and Invalids
// -----------------------------------------------------------------------------
test("validator accepts boundary permit fields", () => {
  const boundaryPermit = {
    token: VALID_TOKEN_OUT,
    spender: VALID_SPENDER,
    amount: MAX_UINT160.toString(), // uint160 max
    expiration: MAX_UINT48, // uint48 max: 2^48 - 1
    nonce: MAX_UINT48, // uint48 max: 2^48 - 1
    sigDeadline: MAX_UINT256.toString(), // uint256 max: 2^256 - 1
    signature: ("0x" + "ff".repeat(MAX_SIGNATURE_BYTES)) as `0x${string}`, // 4096 bytes
  };
  const res = validateSwapRequest({
    ...validNativeRequest(),
    permit: boundaryPermit,
  });
  assert.equal(res.ok, true);
});

test("validator accepts permit amount == '0' and minimal 1-byte signature", () => {
  const permit = {
    ...validPermit(),
    amount: "0",
    expiration: 0,
    nonce: 0,
    sigDeadline: "0",
    signature: "0x12" as `0x${string}`,
  };
  const res = validateSwapRequest({
    ...validNativeRequest(),
    permit,
  });
  assert.equal(res.ok, true);
});

test("validator rejects out-of-width permit fields", () => {
  // Amount > 2^160 - 1
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), amount: (MAX_UINT160 + 1n).toString() },
    }).ok,
    false,
    "rejects permit amount > 2^160 - 1",
  );

  // Expiration > 2^48 - 1
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), expiration: MAX_UINT48 + 1 },
    }).ok,
    false,
    "rejects permit expiration > 2^48 - 1",
  );

  // Expiration < 0 or fractional
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), expiration: -1 },
    }).ok,
    false,
  );
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), expiration: 1.5 },
    }).ok,
    false,
  );

  // Nonce > 2^48 - 1
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), nonce: MAX_UINT48 + 1 },
    }).ok,
    false,
    "rejects permit nonce > 2^48 - 1",
  );

  // Nonce < 0 or fractional
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), nonce: -1 },
    }).ok,
    false,
  );
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), nonce: 2.5 },
    }).ok,
    false,
  );

  // SigDeadline > 2^256 - 1
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), sigDeadline: (MAX_UINT256 + 1n).toString() },
    }).ok,
    false,
    "rejects permit sigDeadline > 2^256 - 1",
  );

  // Signature > 4096 bytes (4097 bytes = 8194 hex chars)
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: {
        ...validPermit(),
        signature: ("0x" + "ff".repeat(MAX_SIGNATURE_BYTES + 1)) as `0x${string}`,
      },
    }).ok,
    false,
    "rejects signature > 4096 bytes",
  );

  // Signature empty, odd length, or non-hex
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), signature: "0x" as `0x${string}` },
    }).ok,
    false,
    "rejects empty 0x signature",
  );
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), signature: "0x123" as `0x${string}` },
    }).ok,
    false,
    "rejects odd length signature",
  );
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), signature: "0x12zz" as `0x${string}` },
    }).ok,
    false,
    "rejects non-hex signature",
  );

  // Permit unknown key
  assert.equal(
    validateSwapRequest({
      ...validNativeRequest(),
      permit: { ...validPermit(), rogueField: "unauthorized" },
    }).ok,
    false,
    "rejects permit with unknown field",
  );
});

// -----------------------------------------------------------------------------
// 7. Bounded JSON & Stream Reader Tests
// -----------------------------------------------------------------------------
test("readBoundedJson rejects Content-Length exceeding 64 KiB early", async () => {
  const req = new Request("http://localhost:3000/api/swap/plan", {
    method: "POST",
    headers: { "Content-Length": "70000" },
  });
  const res = await readBoundedJson(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.status, "invalid");
  assert.match(res.error.detail, /64 KiB/);
});

test("readBoundedJson stops reading stream and rejects when actual bytes exceed 64 KiB", async () => {
  // Send 66 chunks of 1024 bytes each = 67584 bytes (> 65536)
  const chunk = new Uint8Array(1024);
  chunk.fill(120); // 'x'
  const chunks = Array.from({ length: 66 }, () => chunk);

  const req = createStreamRequest(chunks);
  const res = await readBoundedJson(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.status, "invalid");
  assert.match(res.error.detail, /64 KiB/);
});

test("readBoundedJson catches spoofed Content-Length when stream exceeds 64 KiB", async () => {
  // Spoof Content-Length: 100, but deliver 70 KiB
  const chunk = new Uint8Array(1024);
  chunk.fill(120);
  const chunks = Array.from({ length: 70 }, () => chunk);

  const req = createStreamRequest(chunks, { "Content-Length": "100" });
  const res = await readBoundedJson(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.status, "invalid");
  assert.match(res.error.detail, /64 KiB/);
});

test("readBoundedJson rejects malformed JSON", async () => {
  const brokenJson = Buffer.from("{ incomplete json string: 123");
  const req = createStreamRequest([new Uint8Array(brokenJson)]);
  const res = await readBoundedJson(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.status, "invalid");
  assert.equal(res.error.detail, "The request body was not valid JSON.");
});

test("readBoundedJson rejects empty body", async () => {
  const req = createStreamRequest([new Uint8Array(0)]);
  const res = await readBoundedJson(req);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.status, "invalid");
  assert.equal(res.error.detail, "The request body was not valid JSON.");
});

// -----------------------------------------------------------------------------
// 8. Route Integration Tests with Mocked buildSwapPlan
// -----------------------------------------------------------------------------
test("POST route succeeds with 200, no-store and x-server-time on valid request", async () => {
  const { POST } = await getRoute();
  buildSwapPlanCalls = [];
  const validBody = JSON.stringify(validNativeRequest());
  const req = new NextRequest("http://localhost:3000/api/swap/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: validBody,
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.ok(res.headers.get("x-server-time"));
  assert.equal(buildSwapPlanCalls.length, 1);
  assert.equal(buildSwapPlanCalls[0].account, VALID_ACCOUNT);

  const json = await res.json();
  assert.equal(json.status, "ready");
});

test("POST route rejects oversized stream with 400 and does NOT invoke buildSwapPlan", async () => {
  const { POST } = await getRoute();
  buildSwapPlanCalls = [];
  const chunk = new Uint8Array(1024);
  chunk.fill(32);
  const chunks = Array.from({ length: 66 }, () => chunk);
  const req = createStreamRequest(chunks);

  const res = await POST(req);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(buildSwapPlanCalls.length, 0, "buildSwapPlan must not be called on oversized stream");

  const json = await res.json();
  assert.equal(json.status, "invalid");
  assert.match(json.detail, /64 KiB/);
});

test("POST route rejects booleans or hex amount with 400 and does NOT invoke buildSwapPlan", async () => {
  const { POST } = await getRoute();
  const badBodies = [
    JSON.stringify({ ...validNativeRequest(), amountIn: true }),
    JSON.stringify({ ...validNativeRequest(), amountIn: "0x1234" }),
    JSON.stringify({ ...validNativeRequest(), amountIn: 1000 }),
  ];

  for (const body of badBodies) {
    buildSwapPlanCalls = [];
    const req = new NextRequest("http://localhost:3000/api/swap/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(buildSwapPlanCalls.length, 0, "buildSwapPlan must not be called for invalid amount");
    const json = await res.json();
    assert.equal(json.status, "invalid");
  }
});

test("POST route rejects missing slippage with 400 and does NOT invoke buildSwapPlan", async () => {
  const { POST } = await getRoute();
  buildSwapPlanCalls = [];
  const { slippageBps: _, ...missingSlippage } = validNativeRequest();
  const req = new NextRequest("http://localhost:3000/api/swap/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(missingSlippage),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(buildSwapPlanCalls.length, 0);
  const json = await res.json();
  assert.equal(json.status, "invalid");
});

test("POST route rejects malformed JSON with 400 and does NOT invoke buildSwapPlan", async () => {
  const { POST } = await getRoute();
  buildSwapPlanCalls = [];
  const req = new NextRequest("http://localhost:3000/api/swap/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ unclosed_json: ",
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(buildSwapPlanCalls.length, 0);
  const json = await res.json();
  assert.equal(json.status, "invalid");
  assert.equal(json.detail, "The request body was not valid JSON.");
});

test("POST route rejects non-object JSON with 400 and does NOT invoke buildSwapPlan", async () => {
  const { POST } = await getRoute();
  const nonObjects = ['"just a string"', "12345", "true", "[1, 2, 3]"];
  for (const body of nonObjects) {
    buildSwapPlanCalls = [];
    const req = new NextRequest("http://localhost:3000/api/swap/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(buildSwapPlanCalls.length, 0);
    const json = await res.json();
    assert.equal(json.status, "invalid");
  }
});

test("validator carries atomicBatch only as a real boolean true", () => {
  const on = validateSwapRequest({ ...validNativeRequest(), atomicBatch: true });
  assert.equal(on.ok && on.value.atomicBatch, true);
  const off = validateSwapRequest({ ...validNativeRequest(), atomicBatch: false });
  assert.equal(off.ok && off.value.atomicBatch, undefined);
  assert.equal(validateSwapRequest({ ...validNativeRequest(), atomicBatch: "true" }).ok, false);
});
