// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

interface IPortfolioDCA {

    struct UserTokenTx {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        string err;
    }

    struct UserTx {
        uint256 timestamp;
        UserTokenTx[] tokenTxs;
    }


    struct PositionOut {
        address token;
        uint256 weight;
        uint256 maxSlippage;
        uint256 balance;
    }
    struct Position {
        address user;
        uint256 treasury;

        address tokenIn;
        uint256 balanceIn;
        PositionOut[] tokensOut;

        uint256 amountDCA;
        uint256 intervalDCA;
        uint256 lastDCA;
        uint256 maxGasPrice;

        bytes32 taskId;
        string finalizationReason;
    }

    struct DCAExtraData {
        // minimal swap output amount to prevent manipulation
        uint256 swapAmountOutMin;
        // swap path
        address[] swapPath;
    }

    struct TokenData {
        address token;
        string symbol;
        uint256 allowance;
        uint256 balance;
    }

    event SetPosition(
        address indexed owner,
        address tokenIn,
        PositionOut[] tokensOut,
        uint256 amountDCA,
        uint256 intervalDCA,
        uint256 maxGasPrice
    );
    event PositionUpdated(
        address indexed user,
        uint256 indexed amountDCA,
        uint256 indexed intervalDCA,
        uint256 maxSlippage,
        uint256 maxGasPrice
    );
    event DepositToTreasury(address indexed user, uint256 indexed amount);
    event WithdrawFromTreasury(address indexed user, uint256 indexed amount);
    event Deposit(address indexed user, address indexed tokenIn, uint256 indexed amount);
    event WithdrawTokenIn(address indexed user, address indexed tokenIn, uint256 indexed amount);
    event WithdrawTokensOut(address indexed user, address[] indexed tokens, uint256[] indexed amounts);
    event FinalizePosition(address indexed user, string reason);
    event ExecuteDCA(address indexed user);
    event SetAllowedToken(address indexed token, bool indexed allowed, string symbol);
    event AllowedTokenPairSet(
        address indexed tokenIn,
        address indexed tokenOut,
        bool indexed allowed
    );
    event MinSlippageSet(uint256 indexed minSlippage);

    function getPosition(address) external view returns (Position memory);
    function executeDCA(address, DCAExtraData[] calldata) external; 
}
