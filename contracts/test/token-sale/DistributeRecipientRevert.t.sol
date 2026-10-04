// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TokenSale} from "../../src/token-sale/TokenSale.sol";

/// @dev A denylisting token, to pin what happens when ONE recipient reverts.
///      Not the shape of RobinCalls, which has no _update override: this exists
///      because TOKEN is a constructor argument, so the token is an operational
///      choice and not a compile-time one.
contract DenylistERC20 is ERC20 {
    mapping(address => bool) public blocked;
    constructor() ERC20("D", "D") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function block_(address a) external { blocked[a] = true; }
    function _update(address f, address t, uint256 v) internal override {
        require(!blocked[t], "DENYLIST");
        super._update(f, t, v);
    }
}

contract DistributeRecipientRevertTest is Test {
    TokenSale sale;
    DenylistERC20 token;
    address owner = address(0xA11CE);
    uint256 constant FOR_SALE = 3_000_000e18;

    function setUp() public {
        token = new DenylistERC20();
        sale = new TokenSale(owner, address(token), FOR_SALE, address(0xFEE1), address(0xFEE2), address(0xFEE3));
        token.mint(address(sale), FOR_SALE);
        vm.prank(owner);
        sale.start();
        for (uint256 i = 0; i < 10; ++i) {
            address a = address(uint160(0x1000 + i));
            vm.deal(a, 1 ether);
            vm.prank(a);
            sale.contribute{value: 0.01 ether}();
        }
        vm.prank(owner);
        sale.close();
    }

    /// @dev distribute() is convenience; claim() is the guarantee. One undeliverable
    ///      recipient pins the cursor forever, and that must never cost anyone behind it
    ///      their tokens. If this assertion ever fails, the push loop became load-bearing.
    function test_oneBadRecipientBricksDistributeButNotClaim() public {
        address bad = address(uint160(0x1000 + 3));
        token.block_(bad);

        vm.prank(owner);
        sale.distribute(3);
        console.log("cursor after clean batch of 3:", sale.distributionCursor());

        // Any batch that spans index 3 reverts, and the cursor never moves.
        vm.prank(owner);
        vm.expectRevert(bytes("DENYLIST"));
        sale.distribute(5);
        console.log("cursor after reverted batch:", sale.distributionCursor());

        // count == 1 does not route around it: the cursor IS the bad index.
        vm.prank(owner);
        vm.expectRevert(bytes("DENYLIST"));
        sale.distribute(1);
        console.log("cursor after distribute(1):", sale.distributionCursor());
        assertEq(sale.distributionCursor(), 3, "cursor is pinned at the bad index");

        // Everyone behind index 3 can still self-serve.
        address behind = address(uint160(0x1000 + 7));
        vm.prank(behind);
        sale.claim();
        console.log("claim() by a contributor BEHIND the stuck cursor:", token.balanceOf(behind));
        assertGt(token.balanceOf(behind), 0, "claim() is also blocked");
    }
}
