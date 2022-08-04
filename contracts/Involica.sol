// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/security/Pausable.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import './external/OpsReady.sol';
import './interfaces/IInvolica.sol';
import './interfaces/IUniswapV2Router.sol';
import './interfaces/IWETH.sol';
import './interfaces/IERC20Ext.sol';

/*


 __                    _                
/  |                  | |  o            
   |  _  _        __  | |     __    __  
   | / |/ | /|  |/  \ |/   | /     /  | 
 (_|/  |  |_  \/ \__//|__//|_\___//\_/|_

- by Architect



DCA into a full portfolio effortlessly

DCA, or Dollar Cost Averaging, is the practice of regularly buying assets
over a long duration to reduce exposure to market volatility.

Involica has a 0.05% fee on trade to keep the lights on.


*/

contract Involica is OpsReady, IInvolica, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    EnumerableSet.AddressSet usersWithPositions;
    mapping(address => Position) public positions;
    mapping(address => UserTx[]) public userTxs;
    mapping(address => uint256) public userTreasuries;

    EnumerableSet.AddressSet allowedTokens;
    mapping(address => mapping(address => bool)) public blacklistedPairs;
    uint256 public minSlippage = 25;
    uint256 public txFee = 5;
    address public resolver;
    address public involicaTreasury;

    IUniswapV2Router public immutable uniRouter;
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable weth;

    uint256 activeTxAmountSwapped = 0;
    uint256 activeTxFeeTaken = 0;

    receive() external payable {}

    constructor(
        address _involicaTreasury,
        address payable _ops,
        address _uniRouter,
        address _weth
    ) OpsReady(_ops) {
        involicaTreasury = _involicaTreasury;
        uniRouter = IUniswapV2Router(_uniRouter);
        weth = _weth;

        _setAllowedToken(_weth, true);
    }

    // VALIDATORS

    modifier positionExists() {
        require(positions[msg.sender].user == msg.sender, 'User doesnt have a position');
        _;
    }

    function _validPair(address _in, address _out) internal view returns (bool) {
        return (allowedTokens.contains(_in) &&
            allowedTokens.contains(_out) &&
            _in != _out &&
            !blacklistedPairs[_in][_out]);
    }

    function _validRoute(
        address _tokenIn,
        uint256 _amountIn,
        address _out,
        TokenOutParams memory _tokenOut
    ) internal view returns (bool) {
        if (_tokenIn != _tokenOut.route[0] || _out != _tokenOut.route[_tokenOut.route.length - 1]) return false;
        try uniRouter.getAmountsOut((_amountIn * _tokenOut.weight) / 10_000, _tokenOut.route) {
            return true;
        } catch {
            return false;
        }
    }

    // TREASURY MANAGEMENT

    function depositTreasury() public payable whenNotPaused nonReentrant {
        require(msg.value > 0, 'msg.value must be > 0');
        userTreasuries[msg.sender] += msg.value;

        emit DepositTreasury(msg.sender, msg.value);

        _checkAndInitializeTask(positions[msg.sender]);
    }

    function withdrawTreasury(uint256 _amount) public nonReentrant {
        require(_amount > 0, '_amount must be > 0');
        require(_amount <= userTreasuries[msg.sender], 'Bad withdraw');
        _withdrawTreasury(_amount);

        _checkAndFinalizeTask(positions[msg.sender], 0);
    }

    function _withdrawTreasury(uint256 _amount) internal {
        (bool success, ) = payable(msg.sender).call{value: _amount}('');
        require(success, 'ETH transfer failed');
        userTreasuries[msg.sender] -= _amount;
        emit WithdrawTreasury(msg.sender, _amount);
    }

    // POSITION MANAGEMENT

    function setPosition(
        address _tokenIn,
        TokenOutParams[] memory _outs,
        uint256 _amountDCA,
        uint256 _intervalDCA,
        uint256 _maxGasPrice
    ) public payable whenNotPaused nonReentrant {
        require(userTreasuries[msg.sender] > 0, 'Treasury must not be 0');
        require(_amountDCA > 0, 'DCA amount must be > 0');
        require(_intervalDCA >= 60, 'DCA interval must be > 60s');

        usersWithPositions.add(msg.sender);
        Position storage position = positions[msg.sender];

        // Handle deposit
        require(allowedTokens.contains(_tokenIn), 'Token is not allowed');

        // Set Data
        position.user = msg.sender;
        position.tokenIn = _tokenIn;

        // Validate balance / approval + wallet balance can cover at least 1 DCA
        require(IERC20(_tokenIn).allowance(msg.sender, address(this)) >= _amountDCA, 'Approve for at least 1 DCA');
        require(IERC20(_tokenIn).balanceOf(msg.sender) >= _amountDCA, 'Wallet balance for at least 1 DCA');

        position.amountDCA = _amountDCA;
        position.intervalDCA = _intervalDCA;
        position.maxGasPrice = _maxGasPrice * 1 gwei;

        // Add tokens to position
        delete position.outs;
        uint256 weightsSum = 0;
        address out;
        for (uint256 i = 0; i < _outs.length; i++) {
            out = _outs[i].token;
            require(out != _tokenIn, 'Same token both sides of pair');
            require(allowedTokens.contains(out), 'Token is not allowed');
            require(!blacklistedPairs[_tokenIn][out], 'Pair is blacklisted');
            require(_outs[i].maxSlippage >= minSlippage, 'Invalid slippage');
            require(_outs[i].weight > 0, 'Non zero weight');
            require(_validRoute(_tokenIn, position.amountDCA, out, _outs[i]), 'Invalid route');
            weightsSum += _outs[i].weight;
            position.outs.push(
                PositionOut({
                    token: out,
                    weight: _outs[i].weight,
                    route: _outs[i].route,
                    maxSlippage: _outs[i].maxSlippage
                })
            );
        }
        require(weightsSum == 10_000, 'Weights do not sum to 10000');

        emit SetPosition(msg.sender, _tokenIn, position.outs, _amountDCA, _intervalDCA, _maxGasPrice);

        // New position needs to be initialized (must call from array of positions to persist taskId)
        _checkAndInitializeTask(positions[msg.sender]);
    }

    function reInitPosition() public whenNotPaused positionExists nonReentrant {
        Position storage position = positions[msg.sender];

        require(position.taskId == bytes32(0), 'Task already initialized');
        require(userTreasuries[msg.sender] > 0, 'Treasury must not be 0');
        require(
            IERC20(position.tokenIn).allowance(msg.sender, address(this)) >= position.amountDCA,
            'Approve for at least 1 DCA'
        );
        require(
            IERC20(position.tokenIn).balanceOf(msg.sender) >= position.amountDCA,
            'Wallet balance for at least 1 DCA'
        );

        _checkAndInitializeTask(position);
    }

    function exitPosition() public positionExists nonReentrant {
        Position storage position = positions[msg.sender];

        // Remove treasury
        _withdrawTreasury(userTreasuries[msg.sender]);

        // Stop task
        _finalizeTask(position, 'User exited');

        // Clear data
        position.user = address(0);
        usersWithPositions.remove(msg.sender);

        emit ExitPosition(msg.sender);
    }

    // TASK MANAGEMENT

    function _checkAndInitializeTask(Position storage _position) internal {
        if (_position.user == address(0)) return;
        if (_position.taskId != bytes32(0)) return;

        _position.taskId = IOps(ops).createTimedTask(
            0,
            uint128(_position.intervalDCA),
            address(this),
            this.executeDCA.selector,
            resolver,
            abi.encodeWithSelector(IInvolicaResolver(resolver).checkPositionExecutable.selector, _position.user),
            NATIVE_TOKEN,
            false
        );

        _position.finalizationReason = '';
        _position.lastDCA = 0;

        emit InitializeTask(_position.user, _position.taskId);
    }

    function _checkAndFinalizeTask(Position storage _position, uint256 _txFee) internal returns (bool finalize) {
        // Funds must be approved for this contract
        if (
            _position.tokenIn != address(0) &&
            IERC20(_position.tokenIn).allowance(_position.user, address(this)) < _position.amountDCA
        ) {
            _finalizeTask(_position, 'Insufficient approval to pull from wallet');
            return true;
        }

        // Must be enough funds for DCA
        if (
            _position.tokenIn != address(0) && IERC20(_position.tokenIn).balanceOf(_position.user) < _position.amountDCA
        ) {
            _finalizeTask(_position, 'Insufficient funds to pull from wallet');
            return true;
        }

        if (userTreasuries[_position.user] == 0 || userTreasuries[_position.user] < _txFee) {
            if (_txFee > 0) {
                // Tx has fee, but isn't covered by user's treasury, empty to zero
                userTreasuries[_position.user] = 0;
            }

            _finalizeTask(_position, 'Treasury out of gas');
            return true;
        }

        return false;
    }

    function _finalizeTask(Position storage _position, string memory _reason) internal {
        if (_position.taskId == bytes32(0)) return;

        IOps(ops).cancelTask(_position.taskId);
        _position.taskId = bytes32(0);
        _position.finalizationReason = _reason;

        emit FinalizeTask(_position.user, _reason);
    }

    // DCA EXECUTION

    function executeDCA(address _user, uint256[] calldata swapsAmountOutMin)
        public
        override
        whenNotPaused
        nonReentrant
    {
        require(msg.sender == ops || msg.sender == _user, 'Only GelatoOps or User can Execute DCA');

        Position storage position = positions[_user];
        require(position.user == _user, 'User doesnt have a position');
        require(block.timestamp >= position.lastDCA + position.intervalDCA, 'DCA not mature');
        position.lastDCA = block.timestamp;

        // Validate extraData length
        require(position.outs.length == swapsAmountOutMin.length, 'Invalid extra data');

        (uint256 fee, ) = IOps(ops).getFeeDetails();
        _transfer(fee, NATIVE_TOKEN);

        // Check if tx will fail or treasury won't cover gas
        bool finalized = _checkAndFinalizeTask(position, fee);
        // Exit if tx will fail
        if (finalized) return;

        // Take transaction fee out of users treasury
        userTreasuries[_user] -= fee;

        // Withdraw funds from user wallet for DCA
        _setupDCA(position);

        // Perform swaps
        _executeDCASwaps(position, swapsAmountOutMin);

        // Send unused in and all swapped outs back to users wallet
        _finalizeDCA(position);
    }

    function _setupDCA(Position storage position) internal {
        IERC20(position.tokenIn).safeTransferFrom(position.user, address(this), position.amountDCA);
        activeTxAmountSwapped = 0;
        activeTxFeeTaken = 0;
    }

    function _executeDCASwaps(Position storage position, uint256[] memory swapsAmountOutMin) internal {
        // Approve swap in amount
        IERC20(position.tokenIn).approve(address(uniRouter), position.amountDCA);

        // Set up tx receipt storage
        userTxs[position.user].push();
        UserTx storage userTx = userTxs[position.user][userTxs[position.user].length - 1];
        userTx.timestamp = block.timestamp;
        userTx.tokenIn = position.tokenIn;

        // Execute individual token swaps
        uint256[] memory amounts;
        bool validPair;
        string memory swapErrReason;
        bool swapErr;
        for (uint256 i = 0; i < position.outs.length; i++) {
            validPair = _validPair(position.tokenIn, position.outs[i].token);

            if (!validPair) {
                userTx.tokenTxs.push(
                    UserTokenTx({
                        tokenIn: position.tokenIn,
                        tokenOut: position.outs[i].token,
                        amountIn: 0,
                        amountOut: 0,
                        err: 'Invalid pair'
                    })
                );
                continue;
            }

            (amounts, swapErr, swapErrReason) = _swap(
                (position.amountDCA * position.outs[i].weight * (10_000 - txFee)) / (10_000 * 10_000),
                swapsAmountOutMin[i],
                position.outs[i].route
            );

            if (swapErr) {
                userTx.tokenTxs.push(
                    UserTokenTx({
                        tokenIn: position.tokenIn,
                        tokenOut: position.outs[i].token,
                        amountIn: 0,
                        amountOut: 0,
                        err: swapErrReason
                    })
                );
                continue;
            }

            activeTxFeeTaken += (position.amountDCA * position.outs[i].weight * txFee) / (10_000 * 10_000);
            activeTxAmountSwapped += amounts[0];

            userTx.tokenTxs.push(
                UserTokenTx({
                    tokenIn: position.tokenIn,
                    tokenOut: position.outs[i].token,
                    amountIn: amounts[0],
                    amountOut: amounts[amounts.length - 1],
                    err: ''
                })
            );
        }
    }

    function _swap(
        uint256 _amountIn,
        uint256 _amountOutMin,
        address[] memory _path
    )
        internal
        returns (
            uint256[] memory amounts,
            bool err,
            string memory errReason
        )
    {
        try
            uniRouter.swapExactTokensForTokens(_amountIn, _amountOutMin, _path, address(this), block.timestamp)
        returns (uint256[] memory _amounts) {
            amounts = _amounts;
            err = false;
        } catch Error(string memory _errReason) {
            errReason = _errReason;
            err = true;
        }
    }

    function _finalizeDCA(Position storage position) internal {
        UserTx storage userTx = userTxs[position.user][userTxs[position.user].length - 1];

        // Transfer swap out tokens to user's wallet, populate 
        address[] memory tokens = new address[](userTx.tokenTxs.length);
        uint256[] memory amounts = new uint256[](userTx.tokenTxs.length);
        for (uint256 i = 0; i < userTx.tokenTxs.length; i++) {
            tokens[i] = userTx.tokenTxs[i].tokenOut;
            amounts[i] = userTx.tokenTxs[i].amountOut;
            if (amounts[i] > 0) {
                IERC20(tokens[i]).safeTransfer(position.user, amounts[i]);
            }
        }

        // Take any fee
        if (activeTxFeeTaken > 0) {
            IERC20(position.tokenIn).safeTransfer(involicaTreasury, activeTxFeeTaken);
            userTxs[position.user][userTxs[position.user].length - 1].txFee = activeTxFeeTaken;
        }

        // Return unused funds from failed swaps
        if ((activeTxAmountSwapped + activeTxFeeTaken) < position.amountDCA) {
            IERC20(position.tokenIn).safeTransfer(position.user, position.amountDCA - (activeTxAmountSwapped + activeTxFeeTaken));
        }

        emit FinalizeDCA(position.user, position.tokenIn, activeTxAmountSwapped, tokens, amounts, activeTxFeeTaken);
    }

    // ADMINISTRATION

    function setInvolicaTreasury(address _treasury) public onlyOwner {
        require(_treasury != address(0), 'Missing treasury');
        involicaTreasury = _treasury;
        emit SetInvolicaTreasury(_treasury);
    }

    function setInvolicaTxFee(uint256 _txFee) public onlyOwner {
        require(_txFee <= 30, 'Invalid txFee');
        txFee = _txFee;
        activeTxFeeTaken = 0; // Reset this value here so it doesnt have to happen every DCA
        emit SetInvolicaTxFee(_txFee);
    }

    function setResolver(address _resolver) public onlyOwner {
        require(_resolver != address(0), 'Missing resolver');
        resolver = _resolver;
        emit SetResolver(_resolver);
    }

    function setPaused(bool _setPause) public onlyOwner {
        if (_setPause) _pause();
        else _unpause();
        emit SetPaused(_setPause);
    }

    function setAllowedTokens(address[] calldata _tokens, bool[] calldata _alloweds) public onlyOwner {
        require(_tokens.length == _alloweds.length, 'Invalid length');

        for (uint256 i = 0; i < _tokens.length; i++) {
            _setAllowedToken(_tokens[i], _alloweds[i]);
        }
    }

    function _setAllowedToken(address _token, bool _allowed) internal {
        if (_allowed) allowedTokens.add(_token);
        else allowedTokens.remove(_token);
        emit SetAllowedToken(_token, _allowed);
    }

    function setBlacklistedPairs(address[] calldata _tokens, bool[] calldata _blacklisteds) public onlyOwner {
        require(_tokens.length == (_blacklisteds.length * 2), 'Invalid length');

        for (uint256 i = 0; i < _blacklisteds.length; i++) {
            _setBlacklistedPairs(_tokens[i * 2], _tokens[i * 2 + 1], _blacklisteds[i]);
        }
    }

    function _setBlacklistedPairs(
        address _tokenA,
        address _tokenB,
        bool _blacklisted
    ) internal {
        blacklistedPairs[_tokenA][_tokenB] = _blacklisted;
        emit SetBlacklistedPair(_tokenA, _tokenB, _blacklisted);
    }

    function setMinSlippage(uint256 _minSlippage) public onlyOwner {
        require(minSlippage != _minSlippage, 'Same slippage value');
        require(_minSlippage <= 1000, 'Min slippage too large');
        minSlippage = _minSlippage;
        emit MinSlippageSet(_minSlippage);
    }

    // FRONTEND FETCH HELPERS

    function fetchAllowedTokens() public view returns (address[] memory tokens) {
        tokens = allowedTokens.values();
    }

    function fetchUserData(address _user)
        public
        view
        returns (
            bool userHasPosition,
            uint256 userTreasury,
            Position memory position,
            uint256 allowance,
            uint256 balance,
            uint256 dcasRemaining,
            UserTx[] memory txs,
            UserTokenData[] memory tokens
        )
    {
        userHasPosition = usersWithPositions.contains(_user);

        userTreasury = userTreasuries[_user];

        position = positions[_user];

        // Fetch wallet allowance and balance
        if (userHasPosition) {
            allowance = IERC20(position.tokenIn).allowance(position.user, address(this));
            balance = IERC20(position.tokenIn).balanceOf(position.user);
            uint256 limitedValue = allowance < balance ? allowance : balance;
            dcasRemaining = position.amountDCA > 0 ? limitedValue / position.amountDCA : 0;
        }

        txs = userTxs[_user];

        tokens = new UserTokenData[](allowedTokens.length());
        for (uint256 i = 0; i < allowedTokens.length(); i++) {
            tokens[i] = UserTokenData({
                token: allowedTokens.at(i),
                allowance: IERC20(allowedTokens.at(i)).allowance(_user, address(this)),
                balance: IERC20(allowedTokens.at(i)).balanceOf(_user)
            });
        }
    }

    function fetchPosition(address _user) public view override returns (Position memory) {
        return positions[_user];
    }
}
