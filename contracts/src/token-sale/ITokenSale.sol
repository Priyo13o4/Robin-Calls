// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title ITokenSale
 * @notice Events, errors, state machine and view surface of {TokenSale}, split out so
 *         off-chain callers (the app, a subgraph, a verification script) can depend on
 *         the ABI without pulling in the implementation.
 */
interface ITokenSale {
    // ===================================================================
    // STATE MACHINE
    // ===================================================================

    /**
     * @notice Where the sale is in its life. One variable answers every "may I?" question.
     *
     *      Pending ──start()──> Active <──resume()/pause()──> Paused
     *         │                   │                             │
     *         │                   └────────close()──────────────┤
     *         │                                                 │
     *         │                                          Closed (terminal)
     *         └──────────────abandon()───────────────────> Abandoned (terminal)
     *                    (also from Active / Paused)
     *
     * @dev Closed and Abandoned are both terminal and mutually exclusive. Abandon is
     *      unreachable from Closed by necessity: once Closed, tokens start moving, so a
     *      later cancellation would leave some people holding tokens and others owed ETH
     *      out of a pot that already paid tokens out.
     */
    enum SaleState {
        Pending,
        Active,
        Paused,
        Closed,
        Abandoned
    }

    // ===================================================================
    // EVENTS
    // ===================================================================

    event SaleStarted(uint256 tokensForSale, uint256 heldBalance);
    event SalePaused();
    event SaleResumed();

    /// @notice Contributions stopped and `totalRaised` is final — it is the denominator
    ///         of every allocation, so nothing may move it afterwards.
    event SaleClosed(uint256 totalRaised, uint256 contributorCount);

    /// @notice The sale was cancelled. Contributors pull their exact ETH back.
    event SaleAbandoned(uint256 totalRaised, uint256 contributorCount);

    event Contributed(address indexed contributor, uint256 amount, uint256 totalRaised);
    event Claimed(address indexed contributor, uint256 tokenAmount);
    event Refunded(address indexed contributor, uint256 amount);

    /// @notice The raise was split and paid out in one call. Emitted once, ever.
    event ProceedsWithdrawn(
        address indexed owner,
        uint256 ownerAmount,
        address indexed feeAddress1,
        uint256 fee1Amount,
        address indexed feeAddress2,
        uint256 fee2Amount,
        address feeAddress3,
        uint256 fee3Amount
    );

    /// @notice A fee share leg could not be delivered, so it went to `owner()` in the
    ///         same transaction. One unreceivable address can never strand the raise.
    event FeeShareRedirected(
        uint8 indexed feeAddressId, address indexed intended, address indexed to, uint256 amount
    );
    /// @notice A fee leg was turned off or back on by the owner. A disabled leg computes
    ///         to zero and falls to the owner through the existing subtraction.
    event FeeEnabledSet(uint8 indexed feeAddressId, bool enabled);
    /// @notice Where the referral pot scooped in {withdrawProceeds} is sent. Unset means
    ///         `owner()`, which is the state the contract ships in and may stay in forever.
    event ReferralPotRecipientSet(address indexed recipient);
    event ReferralPotPaid(address indexed to, uint256 amount);
    /// @notice Sale tokens left in the contract were burned, reducing `totalSupply`.
    event UnclaimedBurned(uint256 amount);

    event FeeAddress1Set(address indexed feeAddress1);
    event FeeAddress2Set(address indexed feeAddress2);
    event FeeAddress3Set(address indexed feeAddress3);
    event UnsoldTokensWithdrawn(address indexed to, uint256 amount);
    event ERC20Recovered(address indexed erc20, address indexed to, uint256 amount);

    /// @notice ETH arrived outside `contribute()`. Buys nothing; refundable on request.
    event StrayReceived(address indexed sender, uint256 amount, uint256 totalStray);
    event StrayClaimed(address indexed sender, uint256 amount);
    event StraySwept(address indexed to, uint256 amount);
    event ContributionLimitsSet(uint256 minInitialContribution, uint256 contributionStep);

    // ===================================================================
    // ERRORS
    // ===================================================================

    /// @notice The call is not legal from the state the sale is currently in.
    error WrongState(SaleState current);

    error ZeroAddress();
    error ZeroTokensForSale();

    /// @notice `start()` was called before the contract held the tokens it promises.
    error Underfunded(uint256 held, uint256 required);
    /// @notice `start()` was called holding MORE than the target. Rejected because
    ///         allocations divide TOKENS_FOR_SALE and never the balance, so the excess is
    ///         unreachable by every exit once the sale opens. Still recoverable from
    ///         Pending via abandon() then withdrawUnsoldTokens().
    error Overfunded(uint256 held, uint256 required);

