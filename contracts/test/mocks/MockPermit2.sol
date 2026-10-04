// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Permit2 stand-in for unit tests. Struct shapes are byte-identical to
 *      `src/interfaces/IPermit2.sol`, so the router's calldata encoding is exercised
 *      for real; only signature RECOVERY is stubbed out.
 *
 *      What this cannot prove is therefore explicit: that a real signature verifies, and
 *      that our selectors match the deployed Permit2. Both are fork-test territory
 *      (`RobinCallsRouterFork.t.sol`), not unit-test territory.
 */
contract MockPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    // user => token => spender
    mapping(address => mapping(address => mapping(address => uint160))) public allowanceAmount;
    mapping(address => mapping(address => mapping(address => uint48))) public allowanceExpiration;

    // Recorded so a test can assert the router passed msg.sender as `owner` — the single
    // property that makes a lifted signature useless to a front-runner.
    address public lastOwner;
    uint256 public lastNonce;
    uint256 public lastDeadline;
    address public lastTo;
    uint256 public lastRequestedAmount;
    bytes public lastSignature;

    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external {
        require(block.timestamp <= permit.deadline, "P2: permit expired");
        require(transferDetails.requestedAmount <= permit.permitted.amount, "P2: over permitted");
        require(signature.length != 0, "P2: empty signature");

        lastOwner = owner;
        lastNonce = permit.nonce;
        lastDeadline = permit.deadline;
        lastTo = transferDetails.to;
        lastRequestedAmount = transferDetails.requestedAmount;
        lastSignature = signature;

        IERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
    }

    // Signature correctness is proved elsewhere against the real Permit2, in RobinCallsGaslessRouterFork.t.sol.
    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32,
        string calldata,
        bytes calldata
    ) external {
        require(block.timestamp <= permit.deadline, "P2: permit expired");
        require(transferDetails.requestedAmount <= permit.permitted.amount, "P2: over permitted");

        lastOwner = owner;
        lastNonce = permit.nonce;
        lastDeadline = permit.deadline;
        lastTo = transferDetails.to;
        lastRequestedAmount = transferDetails.requestedAmount;

        IERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
    }

    function approve(address token, address spender, uint160 amount, uint48 expiration) external {
        allowanceAmount[msg.sender][token][spender] = amount;
        allowanceExpiration[msg.sender][token][spender] = expiration;
    }

    function allowance(address user, address token, address spender)
        external
        view
        returns (uint160, uint48, uint48)
    {
        return (allowanceAmount[user][token][spender], allowanceExpiration[user][token][spender], 0);
    }

    /// @dev IAllowanceTransfer.transferFrom — how a Universal-Router-shaped target draws
    ///      on the allowance the router granted it.
    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint160 allowed = allowanceAmount[from][token][msg.sender];
        require(allowed >= amount, "P2: insufficient allowance");
        require(block.timestamp <= allowanceExpiration[from][token][msg.sender], "P2: allowance expired");
        allowanceAmount[from][token][msg.sender] = allowed - amount;
        IERC20(token).transferFrom(from, to, amount);
    }

    function nonceBitmap(address, uint256) external pure returns (uint256) {
        return 0;
    }

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return bytes32(0);
    }
}
