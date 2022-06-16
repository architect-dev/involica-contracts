// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import {IPortfolioDCA} from "./interfaces/IPortfolioDCA.sol";
import {IUniswapV2Router} from "./interfaces/IUniswapV2Router.sol";

contract PortfolioDCAResolver {
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

        if (block.timestamp < (position.lastDCA + position.intervalDCA)) return (false, bytes("Position not ready"));
        if (position.maxGasPrice > 0 && tx.gasprice > position.maxGasPrice) return (false, bytes("Gas too expensive"));
        canExec = true;

        address[] memory path;
        uint256[] memory amounts;
        IPortfolioDCA.DCAExtraData[] memory extraData = new IPortfolioDCA.DCAExtraData[](position.tokensOut.length);
        for (uint256 i = 0; i < position.tokensOut.length; i++) {
            path = new address[](2);
            path[0] = position.tokenIn;
            path[1] = position.tokensOut[i].token;

            amounts = uniRouter.getAmountsOut(
                position.amountDCA,
                path
            );
            extraData[i] = IPortfolioDCA.DCAExtraData({
                swapAmountOutMin: amounts[1] * (10_000 - position.tokensOut[i].maxSlippage) / 10_000,
                swapPath: path
            });
        }

        execPayload = abi.encodeWithSelector(
            IPortfolioDCA.executeDCA.selector,
            _user,
            extraData
        );
    }
}
