// SPDX-License-Identifier: MIT
// This module is not included in this repository.
// Exports and types are kept so the app compiles.
pragma solidity =0.8.28;

error NotImplementedInPublicBuild();

contract PoolDepthLens {
    struct Req {
        uint8 kind;
        address pool;
        bytes32 id;
        int24 spacing;
    }

    struct Res {
        bool ok;
        bool truncated;
        uint256 a;
        uint256 b;
        int24 tick;
        int24[] ticks;
        int128[] nets;
    }

    function measure(address, Req[] calldata, int24) external view returns (Res[] memory) {
        revert NotImplementedInPublicBuild();
    }

    function one(address, Req calldata, int24) external view returns (Res memory) {
        revert NotImplementedInPublicBuild();
    }
}
