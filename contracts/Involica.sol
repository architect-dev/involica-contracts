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

    mapping(address => Position) public positions;
    mapping(address => UserTx[]) public userTxs;
    mapping(address => uint256) public userTreasuries;

    EnumerableSet.AddressSet allowedTokens;
    mapping(address => mapping(address => bool)) public blacklistedPairs;
    uint256 public minSlippage = 25;
    uint256 public override txFee = 10;
    address public resolver;
    address public involicaTreasury;

    IUniswapV2Router public immutable uniRouter;
    address public constant override NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable weth;

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
        address _out,
        uint256 _amount,
        uint256 _weight,
        address[] memory _route
    ) internal view returns (bool) {
        if (_tokenIn != _route[0] || _out != _route[_route.length - 1]) return false;
        try uniRouter.getAmountsOut((_amount * _weight) / 10_000, _route) {
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
    }

    function withdrawTreasury(uint256 _amount) public nonReentrant {
        require(_amount > 0, '_amount must be > 0');
        require(_amount <= userTreasuries[msg.sender], 'Bad withdraw');
        _withdrawTreasury(_amount);
    }

    function exitPosition() public positionExists nonReentrant {
        Position storage position = positions[msg.sender];
        _withdrawTreasury(userTreasuries[msg.sender]);
        _clearTask(position);
        delete positions[msg.sender];

        emit ExitPosition(msg.sender);
    }

    function _withdrawTreasury(uint256 _amount) internal {
        (bool success, ) = payable(msg.sender).call{value: _amount}('');
        require(success, 'ETH transfer failed');
        userTreasuries[msg.sender] -= _amount;

        emit WithdrawTreasury(msg.sender, _amount);
    }

    // POSITION MANAGEMENT

    // Only for initial creation
    function createAndFundPosition(
        address _recipient,
        address _tokenIn,
        PositionOut[] memory _outs,
        uint256 _amountDCA,
        uint256 _intervalDCA,
        uint256 _maxGasPrice,
        bool _executeImmediately
    ) public payable {
        require(positions[msg.sender].user == address(0), 'User already has a position');
        // Treasury is checked in setPosition, msg.value doesn't need to be validated here
        userTreasuries[msg.sender] += msg.value;
        emit DepositTreasury(msg.sender, msg.value);
        setPosition(
            _recipient,
            _tokenIn,
            _outs,
            _amountDCA,
            _intervalDCA,
            _maxGasPrice,
            _executeImmediately,
            false // Cannot create manual position and add treasury
        );
    }

    // Update position or create manual position
    function setPosition(
        address _recipient,
        address _tokenIn,
        PositionOut[] memory _outs,
        uint256 _amountDCA,
        uint256 _intervalDCA,
        uint256 _maxGasPrice,
        bool _executeImmediately,
        bool _manualExecutionOnly
    ) public whenNotPaused nonReentrant {
        require(_manualExecutionOnly || userTreasuries[msg.sender] > 0, 'Treasury must not be 0');
        require(_amountDCA > 0, 'DCA amount must be > 0');
        require(_intervalDCA >= 60, 'DCA interval must be >= 60s');
        require(_outs.length <= 8, 'No more than 8 out tokens');
        require(_maxGasPrice >= 3e9, 'Max gas price must be >= 3 gwei');

        Position storage position = positions[msg.sender];

        // Handle deposit
        require(allowedTokens.contains(_tokenIn), 'Token is not allowed');

        // Set Data
        position.user = msg.sender;
        position.tokenIn = _tokenIn;

        // Validate balance / approval + wallet balance can cover at least 1 DCA
        if (!_manualExecutionOnly) {
            require(IERC20(_tokenIn).allowance(msg.sender, address(this)) >= _amountDCA, 'Approve for at least 1 DCA');
            require(IERC20(_tokenIn).balanceOf(msg.sender) >= _amountDCA, 'Wallet balance for at least 1 DCA');
        }

        position.manualExecutionOnly = _manualExecutionOnly;
        position.amountDCA = _amountDCA;
        position.intervalDCA = _intervalDCA;
        position.maxGasPrice = _maxGasPrice;
        position.recipient = _recipient == address(0) ? msg.sender : _recipient;

        // Add tokens to position
        delete position.outs;
        uint256 weightsSum = 0;
        address out;
        for (uint256 i = 0; i < _outs.length; i++) {
            out = _outs[i].token;
            require(out != _tokenIn, 'Same token both sides of pair');
            require(allowedTokens.contains(out), 'Token is not allowed');
            require(!blacklistedPairs[_tokenIn][out], 'Pair is blacklisted');
            require(_outs[i].maxSlippage >= minSlippage && _outs[i].maxSlippage < 10_000, 'Invalid slippage');
            require(_outs[i].weight > 0, 'Non zero weight');
            weightsSum += _outs[i].weight;
            position.outs.push(PositionOut({token: out, weight: _outs[i].weight, maxSlippage: _outs[i].maxSlippage}));
        }
        require(weightsSum == 10_000, 'Weights do not sum to 10000');

        emit SetPosition(
            msg.sender,
            position.recipient,
            _tokenIn,
            position.outs,
            _amountDCA,
            _intervalDCA,
            _maxGasPrice,
            _manualExecutionOnly
        );

        if (!_manualExecutionOnly) {
            // Initialize task if it doesn't already exist
            _initializeTask(positions[msg.sender]);
            _bringLastDCACurrent(positions[msg.sender], _executeImmediately);
        } else {
            // Clear existing task if necessary
            _clearTask(positions[msg.sender]);
        }
    }

    function pausePosition(bool _paused) public whenNotPaused nonReentrant {
        Position storage position = positions[msg.sender];
        require(position.user != address(0), 'User doesnt have a position');
        position.paused = _paused;

        emit PausePosition(msg.sender, _paused);
    }

    function _initializeTask(Position storage _position) internal {
        // Early exit if task already exists
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

        emit InitializeTask(_position.user, _position.taskId);
    }

    function _clearTask(Position storage _position) internal {
        // Early exit if task doesnt exist
        if (_position.taskId == bytes32(0)) return;

        emit ClearTask(_position.user, _position.taskId);

        IOps(ops).cancelTask(_position.taskId);
        _position.lastDCA = 0;
        _position.taskId = bytes32(0);
    }

    function _bringLastDCACurrent(Position storage _position, bool _executeImmediately) internal {
        // Early exit if block.timestamp is already within last interval range
        if (_position.lastDCA != 0 && block.timestamp >= (_position.lastDCA - _position.intervalDCA)) return;

        // If execute immediately, set lastDCA back to instantly mature position
        _position.lastDCA = block.timestamp - (_executeImmediately ? _position.intervalDCA : 0);
    }

    // DCA EXECUTION

    function dcaRevertCondition(address _user, uint256 _opsFee)
        public
        view
        override
        returns (bool reverted, string memory revertMsg)
    {
        return _dcaRevertCondition(_user, _opsFee);
    }

    function _dcaRevertCondition(address _user, uint256 _opsFee)
        internal
        view
        returns (bool reverted, string memory revertMsg)
    {
        Position storage position = positions[_user];

        if (_user == address(0) || position.user != _user) {
            return (true, 'User doesnt have a position');
        }
        if (msg.sender != _user && block.timestamp < (position.lastDCA + position.intervalDCA)) {
            return (true, 'DCA not mature');
        }
        if (!position.manualExecutionOnly && position.maxGasPrice < tx.gasprice) {
            return (true, 'Gas too expensive');
        }

        // Funds must be approved for this tx
        if (IERC20(position.tokenIn).allowance(position.user, address(this)) < position.amountDCA) {
            return (true, 'Insufficient allowance');
        }

        // Must be enough wallet balance for this
        if (IERC20(position.tokenIn).balanceOf(position.user) < position.amountDCA) {
            return (true, 'Insufficient balance');
        }

        if (_opsFee > 0) {
            if (userTreasuries[position.user] < _opsFee) {
                return (true, 'Treasury out of gas');
            }
        }

        return (false, '');
    }

    function executeDCA(
        address _user,
        uint256 tokenInPrice,
        address[][] calldata swapsRoutes,
        uint256[] calldata swapsAmountOutMin,
        uint256[] calldata outPrices
    ) public override whenNotPaused nonReentrant {
        require(msg.sender == ops || msg.sender == _user, 'Only GelatoOps or User can Execute DCA');
        Position storage position = positions[_user];

        uint256 opsFee;
        if (msg.sender == ops) {
            (opsFee, ) = IOps(ops).getFeeDetails();
        }

        (bool reverted, string memory revertMsg) = _dcaRevertCondition(_user, opsFee);
        require(!reverted, revertMsg);

        // Validate call data
        require(position.outs.length == swapsRoutes.length, 'Routes for swaps is invalid');
        require(position.outs.length == swapsAmountOutMin.length, 'AmountOut for swaps is invalid');
        require(position.outs.length == outPrices.length, 'OutPrices for swaps is invalid');

        if (opsFee > 0) {
            // Send Gelato Fee
            _transfer(opsFee, NATIVE_TOKEN);

            // Take transaction fee out of users treasury
            userTreasuries[_user] -= opsFee;
        }

        // Withdraw funds from user wallet for DCA
        _setupDCA(position);

        // Perform swaps
        _executeDCASwaps(position, tokenInPrice, swapsRoutes, swapsAmountOutMin);

        // Send unused in and all swapped outs back to users wallet
        _finalizeDCA(position, msg.sender == _user, tokenInPrice, outPrices);
    }

    uint256 activeTxAmountSwapped = 0;
    uint256 activeTxFeeTaken = 0;

    function _setupDCA(Position storage position) internal {
        IERC20(position.tokenIn).safeTransferFrom(position.user, address(this), position.amountDCA);
        activeTxAmountSwapped = 0;
        activeTxFeeTaken = 0;
    }

    function _executeDCASwaps(
        Position storage position,
        uint256 tokenInPrice,
        address[][] memory swapsRoutes,
        uint256[] memory swapsAmountOutMin
    ) internal {
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
        bool validRoute;
        string memory swapErrReason;
        bool swapErr;
        for (uint256 i = 0; i < position.outs.length; i++) {
            validPair = _validPair(position.tokenIn, position.outs[i].token);
            validRoute = _validRoute(
                position.tokenIn,
                position.outs[i].token,
                position.amountDCA,
                position.outs[i].weight,
                swapsRoutes[i]
            );

            if (!validPair || !validRoute) {
                userTx.tokenTxs.push(
                    UserTokenTx({
                        tokenIn: position.tokenIn,
                        tokenInPrice: tokenInPrice,
                        tokenOut: position.outs[i].token,
                        amountIn: 0,
                        amountOut: 0,
                        err: !validPair ? 'Invalid pair' : 'Invalid route'
                    })
                );
                continue;
            }

            (amounts, swapErr, swapErrReason) = _swap(
                position.recipient,
                (position.amountDCA * position.outs[i].weight * (10_000 - txFee)) / (10_000 * 10_000),
                swapsAmountOutMin[i],
                swapsRoutes[i]
            );

            if (swapErr) {
                userTx.tokenTxs.push(
                    UserTokenTx({
                        tokenIn: position.tokenIn,
                        tokenInPrice: tokenInPrice,
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
                    tokenInPrice: tokenInPrice,
                    tokenOut: position.outs[i].token,
                    amountIn: amounts[0],
                    amountOut: amounts[amounts.length - 1],
                    err: ''
                })
            );
        }
    }

    function _swap(
        address _recipient,
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
        try uniRouter.swapExactTokensForTokens(_amountIn, _amountOutMin, _path, _recipient, block.timestamp) returns (
            uint256[] memory _amounts
        ) {
            amounts = _amounts;
            err = false;
        } catch Error(string memory _errReason) {
            errReason = _errReason;
            err = true;
        }
    }

    function _finalizeDCA(
        Position storage position,
        bool manualExecution,
        uint256 tokenInPrice,
        uint256[] memory outPrices
    ) internal {
        UserTx storage userTx = userTxs[position.user][userTxs[position.user].length - 1];

        // Transfer swap out tokens to user's wallet, populate
        address[] memory tokens = new address[](userTx.tokenTxs.length);
        uint256[] memory amounts = new uint256[](userTx.tokenTxs.length);
        for (uint256 i = 0; i < userTx.tokenTxs.length; i++) {
            tokens[i] = userTx.tokenTxs[i].tokenOut;
            amounts[i] = userTx.tokenTxs[i].amountOut;
        }

        // Take any fee
        if (activeTxFeeTaken > 0) {
            IERC20(position.tokenIn).safeTransfer(involicaTreasury, activeTxFeeTaken);
            userTxs[position.user][userTxs[position.user].length - 1].txFee = activeTxFeeTaken;
        }

        // Return unused funds from failed swaps
        if ((activeTxAmountSwapped + activeTxFeeTaken) < position.amountDCA) {
            IERC20(position.tokenIn).safeTransfer(
                position.user,
                position.amountDCA - (activeTxAmountSwapped + activeTxFeeTaken)
            );
        }

        // If lastDCA was before the previous interval, snap it current to prevent instant sequential DCAS while catching up
        // This would happen if treasury/balance/allowance began reverting DCA executions for an extended period of time
        if (msg.sender == ops) {
            if (position.lastDCA < (block.timestamp - position.intervalDCA - position.intervalDCA)) {
                position.lastDCA = block.timestamp;
            }
            // Else last DCA was within the previous interval, add interval instead of snapping to prevent execution drift
            else {
                position.lastDCA += position.intervalDCA;
            }
        }

        emit ExecuteDCA(
            position.user,
            position.recipient,
            position.tokenIn,
            manualExecution,
            tokenInPrice,
            activeTxAmountSwapped,
            tokens,
            amounts,
            outPrices,
            activeTxFeeTaken
        );
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

    // PUBLIC

    function fetchUniRouter() public view override returns (address) {
        return address(uniRouter);
    }

    function fetchAllowedTokens() public view override returns (address[] memory) {
        return allowedTokens.values();
    }

    function fetchAllowedToken(uint256 i) public view override returns (address) {
        return allowedTokens.at(i);
    }

    function fetchUserTreasury(address user) public view override returns (uint256) {
        return userTreasuries[user];
    }

    function fetchUserPosition(address user) public view override returns (Position memory) {
        return positions[user];
    }

    function fetchUserTxs(address user) public view override returns (UserTx[] memory) {
        return userTxs[user];
    }
}
