// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IRobinCallsGaslessRouter
 * @notice Types, events and errors for the RobinCalls gasless (relayed) swap router.
 * @dev Design: docs/cross-dex-router/WAYS-OF-WORK.md (Phase 2, ENABLE_GASLESS_SWAPS),
 *      KNOWN-PROBLEMS L181 (never name an amount the plan cannot know) and L182
 *      (nothing may be left in the wrapped router).
 */
interface IRobinCallsGaslessRouter {
    // ===================================================================
    // TYPES
    // ===================================================================

    /**
     * @notice What Permit2 pulls, and from whom. Every field is covered by the Permit2
     *         signature itself (token, amount, nonce, deadline; owner is the signer).
     */
    struct OrderPermit {
        address owner;
        address tokenIn;
        uint256 amountIn;
        uint256 nonce;
        uint256 deadline;
    }

    /**
     * @notice The Permit2 witness: everything else the user agreed to. A relayer can
     *         submit this order or decline to; it cannot change any field.
     * @param recipient     Receives tokenOut. Residual input always returns to the owner.
     * @param target        Allowlisted router. Receives the post-fee input by transfer and
     *                      must swap its own balance (CONTRACT_BALANCE), never a named amount.
     * @param tokenOut      Output token; address(0) means native ETH.
     * @param minAmountOut  Floor on what the recipient receives, after our fee AND the relayer fee.
     * @param feeBps        Our fee, set by /admin config at quote time, capped by MAX_FEE_BPS.
     * @param feeRecipient  Where our fee goes.
     * @param maxRelayerFee Cap on the relayer's gas reimbursement, paid in tokenOut, which
     *                      must then be native ETH or WETH. Zero means sponsored.
     * @param callDataHash  keccak256 of the calldata handed to `target`.
     */
    struct SwapOrder {
        address recipient;
        address target;
        address tokenOut;
        uint256 minAmountOut;
        uint16 feeBps;
        address feeRecipient;
        uint256 maxRelayerFee;
        bytes32 callDataHash;
    }

    // ===================================================================
    // EVENTS
    // ===================================================================

    /// @dev `amountIn` is what actually arrived (fee-on-transfer aware); `amountOut` is net.
    event OrderExecuted(
        address indexed owner,
        address indexed tokenIn,
        address indexed tokenOut,
        address target,
        address recipient,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount,
        address relayer,
        uint256 relayerFee
    );

    event FeeCollected(address indexed token, address indexed recipient, uint256 amount);
    event Refunded(address indexed token, address indexed to, uint256 amount);
    event TargetRegistered(address indexed target);
    event FeeAssetRegistered(address indexed asset);
    event TargetPauseSet(address indexed target, bool paused);
    event Swept(address indexed token, address indexed to, uint256 amount);

    // ===================================================================
    // ERRORS
    // ===================================================================

    error ZeroAddress();
    error NoTargets();
    error InvalidTarget(address target);
    error GasOverheadTooHigh(uint256 requested, uint256 cap);
    error RenounceDisabled();

    error Expired(uint256 deadline);
    error ZeroRecipient();
    error IdenticalTokens();
    error NativeInputUnsupported();
    error TargetNotAllowed(address target);
    error TargetIsPaused(address target);
    error FeeAboveCap(uint16 requested, uint16 cap);
    error InvalidFeeRecipient(address feeRecipient);
    error CallDataMismatch();
    error RelayerFeeNeedsEthOutput(address tokenOut);
    error NoInput();
    error ZeroSwapAmount();
    error NoOutput();
    error RouterResidue(address token, uint256 before, uint256 afterCall);
    error InsufficientOutput(uint256 received, uint256 minimum);
    error TargetCallFailed();

    // ===================================================================
    // FUNCTIONS
    // ===================================================================

    function executeOrder(
        OrderPermit calldata permit,
        SwapOrder calldata order,
        bytes calldata callData,
        bytes calldata signature
    ) external returns (uint256 amountOut);

    function hashOrder(SwapOrder calldata order) external pure returns (bytes32);

    function setPaused(bool paused) external;
    function setTargetPaused(address target, bool paused) external;
    function sweep(address token, address to, uint256 amount) external;

    function isTarget(address target) external view returns (bool);
    function isTargetPaused(address target) external view returns (bool);
    function isFeeAsset(address asset) external view returns (bool);
    function totalFeesCollected(address token) external view returns (uint256);
    function targets() external view returns (address[] memory);
    function feeAssets() external view returns (address[] memory);
}
