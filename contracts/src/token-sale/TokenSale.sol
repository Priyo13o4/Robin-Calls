// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/*
 * ===========================================================================
 *
 *                                                           :=******=.
 *                                                         -%@@@@@@@@@@.
 *                                                       -%@@@@@@@@@@@@=
 *                                                      :--------@@@@@@=
 *                                                   :#%%%%%#=   @@@@@%.
 *                                       .-++      .+@@@@@@*..*= @@@@+
 *                                   .-+%@@@@#    =@@@@@@#: +@@= @@#.
 *                                :=#@@@@@@@@@#  *@@@@@%- =%@@@= %-
 *                             .=%@@@@@@@@@@@@@: @@@@@# .#@@@@@=
 *                           :*@@@@@@@@@@@@@@@@ :@@@@= =@@@@@@#.
 *                         :#@@@@@@@@@@@@@@@@@@:.@@@: *@@@@@@=
 *                       .*@@@@@@@@@@@@@@@@@@@@.=@%: #@@@@@%:
 *                      +@@@@@@@@@@@@@@@@@@@@@--@%:.%%*+-:.
 *                    :%@@@@@@%%%**#@@@@@@@@@=:@@: .
 *                   +%*+=-:.:=+#%@@@@@@@@@@#:@@:
 *                     .-=*%@@@@@@@@@@@@@@@@-%@*:
 *        .::::::--=*#@@@@@@@@@@@@@@@@@@@@@#+@@@@@%#*-
 *         -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@+@@@@@@@@+.
 *            :=+**#%*@@@@@@@@@@@@@@@@@@@@@%@@@@@%=.
 *                    @@@@@@@@@@@@@@@@@@@@@@@@@@#
 *                   #@@@@@@@@@@@@@@@@@@@@@@@@@@@%*-
 *                  *@@@@@@@@@@@@@@@@@@@@@@@@@@@@*.
 *                 .==%@@@@@@@@@@@@@@@@@@@@@@@@-.    :-=**=
 *                    *@@@@@@@@@@@@@@@@@@@@@#+-.:=*%@@@@@=
 *                    :%@@@@@@@@@@@@@@@@%+:.-+#@@@@@@@@%:
 *                     %@@@@@@@@@@@@@%=: =*@@@@@@@@@@@%.
 *                     -===-:.%@@@@*- -*@@@@@@@@@@@@@@-
 *                            +@@*.:+%@@@@@@@@@@@@@@@@@*.
 *                           :%#:-*@@@@@@@@@@@@@@@@@@@@@@-
 *                          +@=-#@@@@@@@@@@@%#**+===+*#%@@:
 *                        .%@+#@@@@@@@#*=:.              :=
 *                       .%@#@@@@@#+-
 *                      :%@@@@%+-
 *                      %@@@+:
 *                     *@#-
 *                    :*:
 *
 * ===========================================================================
 *
 *                 R O B I N C A L L S   ::   $ROBINCALLS
 *              Official ROBINCALLS Fair-Launch Sale
 *                     on Robinhood Chain
 *
 *                     Steal from the ruggers.
 *                     Give to the holders.
 *
 * ---------------------------------------------------------------------------
 *
 *   Sale       https://robincalls.com/token-sale
 *   Website    https://robincalls.com
 *   Scanner    https://robincalls.com/scan
 *   RWA        https://robincalls.com/rwa
 *   X          https://x.com/RobinCalls
 *
 *   Chain      Robinhood Chain (chain id 4663)
 *
 * ---------------------------------------------------------------------------
 *
 *   WHAT ROBINCALLS DOES
 *
 *     Scanner        Paste a token. Get the truth.
 *                    Honeypots, hidden taxes, pulled liquidity, whales.
 *                    Caught before you buy, not after you cry.
 *
 *     Night Market   Every launchpad on the chain. One live feed.
 *                    Fresh curves, graduations, direct DEX launches.
 *
 *     Swap           Best route across the chain's DEXs. Simulated first,
 *                    so what you see is what you get.
 *
 *     Trade          Live chart, live trades, verdict on the same screen.
 *                    Never ape blind again.
 *
 *     RWA            Anyone can name a token "TSLA".
 *                    We check it against Robinhood's real contracts.
 *                    The ticker proves nothing. The code does.
 *
 *     Wanted         Every rug, every rugger. On-chain receipts.
 *
 *     Ledger         Every verdict we publish, hash-chained.
 *                    No call can be quietly rewritten. Not even by us.
 *
 *     Robin Knight   AI copilot that explains a verdict in plain words.
 *                    It explains. It never decides.
 *
 *     Ecosystem      Every project on Robinhood Chain, reviewed.
 *
 * ---------------------------------------------------------------------------
 *
 *   FAIR-LAUNCH SALE MECHANICS
 *
 *     Token           Sells an existing ERC-20 token configured at deployment
 *                     via constructor. No fixed token allocation or token CA
 *                     is hardcoded in this contract.
 *
 *     Allocation      Pro-rata distribution based on contribution:
 *                     allocation(a) = TOKENS_FOR_SALE * contributed[a] / totalRaised
 *
 *     Lifecycle       Deploy -> transfer EXACT allocation -> start()
 *
 *     Owner Controls  Owner can start, pause, resume, close, and abandon the sale;
 *                     adjust contribution limits and fee recipients; withdraw closed
 *                     sale proceeds; and burn remaining tokens 60 days after close.
 *
 *     Fairness        No whitelist, no max per-wallet, no price ramps.
 *                     If abandoned, contributors pull full refunds.
 *
 *   Don't trust us. Scan us: https://robincalls.com/scan
 *
 * ===========================================================================
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {ITokenSale} from "./ITokenSale.sol";

