// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

interface IInvolica {
    // Data Structure

    struct Position {
        address user;
        address tokenIn;
        address[] tokenInPriceRoute;
        PositionOut[] outs;
        uint256 amountDCA;
        uint256 intervalDCA;
        uint256 lastDCA;
        uint256 maxGasPrice;
        bytes32 taskId;
        address recipient;
        bool manualExecutionOnly;
        bool paused;
    }
    struct PositionOut {
        address token;
        uint256 weight;
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
        address tokenIn;
        uint256 txFee;
        UserTokenTx[] tokenTxs;
    }
    struct UserTokenTx {
        address tokenIn;
        uint256 tokenInPrice;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        string err;
    }

    // Events
    event SetPosition(
        address indexed owner,
        address indexed recipient,
        address tokenIn,
        PositionOut[] outs,
        uint256 amountDCA,
        uint256 intervalDCA,
        uint256 maxGasPrice,
        bool manualExecutionOnly
    );
    event PositionUpdated(
        address indexed user,
        uint256 indexed amountDCA,
        uint256 indexed intervalDCA,
        uint256 maxSlippage,
        uint256 maxGasPrice
    );
    event PausePosition(address indexed user, bool indexed paused);
    event ExitPosition(address indexed user);
    event DepositTreasury(address indexed user, uint256 indexed amount);
    event WithdrawTreasury(address indexed user, uint256 indexed amount);

    event InitializeTask(address indexed user, bytes32 taskId);
    event ClearTask(address indexed user, bytes32 taskId);

    event ExecuteDCA(
        address indexed user,
        address indexed recipient,
        address indexed tokenIn,
        bool manualExecution,
        uint256 inAmount,
        uint256 inPrice,
        address[] outTokens,
        uint256[] outAmounts,
        uint256[] outPrices,
        uint256 involicaTxFee
    );

    event SetInvolicaTreasury(address indexed treasury);
    event SetInvolicaTxFee(uint256 indexed txFee);
    event SetResolver(address indexed resolver);
    event SetPaused(bool indexed paused);
    event SetAllowedToken(address indexed token, bool indexed allowed);
    event SetBlacklistedPair(address indexed tokenA, address indexed tokenB, bool indexed blacklisted);
    event MinSlippageSet(uint256 indexed minSlippage);

    // Public
    function NATIVE_TOKEN() external view returns (address);
    function txFee() external view returns (uint256);
    function fetchUniRouter() external view returns (address);
    function fetchAllowedTokens() external view returns (address[] memory);
    function fetchAllowedToken(uint256 i) external view returns (address);
    function fetchUserTreasury(address user) external view returns (uint256);
    function fetchUserPosition(address user) external view returns (Position memory);
    function fetchUserTxs(address user) external view returns (UserTx[] memory);
    function dcaRevertCondition(address user, uint256 _opsFee) external view returns (bool reverted, string memory revertMsg);

    // Callable
    function executeDCA(address, uint256 tokenInPrice, address[][] calldata swapsRoutes, uint256[] calldata swapsAmountOutMin, uint256[] calldata outPrices) external;
}

interface IInvolicaResolver {
    function checkPositionExecutable(address _user) external view returns (bool canExec, bytes memory execPayload);
}
