// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "./interfaces/IUniswapV2Router.sol";
import "./interfaces/IERC20Ext.sol";

interface PriceRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

contract Oracle {
    address public wethAddress;
    address public usdcAddress;

    mapping(address => PriceRouter) public routerForFactory;
    PriceRouter public router;

    address ethAddress = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address zeroAddress = 0x0000000000000000000000000000000000000000;

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
        // if (isLpToken(tokenAddress)) {
        //     return getLpTokenPriceUsdc(tokenAddress);
        // }
        return getPriceFromRouterUsdc(tokenAddress);
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
        directPath[2] = token1Address;

        bool inputTokenIsWeth = token0Address == wethAddress ||
            token1Address == wethAddress;
        if (inputTokenIsWeth) {
            // path = [token0, weth] or [weth, token1]
            return (
                _amountOut(directPath),
                directPath
            );
        }

        // path = [token0, weth, token1] or [token0, token1]
        address[] memory throughWethPath = new address[](3);
        throughWethPath[0] = token0Address;
        throughWethPath[1] = wethAddress;
        throughWethPath[2] = token1Address;

        uint256 throughWethOut = _amountOut(throughWethPath);
        uint256 directOut = _amountOut(directPath);
        if (throughWethOut > directOut) {
            price = throughWethOut;
            route = throughWethPath;
        } else {
            price = directOut;
            route = directPath;
        }
    }

    function _amountOut(address[] memory path) internal view returns (uint256) {
        IERC20Ext token0 = IERC20Ext(path[0]);
        uint256 amountIn = 10**uint256(token0.decimals());
        uint256[] memory amountsOut = router.getAmountsOut(
            amountIn,
            path
        );

        uint256 amountOut = amountsOut[amountsOut.length - 1];
        uint256 feeBips = 20; // .2% per swap
        amountOut = (amountOut * 10000) / (10000 - (feeBips * path.length));
        return amountOut;
    }

    function getPriceFromRouterUsdc(address tokenAddress)
        public
        view
        returns (uint256 price, address[] memory route)
    {
        return getPriceFromRouter(tokenAddress, usdcAddress);
    }

    // function isLpToken(address tokenAddress) public view returns (bool) {
    //     IUniswapV2Pair lpToken = IUniswapV2Pair(tokenAddress);
    //     try lpToken.factory() {
    //         return true;
    //     } catch {
    //         return false;
    //     }
    // }

    // function getRouterForLpToken(address tokenAddress)
    //     public
    //     view
    //     returns (PriceRouter)
    // {
    //     IUniswapV2Pair lpToken = IUniswapV2Pair(tokenAddress);
    //     PriceRouter lpTokenRouter = routerForFactory[lpToken.factory()];
    //     require(
    //         address(lpTokenRouter) != address(0),
    //         "No router for this token"
    //     );
    //     return lpTokenRouter;
    // }

    // function getLpTokenTotalLiquidityUsdc(address tokenAddress)
    //     public
    //     view
    //     returns (uint256)
    // {
    //     IUniswapV2Pair pair = IUniswapV2Pair(tokenAddress);
    //     address token0Address = pair.token0();
    //     address token1Address = pair.token1();
    //     IERC20Ext token0 = IERC20Ext(token0Address);
    //     IERC20Ext token1 = IERC20Ext(token1Address);
    //     uint256 token0Decimals = token0.decimals();
    //     uint256 token1Decimals = token1.decimals();
    //     uint256 token0Price = getPriceUsdc(token0Address);
    //     uint256 token1Price = getPriceUsdc(token1Address);
    //     (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
    //     uint256 totalLiquidity = ((reserve0 / 10**token0Decimals) *
    //         token0Price) + ((reserve1 / 10**token1Decimals) * token1Price);
    //     return totalLiquidity;
    // }

    // function getLpTokenPriceUsdc(address tokenAddress)
    //     public
    //     view
    //     returns (uint256 price, address[] memory route)
    // {
    //     IUniswapV2Pair pair = IUniswapV2Pair(tokenAddress);
    //     uint256 totalLiquidity;
    //     (totalLiquidity, route) = getLpTokenTotalLiquidityUsdc(tokenAddress);
    //     uint256 totalSupply = pair.totalSupply();
    //     uint8 pairDecimals = pair.decimals();
    //     uint256 pricePerLpTokenUsdc = (totalLiquidity * 10**pairDecimals) /
    //         totalSupply;
    //     return (pricePerLpTokenUsdc, route);
    // }
}
