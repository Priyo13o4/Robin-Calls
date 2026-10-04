/**
 * ERC-1271 `isValidSignature`.
 *
 * viem exports `erc1271Abi` from `viem/constants` but that subpath is not in
 * the package's `exports` map (verified against the installed 2.56.0), and the
 * ABI is four fields — a hand copy here is cheaper than a second dependency.
 * The magic value `0x1626ba7e` is the standard, checked lowercase by callers.
 */
export const erc1271Abi = [
  {
    name: "isValidSignature",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes4" }],
  },
] as const;

export const ERC1271_MAGIC_VALUE = "0x1626ba7e";
