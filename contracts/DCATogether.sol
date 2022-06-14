// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IUniswapV2Router.sol";



/*

DCA with friends
- with love by Architect


Join a DCA pool to DCA over a period of epochs
Each epoch a pooled trade is executed
Users can withdraw / exit at any time



== ADMIN ==

    ADD POOL
        params: in token, out token, max slippage, swap path
    SET POOL
        params: pool, max slippage, swap path




== USER ACTIONS ==

    ENTER DCA:
        params: user, pool, amount, end epoch
        do:
            Set user data
            Increase the amount per epoch of the next epoch
            Decrease the amount per epoch of the final epoch

    WITHDRAW OUT TOKEN:
        params: user
        do:
            Send out token to user
            Reset user outDebt

    EXIT DCA:
        params: user, pool
        do:
            If user's dca has already finished - Harvest
            Else:
                Decrease the amount per epoch of the next epoch
                Increase the amount per epoch of the final epoch (removing the already stored drop at end)
                Send out token to user
                Send remaining in token to user

    MODIFY DCA:
        params: user, pool, amount, end epoch
        do:
            EXIT DCA
            DCA




== GELATO ACTIONS ==
    CHECK DCA EXEC AVAILABLE
        params: pool
        do:
            If epoch mature: true
            Amount to trade -> amount per epoch * epoch perc complete
            If amount to trade > 5k (?): true
            false

    EXECUTE TRADE:
        params: pool
        do:
            If epoch mature:
                Amount to trade -> current amount per epoch +/- amount per epoch of the current epoch
                Execute trade
                Update running outPerShare -> outPerShare += outTokenAmt * 1e12 / inTokenAmt
                Set outPerShare of current epoch to running outPerShare
            Else:
                Amount to trade -> amount per epoch * epoch perc complete
                Execute trade
                Update running outPerShare



== FETCH ==
    USER DCA INFO
        params: user, pool
        return:
            Allowance
            In balance
            Amount in remaining
            Amount out traded
            End epoch
            Trades:
                (uses in and out of epoch scaled by users amountPerEpoch)
                [
                    epoch,
                    userIn,
                    userOut,
                ]

    POOL INFO
        params: pool
        return:
            in token address
            out token address
            swap path
            max slippage




*/

