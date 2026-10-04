// SPDX-License-Identifier: MIT
// This module is not included in this repository.
// Exports and types are kept so the app compiles.
pragma solidity 0.8.28;

import {IRobinCallsGaslessRouter} from "./IRobinCallsGaslessRouter.sol";

error NotImplementedInPublicBuild();

contract RobinCallsGaslessRouter is IRobinCallsGaslessRouter {
    function executeOrder(
        OrderPermit calldata,
        SwapOrder calldata,
        bytes calldata,
        bytes calldata
    ) external override returns (uint256) {
        revert NotImplementedInPublicBuild();
    }

    function hashOrder(SwapOrder calldata) external pure override returns (bytes32) {
        revert NotImplementedInPublicBuild();
    }

    function setPaused(bool) external override {
        revert NotImplementedInPublicBuild();
    }

    function setTargetPaused(address, bool) external override {
        revert NotImplementedInPublicBuild();
    }

    function sweep(address, address, uint256) external override {
        revert NotImplementedInPublicBuild();
    }

    function isTarget(address) external pure override returns (bool) {
        revert NotImplementedInPublicBuild();
    }

    function isTargetPaused(address) external pure override returns (bool) {
        revert NotImplementedInPublicBuild();
    }

    function isFeeAsset(address) external pure override returns (bool) {
        revert NotImplementedInPublicBuild();
    }

    function totalFeesCollected(address) external pure override returns (uint256) {
        revert NotImplementedInPublicBuild();
    }

    function targets() external pure override returns (address[] memory) {
        revert NotImplementedInPublicBuild();
    }

    function feeAssets() external pure override returns (address[] memory) {
        revert NotImplementedInPublicBuild();
    }
}
