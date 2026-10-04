// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RobinCalls} from "../../src/token/RobinCalls.sol";

contract RobinCallsTest is Test {
    RobinCalls token;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    function setUp() public {
        token = new RobinCalls(owner);
    }

    function test_metadata() public view {
        assertEq(token.name(), "RobinCalls");
        assertEq(token.symbol(), "ROBINCALLS");
        assertEq(token.decimals(), 18);
    }

    function test_ownerGetsWholeSupplyAndOwnership() public view {
        assertEq(token.totalSupply(), 10_000_000e18);
        assertEq(token.balanceOf(owner), 10_000_000e18);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.owner(), owner);
    }

    function test_zeroOwnerRejected() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new RobinCalls(address(0));
    }

    function test_transferToTokenContractReverts() public {
        vm.prank(owner);
        vm.expectRevert(RobinCalls.TransferToTokenContract.selector);
        token.transfer(address(token), 1);
    }

    function test_transferFromToTokenContractReverts() public {
        vm.prank(owner);
        token.approve(alice, 1);
        vm.prank(alice);
        vm.expectRevert(RobinCalls.TransferToTokenContract.selector);
        token.transferFrom(owner, address(token), 1);
    }

    function test_normalTransferAndBurnStillWork() public {
        vm.startPrank(owner);
        token.transfer(alice, 100);
        token.burn(40);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 100);
        assertEq(token.totalSupply(), 10_000_000e18 - 40);
    }
}