/**
 * @dev The one method {burnUnclaimed} needs. Declared here rather than importing
 *      ERC20Burnable so this contract keeps taking a plain IERC20 and stays deployable
 *      against any ERC20; the sale token (RobinCalls) is ERC20Burnable, and a token that
 *      is not simply makes {burnUnclaimed} revert rather than making this undeployable.
 */
interface IERC20Burnable {
    function burn(uint256 amount) external;
}

/**
 * @title TokenSale
 * @author RobinCalls (https://robincalls.com)
 * @notice Official ROBINCALLS fair-launch sale. Sells an existing token configured by
 *         constructor with pro-rata allocation. Contributors deposit ETH while active;
 *         upon closing, tokens are claimable in proportion to contribution:
 *
 *             allocation(a) = TOKENS_FOR_SALE * contributed[a] / totalRaised
 *
 * @dev Deployment order is deploy -> transfer EXACT allocation -> `start()`, and `start()` enforces it.
 *
 *      The contract sells an existing token passed into constructor with no hardcoded token CA
 *      or fixed token allocation. The owner can start, pause, resume, close, or abandon
 *      the sale, adjust contribution limits and fee recipients, withdraw closed sale
 *      proceeds, and burn remaining tokens 60 days after close (BURN_DELAY).
 *
 *      Multiply before dividing. An intermediate unit price truncates to zero under
 *      integer division, so every path goes through {allocationOf} instead.
 *
 *      Deliberately absent: no hard cap, no soft cap, no deadline, no per-wallet maximum,
 *      no whitelist, no vesting. The sale runs until the owner closes it, and claims are
 *      all-or-nothing because `claimed` is a flag rather than a balance.
 *
 *      The sale token must be a plain ERC20 with no transfer fee and no rebasing.
 *      TOKENS_FOR_SALE is a fixed promise that such a token cannot pay. `start()` catches
 *      the funding leg; nothing can catch a rebase mid-sale.
 *
 *      TWO ETH POTS, never mixed. `contribute()` fills `totalRaised`, which buys tokens; a
 *      plain send fills `strayOf`, which buys nothing and is refundable. Because they never
 *      mix, {withdrawProceeds} pays exactly `totalRaised` rather than sweeping the balance,
 *      so it structurally cannot reach a stray sender's funds. The accepted cost is that
 *      ETH force-sent by `selfdestruct` belongs to neither pot and is stranded.
 *
 *      Proceeds are split by constant percentages. The fee addresses, and whether each fee
 *      leg is on, stay owner-editable until {withdrawProceeds}.
 *
 * @custom:website https://robincalls.com
 * @custom:x https://x.com/RobinCalls
 * @custom:rwa https://robincalls.com/rwa
 * @custom:sale https://robincalls.com/token-sale
 */
