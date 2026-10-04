// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @dev Isolates ONE variable: whether `contributed` and `claimed` share a storage slot.
///      Everything else — the transfer, the event, the loop — is identical in both.
contract Separate {
    MockERC20 immutable T;
    uint256 public totalRaised;
    uint256 public constant FOR_SALE = 3_000_000e18;
    mapping(address => uint256) public contributed;
    mapping(address => bool) public claimed;
    address[] public contributors;

    event Claimed(address indexed to, uint256 amount);

    constructor(MockERC20 t) { T = t; }

    function seed(address a, uint256 amt) external {
        if (contributed[a] == 0) contributors.push(a);
        contributed[a] += amt;
        totalRaised += amt;
    }

    function distribute(uint256 n) external {
        for (uint256 i = 0; i < n; ++i) {
            address to = contributors[i];
            if (claimed[to]) continue;
            uint256 amount = (FOR_SALE * contributed[to]) / totalRaised;
            if (amount == 0) continue;
            claimed[to] = true;
            T.transfer(to, amount);
            emit Claimed(to, amount);
        }
    }
}

contract Packed {
    MockERC20 immutable T;
    uint256 public totalRaised;
    uint256 public constant FOR_SALE = 3_000_000e18;

    // One slot. `contributed` is non-zero for every contributor by construction, so the
    // slot is already dirty and setting the flag is a 2.9k update, not a 20k initialise.
    struct Account { uint248 contributed; bool claimed; }
    mapping(address => Account) internal acct;
    address[] public contributors;

    event Claimed(address indexed to, uint256 amount);

    constructor(MockERC20 t) { T = t; }

    function contributed(address a) external view returns (uint256) { return acct[a].contributed; }
    function claimed(address a) external view returns (bool) { return acct[a].claimed; }

    function seed(address a, uint256 amt) external {
        Account storage s = acct[a];
        if (s.contributed == 0) contributors.push(a);
        s.contributed += uint248(amt);
        totalRaised += amt;
    }

    function distribute(uint256 n) external {
        for (uint256 i = 0; i < n; ++i) {
            address to = contributors[i];
            Account storage s = acct[to];      // ONE cold SLOAD covers both fields
            if (s.claimed) continue;
            uint256 amount = (FOR_SALE * s.contributed) / totalRaised;
            if (amount == 0) continue;
            s.claimed = true;
            T.transfer(to, amount);
            emit Claimed(to, amount);
        }
    }
}

contract PackedLayoutTest is Test {
    MockERC20 token;
    uint256 constant N = 100;

    function setUp() public { token = new MockERC20("T", "T", 18); }

    /// @dev Disjoint recipient sets and separate test functions, because the first
    ///      version of this shared both and measured a 66% "saving" that was really the
    ///      second contract finding every recipient balance already initialised and warm.
    ///      A zero-to-non-zero balance SSTORE is 20k and it is paid by whoever gets there
    ///      first. (CLAUDE.md §8 #11: is this argument measured, or assumed?)
    function _run(bool packed, uint160 base) internal returns (uint256) {
        Separate s;
        Packed p;
        if (packed) { p = new Packed(token); token.mint(address(p), 3_000_000e18); }
        else        { s = new Separate(token); token.mint(address(s), 3_000_000e18); }

        for (uint256 i = 0; i < N; ++i) {
            address a = address(base + uint160(i));
            if (packed) p.seed(a, 0.01 ether); else s.seed(a, 0.01 ether);
        }

        uint256 g = gasleft();
        if (packed) p.distribute(N); else s.distribute(N);
        return g - gasleft();
    }

    /// @dev Asserted, not just logged: a benchmark that only prints cannot fail, and a
    ///      test that cannot fail is not evidence of anything (CLAUDE.md §7).
    function test_packingSavesRoughlyTheFlagSstore() public {
        uint256 gs = _run(false, 0x100000);
        uint256 gp = _run(true, 0x900000);
        console.log("SEPARATE per recipient:", gs / N);
        console.log("PACKED   per recipient:", gp / N);
        console.log("saved per recipient:", (gs - gp) / N);

        assertLt(gp, gs, "packing must be cheaper");
        // The saving is the 20k zero-to-non-zero SSTORE on the `claimed` flag becoming a
        // ~2.9k update of an already-dirty slot, plus one cold SLOAD folded away. Bounded
        // loosely on both sides so a compiler bump does not fail this, but a change that
        // silently unpacks the struct does.
        uint256 saved = (gs - gp) / N;
        assertGt(saved, 15_000, "the flag SSTORE saving disappeared: is the struct still one slot?");
        assertLt(saved, 25_000, "saving is larger than the mechanism explains : the benchmark is biased again");
    }

    /// @dev The cursor is linear, so a contributor who already claimed is still walked
    ///      past. This is what that costs, and it is the number the calldata variant
    ///      removes entirely.
    function test_gas_skipCost_separate() public {
        Separate s = new Separate(token);
        token.mint(address(s), 3_000_000e18);
        for (uint256 i = 0; i < N; ++i) s.seed(address(uint160(0x300000 + i)), 0.01 ether);
        s.distribute(N);                       // everyone delivered
        uint256 g = gasleft();
        s.distribute(N);                       // now every one is a skip
        uint256 gs = g - gasleft();
        console.log("SKIP separate  total:", gs, " per skipped:", gs / N);
    }

    function test_gas_skipCost_packed() public {
        Packed p = new Packed(token);
        token.mint(address(p), 3_000_000e18);
        for (uint256 i = 0; i < N; ++i) p.seed(address(uint160(0x400000 + i)), 0.01 ether);
        p.distribute(N);
        uint256 g = gasleft();
        p.distribute(N);
        uint256 gp = g - gasleft();
        console.log("SKIP packed    total:", gp, " per skipped:", gp / N);
    }
}
