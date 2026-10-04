// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IRobinCallsRouter
 * @notice Types, events and errors for the RobinCalls swap executor.
 * @dev Split out so the off-chain plan builder and any integrator can depend on
 *      the shapes without pulling the implementation.
 *      Design: docs/cross-dex-router/WAYS-OF-WORK.md §5 Phase 2, §7, §8 D1/D3/D4.
 */
interface IRobinCallsRouter {
    // ===================================================================
    // TYPES
    // ===================================================================

    /**
     * @notice How the input token reaches the wrapped router.
     * @dev Not cosmetic — the DEX families on this chain disagree about it, and
     *      guessing wrong is a reverted trade, not a silent one:
     *      APPROVE         classic routers (UniswapV2Router02, SwapRouter02,
     *                      Sushi/Pancake routers) pull with a plain allowance.
     *      PERMIT2_APPROVE Uniswap Universal Router pulls through Permit2, so the
     *                      allowance has to be granted to Permit2 and then routed
     *                      on to the target (`payerIsUser = true` in its inputs).
     *      TRANSFER        route processors and launchpad curves that expect the
     *                      funds to already be sitting on them when called.
     */
    enum PayMode {
        APPROVE,
        PERMIT2_APPROVE,
        TRANSFER
    }

    /**
     * @notice One fully specified trade. Built off-chain by the routing service —
     *         this contract never forms an intent of its own.
     * @param target       Wrapped router / pad. Must be in the write-once allowlist.
     * @param tokenIn      Input token; `address(0)` means native ETH.
     * @param tokenOut     Output token; `address(0)` means native ETH.
     * @param amountIn     Amount pulled from the caller. For native it must equal msg.value.
     * @param minAmountOut Floor on what the RECIPIENT receives, i.e. after our fee.
     * @param recipient    Who receives `tokenOut`. Residual input always returns to msg.sender.
     * @param deadline     Unix seconds; the trade reverts at or past it.
     * @param payMode      See {PayMode}.
     * @param callData     Calldata for `target`, built by the venue adapter off-chain.
     */
    struct SwapPlan {
        address target;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        PayMode payMode;
        bytes callData;
    }

    /**
     * @notice Permit2 signature-transfer material for pulling `tokenIn`.
     * @dev An empty `signature` selects the plain ERC20 allowance path instead, so
     *      a wallet that cannot sign typed data is never locked out.
     */
    struct Permit {
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    // ===================================================================
    // EVENTS
    // ===================================================================

    /// @dev `amountIn` and `amountOut` are MEASURED balance deltas, never the quoted figures.
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        address target,
        address recipient,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount
    );

    /// @dev Exactly one of these per trade with a non-zero fee. Two would be a bug.
    event FeeCollected(address indexed token, address indexed recipient, uint256 amount);

    /// @dev Unspent input handed back to the payer, not to `recipient`.
    event Refunded(address indexed token, address indexed to, uint256 amount);

    event TargetRegistered(address indexed target);
    event FeeAssetRegistered(address indexed asset);

    // Owner surface (D1) — one event per capability.
    event FeeConfigUpdated(uint16 feeBps, address feeRecipient);
    event TargetPauseSet(address indexed target, bool paused);
    event Swept(address indexed token, address indexed to, uint256 amount);
    // Global trading pause reuses OpenZeppelin Pausable's own Paused/Unpaused.

    // ===================================================================
    // ERRORS
    // ===================================================================

    error ZeroAddress();
    error NoTargets();
    error InvalidTarget(address target);
    error TargetNotAllowed(address target);
    error TargetIsPaused(address target);
    error FeeAboveCap(uint16 requested, uint16 cap);
    error RenounceDisabled();

    error Expired(uint256 deadline);
    error ZeroRecipient();
    error IdenticalTokens();
    error NativeAmountMismatch(uint256 sent, uint256 declared);
    error UnexpectedNative();
    error NoInput();
    error ZeroSwapAmount();
    error NoOutput();
    error InsufficientOutput(uint256 received, uint256 minimum);
    error TargetCallFailed();

    // ===================================================================
    // FUNCTIONS
    // ===================================================================

    function execute(SwapPlan calldata plan, Permit calldata permit)
        external
        payable
        returns (uint256 amountOut);

    function setFeeConfig(uint16 newFeeBps, address newFeeRecipient) external;
    function setPaused(bool paused) external;
    function setTargetPaused(address target, bool paused) external;
    function sweep(address token, address to, uint256 amount) external;

    function feeBps() external view returns (uint16);
    function feeRecipient() external view returns (address);
    function totalFeesCollected(address token) external view returns (uint256);
    function isTarget(address target) external view returns (bool);
    function isTargetPaused(address target) external view returns (bool);
    function isFeeAsset(address asset) external view returns (bool);
    function targets() external view returns (address[] memory);
    function feeAssets() external view returns (address[] memory);
}
