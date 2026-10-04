import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  concatHex,
  encodeAbiParameters,
  hashDomain,
  hashTypedData,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

/**
 * Reconcile two independent constructions of the Permit2 witness digest (CLAUDE.md §9).
 *
 * The fork suite cannot do this. Permit2 rebuilds its typehash FROM the string the contract
 * hands it, so a wrong but self-consistent WITNESS_TYPE_STRING still executes on chain and
 * only fails against a real wallet, which builds the digest from the struct definitions.
 * So one side here is viem's EIP-712 implementation and the other is the contract's own
 * string, read out of the Solidity source. They must agree byte for byte.
 */

const ROOT = join(import.meta.dirname, "..");
const SOL = readFileSync(
  join(ROOT, "contracts/src/swap-router/RobinCallsGaslessRouter.sol"),
  "utf8",
);

/** Pull a Solidity string constant's value, newlines and indentation removed. */
function solString(name: string): string | null {
  const at = SOL.indexOf(`string public constant ${name} =`);
  if (at < 0) return null;
  const open = SOL.indexOf('"', at);
  const close = SOL.indexOf('"', open + 1);
  if (open < 0 || close < 0) return null;
  return SOL.slice(open + 1, close);
}

/** Pull the literal inside a keccak256("...") constant. */
function solTypeString(name: string): string | null {
  const at = SOL.indexOf(`bytes32 public constant ${name} = keccak256(`);
  if (at < 0) return null;
  const open = SOL.indexOf('"', at);
  const close = SOL.indexOf('"', open + 1);
  if (open < 0 || close < 0) return null;
  return SOL.slice(open + 1, close);
}

const PERMIT2: Address = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const CHAIN_ID = 4663;

/**
 * Measured from the deployed Permit2 on 4663, 2026-09-16:
 *   cast call 0x000000000022D473030F116dDEE9F6B43aC78BA3 "DOMAIN_SEPARATOR()(bytes32)"
 */
const ON_CHAIN_DOMAIN_SEPARATOR: Hex =
  "0x448684463b1f7965c1ec7c249cee11520df24c07242efc2b20f6e54c85614fad";

const STUB =
  "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";

const order = {
  recipient: "0x00000000000000000000000000000000000000aa" as Address,
  target: "0x8876789976decbfcbbbe364623c63652db8c0904" as Address,
  tokenOut: "0x0e5f7772ab4717c9ce4cad0acd01de7bf17d442e" as Address,
  minAmountOut: 1234n,
  feeBps: 100,
  feeRecipient: "0x00000000000000000000000000000000feeeeeee" as Address,
  maxRelayerFee: 0n,
  callDataHash: keccak256(toHex("some calldata")),
};

const permitted = {
  token: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as Address,
  amount: 1_000_000n,
};
const SPENDER: Address = "0x00000000000000000000000000000000000000bb";
const NONCE = 7n;
const DEADLINE = 1_800_000_000n;

test("Permit2's domain has no version field, and matches the deployed separator", () => {
  // A `version` here is the classic wrong guess: it changes every digest and every
  // signature silently recovers a stranger.
  const built = hashDomain({
    domain: { name: "Permit2", chainId: CHAIN_ID, verifyingContract: PERMIT2 },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
  assert.equal(
    built,
    ON_CHAIN_DOMAIN_SEPARATOR,
    "the domain a wallet builds does not match the Permit2 deployed on 4663",
  );
});

test("the contract's witness type string is exactly what viem's EIP-712 encoder produces", () => {
  const witnessTail = solString("WITNESS_TYPE_STRING");
  const orderType = solTypeString("SWAP_ORDER_TYPEHASH");
  // CLAUDE.md §8 #22: prove the extraction before asserting over it.
  assert.ok(witnessTail, "WITNESS_TYPE_STRING was not found in the Solidity source");
  assert.ok(orderType, "SWAP_ORDER_TYPEHASH was not found in the Solidity source");
  assert.ok(witnessTail.includes("SwapOrder witness)"), "extracted the wrong constant");
  assert.ok(orderType.startsWith("SwapOrder("), "extracted the wrong typehash literal");

  // Side A: the contract's own string, the way Permit2 concatenates it.
  const typeHashFromContract = keccak256(toHex(STUB + witnessTail));
  const permittedHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [keccak256(toHex("TokenPermissions(address token,uint256 amount)")), permitted.token, permitted.amount],
    ),
  );
  const witnessHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint16" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(toHex(orderType)),
        order.recipient,
        order.target,
        order.tokenOut,
        order.minAmountOut,
        order.feeBps,
        order.feeRecipient,
        order.maxRelayerFee,
        order.callDataHash,
      ],
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [typeHashFromContract, permittedHash, SPENDER, NONCE, DEADLINE, witnessHash],
    ),
  );
  const fromContract = keccak256(
    concatHex(["0x1901", ON_CHAIN_DOMAIN_SEPARATOR, structHash]),
  );

  // Side B: viem, from the struct definitions, which is what a wallet signs.
  const fromWallet = hashTypedData({
    domain: { name: "Permit2", chainId: CHAIN_ID, verifyingContract: PERMIT2 },
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "SwapOrder" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      SwapOrder: [
        { name: "recipient", type: "address" },
        { name: "target", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "minAmountOut", type: "uint256" },
        { name: "feeBps", type: "uint16" },
        { name: "feeRecipient", type: "address" },
        { name: "maxRelayerFee", type: "uint256" },
        { name: "callDataHash", type: "bytes32" },
      ],
    },
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted,
      spender: SPENDER,
      nonce: NONCE,
      deadline: DEADLINE,
      witness: order,
    },
  });

  assert.equal(
    fromContract,
    fromWallet,
    "the contract's witness type string and a wallet's EIP-712 encoding disagree, so a real signature would recover a different signer",
  );
});
