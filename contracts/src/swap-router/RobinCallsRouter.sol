// SPDX-License-Identifier: MIT
// This module is not included in this repository.
// Exports and types are kept so the app compiles.
pragma solidity 0.8.28;

import {IRobinCallsRouter} from "./IRobinCallsRouter.sol";

error NotImplementedInPublicBuild();

contract RobinCallsRouter is IRobinCallsRouter {
    function execute(SwapPlan calldata, Permit calldata)
        external
        payable
        override
        returns (uint256)
    {
        revert NotImplementedInPublicBuild();
    }

    function setFeeConfig(uint16, address) external override {
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

    function feeBps() external pure override returns (uint16) {
        revert NotImplementedInPublicBuild();
    }

    function feeRecipient() external pure override returns (address) {
        revert NotImplementedInPublicBuild();
    }

    function totalFeesCollected(address) external pure override returns (uint256) {
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

    function targets() external pure override returns (address[] memory) {
        revert NotImplementedInPublicBuild();
    }

    function feeAssets() external pure override returns (address[] memory) {
        revert NotImplementedInPublicBuild();
    }
}
