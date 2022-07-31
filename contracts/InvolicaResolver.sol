// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {IInvolica, IInvolicaResolver} from "./interfaces/IInvolica.sol";
import {IUniswapV2Router} from "./interfaces/IUniswapV2Router.sol";

contract InvolicaResolver is IInvolicaResolver {
    IInvolica public involica;
    IUniswapV2Router public uniRouter;

    address public owner;

    constructor(address _involica, address _uniRouter) {
        involica = IInvolica(_involica);
        uniRouter = IUniswapV2Router(_uniRouter);
        owner = msg.sender;
    }


    function checkPositionExecutable(address _user)
        external
        view
        returns (bool canExec, bytes memory execPayload)
    {
        IInvolica.Position memory position = involica.fetchPosition(_user);

        if (position.user != _user || position.taskId == bytes32(0)) return (false, bytes("User doesnt have a position"));
        if (block.timestamp < (position.lastDCA + position.intervalDCA)) return (false, bytes("DCA not mature"));
        if (position.maxGasPrice > 0 && tx.gasprice > position.maxGasPrice) return (false, bytes("Gas too expensive"));
        canExec = true;

        uint256[] memory amounts;
        uint256[] memory swapsAmountOutMin = new uint256[](position.outs.length);
        for (uint256 i = 0; i < position.outs.length; i++) {
            amounts = uniRouter.getAmountsOut(
                position.amountDCA * position.outs[i].weight / 10_000,
                position.outs[i].route
            );
            swapsAmountOutMin[i] = amounts[amounts.length - 1] * (10_000 - position.outs[i].maxSlippage) / 10_000;
        }

        execPayload = abi.encodeWithSelector(
            IInvolica.executeDCA.selector,
            _user,
            swapsAmountOutMin
        );
    }
}
