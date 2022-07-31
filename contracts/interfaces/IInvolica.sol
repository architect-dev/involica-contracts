// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

interface IInvolica {
    // Data Structure

    struct Position {
        address user;
        address tokenIn;
        PositionOut[] outs;
        uint256 amountDCA;
        uint256 intervalDCA;
        uint256 lastDCA;
        uint256 maxGasPrice;
        bytes32 taskId;
        string finalizationReason;
    }
    struct PositionOut {
        address token;
        uint256 weight;
        address[] route;
        uint256 maxSlippage;
        uint256 balance;
    }

    // Input Structure
    struct TokenOutParams {
        address token;
        uint256 weight;
        address[] route;
        uint256 maxSlippage;
    }

    // Output Structure
    struct UserTokenData {
        address token;
        uint256 allowance;
        uint256 balance;
    }
    struct UserTx {
        uint256 timestamp;
        UserTokenTx[] tokenTxs;
    }
    struct UserTokenTx {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        string err;
    }

    // Events
    event SetPosition(
        address indexed owner,
        address tokenIn,
        PositionOut[] outs,
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
    event ExitPosition(address indexed user);
    event DepositTreasury(address indexed user, uint256 indexed amount);
    event WithdrawTreasury(address indexed user, uint256 indexed amount);

    event InitializeTask(address indexed user, bytes32 taskId);
    event FinalizeTask(address indexed user, string reason);

    event FinalizeDCA(address indexed user, address indexed tokenIn, uint256 indexed inAmount, address[] outTokens, uint256[] outAmounts);

    // Eco Events
    event SetResolver(address indexed resolver);
    event SetAllowedToken(address indexed token, bool indexed allowed);
    event SetBlacklistedPair(
        address indexed tokenA,
        address indexed tokenB,
        bool indexed blacklisted
    );
    event MinSlippageSet(uint256 indexed minSlippage);

    // Interface
    function fetchPosition(address) external view returns (Position memory);

    function executeDCA(address, uint256[] calldata) external;
}

interface IInvolicaResolver {
    function checkPositionExecutable(address _user)
        external
        view
        returns (bool canExec, bytes memory execPayload);
}
