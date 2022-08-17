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

    struct TokenData {
        address token;
        uint256 decimals;
        uint256 price;
    }
    function fetchTokensData()
        public
        view
        returns ( TokenData[] memory tokensData )
    {
        address[] memory allowedTokens = involica.fetchAllowedTokens();
        tokensData = new TokenData[](allowedTokens.length + 1);

        for (uint256 i = 0; i < (tokensData.length - 1); i++) {
            tokensData[i].token = allowedTokens[i];
            tokensData[i].decimals = IERC20Ext(allowedTokens[i]).decimals();
            (tokensData[i].price,) = oracle.getPriceUsdc(allowedTokens[i]);
        }
        tokensData[tokensData.length - 1].token = involica.NATIVE_TOKEN();
        tokensData[tokensData.length - 1].decimals = 18;
        (tokensData[tokensData.length - 1].price,) = oracle.getPriceUsdc(involica.NATIVE_TOKEN());
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
            allowance = IERC20(position.tokenIn).allowance(position.user, address(involica));
            balance = IERC20(position.tokenIn).balanceOf(position.user);
            uint256 limitedValue = allowance < balance ? allowance : balance;
            dcasRemaining = position.amountDCA > 0 ? limitedValue / position.amountDCA : 0;
        }

        address[] memory allowedTokens = involica.fetchAllowedTokens();
        userTokensData = new IInvolica.UserTokenData[](allowedTokens.length + 1);
        for (uint256 i = 0; i < (userTokensData.length - 1); i++) {
            userTokensData[i] = IInvolica.UserTokenData({
                token: allowedTokens[i],
                allowance: IERC20(allowedTokens[i]).allowance(_user, address(involica)),
                balance: IERC20(allowedTokens[i]).balanceOf(_user)
            });
        }
        userTokensData[userTokensData.length - 1] = IInvolica.UserTokenData({
            token: involica.NATIVE_TOKEN(),
            allowance: type(uint256).max,
            balance: _user.balance
        });
        
        swapsAmountOutMin = new uint256[](position.outs.length);
        for (uint256 i = 0; i < position.outs.length; i++) {
            address[] memory route = oracle.getRoute(position.tokenIn, position.outs[i].token);
            try IUniswapV2Router(involica.fetchUniRouter()).getAmountsOut(
                position.amountDCA * position.outs[i].weight / 10_000,
                route
            ) returns (uint256[] memory amounts) {
                swapsAmountOutMin[i] = amounts[amounts.length - 1] * (10_000 - position.outs[i].maxSlippage) / 10_000;
            } catch {
                swapsAmountOutMin[i] = 0;
            }
        }
    }

    function fetchPairRoute (address token0, address token1) public view returns (address[] memory) {
        return oracle.getRoute(token0, token1);
    }
}
