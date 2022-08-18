// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {IInvolica, IInvolicaResolver} from './interfaces/IInvolica.sol';
import {IUniswapV2Router} from './interfaces/IUniswapV2Router.sol';
import './Oracle.sol';
import 'hardhat/console.sol';

contract InvolicaResolver is IInvolicaResolver {
    IInvolica public involica;
    IUniswapV2Router public uniRouter;
    Oracle public oracle;

    address public owner;

    constructor(
        address _involica,
        address _uniRouter,
        address _oracle
    ) {
        involica = IInvolica(_involica);
        uniRouter = IUniswapV2Router(_uniRouter);
        oracle = Oracle(_oracle);
        owner = msg.sender;
    }

    function checkPositionExecutable(address _user) external view returns (bool canExec, bytes memory execPayload) {
        (bool reverted, string memory revertMsg) = involica.dcaRevertCondition(_user, 0);
        if (reverted) return (false, bytes(revertMsg));

        IInvolica.Position memory position = involica.fetchUserPosition(_user);

        (uint256 tokenInPrice, ) = oracle.getPriceUsdc(position.tokenIn);

        address[][] memory swapsRoutes = new address[][](position.outs.length);
        uint256[] memory amounts;
        uint256[] memory swapsAmountOutMin = new uint256[](position.outs.length);
        uint256[] memory outPrices = new uint256[](position.outs.length);

        for (uint256 i = 0; i < position.outs.length; i++) {
            swapsRoutes[i] = oracle.getRoute(position.tokenIn, position.outs[i].token);
            amounts = uniRouter.getAmountsOut((position.amountDCA * position.outs[i].weight) / 10_000, swapsRoutes[i]);
            swapsAmountOutMin[i] = (amounts[amounts.length - 1] * (10_000 - position.outs[i].maxSlippage)) / 10_000;
            (outPrices[i], ) = oracle.getPriceUsdc(position.outs[i].token);
        }

        return (
            true,
            abi.encodeWithSelector(
                IInvolica.executeDCA.selector,
                _user,
                tokenInPrice,
                swapsRoutes,
                swapsAmountOutMin,
                outPrices
            )
        );
    }
}