contract DCATogether is Ownable, Pausable {
    using SafeERC20 for IERC20;

    IUniswapV2Router public uniRouter;
    address public executor;
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable weth;

    struct UserInfo {
        uint256 inPerEpoch;
        uint256 startEpoch;
        uint256 endEpoch;
        uint256 outDebt;
    }

    struct PoolInfo {
        IERC20 inToken;
        IERC20 outToken;
        address[] swapPath;
        uint256 maxSlippage;

        uint256 inPerEpoch;
        uint256 outPerShare;
        uint256 executedEpoch;
    }
    
    // TODO: Allow multiple trades to execute within an epoch (keep trades small and prevent manipulation)
    struct PoolEpochInfo {
        uint256 inPerEpochIncrease;
        uint256 inPerEpochDecrease;
        uint256 outPerShare;
        uint256 tradeInAmount;
        uint256 tradeOutAmount;
    }

    PoolInfo[] public poolInfo;
    mapping (uint256 => mapping (uint256 => PoolEpochInfo)) public poolEpochInfo;
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;

    constructor(
        address _uniRouter,
        address _executor,
        address _weth
    ) {
        uniRouter = IUniswapV2Router(_uniRouter);
        executor = _executor;
        weth = _weth;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "Only callable by executor");
        _;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // ADD POOL
    //     params: in token, out token, max slippage, swap path
    function add(IERC20 _inToken, IERC20 _outToken, uint256 _maxSlippage, address[] memory _swapPath) external onlyOwner {
        poolInfo.push(PoolInfo({
            inToken: _inToken,
            outToken: _outToken,
            swapPath: _swapPath,
            maxSlippage: _maxSlippage,

            inPerEpoch: 0,
            outPerShare: 0,
            executedEpoch: _getPrevEpoch()
        }));
    }
    
    // SET POOL
    //     params: pool, max slippage, swap path
    function set(uint256 _pid, uint256 _maxSlippage, address[] memory _swapPath) public onlyOwner {
        PoolInfo storage pool = poolInfo[_pid];
        pool.maxSlippage = _maxSlippage;
        pool.swapPath = _swapPath;
    }


    function _getPrevEpoch() internal view returns (uint256) {
        return block.timestamp / 3600;
    }
    function _getNextEpoch() internal view returns (uint256) {
        return _getPrevEpoch() + 1;
    }
    function _getEpochTimestamp(uint256 _epoch) internal pure returns (uint256) {
        return _epoch * 3600;
    }


    // ENTER DCA:
    //     params: user, pool, amount, end epoch
    //     do:
    //         Set user data
    //         Increase the amount per epoch of the next epoch
    //         Decrease the amount per epoch of the final epoch
    function enter(uint256 _pid, uint256 _amount, uint256 _endEpoch) public {
        _enter(msg.sender, _pid, _amount, _endEpoch);
    }
    function _enter(address _user, uint256 _pid, uint256 _amount, uint256 _endEpoch) internal {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        uint256 nextEpoch = _getNextEpoch();
        uint256 inPerEpoch = _amount / (_endEpoch -  nextEpoch);
        user.inPerEpoch = inPerEpoch;
        user.startEpoch = nextEpoch + 1;
        user.endEpoch = _endEpoch;
        user.outDebt = pool.outPerShare;

        // EPOCH
        poolEpochInfo[_pid][nextEpoch].inPerEpochIncrease += inPerEpoch;
        poolEpochInfo[_pid][_endEpoch].inPerEpochDecrease += inPerEpoch;

        // TRANSFER
        pool.inToken.safeTransferFrom(_user, address(this), _amount);

        // emit Deposit(_user, _pid, _amount, _endEpoch);
    }


    // WITHDRAW OUT TOKEN:
    // params: user, pool
    // do:
    //     Send out token to user
    //     Reset user outDebt
    function withdrawOutToken(uint256 _pid) public {
        _withdrawOutToken(msg.sender, _pid);
    }
    function _withdrawOutToken(address _user, uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        uint256 prevEpochDebt = poolEpochInfo[_pid][_getPrevEpoch()].outPerShare;
        uint256 outAmount = (prevEpochDebt - user.outDebt) / 1e12;
        user.outDebt = prevEpochDebt;

        pool.outToken.safeTransfer(_user, outAmount);
    }


    // EXIT DCA:
    // params: user, pool
    // do:
    //     If user's dca has already finished - Harvest
    //     Else:
    //         Decrease the amount per epoch of the next epoch
    //         Increase the amount per epoch of the final epoch (removing the already stored drop at end)
    //         Send out token to user
    //         Send remaining in token to user
    function exit(uint256 _pid) public {
        _exit(msg.sender, _pid);
    }
    function _exit(address _user, uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        // Return deposited inToken and swapped outToken
        _withdrawOutToken(_user, _pid);
        uint256 inRemaining = user.inPerEpoch * (user.endEpoch - _getNextEpoch());

        // Return users dca'ing funds, remove user's remaining dca from pool
        if (inRemaining > 0) {
            pool.inToken.safeTransfer(_user, inRemaining);
            pool.inPerEpoch -= user.inPerEpoch;
            poolEpochInfo[_pid][user.endEpoch].inPerEpochDecrease -= user.inPerEpoch;
        }

        user.startEpoch = 0;
        user.endEpoch = 0;
        user.inPerEpoch = 0;
        user.outDebt = 0;
    }


    // MODIFY DCA:
    // params: user, pool, amount, end epoch
    // do:
    //     EXIT DCA
    //     ENTER DCA
    function modify(uint256 _pid, uint256 _amount, uint256 _endEpoch) public {
        _exit(msg.sender, _pid);
        _enter(msg.sender, _pid, _amount, _endEpoch);
    }


    // CHECK DCA TRADE AVAILABLE
    //     params: pool
    //     do:
    //         If epoch mature: true
    //         Amount to trade -> amount per epoch * epoch perc complete
    //         If amount to trade > 5k (?): true
    //         false
    function checkTradeAvailable(uint256 _pid) public view returns (bool) {
        return block.timestamp >= _getEpochTimestamp(poolInfo[_pid].executedEpoch + 1);
    }

    // EXECUTE TRADE:
    //     params: pool
    //     do:
    //         If epoch mature:
    //             Amount to trade -> current amount per epoch +/- amount per epoch of the current epoch
    //             Execute trade
    //             Update running outPerShare -> outPerShare += outTokenAmt * 1e12 / inTokenAmt
    //             Set outPerShare of current epoch to running outPerShare
    //         Else: (Not Implemented)
    //             Amount to trade -> amount per epoch * epoch perc complete
    //             Execute trade
    //             Update running outPerShare
    function executeTrades(uint256[] memory _pids) public {
        // CAUTION: Unbounded loop may need to be broken up into multiple calls 
        for (uint256 i = 0; i < _pids.length; i++) {
            executeTrade(_pids[i]);
        }
    }
    function executeTrade(uint256 _pid) public onlyExecutor {
        require(checkTradeAvailable(_pid), "Epoch not mature");
        PoolInfo memory pool = poolInfo[_pid];
        uint256 epoch = pool.executedEpoch + 1;

        // Add users with positions beginning this epoch
        pool.inPerEpoch += poolEpochInfo[_pid][epoch].inPerEpochIncrease;

        // Execute
        IERC20(pool.inToken).approve(
            address(uniRouter),
            pool.inPerEpoch
        );

        uint256 amountOutMin = 0; // TODO: Correctly calculate swap out min
        uint256[] memory amounts = _swap(
            pool.inPerEpoch,
            amountOutMin,
            pool.swapPath
        );
        
        pool.outPerShare += amounts[amounts.length - 1] * 1e12 / pool.inPerEpoch;
        pool.executedEpoch = epoch;
        poolEpochInfo[_pid][epoch].outPerShare = pool.outPerShare;

        // Remove any users whose positions end this epoch
        pool.inPerEpoch -= poolEpochInfo[_pid][epoch].inPerEpochDecrease;
    }

    function _swap(
        uint256 _amountIn,
        uint256 _amountOutMin,
        address[] memory _path
    ) internal returns (uint256[] memory amounts) {
        return
            IUniswapV2Router(uniRouter).swapExactTokensForTokens(
                _amountIn,
                _amountOutMin,
                _path,
                address(this),
                block.timestamp // solhint-disable-line not-rely-on-time,
            );
    }




    // FETCH - USER DCA INFO
    // params: user, pool
    // return:
    //     Allowance
    //     In balance
    //     Amount in remaining
    //     Amount out traded
    //     End epoch
    //     Trades:
    //         (uses in and out of epoch scaled by users amountPerEpoch)
    //         [
    //             epoch,
    //             userIn,
    //             userOut,
    //         ]
    struct TradeInfo {
        uint256 epoch;
        uint256 userIn;
        uint256 userOut;
    }
    function fetchUserInfo(address _user, uint256 _pid) public view returns (
        uint256 allowance,
        uint256 inBalance,
        uint256 inRemaining,
        uint256 outAvailable,
        uint256 endEpoch,
        TradeInfo[] memory trades
    ) {
        PoolInfo memory pool = poolInfo[_pid];
        UserInfo memory user = userInfo[_pid][_user];

        allowance = pool.inToken.allowance(_user, address(this));
        inBalance = pool.inToken.balanceOf(_user);
        inRemaining = user.inPerEpoch * (user.endEpoch - _getNextEpoch());
        outAvailable = poolEpochInfo[_pid][_getPrevEpoch()].outPerShare - user.outDebt;
        endEpoch = user.endEpoch;

        uint256 epochsCount = _getPrevEpoch() - user.startEpoch;
        trades = new TradeInfo[](epochsCount);
        for (uint256 i = 0; i < epochsCount; i++) {
            trades[i] = TradeInfo({
                epoch: i + user.startEpoch,
                userIn: user.inPerEpoch,
                userOut: poolEpochInfo[_pid][i + user.startEpoch].tradeOutAmount * user.inPerEpoch / poolEpochInfo[_pid][i + user.startEpoch].tradeInAmount
            });
        }
    }


    // FETCH - POOL INFO
    // params: pool
    // return:
    //      in address
    //      out address
    //      swap path
    //      max trade slippage
    function fetchPoolInfo(uint256 _pid) public view returns(
        address inToken,
        address outToken,
        address[] memory swapPath,
        uint256 maxSlippage
    ) {
        PoolInfo memory pool = poolInfo[_pid];

        inToken = address(pool.inToken);
        outToken = address(pool.outToken);
        swapPath = pool.swapPath;
        maxSlippage = pool.maxSlippage;
    }
}
