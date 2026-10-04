// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev The MANUAL payout leg: the three referral commissions are sent by hand from the
///      operator's own wallet, so their cost is a plain transfer and not anything the
///      sale contract does. Measured, because "a transfer is 21k" is only true for ETH.
contract PayoutGasTest is Test {
    MockERC20 token;
    address payer = address(0xDEAD01);

    function setUp() public {
        token = new MockERC20("T", "T", 18);
        token.mint(payer, 1_000_000e18);
        vm.deal(payer, 100 ether);
    }

    function test_gas_erc20ToFreshWallet() public {
        vm.prank(payer);
        uint256 g = gasleft();
        token.transfer(address(0xF01), 1e18);
        console.log("ERC20 -> wallet with NO balance (execution):", g - gasleft());
    }

    function test_gas_erc20ToWalletThatAlreadyHolds() public {
        vm.prank(payer);
        token.transfer(address(0xF02), 1e18);
        vm.prank(payer);
        uint256 g = gasleft();
        token.transfer(address(0xF02), 1e18);
        console.log("ERC20 -> wallet that ALREADY holds (execution):", g - gasleft());
    }

    function test_gas_ethSend() public {
        vm.prank(payer);
        uint256 g = gasleft();
        (bool ok,) = address(0xF03).call{value: 1 ether}("");
        require(ok);
        console.log("plain ETH send (execution):", g - gasleft());
    }
}
