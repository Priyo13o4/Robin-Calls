// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * ===========================================================================
 *
 *                                                           :=******=.
 *                                                         -%@@@@@@@@@@.
 *                                                       -%@@@@@@@@@@@@=
 *                                                      :--------@@@@@@=
 *                                                   :#%%%%%#=   @@@@@%.
 *                                       .-++      .+@@@@@@*..*= @@@@+
 *                                   .-+%@@@@#    =@@@@@@#: +@@= @@#.
 *                                :=#@@@@@@@@@#  *@@@@@%- =%@@@= %-
 *                             .=%@@@@@@@@@@@@@: @@@@@# .#@@@@@=
 *                           :*@@@@@@@@@@@@@@@@ :@@@@= =@@@@@@#.
 *                         :#@@@@@@@@@@@@@@@@@@:.@@@: *@@@@@@=
 *                       .*@@@@@@@@@@@@@@@@@@@@.=@%: #@@@@@%:
 *                      +@@@@@@@@@@@@@@@@@@@@@--@%:.%%*+-:.
 *                    :%@@@@@@%%%**#@@@@@@@@@=:@@: .
 *                   +%*+=-:.:=+#%@@@@@@@@@@#:@@:
 *                     .-=*%@@@@@@@@@@@@@@@@-%@*:
 *        .::::::--=*#@@@@@@@@@@@@@@@@@@@@@#+@@@@@%#*-
 *         -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@+@@@@@@@@+.
 *            :=+**#%*@@@@@@@@@@@@@@@@@@@@@%@@@@@%=.
 *                    @@@@@@@@@@@@@@@@@@@@@@@@@@#
 *                   #@@@@@@@@@@@@@@@@@@@@@@@@@@@%*-
 *                  *@@@@@@@@@@@@@@@@@@@@@@@@@@@@*.
 *                 .==%@@@@@@@@@@@@@@@@@@@@@@@@-.    :-=**=
 *                    *@@@@@@@@@@@@@@@@@@@@@#+-.:=*%@@@@@=
 *                    :%@@@@@@@@@@@@@@@@%+:.-+#@@@@@@@@%:
 *                     %@@@@@@@@@@@@@%=: =*@@@@@@@@@@@%.
 *                     -===-:.%@@@@*- -*@@@@@@@@@@@@@@-
 *                            +@@*.:+%@@@@@@@@@@@@@@@@@*.
 *                           :%#:-*@@@@@@@@@@@@@@@@@@@@@@-
 *                          +@=-#@@@@@@@@@@@%#**+===+*#%@@:
 *                        .%@+#@@@@@@@#*=:.              :=
 *                       .%@#@@@@@#+-
 *                      :%@@@@%+-
 *                      %@@@+:
 *                     *@#-
 *                    :*:
 *
 * ===========================================================================
 *
 *                 R O B I N C A L L S   ::   $ROBINCALLS
 *              Official token of RobinCalls on Robinhood Chain
 *
 *                     Steal from the ruggers.
 *                     Give to the holders.
 *
 * ---------------------------------------------------------------------------
 *
 *   Website    https://robincalls.com
 *   Scanner    https://robincalls.com/scan
 *   RWA        https://robincalls.com/rwa
 *   X          https://x.com/RobinCalls
 *
 *   Chain      Robinhood Chain (chain id 4663)
 *   Standard   ERC-20 + ERC-2612 permit
 *   Supply     10,000,000 ROBINCALLS, minted once, never again
 *
 * ---------------------------------------------------------------------------
 *
 *   WHAT ROBINCALLS DOES
 *
 *     Scanner        Paste a token. Get the truth.
 *                    Honeypots, hidden taxes, pulled liquidity, whales.
 *                    Caught before you buy, not after you cry.
 *
 *     Night Market   Every launchpad on the chain. One live feed.
 *                    Fresh curves, graduations, direct DEX launches.
 *
 *     Swap           Best route across the chain's DEXs. Simulated first,
 *                    so what you see is what you get.
 *
 *     Trade          Live chart, live trades, verdict on the same screen.
 *                    Never ape blind again.
 *
 *     RWA            Anyone can name a token "TSLA".
 *                    We check it against Robinhood's real contracts.
 *                    The ticker proves nothing. The code does.
 *
 *     Wanted         Every rug, every rugger. On-chain receipts.
 *
 *     Ledger         Every verdict we publish, hash-chained.
 *                    No call can be quietly rewritten. Not even by us.
 *
 *     Robin Knight   AI copilot that explains a verdict in plain words.
 *                    It explains. It never decides.
 *
 *     Ecosystem      Every project on Robinhood Chain, reviewed.
 *
 * ---------------------------------------------------------------------------
 *
 *   WHAT THIS CONTRACT CANNOT DO
 *
 *     [x] mint          Fixed supply. It only ever goes down.
 *     [x] tax           Zero on buys. Zero on sells. Zero on transfers.
 *     [x] blacklist     Nobody gets frozen. Ever.
 *     [x] limits        No max wallet. No max tx. No cooldown.
 *     [x] pause         Trading cannot be switched off.
 *     [x] upgrade       No proxy. What you read is what runs.
 *     [x] owner powers  The owner has no switches to flip.
 *
 *   Don't trust us. Scan us: https://robincalls.com/scan
 *
 * ===========================================================================
 */

// OpenZeppelin Contracts v5.x
// Install:  npm install @openzeppelin/contracts
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RobinCalls ($ROBINCALLS)
 * @author RobinCalls (https://robincalls.com)
 * @notice The official RobinCalls token. 10M supply, minted once.
 *         No tax. No mint. No blacklist. No pause. No proxy.
 *         Supply only goes down.
 *
 * @dev Inherited surface:
 *   ERC20         -> name, symbol, decimals, totalSupply, balanceOf,
 *                    transfer, approve, allowance, transferFrom
 *   ERC20Burnable -> burn(value), burnFrom(account, value)
 *   ERC20Permit   -> permit(...), nonces(owner), DOMAIN_SEPARATOR()
 *   Ownable       -> owner(), transferOwnership(newOwner), renounceOwnership()
 *
 *   _update is overridden only to refuse transfers to this contract's own
 *   address. It is a fixed rule with no state and no owner control.
 *
 * @custom:website https://robincalls.com
 * @custom:x https://x.com/RobinCalls
 * @custom:rwa https://robincalls.com/rwa
 */
contract RobinCalls is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    /// @dev Total supply minted at deployment: 10,000,000 tokens.
    uint256 private constant INITIAL_SUPPLY = 10_000_000;

    /// @param initialOwner Becomes the owner and receives the entire supply.
    constructor(address initialOwner)
        ERC20("RobinCalls", "ROBINCALLS")
        ERC20Permit("RobinCalls")
        Ownable(initialOwner)
    {
        _mint(initialOwner, INITIAL_SUPPLY * 10 ** decimals());
    }

    /// @notice Transfers to this contract's own address are refused. Nothing could ever get them back out.
    error TransferToTokenContract();

    function _update(address from, address to, uint256 value) internal override {
        if (to == address(this)) revert TransferToTokenContract();
        super._update(from, to, value);
    }
}
