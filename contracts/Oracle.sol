// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import './interfaces/IUniswapV2Router.sol';
import './interfaces/IERC20Ext.sol';

interface PriceRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

contract Oracle {
    address public wethAddress;
    address public usdcAddress;

    mapping(address => PriceRouter) public routerForFactory;
    PriceRouter public router;

    address ethAddress = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    constructor(
        address _routerAddress,
        address _wethAddress,
        address _usdcAddress
    ) {
        router = PriceRouter(_routerAddress);
        usdcAddress = _usdcAddress;
        wethAddress = _wethAddress;
    }

    function getPriceUsdc(address tokenAddress) public view returns (uint256 price, address[] memory route) {
        if (tokenAddress == usdcAddress) return (1e6, new address[](0));
        return getPriceFromRouterUsdc(tokenAddress);
    }

    function getPriceFromRouterUsdc(address tokenAddress) public view returns (uint256 price, address[] memory route) {
        return getPriceFromRouter(tokenAddress, usdcAddress);
    }

    function getRoute(address token0Address, address token1Address) public view returns (address[] memory route) {
        (,route) = getPriceFromRouter(token0Address, token1Address);
    }

    function getPriceFromRouter(address token0Address, address token1Address)
        public
        view
        returns (uint256 price, address[] memory route)
    {
        // Convert ETH address (0xEeee...) to WETH
        if (token0Address == ethAddress) {
            token0Address = wethAddress;
        }
        if (token1Address == ethAddress) {
            token1Address = wethAddress;
        }

        address[] memory directPath = new address[](2);
        directPath[0] = token0Address;
        directPath[1] = token1Address;

        // Early exit with direct path if [token0, weth] or [weth, token1]
        if (token0Address == wethAddress || token1Address == wethAddress) {
            return (_amountOut(directPath), directPath);
        }

        // path = [token0, weth, token1] or [token0, token1]
        address[] memory throughWethPath = new address[](3);
        throughWethPath[0] = token0Address;
        throughWethPath[1] = wethAddress;
        throughWethPath[2] = token1Address;

        uint256 throughWethOut = _amountOut(throughWethPath);
        uint256 directOut = _amountOut(directPath);
        if (throughWethOut > directOut) {
            return (throughWethOut, throughWethPath);
        } else {
            return (directOut, directPath);
        }
    }

    function _amountOut(address[] memory path) internal view returns (uint256) {
        IERC20Ext token0 = IERC20Ext(path[0]);
        uint256 amountIn = 10**uint256(token0.decimals());

        try router.getAmountsOut(amountIn, path) returns (uint256[] memory amountsOut) {
            uint256 amountOut = amountsOut[amountsOut.length - 1];
            uint256 feeBips = 20; // .2% per swap
            amountOut = (amountOut * 10000) / (10000 - (feeBips * path.length));
            return amountOut;
        } catch {
            return 0;
        }
    }
}
