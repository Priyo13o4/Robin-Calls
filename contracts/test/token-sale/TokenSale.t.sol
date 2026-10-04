// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {TokenSale} from "../../src/token-sale/TokenSale.sol";
import {ITokenSale} from "../../src/token-sale/ITokenSale.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/**
 * @dev Sale token that re-enters `claim()` from inside its own transfer. Not a plausible
 *      sale token — it is the only way to exercise the reentrancy path at all, since a
 *      plain ERC20 transfer never calls back.
 */
contract MockReentrantERC20 is ERC20 {
    address public sale;
    bool public reentered;
    bool public reentryReverted;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setSale(address sale_) external {
        sale = sale_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (sale != address(0) && from == sale && !reentered) {
            reentered = true;
            try ITokenSale(sale).claim() {}
            catch {
                reentryReverted = true;
            }
        }
    }
}

/// @dev Refuses ETH, so an ETH exit to it must surface a failure rather than eat one.
contract RejectsEth {
    receive() external payable {
        revert("no");
    }
}

contract TokenSaleTest is Test {
    TokenSale internal sale;
    MockERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal feeAddress1Wallet = makeAddr("feeAddress1Wallet");
    address internal feeAddress2Wallet = makeAddr("feeAddress2Wallet");
    address internal feeAddress3Wallet = makeAddr("feeAddress3Wallet");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    /// @dev A large round number, deliberately unrelated to the real supply: these
    ///      tests pin proportions, and a proportion that only holds at one supply is
    ///      not the invariant we mean to assert.
    uint256 internal constant FOR_SALE = 300_000_000e18;

    /// @dev 8%, 8%, and 4% of the raise, the agreed fee cuts.
    uint16 internal constant FEE_ADDRESS_1_BPS = 800;
    uint16 internal constant FEE_ADDRESS_2_BPS = 800;
    uint16 internal constant FEE_ADDRESS_3_BPS = 400;

    /// @dev Rounds a fuzzed value down onto the step grid, then lifts it to the first-buy
    ///      floor. Read from the contract, never re-declared here: a literal would let the
    ///      tests keep passing against a constant that had silently changed.
    function _legal(uint256 raw, uint256 cap) internal view returns (uint256 amount) {
        uint256 step = sale.contributionStep();
        amount = ((raw % cap) / step) * step;
        if (amount != 0 && amount < sale.minInitialContribution()) {
            amount = sale.minInitialContribution();
        }
    }

    function setUp() public {
        token = new MockERC20("Sale", "SALE", 18);
        sale = new TokenSale(owner, address(token), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);

        vm.deal(alice, 1_000 ether);
        vm.deal(bob, 1_000 ether);
        vm.deal(carol, 1_000 ether);
    }

    // ===================================================================
    // HELPERS
    // ===================================================================

    function _fund() internal {
        token.mint(address(sale), FOR_SALE);
    }

    function _open() internal {
        _fund();
        vm.prank(owner);
        sale.start();
    }

    function _close() internal {
        vm.prank(owner);
        sale.close();
    }

    function _wrongState(ITokenSale.SaleState s) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ITokenSale.WrongState.selector, s);
    }

    // ===================================================================
    // CONSTRUCTOR
    // ===================================================================

    function test_constructor_setsConfig() public view {
        assertEq(sale.token(), address(token));
        assertEq(sale.tokensForSale(), FOR_SALE);
        assertEq(sale.owner(), owner);
        assertEq(sale.feeAddress1(), feeAddress1Wallet);
        assertEq(sale.feeAddress2(), feeAddress2Wallet);
        assertEq(sale.feeAddress3(), feeAddress3Wallet);
        assertEq(sale.feeAddress1Bps(), FEE_ADDRESS_1_BPS);
        assertEq(sale.feeAddress2Bps(), FEE_ADDRESS_2_BPS);
        assertEq(sale.feeAddress3Bps(), FEE_ADDRESS_3_BPS);
        assertEq(uint8(sale.state()), uint8(ITokenSale.SaleState.Pending));
    }

    function test_constructor_rejectsZeroToken() public {
        vm.expectRevert(ITokenSale.ZeroAddress.selector);
        new TokenSale(owner, address(0), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);
    }

    function test_constructor_rejectsZeroAmount() public {
        vm.expectRevert(ITokenSale.ZeroTokensForSale.selector);
        new TokenSale(owner, address(token), 0, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);
    }

    function test_constructor_rejectsMissingFeeAddress1() public {
        vm.expectRevert(ITokenSale.FeeAddressRequired.selector);
        new TokenSale(owner, address(token), FOR_SALE, address(0), feeAddress2Wallet, feeAddress3Wallet);
    }

    function test_constructor_rejectsMissingFeeAddress2() public {
        vm.expectRevert(ITokenSale.FeeAddressRequired.selector);
        new TokenSale(owner, address(token), FOR_SALE, feeAddress1Wallet, address(0), feeAddress3Wallet);
    }

    function test_constructor_rejectsMissingFeeAddress3() public {
        vm.expectRevert(ITokenSale.FeeAddressRequired.selector);
        new TokenSale(owner, address(token), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, address(0));
    }

    // ===================================================================
    // TRAP 2 — start() must assert the contract is funded
    // ===================================================================

    function test_start_revertsWhenUnfunded() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.Underfunded.selector, 0, FOR_SALE));
        sale.start();
    }

    function test_start_revertsWhenPartiallyFunded() public {
        token.mint(address(sale), FOR_SALE - 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.Underfunded.selector, FOR_SALE - 1, FOR_SALE));
        sale.start();
    }

    function test_start_succeedsWhenFunded() public {
        _open();
        assertEq(uint8(sale.state()), uint8(ITokenSale.SaleState.Active));
    }

    /// @dev The live bug this closes: over-funding used to open the sale, and the excess
    ///      was then unreachable — allocations divide TOKENS_FOR_SALE, withdrawUnsoldTokens
    ///      is shut once a Closed sale has raised anything, and recoverERC20 excludes the
    ///      sale token. Nothing in the old suite ever funded above the target.
    function test_start_revertsWhenOverfunded() public {
        token.mint(address(sale), FOR_SALE + 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.Overfunded.selector, FOR_SALE + 1, FOR_SALE));
        sale.start();
    }

    function testFuzz_start_revertsAtAnyExcess(uint96 excess) public {
        vm.assume(excess > 0);
        token.mint(address(sale), FOR_SALE + uint256(excess));
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ITokenSale.Overfunded.selector, FOR_SALE + uint256(excess), FOR_SALE)
        );
        sale.start();
    }

    /// @dev Exact equality is only safe because the mistake is still recoverable here.
    ///      Pending accepts abandon(), and Abandoned accepts withdrawUnsoldTokens, so the
    ///      whole balance — target plus the fat-fingered excess — comes back for a retry.
    function test_start_overfundingIsRecoverableFromPending() public {
        token.mint(address(sale), FOR_SALE + 1_000_000e18);

        vm.startPrank(owner);
        sale.abandon();
        sale.withdrawUnsoldTokens(treasury);
        vm.stopPrank();

        assertEq(token.balanceOf(treasury), FOR_SALE + 1_000_000e18);
        assertEq(token.balanceOf(address(sale)), 0);
    }

    /// @dev The residual, asserted so it stays a KNOWN limit rather than a surprise: a
    ///      transfer landing after start() is still stranded. Recovering it needs an
    ///      owner-callable sweep of the sale token in a live Closed sale — the exact
    ///      switch that could empty the contract out from under unclaimed allocations.
    function test_start_strayTokenArrivingAfterStartIsStranded() public {
        _open();
        token.mint(address(sale), 500e18);

        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(alice);
        sale.claim();
        assertEq(token.balanceOf(alice), FOR_SALE, "allocation divides the target, not the balance");

        vm.prank(owner);
        vm.expectRevert(ITokenSale.SaleWasNotEmpty.selector);
        sale.withdrawUnsoldTokens(treasury);

        vm.prank(owner);
        vm.expectRevert(ITokenSale.CannotRecoverSaleToken.selector);
        sale.recoverERC20(address(token), treasury, 500e18);

        assertEq(token.balanceOf(address(sale)), 500e18, "stranded, by accepted design");
    }

    function test_start_revertsTwice() public {
        _open();
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Active));
        sale.start();
    }

    function test_start_onlyOwner() public {
        _fund();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.start();
    }

    // ===================================================================
    // STATE MACHINE — every illegal transition reverts
    // ===================================================================

    function test_lifecycle_happyPath() public {
        _open();
        vm.startPrank(owner);
        sale.pause();
        assertEq(uint8(sale.state()), uint8(ITokenSale.SaleState.Paused));
        sale.resume();
        assertEq(uint8(sale.state()), uint8(ITokenSale.SaleState.Active));
        sale.close();
        assertEq(uint8(sale.state()), uint8(ITokenSale.SaleState.Closed));
        vm.stopPrank();
    }

    function test_contribute_revertsBeforeStart() public {
        vm.prank(alice);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Pending));
        sale.contribute{value: 1 ether}();
    }

    function test_contribute_revertsWhilePaused() public {
        _open();
        vm.prank(owner);
        sale.pause();

        vm.prank(alice);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Paused));
        sale.contribute{value: 1 ether}();

        vm.prank(owner);
        sale.resume();

        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        assertEq(sale.contributed(alice), 1 ether);
    }

    function test_contribute_revertsOnZeroValue() public {
        _open();
        vm.prank(alice);
        vm.expectRevert(ITokenSale.ZeroContribution.selector);
        sale.contribute{value: 0}();
    }

    // ===================================================================
    // ADMISSION: FIRST-BUY FLOOR AND STEP GRID
    // ===================================================================

    /// @dev Pins the agreed values. Every other test here reads the getters, so without
    ///      this one a changed constant would move the whole suite with it and pass.
    function test_admission_constantsAreTheAgreedValues() public view {
        assertEq(sale.minInitialContribution(), 0.005 ether);
        assertEq(sale.contributionStep(), 0.001 ether);
    }

    /// @dev The floor must itself sit ON the grid. Off it, a contribution of exactly
    ///      minInitialContribution reverts NotStepMultiple and the real floor is
    ///      silently the next step up — a limit nothing states and no test would name.
    function test_admission_floorSitsOnTheStepGrid() public view {
        assertEq(sale.minInitialContribution() % sale.contributionStep(), 0);
    }

    function test_admission_firstBuyBelowFloorReverts() public {
        _open();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ITokenSale.BelowMinimumContribution.selector, 0.004 ether, 0.005 ether)
        );
        sale.contribute{value: 0.004 ether}();
    }

    function test_admission_firstBuyAtExactlyTheFloorIsAccepted() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 0.005 ether}();
        assertEq(sale.contributed(alice), 0.005 ether);
        assertEq(sale.contributorCount(), 1);
    }

    /// @dev The floor prices the `contributors` slot, and a top-up allocates none — so it
    ///      is exempt. Confirms the gate keys on the stored balance, not on msg.value.
    function test_admission_topUpBelowTheFloorIsAccepted() public {
        _open();
        vm.startPrank(alice);
        sale.contribute{value: 0.005 ether}();
        sale.contribute{value: 0.001 ether}();
        vm.stopPrank();
        assertEq(sale.contributed(alice), 0.006 ether);
        assertEq(sale.contributorCount(), 1, "a top-up must not push a second slot");
    }

    /// @dev Derived from the getters, not a literal: an off-grid literal silently becomes
    ///      an ON-grid one the moment the step is made finer, and the test then asserts
    ///      nothing while still passing.
    function test_admission_offGridFirstBuyReverts() public {
        _open();
        uint256 offGrid = sale.minInitialContribution() + 1 wei;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ITokenSale.NotStepMultiple.selector, offGrid, sale.contributionStep())
        );
        sale.contribute{value: offGrid}();
    }

    /// @dev The grid binds top-ups too — only the FLOOR is exempt, not the granularity.
    function test_admission_offGridTopUpReverts() public {
        _open();
        vm.startPrank(alice);
        sale.contribute{value: 1 ether}();
        vm.expectRevert(
            abi.encodeWithSelector(ITokenSale.NotStepMultiple.selector, 1 wei, sale.contributionStep())
        );
        sale.contribute{value: 1 wei}();
        vm.stopPrank();
    }

    /// @dev Zero is a multiple of the step, so the modulo check waves it through. An
    ///      existing contributor is also past the floor. Without its own branch a
    ///      zero-value top-up would emit Contributed for nothing.
    function test_admission_zeroTopUpStillRevertsAsZeroContribution() public {
        _open();
        vm.startPrank(alice);
        sale.contribute{value: 1 ether}();
        vm.expectRevert(ITokenSale.ZeroContribution.selector);
        sale.contribute{value: 0}();
        vm.stopPrank();
    }

    /// @dev The property, over arbitrary values: nothing off-grid is ever stored, and no
    ///      wallet is ever admitted to `contributors` under the floor.
    function testFuzz_admission_acceptedAmountsAlwaysSatisfyBothRules(uint96 raw) public {
        _open();
        uint256 amount = uint256(raw) % 50 ether;
        vm.deal(alice, 50 ether);

        vm.prank(alice);
        (bool ok,) = address(sale).call{value: amount}(abi.encodeWithSignature("contribute()"));

        if (ok) {
            assertEq(amount % sale.contributionStep(), 0);
            assertGe(amount, sale.minInitialContribution());
            assertEq(sale.contributed(alice), amount);
        } else {
            assertEq(sale.contributed(alice), 0);
            assertEq(sale.contributorCount(), 0);
        }
    }

    function test_close_revertsBeforeStart() public {
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Pending));
        sale.close();
    }

    function test_close_revertsTwice() public {
        _open();
        _close();
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Closed));
        sale.close();
    }

    function test_resume_revertsWhenNotPaused() public {
        _open();
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Active));
        sale.resume();
    }

    function test_pause_revertsAfterClose() public {
        _open();
        _close();
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Closed));
        sale.pause();
    }

    // ===================================================================
    // TRAP 1 — close() is one-way, and contributions stop dead at it
    // ===================================================================

    function test_trap1_contributeRevertsAfterClose() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(bob);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Closed));
        sale.contribute{value: 1 ether}();
    }

    function test_trap1_totalRaisedFrozenAtClose() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 3 ether}();
        _close();

        uint256 raisedAtClose = sale.totalRaised();
        vm.prank(alice);
        sale.claim();
        assertEq(sale.totalRaised(), raisedAtClose);
    }

    /// @dev A raw send after close lands in the stray pot, so it can never reopen or
    ///      inflate the denominator that allocations are already being paid against.
    function test_trap1_rawSendAfterCloseCannotMoveTotalRaised() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(bob);
        (bool ok,) = address(sale).call{value: 1 ether}("");
        assertTrue(ok);

        assertEq(sale.totalRaised(), 1 ether);
        assertEq(sale.contributed(bob), 0);
        assertEq(sale.strayOf(bob), 1 ether);
        assertEq(sale.allocationOf(bob), 0);
    }

    // ===================================================================
    // STRAY ETH — the second pot, which never touches the first
    // ===================================================================

    function test_stray_rawSendIsNotAContribution() public {
        _open();
        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 2 ether}("");
        assertTrue(ok);

        assertEq(sale.strayOf(alice), 2 ether);
        assertEq(sale.totalStray(), 2 ether);
        assertEq(sale.contributed(alice), 0);
        assertEq(sale.totalRaised(), 0);
        assertEq(sale.contributorCount(), 0);
    }

    function test_stray_acceptedInEveryState() public {
        // Pending
        vm.prank(alice);
        (bool a,) = address(sale).call{value: 1 ether}("");
        assertTrue(a);

        _open();
        vm.prank(alice);
        (bool b,) = address(sale).call{value: 1 ether}("");
        assertTrue(b);

        _close();
        vm.prank(alice);
        (bool c,) = address(sale).call{value: 1 ether}("");
        assertTrue(c);

        assertEq(sale.strayOf(alice), 3 ether);
        assertEq(sale.totalStray(), 3 ether);
    }

    function test_stray_senderCanPullItBack() public {
        _open();
        uint256 before = alice.balance;

        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 4 ether}("");
        assertTrue(ok);

        vm.prank(alice);
        sale.claimStray();

        assertEq(alice.balance, before);
        assertEq(sale.strayOf(alice), 0);
        assertEq(sale.totalStray(), 0);
    }

    function test_stray_claimTwiceReverts() public {
        _open();
        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(alice);
        sale.claimStray();
        vm.prank(alice);
        vm.expectRevert(ITokenSale.NoStray.selector);
        sale.claimStray();
    }

    function test_stray_isPerSender() public {
        _open();
        vm.prank(alice);
        (bool a,) = address(sale).call{value: 1 ether}("");
        vm.prank(bob);
        (bool b,) = address(sale).call{value: 3 ether}("");
        assertTrue(a && b);

        vm.prank(alice);
        sale.claimStray();

        assertEq(sale.strayOf(bob), 3 ether);
        assertEq(sale.totalStray(), 3 ether);
    }

    /// @dev THE separation invariant: the owner's proceeds exit pays exactly the raise, so
    ///      it structurally cannot reach a stray sender's ETH.
    function test_stray_withdrawProceedsCannotTouchIt() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 5 ether}();
        vm.prank(bob);
        (bool ok,) = address(sale).call{value: 7 ether}("");
        assertTrue(ok);
        _close();

        vm.prank(owner);
        sale.withdrawProceeds();

        assertEq(owner.balance + feeAddress1Wallet.balance + feeAddress2Wallet.balance + feeAddress3Wallet.balance, 5 ether);
        assertEq(address(sale).balance, 7 ether);

        // And bob can still pull his out afterwards.
        uint256 before = bob.balance;
        vm.prank(bob);
        sale.claimStray();
        assertEq(bob.balance, before + 7 ether);
        assertEq(address(sale).balance, 0);
    }

    function test_stray_sweepOnlyInTerminalStates() public {
        _open();
        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 2 ether}("");
        assertTrue(ok);

        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Active));
        sale.sweepStray(treasury);

        _close();
        vm.prank(owner);
        sale.sweepStray(treasury);
        assertEq(treasury.balance, 2 ether);
        assertTrue(sale.straySwept());
    }

    /// @dev Without the `straySwept` flag this claim would pay out of ETH the sweep
    ///      already removed — i.e. out of the proceeds.
    function test_stray_claimAfterSweepReverts() public {
        _open();
        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 2 ether}("");
        assertTrue(ok);
        _close();

        vm.prank(owner);
        sale.sweepStray(treasury);

        vm.prank(alice);
        vm.expectRevert(ITokenSale.StrayAlreadySwept.selector);
        sale.claimStray();
    }

    /// @dev The reason {sweepStray} is repeatable. People keep sending ETH to an address
    ///      long after it is finished. `receive()` is deliberately NOT gated on
    ///      `straySwept`, so a late deposit is still booked; if the sweep refused a second
    ///      run that ETH would be stranded for everyone, the sender included. It is not.
    function test_stray_arrivingAfterTheSweepIsStillRecoverable() public {
        _open();
        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 1 ether}("");
        assertTrue(ok);
        _close();

        vm.prank(owner);
        sale.sweepStray(treasury);
        assertEq(treasury.balance, 1 ether);
        assertTrue(sale.straySwept());

        // A second sender turns up late. The contract still books it.
        vm.deal(bob, 3 ether);
        vm.prank(bob);
        (ok,) = address(sale).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(sale.totalStray(), 2 ether, "the late deposit is booked");

        // The sender still cannot claim: `strayOf` is stale after a sweep, so honouring
        // it would pay out of ETH the first sweep already removed.
        vm.prank(bob);
        vm.expectRevert(ITokenSale.StrayAlreadySwept.selector);
        sale.claimStray();

        // But the owner can take it, which is the whole point of the change.
        vm.prank(owner);
        sale.sweepStray(treasury);
        assertEq(treasury.balance, 3 ether, "the late 2 ETH is recoverable");
        assertEq(address(sale).balance, 0, "nothing stranded");
    }

    /// @dev The property a repeatable sweep must NOT break: it moves `totalStray` only,
    ///      and that counter is disjoint from `totalRaised`. No number of sweeps can
    ///      reach the raise.
    function test_stray_repeatedSweepCannotReachTheRaise() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        vm.prank(bob);
        (bool ok,) = address(sale).call{value: 1 ether}("");
        assertTrue(ok);
        _close();

        vm.startPrank(owner);
        sale.sweepStray(treasury);
        assertEq(treasury.balance, 1 ether, "the sweep takes the stray and only the stray");
        // A second sweep with nothing new must find nothing, not reach into the raise.
        vm.expectRevert(ITokenSale.NoStray.selector);
        sale.sweepStray(treasury);
        vm.stopPrank();

        assertEq(address(sale).balance, 10 ether, "the raise is untouched");
        vm.prank(owner);
        sale.withdrawProceeds();
        assertEq(address(sale).balance, 0);
    }

    /// @dev Sweeping again with an empty pot is NoStray, not StrayAlreadySwept. The
    ///      distinction matters to an operator reading the revert: "there is nothing
    ///      here" invites a later retry, "this is closed" says never again.
    function test_stray_sweepWithNothingNewSaysNoStray() public {
        _open();
        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 1 ether}("");
        assertTrue(ok);
        _close();

        vm.startPrank(owner);
        sale.sweepStray(treasury);
        vm.expectRevert(ITokenSale.NoStray.selector);
        sale.sweepStray(treasury);
        vm.stopPrank();
    }

    function test_stray_sweepOnlyOwner() public {
        _open();
        vm.prank(alice);
        (bool ok,) = address(sale).call{value: 1 ether}("");
        assertTrue(ok);
        _close();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.sweepStray(alice);
    }

    // ===================================================================
    // PRO-RATA CORRECTNESS
    // ===================================================================

    function test_proRata_tenPercentTwentyPercentSeventyPercent() public {
        _open();

        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        vm.prank(bob);
        sale.contribute{value: 2 ether}();
        vm.prank(carol);
        sale.contribute{value: 7 ether}();

        _close();
        assertEq(sale.totalRaised(), 10 ether);

        assertEq(sale.allocationOf(alice), FOR_SALE / 10);
        assertEq(sale.allocationOf(bob), FOR_SALE / 5);
        assertEq(sale.allocationOf(carol), (FOR_SALE * 7) / 10);

        vm.prank(alice);
        sale.claim();
        vm.prank(bob);
        sale.claim();
        vm.prank(carol);
        sale.claim();

        assertEq(token.balanceOf(alice), FOR_SALE / 10);
        assertEq(token.balanceOf(bob), FOR_SALE / 5);
        assertEq(token.balanceOf(carol), (FOR_SALE * 7) / 10);
        assertEq(token.balanceOf(address(sale)), 0);
    }

    function test_proRata_multipleContributionsAccumulate() public {
        _open();
        vm.startPrank(alice);
        sale.contribute{value: 1 ether}();
        sale.contribute{value: 4 ether}();
        vm.stopPrank();

        vm.prank(bob);
        sale.contribute{value: 5 ether}();
        _close();

        assertEq(sale.contributed(alice), 5 ether);
        // One entry, not two — a second push would pay Alice twice under distribute().
        assertEq(sale.contributorCount(), 2);
        assertEq(sale.allocationOf(alice), FOR_SALE / 2);
    }

    function test_allocationIsZeroBeforeAnyContribution() public view {
        assertEq(sale.allocationOf(alice), 0);
    }

    // ===================================================================
    // CLAIMING
    // ===================================================================

    function test_claim_revertsBeforeClose() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Active));
        sale.claim();
    }

    function test_claim_revertsTwice() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(alice);
        sale.claim();
        vm.prank(alice);
        vm.expectRevert(ITokenSale.AlreadyClaimed.selector);
        sale.claim();
    }

    function test_claim_revertsForNonContributor() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(bob);
        vm.expectRevert(ITokenSale.NothingToClaim.selector);
        sale.claim();
    }

    // ===================================================================
    // TRAP 5 — distribute() is chunked and idempotent against claim()
    // ===================================================================

    function test_trap5_distributeInChunksPaysEachExactlyOnce() public {
        _open();

        uint256 n = 100;
        for (uint256 i = 0; i < n; ++i) {
            address who = address(uint160(0x1000 + i));
            vm.deal(who, 1 ether);
            vm.prank(who);
            sale.contribute{value: 1 ether}();
        }
        _close();

        assertEq(sale.contributorCount(), n);

        vm.startPrank(owner);
        assertEq(sale.distribute(40), 40);
        assertEq(sale.distribute(40), 40);
        assertEq(sale.distribute(40), 20); // clamps at the end of the array
        assertEq(sale.distribute(40), 0); // and stays there
        vm.stopPrank();

        assertTrue(sale.distributionComplete());

        uint256 each = FOR_SALE / n;
        for (uint256 i = 0; i < n; ++i) {
            assertEq(token.balanceOf(address(uint160(0x1000 + i))), each);
            assertTrue(sale.claimed(address(uint160(0x1000 + i))));
        }
        assertEq(token.balanceOf(address(sale)), FOR_SALE - each * n);
    }

    function test_trap5_claimThenDistributeIsNoOp() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        vm.prank(bob);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(alice);
        sale.claim();
        uint256 aliceAfterClaim = token.balanceOf(alice);

        vm.prank(owner);
        sale.distribute(10);

        assertEq(token.balanceOf(alice), aliceAfterClaim);
        assertEq(token.balanceOf(bob), FOR_SALE / 2);
    }

    function test_trap5_distributeThenClaimReverts() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(owner);
        sale.distribute(1);

        vm.prank(alice);
        vm.expectRevert(ITokenSale.AlreadyClaimed.selector);
        sale.claim();
    }

    function test_distribute_revertsBeforeClose() public {
        _open();
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Active));
        sale.distribute(1);
    }

    function test_distribute_onlyOwner() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.distribute(1);
    }

    // ===================================================================
    // TRAP 7 — the sum of allocations never exceeds what is held
    // ===================================================================

    function testFuzz_trap7_allocationsNeverExceedTokensForSale(uint96[8] memory amounts) public {
        _open();

        address[8] memory who;
        uint256 contributorsSeen;
        for (uint256 i = 0; i < 8; ++i) {
            uint256 amount = _legal(uint256(amounts[i]), 500 ether);
            if (amount == 0) continue;
            who[contributorsSeen] = address(uint160(0x2000 + i));
            vm.deal(who[contributorsSeen], amount);
            vm.prank(who[contributorsSeen]);
            sale.contribute{value: amount}();
            ++contributorsSeen;
        }
        if (contributorsSeen == 0) return;

        _close();

        uint256 sum;
        for (uint256 i = 0; i < contributorsSeen; ++i) {
            sum += sale.allocationOf(who[i]);
        }
        // Rounding can only ever lose, never create.
        assertLe(sum, FOR_SALE);
        assertGe(sum, FOR_SALE - contributorsSeen);

        for (uint256 i = 0; i < contributorsSeen; ++i) {
            uint256 expected = sale.allocationOf(who[i]);
            vm.prank(who[i]);
            sale.claim();
            assertEq(token.balanceOf(who[i]), expected);
        }
        assertEq(token.balanceOf(address(sale)), FOR_SALE - sum);
    }

    // ===================================================================
    // ABANDON + REFUNDS
    // ===================================================================

    function test_abandon_refundsExactContributions() public {
        _open();
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        vm.prank(alice);
        sale.contribute{value: 5 ether}();
        vm.prank(bob);
        sale.contribute{value: 11 ether}();

        vm.prank(owner);
        sale.abandon();
        assertEq(uint8(sale.state()), uint8(ITokenSale.SaleState.Abandoned));

        vm.prank(alice);
        sale.claimRefund();
        vm.prank(bob);
        sale.claimRefund();

        assertEq(alice.balance, aliceBefore);
        assertEq(bob.balance, bobBefore);
        assertEq(address(sale).balance, 0);
    }

    function test_abandon_fromPendingAndPaused() public {
        vm.prank(owner);
        sale.abandon();
        assertEq(uint8(sale.state()), uint8(ITokenSale.SaleState.Abandoned));

        TokenSale other = new TokenSale(owner, address(token), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);
        token.mint(address(other), FOR_SALE);
        vm.startPrank(owner);
        other.start();
        other.pause();
        other.abandon();
        vm.stopPrank();
        assertEq(uint8(other.state()), uint8(ITokenSale.SaleState.Abandoned));
    }

    /// @dev The correctness reason, not a preference: after Closed tokens start moving, so
    ///      a later cancellation would owe ETH out of a pot that already paid tokens out.
    function test_abandon_unreachableAfterClose() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Closed));
        sale.abandon();
    }

    function test_abandon_twiceReverts() public {
        vm.startPrank(owner);
        sale.abandon();
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Abandoned));
        sale.abandon();
        vm.stopPrank();
    }

    function test_abandon_onlyOwner() public {
        _open();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.abandon();
    }

    function test_refund_twiceReverts() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 2 ether}();
        vm.prank(owner);
        sale.abandon();

        vm.prank(alice);
        sale.claimRefund();
        vm.prank(alice);
        vm.expectRevert(ITokenSale.AlreadyRefunded.selector);
        sale.claimRefund();
    }

    function test_refund_revertsForNonContributor() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 2 ether}();
        vm.prank(owner);
        sale.abandon();

        vm.prank(bob);
        vm.expectRevert(ITokenSale.NothingToRefund.selector);
        sale.claimRefund();
    }

    function test_refund_revertsWhenNotAbandoned() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 2 ether}();
        _close();

        vm.prank(alice);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Closed));
        sale.claimRefund();
    }

    /// @dev The abandoned branch must not also open the claim path, or a contributor could
    ///      take both the tokens and their ETH back.
    function test_abandon_claimIsClosed() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 2 ether}();
        vm.prank(owner);
        sale.abandon();

        vm.prank(alice);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Abandoned));
        sale.claim();
    }

    function test_abandon_ownerCannotTakeProceeds() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 2 ether}();
        vm.prank(owner);
        sale.abandon();

        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Abandoned));
        sale.withdrawProceeds();
    }

    function test_abandon_ownerRecoversTheTokens() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 2 ether}();
        vm.prank(owner);
        sale.abandon();

        vm.prank(owner);
        sale.withdrawUnsoldTokens(treasury);
        assertEq(token.balanceOf(treasury), FOR_SALE);
    }

    // ===================================================================
    // TRAP 4 — reentrancy
    // ===================================================================

    function test_trap4_reentrantTokenCannotDoubleClaim() public {
        MockReentrantERC20 evil = new MockReentrantERC20();
        TokenSale evilSale = new TokenSale(owner, address(evil), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);
        evil.mint(address(evilSale), FOR_SALE);
        evil.setSale(address(evilSale));

        vm.prank(owner);
        evilSale.start();
        vm.prank(alice);
        evilSale.contribute{value: 1 ether}();
        vm.prank(owner);
        evilSale.close();

        vm.prank(alice);
        evilSale.claim();

        assertTrue(evil.reentered(), "reentry path never exercised: test proves nothing");
        assertTrue(evil.reentryReverted(), "the guard did not stop the re-entry");
        assertEq(evil.balanceOf(alice), FOR_SALE);
        assertEq(evil.balanceOf(address(evilSale)), 0);
    }

    // ===================================================================
    // PROCEEDS — the 90/10 split
    // ===================================================================

    function test_withdrawProceeds_revertsBeforeClose() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 5 ether}();

        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Active));
        sale.withdrawProceeds();
    }

    function test_withdrawProceeds_splitsEightEightFourEighty() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 5 ether}();
        vm.prank(bob);
        sale.contribute{value: 3 ether}();
        _close();

        vm.prank(owner);
        sale.withdrawProceeds();

        // The referral scoop comes off the top first, so the fee legs divide 7.68, not 8.
        assertEq(feeAddress1Wallet.balance, 0.6144 ether); // 8% of 7.68
        assertEq(feeAddress2Wallet.balance, 0.6144 ether); // 8% of 7.68
        assertEq(feeAddress3Wallet.balance, 0.3072 ether); // 4% of 7.68
        // 80% of 7.68 is 6.144, plus the 0.32 scoop, which is unset and so goes here too.
        assertEq(owner.balance, 6.464 ether);
        assertEq(address(sale).balance, 0);
        assertTrue(sale.proceedsWithdrawn());
    }

    /// @dev The legs must sum to the raise EXACTLY. Computing fee legs by division and
    ///      the owner leg by subtraction guarantees the legs sum to the raise with zero wei
    ///      stranded. Fuzzed.
    function testFuzz_withdrawProceeds_legsSumToTheRaise(uint96 raw) public {
        uint256 amount = _legal(uint256(raw), 900 ether);
        if (amount == 0) amount = sale.minInitialContribution();
        _open();
        vm.deal(alice, amount);
        vm.prank(alice);
        sale.contribute{value: amount}();
        _close();

        vm.prank(owner);
        sale.withdrawProceeds();

        // Every wei of the raise must land somewhere. The scoop's recipient is unset in
        // this fixture, so it is paid to the owner and is inside `owner.balance` here.
        assertEq(feeAddress1Wallet.balance + feeAddress2Wallet.balance + feeAddress3Wallet.balance + owner.balance, amount);
        assertEq(address(sale).balance, 0);

        // The fee legs are a percentage of what remains AFTER the scoop, never of the raise.
        uint256 splittable = amount - (amount * sale.referralBps()) / 10_000;
        assertEq(feeAddress1Wallet.balance, (splittable * FEE_ADDRESS_1_BPS) / 10_000);
        assertEq(feeAddress2Wallet.balance, (splittable * FEE_ADDRESS_2_BPS) / 10_000);
        assertEq(feeAddress3Wallet.balance, (splittable * FEE_ADDRESS_3_BPS) / 10_000);
    }

    function test_withdrawProceeds_twiceReverts() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 5 ether}();
        _close();

        vm.startPrank(owner);
        sale.withdrawProceeds();
        vm.expectRevert(ITokenSale.ProceedsAlreadyWithdrawn.selector);
        sale.withdrawProceeds();
        vm.stopPrank();
    }

    function test_withdrawProceeds_revertsOnZeroRaise() public {
        _open();
        _close();
        vm.prank(owner);
        vm.expectRevert(ITokenSale.NothingToWithdraw.selector);
        sale.withdrawProceeds();
    }

    function test_withdrawProceeds_onlyOwner() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.withdrawProceeds();
    }

    /// @dev A reverting fee address must never be able to strand the raise. The leg is
    ///      REDIRECTED to the owner in the same transaction; nothing is left in the
    ///      contract and there is no second call to make.
    function test_withdrawProceeds_feeAddressThatRejectsEthIsRedirectedToOwner() public {
        RejectsEth badFee1 = new RejectsEth();
        TokenSale s2 = new TokenSale(owner, address(token), FOR_SALE, address(badFee1), feeAddress2Wallet, feeAddress3Wallet);
        token.mint(address(s2), FOR_SALE);

        vm.prank(owner);
        s2.start();
        vm.prank(alice);
        s2.contribute{value: 10 ether}();
        vm.prank(owner);
        s2.close();

        vm.prank(owner);
        s2.withdrawProceeds();

        // owner leg 7.68 + referral scoop 0.4 (unset recipient) + redirected fee1 0.768
        assertEq(owner.balance, 8.848 ether, "owner must receive its leg, the scoop and the redirected leg");
        assertEq(feeAddress2Wallet.balance, 0.768 ether, "feeAddress2 leg must still be paid");
        assertEq(feeAddress3Wallet.balance, 0.384 ether, "feeAddress3 leg must still be paid");
        assertEq(address(badFee1).balance, 0, "the rejecting address receives nothing");
        assertEq(address(s2).balance, 0, "nothing may be left behind for a second call");
    }

    /// @dev The ONE case that can stop the payout, and the point is that it stops it
    ///      CLEANLY. A fee address that cannot receive is redirected to the owner, so the
    ///      owner is the last resort for every leg — and if the owner itself cannot
    ///      receive, there is nowhere left to send to. That must revert the whole call
    ///      rather than half-pay and latch `proceedsWithdrawn`, or the raise is stranded
    ///      forever with the flag already spent.
    function test_withdrawProceeds_ownerThatRejectsEthRevertsAndStaysRetryable() public {
        RejectsEth badOwner = new RejectsEth();
        TokenSale s2 =
            new TokenSale(address(badOwner), address(token), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);
        token.mint(address(s2), FOR_SALE);

        vm.startPrank(address(badOwner));
        s2.start();
        vm.stopPrank();
        vm.prank(alice);
        s2.contribute{value: 10 ether}();
        vm.prank(address(badOwner));
        s2.close();

        vm.prank(address(badOwner));
        vm.expectRevert(ITokenSale.EthTransferFailed.selector);
        s2.withdrawProceeds();

        // The flag must have rolled back with the revert. If it latched, the raise would
        // be unreachable by any call for the rest of the contract's life.
        assertFalse(s2.proceedsWithdrawn(), "proceedsWithdrawn must roll back with the revert");
        assertEq(address(s2).balance, 10 ether, "the whole raise must still be there");

        // And the remedy has to actually work: hand ownership to an address that can
        // receive, and the same call goes through.
        vm.prank(address(badOwner));
        s2.transferOwnership(owner);
        vm.prank(owner);
        s2.acceptOwnership();

        vm.prank(owner);
        s2.withdrawProceeds();

        assertTrue(s2.proceedsWithdrawn());
        assertEq(address(s2).balance, 0, "the retry must clear the contract");
        assertEq(owner.balance, 8.08 ether, "owner leg 7.68 plus the 0.4 scoop");
    }

    // ===================================================================
    // FEE OVERRIDE
    // ===================================================================

    function test_setFeeEnabled_disabledLegFallsToTheOwner() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        _close();

        vm.prank(owner);
        sale.setFeeEnabled(2, false);
        assertTrue(sale.feeDisabled(2));

        vm.prank(owner);
        sale.withdrawProceeds();

        assertEq(feeAddress2Wallet.balance, 0, "a disabled leg is paid nothing");
        assertEq(feeAddress3Wallet.balance, 0.384 ether, "other legs are untouched");
        // 7.68 owner + 0.4 scoop + 0.768 the disabled leg
        assertEq(owner.balance, 8.848 ether, "the disabled leg falls to the owner");
        assertEq(address(sale).balance, 0);
    }

    function test_setFeeEnabled_canBeTurnedBackOn() public {
        vm.startPrank(owner);
        sale.setFeeEnabled(1, false);
        assertTrue(sale.feeDisabled(1));
        sale.setFeeEnabled(1, true);
        assertFalse(sale.feeDisabled(1));
        vm.stopPrank();
    }

    function test_setFeeEnabled_worksInEveryStateBeforeWithdrawal() public {
        _open(); // Active
        vm.prank(owner);
        sale.setFeeEnabled(1, false);
        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        _close(); // Closed
        vm.prank(owner);
        sale.setFeeEnabled(1, true);
        assertFalse(sale.feeDisabled(1));
    }

    function test_setFeeEnabled_refusedAfterTheProceedsAreOut() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        _close();
        vm.prank(owner);
        sale.withdrawProceeds();

        vm.prank(owner);
        vm.expectRevert(ITokenSale.ProceedsAlreadyWithdrawn.selector);
        sale.setFeeEnabled(1, false);
    }

    function test_setFeeEnabled_rejectsAnUnknownLeg() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.InvalidFeeAddressId.selector, uint8(0)));
        sale.setFeeEnabled(0, false);
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.InvalidFeeAddressId.selector, uint8(4)));
        sale.setFeeEnabled(4, false);
        vm.stopPrank();
    }

    function test_setFeeEnabled_isOwnerOnly() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.setFeeEnabled(1, false);
    }

    // ===================================================================
    // REFERRAL SCOOP
    // ===================================================================

    /// @dev The scoop comes off the TOP: the fee legs divide 96%, not 100%.
    function test_withdrawProceeds_scoopsTheReferralPotBeforeSplitting() public {
        address pot = makeAddr("referralPot");
        _open();
        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        _close();

        vm.prank(owner);
        sale.setReferralPotRecipient(pot);
        assertEq(sale.referralPotRecipient(), pot);

        vm.prank(owner);
        sale.withdrawProceeds();

        assertEq(pot.balance, 0.4 ether, "4% of the raise, off the top");
        assertEq(feeAddress1Wallet.balance, 0.768 ether, "8% of the remaining 96%");
        assertEq(feeAddress2Wallet.balance, 0.768 ether);
        assertEq(feeAddress3Wallet.balance, 0.384 ether, "4% of the remaining 96%");
        assertEq(owner.balance, 7.68 ether, "80% of the remaining 96%");
        assertEq(address(sale).balance, 0, "every wei accounted for");
    }

    /// @dev Unset is a WORKING configuration, not a missing one: the sale may open with no
    ///      distributor built and may never get one.
    function test_referralPot_unsetPaysTheOwner() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        _close();
        assertEq(sale.referralPotRecipient(), address(0));

        vm.prank(owner);
        sale.withdrawProceeds();

        assertEq(owner.balance, 8.08 ether, "owner leg 7.68 plus the 0.4 scoop");
        assertEq(address(sale).balance, 0);
    }

    function test_setReferralPotRecipient_refusedAfterTheProceedsAreOut() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        _close();
        vm.prank(owner);
        sale.withdrawProceeds();

        vm.prank(owner);
        vm.expectRevert(ITokenSale.ProceedsAlreadyWithdrawn.selector);
        sale.setReferralPotRecipient(alice);
    }

    function test_referralBps_isFourPercent() public view {
        assertEq(sale.referralBps(), 400);
    }

    // ===================================================================
    // BURNING UNCLAIMED SALE TOKENS
    // ===================================================================

    function test_close_recordsWhenItHappened() public {
        assertEq(sale.closedAt(), 0, "zero until the sale closes");
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();
        assertEq(sale.closedAt(), block.timestamp);
    }

    function test_burnUnclaimed_refusedBeforeTheDelay() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        uint256 availableAt = sale.closedAt() + sale.BURN_DELAY();
        vm.warp(availableAt - 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.BurnTooEarly.selector, availableAt));
        sale.burnUnclaimed();
    }

    /// @dev A REAL burn: totalSupply falls. Sending to a dead address would leave the
    ///      published supply overstating what exists.
    function test_burnUnclaimed_reducesTotalSupply() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        uint256 supplyBefore = token.totalSupply();
        uint256 held = token.balanceOf(address(sale));
        assertGt(held, 0);

        vm.warp(sale.closedAt() + sale.BURN_DELAY());
        vm.prank(owner);
        sale.burnUnclaimed();

        assertTrue(sale.unclaimedBurned());
        assertEq(token.balanceOf(address(sale)), 0);
        assertEq(token.totalSupply(), supplyBefore - held, "supply must actually fall");
    }

    function test_burnUnclaimed_isOwnerOnlyAndOnlyOnce() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();
        vm.warp(sale.closedAt() + sale.BURN_DELAY());

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.burnUnclaimed();

        vm.prank(owner);
        sale.burnUnclaimed();
        vm.prank(owner);
        vm.expectRevert(ITokenSale.AlreadyBurned.selector);
        sale.burnUnclaimed();
    }

    /// @dev The point of the flag: a readable sentence, not an ERC20 underflow.
    function test_claimAfterBurn_revertsReadably() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();
        vm.warp(sale.closedAt() + sale.BURN_DELAY());
        vm.prank(owner);
        sale.burnUnclaimed();

        vm.prank(alice);
        vm.expectRevert(ITokenSale.SaleTokensBurned.selector);
        sale.claim();

        vm.prank(owner);
        vm.expectRevert(ITokenSale.SaleTokensBurned.selector);
        sale.distribute(1);
    }

    /// @dev The intended order, and the reason the delay is unconditional: distribute
    ///      first, then burn what nobody could be given.
    /// @dev The intended order, and the reason the delay is unconditional: distribute
    ///      first, then burn what nobody could be given. With a single contributor the
    ///      allocation is exact and nothing is left, so this forces in the case the burn
    ///      actually exists for: tokens pushed at the contract by a stranger.
    function test_burnAfterDistribute_takesOnlyTheStrandedTokens() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(owner);
        sale.distribute(10);
        uint256 delivered = token.balanceOf(alice);
        assertEq(delivered, FOR_SALE, "the sole contributor is owed the whole pool");
        assertEq(token.balanceOf(address(sale)), 0, "nothing left after a clean distribute");

        token.mint(address(sale), 123 ether);

        vm.warp(sale.closedAt() + sale.BURN_DELAY());
        vm.prank(owner);
        sale.burnUnclaimed();

        assertEq(token.balanceOf(address(sale)), 0, "the stranded tokens are gone");
        assertEq(token.balanceOf(alice), delivered, "a delivered allocation is untouched");
    }

    // ===================================================================
    // FEE ADDRESS CONFIG
    // ===================================================================

    function test_setFeeAddress1_worksWhilePending() public {
        vm.prank(owner);
        sale.setFeeAddress1(carol);
        assertEq(sale.feeAddress1(), carol);
    }

    function test_setFeeAddress2_worksWhilePending() public {
        vm.prank(owner);
        sale.setFeeAddress2(carol);
        assertEq(sale.feeAddress2(), carol);
    }

    function test_setFeeAddress3_worksWhilePending() public {
        vm.prank(owner);
        sale.setFeeAddress3(carol);
        assertEq(sale.feeAddress3(), carol);
    }

    function test_setFeeAddress_rejectsZeroAddress() public {
        vm.startPrank(owner);
        vm.expectRevert(ITokenSale.FeeAddressRequired.selector);
        sale.setFeeAddress1(address(0));
        vm.expectRevert(ITokenSale.FeeAddressRequired.selector);
        sale.setFeeAddress2(address(0));
        vm.expectRevert(ITokenSale.FeeAddressRequired.selector);
        sale.setFeeAddress3(address(0));
        vm.stopPrank();
    }

    /// @dev Frozen by start(), so the destination cannot move once anyone has contributed.
    /// @dev The freeze moved, deliberately. Fee addresses used to lock at `start()`,
    ///      which left an operator who had set a wrong or unreachable address with
    ///      abandoning the sale as the only exit. They are now editable right up to
    ///      {withdrawProceeds}, and frozen by that instead.
    function test_setFeeAddress_editableUntilTheProceedsAreOut() public {
        _open();
        vm.prank(owner);
        sale.setFeeAddress1(carol);
        assertEq(sale.feeAddress1(), carol, "editable while Active");

        vm.prank(alice);
        sale.contribute{value: 10 ether}();
        _close();

        vm.prank(owner);
        sale.setFeeAddress1(feeAddress2Wallet);
        assertEq(sale.feeAddress1(), feeAddress2Wallet, "editable while Closed");

        vm.prank(owner);
        sale.withdrawProceeds();

        vm.prank(owner);
        vm.expectRevert(ITokenSale.ProceedsAlreadyWithdrawn.selector);
        sale.setFeeAddress1(carol);
    }

    function test_setFeeAddress_onlyOwner() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.setFeeAddress1(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.setFeeAddress2(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.setFeeAddress3(carol);
        vm.stopPrank();
    }

    // ===================================================================
    // TRAP 8 — unsold tokens
    // ===================================================================

    function test_trap8_withdrawUnsoldRevertsWhenSaleRaisedSomething() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 0.01 ether}();
        _close();

        vm.prank(owner);
        vm.expectRevert(ITokenSale.SaleWasNotEmpty.selector);
        sale.withdrawUnsoldTokens(treasury);
    }

    function test_trap8_withdrawUnsoldWorksOnAnEmptyClosedSale() public {
        _open();
        _close();

        vm.prank(owner);
        sale.withdrawUnsoldTokens(treasury);
        assertEq(token.balanceOf(treasury), FOR_SALE);
        assertEq(token.balanceOf(address(sale)), 0);
    }

    function test_trap8_withdrawUnsoldRevertsWhileActive() public {
        _open();
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Active));
        sale.withdrawUnsoldTokens(treasury);
    }

    // ===================================================================
    // recoverERC20
    // ===================================================================

    function test_recoverERC20_returnsAStrayToken() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(address(sale), 500e18);

        vm.prank(owner);
        sale.recoverERC20(address(other), treasury, 500e18);
        assertEq(other.balanceOf(treasury), 500e18);
    }

    /// @dev The sale token is spoken for by withdrawUnsoldTokens, which knows when nobody
    ///      has a claim on it. This path must never be a second, ungated door to it.
    function test_recoverERC20_cannotTouchTheSaleToken() public {
        _open();
        vm.prank(alice);
        sale.contribute{value: 1 ether}();
        _close();

        vm.prank(owner);
        vm.expectRevert(ITokenSale.CannotRecoverSaleToken.selector);
        sale.recoverERC20(address(token), treasury, 1);
    }

    function test_recoverERC20_onlyOwner() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(address(sale), 1e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.recoverERC20(address(other), alice, 1e18);
    }

    // ===================================================================
    // OWNERSHIP
    // ===================================================================

    function test_ownershipIsTwoStep() public {
        vm.prank(owner);
        sale.transferOwnership(alice);
        assertEq(sale.owner(), owner, "ownership moved on the first step");

        vm.prank(alice);
        sale.acceptOwnership();
        assertEq(sale.owner(), alice);
    }

    function test_renounceOwnership_revertsInAllStates() public {
        // Pending
        vm.prank(owner);
        vm.expectRevert(ITokenSale.RenounceOwnershipDisabled.selector);
        sale.renounceOwnership();

        // Active
        _open();
        vm.prank(owner);
        vm.expectRevert(ITokenSale.RenounceOwnershipDisabled.selector);
        sale.renounceOwnership();

        // Paused
        vm.prank(owner);
        sale.pause();
        vm.prank(owner);
        vm.expectRevert(ITokenSale.RenounceOwnershipDisabled.selector);
        sale.renounceOwnership();

        // Closed
        vm.prank(owner);
        sale.resume();
        _close();
        vm.prank(owner);
        vm.expectRevert(ITokenSale.RenounceOwnershipDisabled.selector);
        sale.renounceOwnership();

        // Abandoned
        TokenSale abandonedSale = new TokenSale(owner, address(token), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);
        vm.prank(owner);
        abandonedSale.abandon();
        vm.prank(owner);
        vm.expectRevert(ITokenSale.RenounceOwnershipDisabled.selector);
        abandonedSale.renounceOwnership();
    }

    // ===================================================================
    // CONTRIBUTION LIMITS
    // ===================================================================

    function test_setContributionLimits_setsValuesAndEmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit ITokenSale.ContributionLimitsSet(0.01 ether, 0.002 ether);
        sale.setContributionLimits(0.01 ether, 0.002 ether);

        assertEq(sale.minInitialContribution(), 0.01 ether);
        assertEq(sale.contributionStep(), 0.002 ether);
    }

    function test_setContributionLimits_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sale.setContributionLimits(0.01 ether, 0.002 ether);
    }

    function test_setContributionLimits_allowedInPendingActivePaused() public {
        // Pending
        vm.prank(owner);
        sale.setContributionLimits(0.01 ether, 0.001 ether);
        assertEq(sale.minInitialContribution(), 0.01 ether);

        // Active
        _open();
        vm.prank(owner);
        sale.setContributionLimits(0.02 ether, 0.002 ether);
        assertEq(sale.minInitialContribution(), 0.02 ether);

        // Paused
        vm.prank(owner);
        sale.pause();
        vm.prank(owner);
        sale.setContributionLimits(0.03 ether, 0.001 ether);
        assertEq(sale.minInitialContribution(), 0.03 ether);
    }

    function test_setContributionLimits_revertsInClosedAndAbandoned() public {
        // Closed
        _open();
        _close();
        vm.prank(owner);
        vm.expectRevert(_wrongState(ITokenSale.SaleState.Closed));
        sale.setContributionLimits(0.01 ether, 0.001 ether);

        // Abandoned
        TokenSale abandonedSale = new TokenSale(owner, address(token), FOR_SALE, feeAddress1Wallet, feeAddress2Wallet, feeAddress3Wallet);
        vm.prank(owner);
        abandonedSale.abandon();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.WrongState.selector, ITokenSale.SaleState.Abandoned));
        abandonedSale.setContributionLimits(0.01 ether, 0.001 ether);
    }

    function test_setContributionLimits_rejectsInvalidLimits() public {
        vm.startPrank(owner);
        // zero minContribution
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.InvalidContributionLimits.selector, 0, 0.001 ether));
        sale.setContributionLimits(0, 0.001 ether);

        // zero step
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.InvalidContributionLimits.selector, 0.005 ether, 0));
        sale.setContributionLimits(0.005 ether, 0);

        // minContribution < step
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.InvalidContributionLimits.selector, 0.001 ether, 0.002 ether));
        sale.setContributionLimits(0.001 ether, 0.002 ether);

        // minContribution not a multiple of step
        vm.expectRevert(abi.encodeWithSelector(ITokenSale.InvalidContributionLimits.selector, 0.005 ether, 0.002 ether));
        sale.setContributionLimits(0.005 ether, 0.002 ether);
        vm.stopPrank();
    }

    // ===================================================================
    // CENSUS SLICE
    // ===================================================================

    function test_censusSlice_pagination() public {
        _open();
        address[5] memory addrs = [
            address(0x1111),
            address(0x2222),
            address(0x3333),
            address(0x4444),
            address(0x5555)
        ];
        for (uint256 i = 0; i < addrs.length; i++) {
            vm.deal(addrs[i], 1 ether);
            vm.prank(addrs[i]);
            sale.contribute{value: 0.01 ether}();
        }
        assertEq(sale.contributorCount(), 5);

        // Slice middle: offset 1, count 2 -> index 1, 2
        (address[] memory wallets, uint256[] memory amounts) = sale.censusSlice(1, 2);
        assertEq(wallets.length, 2);
        assertEq(amounts.length, 2);
        assertEq(wallets[0], addrs[1]);
        assertEq(amounts[0], 0.01 ether);
        assertEq(wallets[1], addrs[2]);
        assertEq(amounts[1], 0.01 ether);

        // Slice to end: offset 3, count 10 -> index 3, 4 (length 2)
        (wallets, amounts) = sale.censusSlice(3, 10);
        assertEq(wallets.length, 2);
        assertEq(wallets[0], addrs[3]);
        assertEq(wallets[1], addrs[4]);

        // Offset beyond end
        (wallets, amounts) = sale.censusSlice(5, 5);
        assertEq(wallets.length, 0);
        assertEq(amounts.length, 0);

        // Count 0
        (wallets, amounts) = sale.censusSlice(0, 0);
        assertEq(wallets.length, 0);
        assertEq(amounts.length, 0);
    }
}
