// SPDX-License-Identifier: MIT
pragma solidity >=0.8.28 <=0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Plain, well-behaved ERC20. The baseline the taxed variants are compared against.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Mirrors OpenZeppelin's ERC20Burnable, which the real sale token (RobinCalls)
    ///      inherits. Without it {TokenSale.burnUnclaimed} cannot be exercised against a
    ///      token shaped like the one that will actually be deployed.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

/**
 * @dev Fee-on-transfer token. Exists because "measure, never trust" (WAYS-OF-WORK
 *      principle 2) is untestable against a token that always delivers what was asked:
 *      here `transfer(x)` credits less than x, so any code path that trusted the
 *      requested figure over the balance delta fails loudly.
 */
contract MockTaxedERC20 is ERC20 {
    uint16 public immutable taxBps;
    address public immutable taxSink;

    constructor(string memory name_, string memory symbol_, uint16 taxBps_, address taxSink_)
        ERC20(name_, symbol_)
    {
        taxBps = taxBps_;
        taxSink = taxSink_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || taxBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 tax = (value * taxBps) / 10_000;
        if (tax != 0) super._update(from, taxSink, tax);
        super._update(from, to, value - tax);
    }
}

/// @dev USDT-shaped: approve() reverts unless the current allowance is zero. Proves the
///      router's forceApprove path, which a plain approve() would break on.
contract MockNonStandardERC20 is ERC20 {
    constructor() ERC20("NonStandard", "NST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function approve(address spender, uint256 value) public override returns (bool) {
        require(value == 0 || allowance(msg.sender, spender) == 0, "NST: reset allowance first");
        return super.approve(spender, value);
    }
}
