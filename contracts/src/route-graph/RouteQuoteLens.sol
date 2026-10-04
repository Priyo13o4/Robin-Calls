// SPDX-License-Identifier: MIT
// This module is not included in this repository.
// Exports and types are kept so the app compiles.
pragma solidity =0.8.28;

error NotImplementedInPublicBuild();

contract RouteQuoteLens {
    struct Leg {
        uint8 kind;
        address target;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct Quote {
        bool ok;
        uint256[] amounts;
        uint256 failedLeg;
        bytes4 reason;
        uint256 gasUsed;
    }

    function quote(Leg[][] calldata, uint256[][] calldata, uint256) external returns (Quote[] memory) {
        revert NotImplementedInPublicBuild();
    }

    function route(Leg[] calldata, uint256) external returns (uint256[] memory) {
        revert NotImplementedInPublicBuild();
    }

    function uniswapV3SwapCallback(int256, int256, bytes calldata) external pure {
        revert NotImplementedInPublicBuild();
    }
}
