// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import './interfaces/IInvolica.sol';
import './interfaces/IERC20Ext.sol';
import './Oracle.sol';

contract InvolicaFetcher {
    IInvolica public involica;
    Oracle public oracle;

    constructor(address _involica, address _oracle) {
        involica = IInvolica(_involica);
        oracle = Oracle(_oracle);
    }

    function fetchTokensData()
        public
        view
        returns (
            address[] memory tokens,
            uint256[] memory decimals,
            uint256[] memory prices
        )
    {
        tokens = involica.fetchAllowedTokens();
        prices = new uint256[](tokens.length);
        decimals = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            (prices[i],) = oracle.getPriceUsdc(tokens[i]);
            decimals[i] = IERC20Ext(tokens[i]).decimals();
        }
    }

    function fetchUserData(address _user)
        public
        view
        returns (
            bool userHasPosition,
            uint256 userTreasury,
            IInvolica.Position memory position,
            uint256 allowance,
            uint256 balance,
            uint256 dcasRemaining,
            IInvolica.UserTokenData[] memory userTokensData,
            uint256[] memory swapsAmountOutMin
        )
    {
        userTreasury = involica.fetchUserTreasury(_user);

        position = involica.fetchUserPosition(_user);

        userHasPosition = position.user == _user && _user != address(0);

        // Fetch wallet allowance and balance
        if (userHasPosition) {
            allowance = IERC20(position.tokenIn).allowance(position.user, address(this));
            balance = IERC20(position.tokenIn).balanceOf(position.user);
            uint256 limitedValue = allowance < balance ? allowance : balance;
            dcasRemaining = position.amountDCA > 0 ? limitedValue / position.amountDCA : 0;
        }

        userTokensData = new IInvolica.UserTokenData[](involica.fetchAllowedTokens().length + 1);
        for (uint256 i = 0; i < (userTokensData.length - 1); i++) {
            userTokensData[i] = IInvolica.UserTokenData({
                token: involica.fetchAllowedToken(i),
                allowance: IERC20(involica.fetchAllowedToken(i)).allowance(_user, address(this)),
                balance: IERC20(involica.fetchAllowedToken(i)).balanceOf(_user)
            });
        }
        userTokensData[userTokensData.length - 1] = IInvolica.UserTokenData({
            token: involica.NATIVE_TOKEN(),
            allowance: type(uint256).max,
            balance: _user.balance
        });
        
        uint256[] memory amounts;
        swapsAmountOutMin = new uint256[](position.outs.length);
        for (uint256 i = 0; i < position.outs.length; i++) {
            address[] memory route = oracle.getRoute(position.tokenIn, position.outs[i].token);
            amounts = IUniswapV2Router(involica.fetchUniRouter()).getAmountsOut(
                position.amountDCA * position.outs[i].weight / 10_000,
                route
            );
            swapsAmountOutMin[i] = amounts[amounts.length - 1] * (10_000 - position.outs[i].maxSlippage) / 10_000;
        }
    }

    function fetchPairRoute (address token0, address token1) public view returns (address[] memory) {
        return oracle.getRoute(token0, token1);
    }
}