    error ZeroContribution();

    /// @notice A wallet's FIRST contribution was under {minInitialContribution}.
    ///         Top-ups are exempt: the floor prices the permanent `contributors` slot a new
    ///         address allocates, which a top-up does not.
    error BelowMinimumContribution(uint256 sent, uint256 minimum);

    /// @notice The amount was not a whole multiple of {contributionStep}.
    error NotStepMultiple(uint256 sent, uint256 step);
    error InvalidContributionLimits(uint256 minContribution, uint256 step);
    error RenounceOwnershipDisabled();
    error AlreadyClaimed();
    error NothingToClaim();
    error AlreadyRefunded();
    error NothingToRefund();
    error NothingToWithdraw();
    error ProceedsAlreadyWithdrawn();

    /// @notice A fee address cannot be address(0).
    error FeeAddressRequired();
    error InvalidFeeAddressId(uint8 feeAddressId);
    /// @dev The burn is time-locked from the close and NOT gated on distribution being
    ///      complete: one address that cannot receive tokens would otherwise block it forever.
    error BurnTooEarly(uint256 availableAt);
    error AlreadyBurned();
    /// @notice Claiming after {burnUnclaimed} ran. A readable sentence rather than an
    ///         ERC20 underflow from a contract that no longer holds the tokens.
    error SaleTokensBurned();
    error SaleWasNotEmpty();

    /// @notice `recoverERC20` may never touch the token being sold.
    error CannotRecoverSaleToken();

    error StrayAlreadySwept();
    error NoStray();

    error EthTransferFailed();

    // ===================================================================
    // ACTIONS
    // ===================================================================

    function start() external;
    function pause() external;
    function resume() external;
    function close() external;
    function abandon() external;

    function contribute() external payable;
    function claim() external;
    function claimRefund() external;
    function claimStray() external;

    function distribute(uint256 count) external returns (uint256 processed);
    /// @dev No destination argument: the owner leg goes to `owner()` and the fee legs to
    ///      `feeAddress1`, `feeAddress2` and `feeAddress3` as they stand at the time of the call.
    function withdrawProceeds() external;
    /// @notice Turns a fee leg off or back on. Any state, until {withdrawProceeds}.
    function setFeeEnabled(uint8 feeAddressId, bool enabled) external;
    /// @notice Destination of the referral scoop. Any state, until {withdrawProceeds}.
    function setReferralPotRecipient(address recipient) external;
    /// @notice Burns whatever sale tokens remain, {BURN_DELAY} after the close.
    function burnUnclaimed() external;
    function setFeeAddress1(address feeAddress1_) external;
    function setFeeAddress2(address feeAddress2_) external;
    function setFeeAddress3(address feeAddress3_) external;
    function setContributionLimits(uint256 minInitialContribution_, uint256 contributionStep_) external;
    function withdrawUnsoldTokens(address to) external;
    /// @notice Takes the stray pot. Repeatable, so late arrivals are never stranded.
    function sweepStray(address to) external;
    function recoverERC20(address erc20, address to, uint256 amount) external;

    // ===================================================================
    // VIEWS
    // ===================================================================

    function token() external view returns (address);
    function tokensForSale() external view returns (uint256);
    function state() external view returns (SaleState);
    function minInitialContribution() external view returns (uint256);
    function contributionStep() external view returns (uint256);
    function censusSlice(uint256 offset, uint256 count)
        external
        view
        returns (address[] memory wallets, uint256[] memory amounts);

    function totalRaised() external view returns (uint256);
    function contributed(address account) external view returns (uint256);
    function claimed(address account) external view returns (bool);
    function refunded(address account) external view returns (bool);
    function contributorCount() external view returns (uint256);
    function allocationOf(address account) external view returns (uint256);

    function feeAddress1() external view returns (address);
    function feeAddress2() external view returns (address);
    function feeAddress3() external view returns (address);
    function feeAddress1Bps() external pure returns (uint16);
    function feeAddress2Bps() external pure returns (uint16);
    function feeAddress3Bps() external pure returns (uint16);
    /// @notice True when that leg has been switched off and will compute to zero.
    function feeDisabled(uint8 feeAddressId) external view returns (bool);
    function referralBps() external pure returns (uint16);
    /// @notice Unset (address(0)) means the scoop goes to `owner()`.
    function referralPotRecipient() external view returns (address);
    /// @notice When {close} ran. Zero until then. The burn clock starts here.
    function closedAt() external view returns (uint256);
    function unclaimedBurned() external view returns (bool);

    function strayOf(address account) external view returns (uint256);
    function totalStray() external view returns (uint256);
    function straySwept() external view returns (bool);
    function proceedsWithdrawn() external view returns (bool);
}