contract TokenSale is ITokenSale, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ===================================================================
    // IMMUTABLE CONFIG
    // ===================================================================

    /// @dev Internal, not public: a generated getter would sit beside the interface's
    ///      `token()` as a second selector for the same value.
    IERC20 internal immutable TOKEN;
    uint256 internal immutable TOKENS_FOR_SALE;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice How long after {close} before {burnUnclaimed} opens.
    /// @dev UNCONDITIONAL. Deliberately not also gated on `distributionComplete()`: one
    ///      address that cannot receive tokens would then block the burn permanently.
    uint256 public constant BURN_DELAY = 60 days;

    /// @notice Scooped off `totalRaised` FIRST in {withdrawProceeds}, before the fee split.
    ///         Funds the referral ETH rebate, which is paid out off chain.
    /// @dev The remaining 96% is what the 4/8/8/80 split then divides. Taking it off the
    ///      top rather than out of the owner's leg is the published design
    ///      (docs/TOKEN-SALE-INTENT.md §10.5) and it moves 0.8% of the raise from the fee
    ///      addresses to the owner. That is a decision, not an accident; see issue 42.
    uint16 public constant REFERRAL_BPS = 400;

    /// @notice Fee legs in basis points: 8% team / second admin, 8% partner 1, 4% partner
    ///         2. The owner takes the remaining 8,000 bps (80%) for liquidity. Constants,
    ///         with no setters.
    uint16 public constant FEE_ADDRESS_1_BPS = 800;
    uint16 public constant FEE_ADDRESS_2_BPS = 800;
    uint16 public constant FEE_ADDRESS_3_BPS = 400;

    /// @notice Floor on a wallet's FIRST contribution only. Settable in wei while Pending, Active, Paused.
    uint256 public override minInitialContribution;

    /// @notice Granularity of every contribution, first and top-up alike. Settable in wei.
    uint256 public override contributionStep;

    // ===================================================================
    // STATE
    // ===================================================================

    /// @notice The whole lifecycle in one variable — see {ITokenSale.SaleState}.
    SaleState public override state;

    /// @notice Final once the sale leaves Active/Paused. It is the denominator of every
    ///         allocation: if contributions could resume after the first claim, earlier
    ///         claimants would have taken more than their share and the last would find an
    ///         empty contract, with no revert to say so.
    uint256 public override totalRaised;

    mapping(address => uint256) public override contributed;
    mapping(address => bool) public override claimed;
    mapping(address => bool) public override refunded;

    /// @dev Appended on an address's FIRST contribution only, so it holds no duplicates.
    address[] public contributors;

    /// @notice How far {distribute} has walked `contributors`. Only that function moves it.
    uint256 public distributionCursor;

    bool public override proceedsWithdrawn;

    /// @notice Where fee address 1's slice (8%) goes. Editable until {withdrawProceeds}.
    address public override feeAddress1;

    /// @notice Where fee address 2's slice (8%) goes. Editable until {withdrawProceeds}.
    address public override feeAddress2;

    /// @notice Where fee address 3's slice (4%) goes. Editable until {withdrawProceeds}.
    address public override feeAddress3;

    /// @notice Fee legs the owner has switched off. A disabled leg computes to zero and
    ///         falls to the owner through the existing subtraction, so nothing is stranded.
    /// @dev Keyed 1/2/3 to match the setters and the events.
    mapping(uint8 => bool) public override feeDisabled;

    /// @notice Where the {REFERRAL_BPS} scoop goes. Unset means `owner()`.
    /// @dev Unset is the state this ships in and may stay in forever: the sale is designed
    ///      to run with no distributor contract ever being built, so a zero here must be a
    ///      working configuration rather than a missing one.
    address public override referralPotRecipient;

    /// @notice Block timestamp of {close}. Zero until then; the burn clock starts here.
    uint256 public override closedAt;

    /// @notice True once {burnUnclaimed} has run. {claim} then reverts with a readable
    ///         error rather than an ERC20 underflow.
    bool public override unclaimedBurned;

    // ===================================================================
    // STRAY ETH — the second pot
    // ===================================================================

    mapping(address => uint256) public override strayOf;
    uint256 public override totalStray;

    /// @notice Once the owner sweeps, individual stray balances stop being claimable.
    ///         Without this flag a post-sweep {claimStray} would pay out of someone
    ///         else's money.
    bool public override straySwept;

    // ===================================================================
    // MODIFIERS
    // ===================================================================

    modifier inState(SaleState expected) {
        if (state != expected) revert WrongState(state);
        _;
    }

    // ===================================================================
    // CONSTRUCTOR
    // ===================================================================

    constructor(
        address owner_,
        address token_,
        uint256 tokensForSale_,
        address feeAddress1_,
        address feeAddress2_,
        address feeAddress3_
    ) Ownable(owner_) {
        if (owner_ == address(0) || token_ == address(0)) revert ZeroAddress();
        if (tokensForSale_ == 0) revert ZeroTokensForSale();
        if (feeAddress1_ == address(0) || feeAddress2_ == address(0) || feeAddress3_ == address(0)) {
            revert FeeAddressRequired();
        }

        TOKEN = IERC20(token_);
        TOKENS_FOR_SALE = tokensForSale_;
        feeAddress1 = feeAddress1_;
        minInitialContribution = 0.005 ether;
        contributionStep = 0.001 ether;
        feeAddress2 = feeAddress2_;
        feeAddress3 = feeAddress3_;
        // state defaults to Pending (enum member 0).
    }

    /// @notice Sets fee address 1 (team / second admin). Any state, until the proceeds are withdrawn.
    function setFeeAddress1(address feeAddress1_) external override onlyOwner {
        if (proceedsWithdrawn) revert ProceedsAlreadyWithdrawn();
        if (feeAddress1_ == address(0)) revert FeeAddressRequired();
        feeAddress1 = feeAddress1_;
        emit FeeAddress1Set(feeAddress1_);
    }

    /// @notice Sets fee address 2 (partner 1). Any state, until the proceeds are withdrawn.
    function setFeeAddress2(address feeAddress2_) external override onlyOwner {
        if (proceedsWithdrawn) revert ProceedsAlreadyWithdrawn();
        if (feeAddress2_ == address(0)) revert FeeAddressRequired();
        feeAddress2 = feeAddress2_;
        emit FeeAddress2Set(feeAddress2_);
    }

    /// @notice Sets fee address 3 (partner 2). Any state, until the proceeds are withdrawn.
    function setFeeAddress3(address feeAddress3_) external override onlyOwner {
        if (proceedsWithdrawn) revert ProceedsAlreadyWithdrawn();
        if (feeAddress3_ == address(0)) revert FeeAddressRequired();
        feeAddress3 = feeAddress3_;
        emit FeeAddress3Set(feeAddress3_);
    }

    /**
     * @notice Turns a fee leg off, or back on.
     * @dev Any state, until {withdrawProceeds}. A disabled leg computes to zero and falls
     *      to the owner through the subtraction there, so nothing is stranded and no other
     *      leg moves.
     *
     *      This is the remedy for a fee address that turns out to be wrong or unreachable.
     *      Without it the only exit is abandoning the sale, which is what happened on the
     *      2026-09-09 testnet run.
     */
    function setFeeEnabled(uint8 feeAddressId, bool enabled) external override onlyOwner {
        if (proceedsWithdrawn) revert ProceedsAlreadyWithdrawn();
        if (feeAddressId == 0 || feeAddressId > 3) revert InvalidFeeAddressId(feeAddressId);
        feeDisabled[feeAddressId] = !enabled;
        emit FeeEnabledSet(feeAddressId, enabled);
    }

    /**
     * @notice Sets where the {REFERRAL_BPS} scoop is paid.
     * @dev Any state, until {withdrawProceeds}. address(0) is VALID and means `owner()`:
     *      the sale is designed to open with no distributor built and may never get one,
     *      so unset has to be a working configuration rather than a missing one.
     */
    function setReferralPotRecipient(address recipient) external override onlyOwner {
        if (proceedsWithdrawn) revert ProceedsAlreadyWithdrawn();
        referralPotRecipient = recipient;
        emit ReferralPotRecipientSet(recipient);
    }

    /**
     * @notice Burns every sale token still held here, {BURN_DELAY} after the close.
     * @dev A real burn through ERC20Burnable, so `totalSupply` actually falls. Sending to
     *      a dead address would leave the supply figure overstating what exists.
     *
     *      The intended order is {distribute} over the whole contributor list FIRST, then
     *      this. What it then takes is dust, force-sent tokens and undeliverable balances,
     *      not allocations anyone was owed.
     *
     *      The delay is UNCONDITIONAL and is deliberately not also gated on
     *      `distributionComplete()`: one address that cannot receive tokens would
     *      otherwise block the burn permanently.
     */
    function burnUnclaimed() external override onlyOwner inState(SaleState.Closed) {
        if (unclaimedBurned) revert AlreadyBurned();
        uint256 availableAt = closedAt + BURN_DELAY;
        if (block.timestamp < availableAt) revert BurnTooEarly(availableAt);

        uint256 amount = TOKEN.balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();

        // Set before the external call, and it is also what makes {claim} fail readably
        // from here on rather than underflowing inside the token.
        unclaimedBurned = true;
        IERC20Burnable(address(TOKEN)).burn(amount);
        emit UnclaimedBurned(amount);
    }

    /// @notice Sets the minimum first contribution and contribution step in wei.
    ///         Allowed while Pending, Active, or Paused (e.g. to lower the floor mid-sale).
    function setContributionLimits(uint256 minInitialContribution_, uint256 contributionStep_)
        external
        override
        onlyOwner
    {
        if (state != SaleState.Pending && state != SaleState.Active && state != SaleState.Paused) {
            revert WrongState(state);
        }
        if (contributionStep_ == 0 || contributionStep_ > 1 ether) {
            revert InvalidContributionLimits(minInitialContribution_, contributionStep_);
        }
        if (
            minInitialContribution_ < contributionStep_ || minInitialContribution_ % contributionStep_ != 0
                || minInitialContribution_ > 100 ether
        ) {
            revert InvalidContributionLimits(minInitialContribution_, contributionStep_);
        }
        minInitialContribution = minInitialContribution_;
        contributionStep = contributionStep_;
        emit ContributionLimitsSet(minInitialContribution_, contributionStep_);
    }

    // ===================================================================
    // OWNER: LIFECYCLE
    // ===================================================================

    /**
     * @notice Opens the sale. Fund the contract with EXACTLY `TOKENS_FOR_SALE` first.
     * @dev Equality is demanded in both directions. Underfunded, the first claimants drain
     *      the contract and the rest revert. Overfunded, allocations still divide
     *      TOKENS_FOR_SALE and never the balance, `withdrawUnsoldTokens` is shut in a
     *      Closed sale that raised anything, and `recoverERC20` excludes the sale token,
     *      so the excess is stranded for good. A mistake here is still in Pending, where
     *      abandon() and withdrawUnsoldTokens() return the whole balance for a retry.
     */
    function start() external onlyOwner inState(SaleState.Pending) {
        uint256 held = TOKEN.balanceOf(address(this));
        if (held < TOKENS_FOR_SALE) revert Underfunded(held, TOKENS_FOR_SALE);
        if (held > TOKENS_FOR_SALE) revert Overfunded(held, TOKENS_FOR_SALE);
        state = SaleState.Active;
        emit SaleStarted(TOKENS_FOR_SALE, held);
    }

    function pause() external onlyOwner inState(SaleState.Active) {
        state = SaleState.Paused;
        emit SalePaused();
    }

    function resume() external onlyOwner inState(SaleState.Paused) {
        state = SaleState.Active;
        emit SaleResumed();
    }

    /// @notice Ends contributions and opens claiming. Terminal.
    /// @dev `closedAt` is recorded HERE and nowhere else. {burnUnclaimed} measures from it,
    ///      and without it the burn would have no clock to start from.
    function close() external onlyOwner {
        if (state != SaleState.Active && state != SaleState.Paused) revert WrongState(state);
        state = SaleState.Closed;
        closedAt = block.timestamp;
        emit SaleClosed(totalRaised, contributors.length);
    }

    /**
     * @notice Cancels the sale. Contributors pull their ETH back via {claimRefund}; the
     *         owner recovers the tokens via {withdrawUnsoldTokens}.
     * @dev Unreachable from Closed, see {ITokenSale.SaleState}. Refunds are pull, never a
     *      loop: a push over a few thousand addresses runs out of gas and would strand
     *      everyone's money behind a transaction that cannot fit.
     */
    function abandon() external onlyOwner {
        if (state == SaleState.Closed || state == SaleState.Abandoned) revert WrongState(state);
        state = SaleState.Abandoned;
        emit SaleAbandoned(totalRaised, contributors.length);
    }

    // ===================================================================
    // CONTRIBUTING
    // ===================================================================

    function contribute() external payable override nonReentrant inState(SaleState.Active) {
        // Zero satisfies the modulo below (0 % step == 0), so it keeps its own branch.
        if (msg.value == 0) revert ZeroContribution();
        if (msg.value % contributionStep != 0) revert NotStepMultiple(msg.value, contributionStep);

        if (contributed[msg.sender] == 0) {
            if (msg.value < minInitialContribution) {
                revert BelowMinimumContribution(msg.value, minInitialContribution);
            }
            contributors.push(msg.sender);
        }
        contributed[msg.sender] += msg.value;
        totalRaised += msg.value;

        emit Contributed(msg.sender, msg.value, totalRaised);
    }

    /**
     * @dev A plain send is NOT a contribution. It is recorded in `strayOf`, buys no
     *      tokens, and the sender can pull it back with {claimStray}. Recording direct
     *      sends keeps them refundable without letting them become a silent purchase.
     */
    receive() external payable {
        strayOf[msg.sender] += msg.value;
        totalStray += msg.value;
        emit StrayReceived(msg.sender, msg.value, totalStray);
    }

    // ===================================================================
    // DISTRIBUTION
    // ===================================================================

    /// @notice A contributor's token allocation. Zero until anyone contributes.
    function allocationOf(address account) public view override returns (uint256) {
        if (totalRaised == 0) return 0;
        return (TOKENS_FOR_SALE * contributed[account]) / totalRaised;
    }

    /// @notice Pull your whole allocation, once. This is the guarantee — {distribute} is
    ///         convenience.
    function claim() external override nonReentrant inState(SaleState.Closed) {
        // A readable sentence instead of an ERC20 underflow from a contract that no
        // longer holds the tokens.
        if (unclaimedBurned) revert SaleTokensBurned();
        if (claimed[msg.sender]) revert AlreadyClaimed();
        if (_deliver(msg.sender) == 0) revert NothingToClaim();
    }

    /**
     * @notice Owner-driven push over the next `count` contributors.
     * @dev Chunked because an unbounded loop over every contributor runs out of gas at a
     *      few thousand entries and is then permanently unusable. Idempotent against
     *      {claim}: an address that already has its tokens is skipped and the cursor still
     *      advances, so the two paths mix freely.
     */
    function distribute(uint256 count)
        external
        override
        nonReentrant
        onlyOwner
        inState(SaleState.Closed)
        returns (uint256 processed)
    {
        // Same guard as {claim}, for the same reason: after the burn there are no tokens
        // to deliver, and a readable revert beats an underflow inside the token.
        if (unclaimedBurned) revert SaleTokensBurned();
        uint256 from = distributionCursor;
        uint256 end = from + count;
        uint256 total = contributors.length;
        if (end > total) end = total;

        for (uint256 i = from; i < end; ++i) {
            _deliver(contributors[i]);
        }

        distributionCursor = end;
        processed = end - from;
    }

    /// @dev The single delivery site. Returns 0 when there was nothing to send, so callers
    ///      decide whether that is an error ({claim}) or a skip ({distribute}).
    function _deliver(address to) internal returns (uint256 amount) {
        if (claimed[to]) return 0;
        amount = allocationOf(to);
        if (amount == 0) return 0;

        claimed[to] = true; // effects before interaction, guard or no guard
        TOKEN.safeTransfer(to, amount);
        emit Claimed(to, amount);
    }

    // ===================================================================
    // REFUNDS (Abandoned only)
    // ===================================================================

    /// @notice Pull back your exact contribution after the sale is abandoned.
    function claimRefund() external override nonReentrant inState(SaleState.Abandoned) {
        if (refunded[msg.sender]) revert AlreadyRefunded();
        uint256 amount = contributed[msg.sender];
        if (amount == 0) revert NothingToRefund();

        refunded[msg.sender] = true;
        _sendEth(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    // ===================================================================
    // STRAY ETH
    // ===================================================================

    /// @notice Pull back ETH you sent directly to this contract. Available in any state,
    ///         until the owner sweeps.
    function claimStray() external override nonReentrant {
        if (straySwept) revert StrayAlreadySwept();
        uint256 amount = strayOf[msg.sender];
        if (amount == 0) revert NoStray();

        strayOf[msg.sender] = 0;
        totalStray -= amount;
        _sendEth(msg.sender, amount);
        emit StrayClaimed(msg.sender, amount);
    }

    /**
     * @notice Owner takes whatever stray ETH nobody reclaimed. Repeatable.
     * @dev Terminal states only, so a stray sender has the whole life of the sale to call
     *      {claimStray} before the line is drawn under the pot.
     *
     *      REPEATABLE on purpose. People keep sending ETH to an address long after it is
     *      finished, and the first version of this refused a second sweep, so anything
     *      arriving afterwards was stranded for everyone: `receive()` still booked it,
     *      while {claimStray} and this both refused. Nobody was served by that.
     *
     *      `straySwept` still latches on the FIRST sweep and still closes {claimStray}
     *      permanently, which is the part that is load-bearing: after a sweep the
     *      per-sender `strayOf` entries are stale, so a later claim would pay out of ETH
     *      this already removed, i.e. out of the proceeds. Sweeping again only ever moves
     *      `totalStray`, a counter disjoint from `totalRaised`, so no repetition of this
     *      call can reach the raise or a contributor's refund.
     */
    function sweepStray(address to) external override nonReentrant onlyOwner {
        if (state != SaleState.Closed && state != SaleState.Abandoned) revert WrongState(state);
        if (to == address(0)) revert ZeroAddress();

        uint256 amount = totalStray;
        if (amount == 0) revert NoStray();

        straySwept = true;
        totalStray = 0;
        _sendEth(to, amount);
        emit StraySwept(to, amount);
    }

    // ===================================================================
    // OWNER: PROCEEDS AND RECOVERY
    // ===================================================================

    /**
     * @notice Splits and pays out the whole raise in one call, once. Closed only.
     * @dev Four legs, no destination argument: `owner()` and the three fee addresses as
     *      they stand at the time of the call.
     *
     *      Pays exactly `totalRaised`, never the balance, which also holds the stray pot.
     *
     *      Fee legs divide; the owner leg SUBTRACTS. Four divisions would each round down
     *      and strand the remainder, so subtracting is what makes the legs sum to the
     *      raise exactly, with zero wei left behind.
     *
     *      A fee address that cannot receive ETH has its leg REDIRECTED to `owner()` in the
     *      same transaction rather than reverting: no one recipient may strand the raise
     *      over its own share. See {_payLeg}.
     */
    function withdrawProceeds() external override nonReentrant onlyOwner inState(SaleState.Closed) {
        if (proceedsWithdrawn) revert ProceedsAlreadyWithdrawn();
        uint256 total = totalRaised;
        if (total == 0) revert NothingToWithdraw();

        proceedsWithdrawn = true;

        // The referral pot comes off the TOP, before anything is split. The fee legs then
        // divide what remains, so their 8/8/4 is of 96% rather than of the whole raise.
        uint256 referralCut = (total * REFERRAL_BPS) / BPS_DENOMINATOR;
        uint256 splittable = total - referralCut;

        // A disabled leg computes to zero here rather than being skipped later, so it
        // falls into `ownerCut` through the subtraction below with no special case.
        uint256 fee1Cut = feeDisabled[1] ? 0 : (splittable * FEE_ADDRESS_1_BPS) / BPS_DENOMINATOR;
        uint256 fee2Cut = feeDisabled[2] ? 0 : (splittable * FEE_ADDRESS_2_BPS) / BPS_DENOMINATOR;
        uint256 fee3Cut = feeDisabled[3] ? 0 : (splittable * FEE_ADDRESS_3_BPS) / BPS_DENOMINATOR;

        // Fee legs divide; the owner leg SUBTRACTS, from `total` and not from `splittable`,
        // so every wei of the raise is accounted for including the scoop's rounding dust.
        address owner_ = owner();
        uint256 ownerCut = total - referralCut - fee1Cut - fee2Cut - fee3Cut;

        _payLeg(1, feeAddress1, fee1Cut, owner_);
        _payLeg(2, feeAddress2, fee2Cut, owner_);
        _payLeg(3, feeAddress3, fee3Cut, owner_);

        if (referralCut != 0) {
            // Unset means the owner. The sale must work with no distributor ever built.
            address pot = referralPotRecipient == address(0) ? owner_ : referralPotRecipient;
            _payLeg(0, pot, referralCut, owner_);
            emit ReferralPotPaid(pot, referralCut);
        }

        _sendEth(owner_, ownerCut);

        emit ProceedsWithdrawn(
            owner_, ownerCut, feeAddress1, fee1Cut, feeAddress2, fee2Cut, feeAddress3, fee3Cut
        );
    }

    /**
     * @dev Pays one leg, and sends it to `fallbackTo` in the SAME transaction if the
     *      recipient cannot receive ETH.
     *
     *      This replaces the deferred-fee machinery (`claimFeeShare`/`reclaimFeeShare` and
     *      six storage slots). Deleting that without a replacement is what would brick the
     *      contract: a single fee address that reverts on receive would revert
     *      {withdrawProceeds} forever and strand the entire raise, with no second path to
     *      the money. Redirecting is the two-line form of the same protection.
     *
     *      A low-level call with no gas stipend cap, deliberately: a recipient that is a
     *      multisig or a contract wallet needs more than 2300 gas, and forcing those into
     *      the failure path would redirect money that could have been delivered.
     */
    function _payLeg(uint8 feeAddressId, address to, uint256 amount, address fallbackTo) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (ok) return;
        emit FeeShareRedirected(feeAddressId, to, fallbackTo, amount);
        _sendEth(fallbackTo, amount);
    }

    /**
     * @notice Recovers the sale tokens from an abandoned sale, or a closed one that
     *         raised nothing.
     * @dev The only way sale tokens leave other than through an allocation, and gated for
     *      that reason: a broader sweep could empty the contract out from under people who
     *      are owed tokens. Rounding dust is deliberately not recoverable.
     */
    function withdrawUnsoldTokens(address to) external override onlyOwner {
        if (state == SaleState.Closed) {
            if (totalRaised != 0) revert SaleWasNotEmpty();
        } else if (state != SaleState.Abandoned) {
            revert WrongState(state);
        }
        if (to == address(0)) revert ZeroAddress();

        uint256 amount = TOKEN.balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();

        TOKEN.safeTransfer(to, amount);
        emit UnsoldTokensWithdrawn(to, amount);
    }

    /**
     * @notice Recovers an unrelated ERC20 sent here by mistake.
     * @dev The sale token is excluded in every state; it is spoken for by
     *      {withdrawUnsoldTokens}, which knows when nobody has a claim on it.
     */
    function recoverERC20(address erc20, address to, uint256 amount) external override onlyOwner {
        if (erc20 == address(TOKEN)) revert CannotRecoverSaleToken();
        if (erc20 == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert NothingToWithdraw();

        IERC20(erc20).safeTransfer(to, amount);
        emit ERC20Recovered(erc20, to, amount);
    }

    // ===================================================================
    // INTERNAL
    // ===================================================================

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    // ===================================================================
    // VIEWS
    // ===================================================================

    function token() external view override returns (address) {
        return address(TOKEN);
    }

    function tokensForSale() external view override returns (uint256) {
        return TOKENS_FOR_SALE;
    }

    function feeAddress1Bps() external pure override returns (uint16) {
        return FEE_ADDRESS_1_BPS;
    }

    function feeAddress2Bps() external pure override returns (uint16) {
        return FEE_ADDRESS_2_BPS;
    }

    function feeAddress3Bps() external pure override returns (uint16) {
        return FEE_ADDRESS_3_BPS;
    }

    function referralBps() external pure override returns (uint16) {
        return REFERRAL_BPS;
    }

    /// @notice Contributors so far — the bound for chunking {distribute} off-chain.
    function contributorCount() public view override returns (uint256) {
        return contributors.length;
    }

    /// @notice True once {distribute} has walked every contributor at least once.
    function distributionComplete() external view returns (bool) {
        return state == SaleState.Closed && distributionCursor >= contributors.length;
    }

    /**
     * @notice Renouncing ownership is disabled to protect the raise proceeds and lifecycle controls.
     */
    function renounceOwnership() public view override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    /**
     * @notice Returns a slice of contributors and their contributed totals.
     */
    function censusSlice(uint256 offset, uint256 count)
        external
        view
        override
        returns (address[] memory wallets, uint256[] memory amounts)
    {
        if (offset >= contributors.length || count == 0) {
            return (new address[](0), new uint256[](0));
        }
        if (count > 500) {
            count = 500;
        }
        uint256 end = offset + count;
        if (end > contributors.length) {
            end = contributors.length;
        }
        uint256 len = end - offset;
        wallets = new address[](len);
        amounts = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            address w = contributors[offset + i];
            wallets[i] = w;
            amounts[i] = contributed[w];
        }
    }
}
