// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import {IPortfolioDCA, IPortfolioDCAResolver} from "./interfaces/IPortfolioDCA.sol";
import {IUniswapV2Router} from "./interfaces/IUniswapV2Router.sol";

contract PortfolioDCAResolver is IPortfolioDCAResolver {
    IPortfolioDCA public portfolioDCA;
    IUniswapV2Router public uniRouter;

    address public owner;

    constructor(address _portfolioDCA, address _uniRouter) {
        portfolioDCA = IPortfolioDCA(_portfolioDCA);
        uniRouter = IUniswapV2Router(_uniRouter);
        owner = msg.sender;
    }


    function checkPositionExecutable(address _user)
        external
        view
        returns (bool canExec, bytes memory execPayload)
    {
        IPortfolioDCA.Position memory position = portfolioDCA.getPosition(_user);

        if (position.user != _user || position.taskId == bytes32(0)) return (false, bytes("User doesnt have a position"));
        if (block.timestamp < (position.lastDCA + position.intervalDCA)) return (false, bytes("DCA not mature"));
        if (position.maxGasPrice > 0 && tx.gasprice > position.maxGasPrice) return (false, bytes("Gas too expensive"));
        canExec = true;

        uint256[] memory amounts;
        uint256[] memory swapsAmountOutMin = new uint256[](position.tokensOut.length);
        for (uint256 i = 0; i < position.tokensOut.length; i++) {
            amounts = uniRouter.getAmountsOut(
                position.amountDCA * position.tokensOut[i].weight / 10_000,
                position.tokensOut[i].route
            );
            swapsAmountOutMin[i] = amounts[amounts.length - 1] * (10_000 - position.tokensOut[i].maxSlippage) / 10_000;
        }

        execPayload = abi.encodeWithSelector(
            IPortfolioDCA.executeDCA.selector,
            _user,
            swapsAmountOutMin
        );
    }
}
