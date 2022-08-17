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

    function fetchPositionExecConditions(address _user)
        external
        view
        returns (
            bool canExec,
            string memory reason,
            bool hasPosition,
            uint256 timeRemaining,
            uint256 gasPrice
        )
    {
        IInvolica.Position memory position = involica.fetchUserPosition(_user);

        if (position.user != _user || position.taskId == bytes32(0))
            return (false, 'User doesnt have a position', false, 0, 0);

        hasPosition = true;
        timeRemaining = position.lastDCA == 0 || block.timestamp >= (position.lastDCA + position.intervalDCA)
            ? 0
            : (position.lastDCA + position.intervalDCA) - block.timestamp;
        gasPrice = tx.gasprice;

        if (timeRemaining > 0) {
            canExec = false;
            reason = 'DCA not mature';
        } else if (position.maxGasPrice > 0 && gasPrice > position.maxGasPrice) {
            canExec = false;
            reason = 'Gas too expensive';
        } else {
            canExec = true;
            reason = '';
        }
    }

    function checkPositionExecutable(address _user) external view returns (bool canExec, bytes memory execPayload) {
        IInvolica.Position memory position = involica.fetchUserPosition(_user);

        if (position.user != _user || position.taskId == bytes32(0))
            return (false, bytes('User doesnt have a position'));
        if ((block.timestamp < (position.lastDCA + position.intervalDCA)) && position.lastDCA != 0)
            return (false, bytes('DCA not mature'));
        if (position.maxGasPrice > 0 && tx.gasprice > position.maxGasPrice) return (false, bytes('Gas too expensive'));
        canExec = true;

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

        execPayload = abi.encodeWithSelector(
            IInvolica.executeDCA.selector,
            _user,
            tokenInPrice,
            swapsRoutes,
            swapsAmountOutMin,
            outPrices
        );
    }
}
