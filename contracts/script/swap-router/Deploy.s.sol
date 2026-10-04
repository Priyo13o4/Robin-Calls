// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {RobinCallsRouter} from "../../src/swap-router/RobinCallsRouter.sol";

/**
 * @notice Deploys the executor. Every constructor value is config, never a literal in here —
 *         the fee number is D4's and still Priyo's to pick, and the target set is the thing
 *         a wrong entry turns into an escape hatch.
 *
 * @dev The target set is FIXED at deploy (D1). Adding a venue or a launchpad later means a
 *      new deployment, so get this list right before spending gas.
 *
 *      Testnet (46630) first, mainnet (4663) second:
 *
 *          forge script script/Deploy.s.sol:Deploy --rpc-url $ROBINHOOD_TESTNET_RPC_URL \
 *              --broadcast --verify --verifier blockscout \
 *              --verifier-url $EXPLORER_API_URL
 */
contract Deploy is Script {
    address internal constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external returns (RobinCallsRouter executor) {
        address owner = vm.envAddress("ROUTER_OWNER");
        address feeRecipient = vm.envAddress("ROUTER_FEE_RECIPIENT");
        uint16 feeBps = uint16(vm.envUint("ROUTER_FEE_BPS"));
        address permit2 = vm.envOr("ROUTER_PERMIT2", CANONICAL_PERMIT2);
        address[] memory feeAssets = vm.envAddress("ROUTER_FEE_ASSETS", ",");
        address[] memory targets = vm.envAddress("ROUTER_TARGETS", ",");

        // A target with no bytecode is a typo that only surfaces on the first trade.
        for (uint256 i; i < targets.length; ++i) {
            require(targets[i].code.length > 0, "Deploy: target has no code on this chain");
        }
        require(permit2.code.length > 0, "Deploy: Permit2 has no code on this chain");
        for (uint256 i; i < feeAssets.length; ++i) {
            require(feeAssets[i].code.length > 0, "Deploy: fee asset has no code on this chain");
        }

        vm.startBroadcast();
        executor = new RobinCallsRouter(owner, permit2, feeRecipient, feeBps, feeAssets, targets);
        vm.stopBroadcast();

        console2.log("RobinCallsRouter:", address(executor));
        console2.log("  owner:         ", owner);
        console2.log("  permit2:       ", permit2);
        console2.log("  feeRecipient:  ", feeRecipient);
        console2.log("  feeBps:        ", feeBps);
        console2.log("  maxFeeBps:     ", executor.MAX_FEE_BPS());
        console2.log("  targets:       ", targets.length);
        for (uint256 i; i < targets.length; ++i) {
            console2.log("   -", targets[i]);
        }
        console2.log("  feeAssets:     ", executor.feeAssets().length, "(native is always included)");

        console2.log("");
        console2.log("Next, in order:");
        console2.log(" 1. Verify on Blockscout and confirm the constructor args match the above.");
        console2.log(" 2. Register this address in trusted_address BEFORE the first trade, or the");
        console2.log("    scanner reads our own routed flows as whale activity on the tokens we route.");
        console2.log(" 3. Confirm owner() is the intended key, then transferOwnership if it is not.");
    }
}
