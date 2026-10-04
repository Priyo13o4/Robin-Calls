// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IPermit2
 * @notice Minimal local view of Uniswap's canonical Permit2
 *         (`0x000000000022D473030F116dDEE9F6B43aC78BA3`, chain-verified on 4663).
 * @dev Struct SHAPES are copied verbatim from upstream `ISignatureTransfer` /
 *      `IAllowanceTransfer` — the ABI encoding is the contract here, and a field
 *      reordered by hand is a silent signature mismatch, not a compile error.
 *      Upstream is not vendored because permit2 pins `^0.8.17` + solmate and drags
 *      a second compiler profile into this project for four function signatures.
 *
 *      Selectors this file must keep producing (assert them on a fork before trusting
 *      any change to it):
 *        permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)
 *        approve(address,address,uint160,uint48)
 */
interface IPermit2 {
    // --- ISignatureTransfer (one-shot, signature-authorised pulls) ---

    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /**
     * @dev The signed struct carries `spender`, which Permit2 fills with its own
     *      `msg.sender` — so a signature naming this router can only ever be spent
     *      BY this router. Pairing that with `owner == msg.sender` on our side is
     *      what makes a lifted signature useless to a front-runner.
     */
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /**
     * @dev The witness form used by the gasless router. `witnessTypeString` must be the
     *      EXACT EIP-712 tail Permit2 appends to its stub; a malformed one does not revert
     *      here, it simply recovers a different signer, so only a fork test against the
     *      real Permit2 can prove it.
     *        permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)
     */
    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;

    function nonceBitmap(address owner, uint256 wordPos) external view returns (uint256);

    // --- IAllowanceTransfer (standing allowances; how Universal Router is funded) ---

    function approve(address token, address spender, uint160 amount, uint48 expiration) external;

    function allowance(address user, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce);

    // --- EIP-712 ---

    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
