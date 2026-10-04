// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {TokenSale} from "../../src/token-sale/TokenSale.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Measurement only. Answers "where does distribute()'s per-recipient gas go",
///      so an optimisation is chosen against a number rather than against intuition.
contract DistributeGasTest is Test {
    TokenSale sale;
    MockERC20 token;
    address owner = address(0xA11CE);
    uint256 constant FOR_SALE = 3_000_000e18;

    function setUp() public {
        token = new MockERC20("T", "T", 18);
        sale = new TokenSale(owner, address(token), FOR_SALE, address(0xFEE1), address(0xFEE2), address(0xFEE3));
        token.mint(address(sale), FOR_SALE);
        vm.prank(owner);
        sale.start();
    }

    function _seed(uint256 n) internal {
        for (uint256 i = 0; i < n; ++i) {
            address a = address(uint160(0x1000 + i));
            vm.deal(a, 1 ether);
            vm.prank(a);
            sale.contribute{value: 0.01 ether}();
        }
        vm.prank(owner);
        sale.close();
    }

    function test_gas_distribute_100_fresh() public {
        _seed(100);
        vm.prank(owner);
        uint256 g = gasleft();
        sale.distribute(100);
        g = g - gasleft();
        console.log("distribute(100), none claimed  total:", g);
        console.log("  per recipient:", g / 100);
        // The floor is the recipient's own balance SSTORE (20k, zero to non-zero) plus
        // the transfer around it. Nothing can deliver a token for less.
        assertGt(g / 100, 20_000, "cheaper than a cold balance write : the measurement is wrong");
        assertLt(g / 100, 70_000, "per-recipient cost regressed");
    }

    function test_gas_distribute_100_allAlreadyClaimed() public {
        _seed(100);
        for (uint256 i = 0; i < 100; ++i) {
            vm.prank(address(uint160(0x1000 + i)));
            sale.claim();
        }
        vm.prank(owner);
        uint256 g = gasleft();
        sale.distribute(100);
        g = g - gasleft();
        console.log("distribute(100), ALL already claimed  total:", g);
        console.log("  wasted per skipped recipient:", g / 100);
        // Pure waste: two cold SLOADs to learn there is nothing to do. The cursor is
        // linear, so this is paid for every self-claimer standing between the cursor
        // and the people who still need pushing.
        assertLt(g / 100, 8_000, "skipping an already-claimed contributor got more expensive");
    }

    function test_gas_singleClaim() public {
        _seed(100);
        address a = address(uint160(0x1000));
        vm.prank(a);
        uint256 g = gasleft();
        sale.claim();
        g = g - gasleft();
        console.log("claim() by the buyer:", g);
    }

    function test_gas_rawTokenTransferBaseline() public {
        _seed(1);
        address fresh = address(0xBEEF);
        vm.prank(address(sale));
        uint256 g = gasleft();
        token.transfer(fresh, 1e18);
        g = g - gasleft();
        console.log("bare ERC20 transfer to a zero-balance address:", g);
    }
}
