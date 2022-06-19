// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./external/OpsReady.sol";
import "./interfaces/IInvolica.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./external/IWETH.sol";
import "./interfaces/IERC20Ext.sol";
import "hardhat/console.sol";

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

The involica service is provided with no fee, no token required to use, and no tax.


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
    address public resolver;

    IUniswapV2Router public immutable uniRouter;
    address public constant NATIVE_TOKEN =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable weth;

    receive() external payable {}

    constructor(
        address payable _ops,
        address _uniRouter,
        address _weth
    ) OpsReady(_ops) {
        uniRouter = IUniswapV2Router(_uniRouter);
        weth = _weth;

        _setAllowedToken(NATIVE_TOKEN, true);
        _setAllowedToken(_weth, true);
    }

    // VALIDATORS

    modifier positionExists() {
        require(
            positions[msg.sender].user == msg.sender,
            "User doesnt have a position"
        );
        _;
    }

    modifier notFromWalletPosition() {
        require(
            !positions[msg.sender].fromWallet,
            "Must not be fromWallet position"
        );
        _;
    }

    function _validPair(address _in, address _out)
        internal
        view
        returns (bool)
    {
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
        if (
            _tokenIn != _tokenOut.route[0] ||
            _out != _tokenOut.route[_tokenOut.route.length - 1]
        ) return false;
        try
            uniRouter.getAmountsOut(
                (_amountIn * _tokenOut.weight) / 10_000,
                _tokenOut.route
            )
        {
            return true;
        } catch {
            return false;
        }
    }

    // TREASURY MANAGEMENT

    function depositTreasury() public payable whenNotPaused nonReentrant {
        require(msg.value > 0, "msg.value must be > 0");
        userTreasuries[msg.sender] += msg.value;

        emit DepositTreasury(msg.sender, msg.value);

        _checkAndInitializeTask(positions[msg.sender]);
    }

    function withdrawTreasury(uint256 _amount) public nonReentrant {
        require(_amount > 0, "_amount must be > 0");
        require(_amount <= userTreasuries[msg.sender], "Bad withdraw");
        _withdrawTreasury(_amount);

        _checkAndFinalizeTask(positions[msg.sender], 0);
    }

    function _withdrawTreasury(uint256 _amount) internal {
        (bool success, ) = payable(msg.sender).call{value: _amount}("");
        require(success, "ETH transfer failed");
        userTreasuries[msg.sender] -= _amount;
        emit WithdrawTreasury(msg.sender, _amount);
    }

    // POSITION MANAGEMENT

    function setPosition(
        bool _fromWallet,
        address _tokenIn,
        TokenOutParams[] memory _outs,
        uint256 _amountIn,
        uint256 _amountDCA,
        uint256 _intervalDCA,
        uint256 _maxGasPrice
    ) public payable whenNotPaused nonReentrant {
        require(userTreasuries[msg.sender] > 0, "Treasury must not be 0");
        require(_amountDCA > 0, "DCA amount must be > 0");
        require(_intervalDCA >= 60, "DCA interval must be > 60s");
        require(
            !_fromWallet || _tokenIn != NATIVE_TOKEN,
            "Cannot use the Native Token for a fromWallet position"
        );

        usersWithPositions.add(msg.sender);
        Position storage position = positions[msg.sender];

        // Handle deposit
        uint256 amountIn = 0;
        address tokenIn = _tokenIn;
        if (_tokenIn == NATIVE_TOKEN) {
            tokenIn = weth;
            IWETH(weth).deposit{value: msg.value}();
            amountIn = msg.value;
        } else if (!_fromWallet) {
            require(msg.value == 0, "Not native token deposit");
            IERC20(_tokenIn).safeTransferFrom(
                msg.sender,
                address(this),
                _amountIn
            );
            amountIn = _amountIn;
        }
        require(allowedTokens.contains(tokenIn), "Token is not allowed");

        // Clean up previous position if it exists and wasn't a fromWallet position
        if (position.user == msg.sender && !position.fromWallet) {
            // Remove previous tokenIn if differs
            if (tokenIn != position.tokenIn && position.balanceIn > 0) {
                _withdrawIn(position, position.balanceIn);
            }

            _withdrawOuts(position);
        }

        // Set Data
        position.user = msg.sender;
        position.fromWallet = _fromWallet;
        position.tokenIn = tokenIn;

        position.balanceIn += amountIn;
        require(
            position.fromWallet || position.balanceIn >= _amountDCA,
            "Deposit for at least 1 DCA"
        );

        position.amountDCA = _amountDCA;
        position.intervalDCA = _intervalDCA;
        position.maxGasPrice = _maxGasPrice * 1 gwei;

        // Add tokens to position
        delete position.outs;
        uint256 weightsSum = 0;
        address out;
        for (uint256 i = 0; i < _outs.length; i++) {
            out = _outs[i].token;
            if (out == NATIVE_TOKEN) out = weth;
            require(out != tokenIn, "Same token both sides of pair");
            require(allowedTokens.contains(out), "Token is not allowed");
            require(!blacklistedPairs[tokenIn][out], "Pair is blacklisted");
            require(_outs[i].maxSlippage >= minSlippage, "Invalid slippage");
            require(_outs[i].weight > 0, "Non zero weight");
            require(
                _validRoute(tokenIn, position.amountDCA, out, _outs[i]),
                "Invalid route"
            );
            weightsSum += _outs[i].weight;
            position.outs.push(
                PositionOut({
                    token: out,
                    weight: _outs[i].weight,
                    route: _outs[i].route,
                    maxSlippage: _outs[i].maxSlippage,
                    balance: 0
                })
            );
        }
        require(weightsSum == 10_000, "Weights do not sum to 10000");

        emit SetPosition(
            msg.sender,
            _fromWallet,
            tokenIn,
            position.outs,
            _amountDCA,
            _intervalDCA,
            _maxGasPrice
        );
        if (amountIn > 0) emit Deposit(msg.sender, tokenIn, amountIn);

        // New position needs to be initialized (must call from array of positions to persist taskId)
        _checkAndInitializeTask(positions[msg.sender]);
    }

    function depositIn(uint256 _amountIn)
        public
        payable
        whenNotPaused
        positionExists
        notFromWalletPosition
        nonReentrant
    {
        uint256 amountIn;
        if (positions[msg.sender].tokenIn == weth && msg.value > 0) {
            IWETH(weth).deposit{value: msg.value}();
            amountIn = msg.value;
        } else {
            IERC20(positions[msg.sender].tokenIn).safeTransferFrom(
                msg.sender,
                address(this),
                _amountIn
            );
            amountIn = _amountIn;
        }

        require(amountIn > 0, "_amount must be > 0");

        positions[msg.sender].balanceIn += amountIn;

        emit Deposit(msg.sender, positions[msg.sender].tokenIn, amountIn);

        _checkAndInitializeTask(positions[msg.sender]);
    }

    function withdrawIn(uint256 _amount)
        public
        positionExists
        notFromWalletPosition
        nonReentrant
    {
        require(_amount > 0, "_amount must be > 0");
        require(positions[msg.sender].balanceIn >= _amount, "Bad withdraw");
        _withdrawIn(positions[msg.sender], _amount);

        _checkAndFinalizeTask(positions[msg.sender], 0);
    }

    function _withdrawIn(Position storage _position, uint256 _amount) internal {
        _position.balanceIn -= _amount;
        _transferTo(payable(_position.user), _position.tokenIn, _amount);
        emit WithdrawIn(_position.user, _position.tokenIn, _amount);
    }

    function withdrawOuts()
        public
        positionExists
        notFromWalletPosition
        nonReentrant
    {
        _withdrawOuts(positions[msg.sender]);
    }

    function _withdrawOuts(Position storage _position) internal {
        address[] memory tokens = new address[](_position.outs.length);
        uint256[] memory amounts = new uint256[](_position.outs.length);
        for (uint256 i = 0; i < _position.outs.length; i++) {
            tokens[i] = _position.outs[i].token;
            amounts[i] = _position.outs[i].balance;
            if (_position.outs[i].balance > 0) {
                _transferTo(
                    payable(_position.user),
                    _position.outs[i].token,
                    _position.outs[i].balance
                );
                _position.outs[i].balance = 0;
            }
        }
        emit WithdrawOuts(_position.user, tokens, amounts);
    }

    function exitPosition() public positionExists nonReentrant {
        Position storage position = positions[msg.sender];

        // Withdraw tokens if not a fromWallet position
        if (!position.fromWallet) {
            // Remove in token
            if (position.balanceIn > 0) {
                _withdrawIn(position, position.balanceIn);
            }

            // Remove out tokens
            _withdrawOuts(position);
        }

        // Remove treasury
        _withdrawTreasury(userTreasuries[msg.sender]);

        // Stop task
        _finalizeTask(position, "User exited");

        // Clear data
        position.user = address(0);
        usersWithPositions.remove(msg.sender);
    }

    // TASK MANAGEMENT

    function _checkAndInitializeTask(Position storage _position) internal {
        if (_position.user == address(0)) return;
        if (!_position.fromWallet && _position.balanceIn < _position.amountDCA)
            return;
        if (_position.taskId != bytes32(0)) return;
        if (userTreasuries[_position.user] == 0) return;

        _position.taskId = IOps(ops).createTimedTask(
            0,
            uint128(_position.intervalDCA),
            address(this),
            this.executeDCA.selector,
            resolver,
            abi.encodeWithSelector(
                IInvolicaResolver(resolver).checkPositionExecutable.selector,
                _position.user
            ),
            NATIVE_TOKEN,
            false
        );

        _position.finalizationReason = "";
        _position.lastDCA = 0;

        emit InitializeTask(_position.user, _position.taskId);
    }

    function _checkAndFinalizeTask(Position storage _position, uint256 _txFee)
        internal
        returns (bool finalize)
    {
        if (_position.fromWallet) {
            // Funds must be approved for this contract
            if (
                IERC20(_position.tokenIn).allowance(
                    _position.user,
                    address(this)
                ) < _position.amountDCA
            ) {
                _finalizeTask(
                    _position,
                    "Funds to pull from wallet not approved"
                );
                return true;
            }

            // Must be enough funds for DCA
            if (
                IERC20(_position.tokenIn).balanceOf(_position.user) <
                _position.amountDCA
            ) {
                _finalizeTask(
                    _position,
                    "Insufficient funds to pull from wallet"
                );
                return true;
            }
        } else {
            // Funds already in contract
            if (_position.balanceIn < _position.amountDCA) {
                _finalizeTask(_position, "Insufficient funds");
                return true;
            }
        }

        if (userTreasuries[_position.user] == 0 || userTreasuries[_position.user] < _txFee) {
            if (_txFee > 0) {
                // Tx has fee, but isn't covered by user's treasury, empty to zero
                userTreasuries[_position.user] = 0;
            }

            _finalizeTask(_position, "Treasury out of gas");
            return true;
        }

        return false;
    }

    function _finalizeTask(Position storage _position, string memory _reason)
        internal
    {
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
        onlyOps
    {
        Position storage position = positions[_user];
        require(position.user == _user, "User doesnt have a position");
        require(
            block.timestamp >= position.lastDCA + position.intervalDCA,
            "DCA not mature"
        );
        position.lastDCA = block.timestamp;

        // Validate extraData length
        require(
            position.outs.length == swapsAmountOutMin.length,
            "Invalid extra data"
        );

        (uint256 fee, ) = IOps(ops).getFeeDetails();
        _transfer(fee, NATIVE_TOKEN);

        // Check if tx will fail or treasury won't cover gas
        bool finalized = _checkAndFinalizeTask(position, fee);
        // Exit if tx will fail
        if (finalized) return;

        // Take transaction fee out of users treasury
        userTreasuries[_user] -= fee;

        // Withdraw funds from user wallet for DCA (if fromWallet position)
        _setupFromWalletExecution(position);

        // Perform swaps
        _executeDCASwaps(position, swapsAmountOutMin);

        // Send unused in and all swapped outs back to users wallet (if fromWallet position)
        _cleanupFromWalletExecution(position);

        emit ExecuteDCA(_user);
    }

    function _setupFromWalletExecution(Position storage position) internal {
        if (!position.fromWallet) return;

        IERC20(position.tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            position.amountDCA
        );
        position.balanceIn = position.amountDCA;
    }

    function _executeDCASwaps(
        Position storage position,
        uint256[] memory swapsAmountOutMin
    ) internal {
        // Approve swap in amount
        IERC20(position.tokenIn).approve(
            address(uniRouter),
            position.amountDCA
        );

        // Set up tx receipt storage
        userTxs[position.user].push();
        UserTx storage userTx = userTxs[position.user][
            userTxs[position.user].length - 1
        ];
        userTx.timestamp = block.timestamp;

        // Execute individual token swaps
        uint256[] memory amounts;
        bool validPair;
        string memory swapErrReason;
        bool swapErr;
        for (uint256 i = 0; i < position.outs.length; i++) {
            validPair = _validPair(position.tokenIn, position.outs[i].token);
            if (validPair) {
                (amounts, swapErr, swapErrReason) = _swap(
                    (position.amountDCA * position.outs[i].weight) / 10_000,
                    swapsAmountOutMin[i],
                    position.outs[i].route
                );
                if (!swapErr) {
                    position.balanceIn -=
                        (position.amountDCA * position.outs[i].weight) /
                        10_000;
                    position.outs[i].balance += amounts[amounts.length - 1];
                }
            }

            if (!validPair) {
                userTx.tokenTxs.push(
                    UserTokenTx({
                        tokenIn: position.tokenIn,
                        tokenOut: position.outs[i].token,
                        amountIn: 0,
                        amountOut: 0,
                        err: "Invalid pair"
                    })
                );
                continue;
            }

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

            userTx.tokenTxs.push(
                UserTokenTx({
                    tokenIn: position.tokenIn,
                    tokenOut: position.outs[i].token,
                    amountIn: (position.amountDCA * position.outs[i].weight) /
                        10_000,
                    amountOut: amounts[amounts.length - 1],
                    err: ""
                })
            );
        }
    }

    function _cleanupFromWalletExecution(Position storage position) internal {
        if (!position.fromWallet) return;

        if (position.balanceIn > 0) {
            _withdrawIn(position, position.balanceIn);
        }

        _withdrawOuts(position);
    }

    // HELPERS

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
            uniRouter.swapExactTokensForTokens(
                _amountIn,
                _amountOutMin,
                _path,
                address(this),
                block.timestamp
            )
        returns (uint256[] memory _amounts) {
            amounts = _amounts;
            err = false;
        } catch Error(string memory _errReason) {
            errReason = _errReason;
            err = true;
        }
    }

    function _transferTo(
        address payable _to,
        address _token,
        uint256 _amount
    ) internal {
        if (_token == weth) {
            IWETH(weth).withdraw(_amount);
            (bool success, ) = _to.call{value: _amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
    }

    // FRONTEND FETCH HELPERS

    function fetchAllowedTokens()
        public
        view
        returns (address[] memory tokens)
    {
        tokens = allowedTokens.values();
    }

    function fetchUserData(address _user)
        public
        view
        returns (
            bool userHasPosition,
            uint256 userTreasury,
            Position memory position,
            FromWalletData memory fromWalletData,
            UserTx[] memory txs,
            UserTokenData[] memory tokens
        )
    {
        userHasPosition = usersWithPositions.contains(_user);

        userTreasury = userTreasuries[_user];

        position = positions[_user];

        if (position.fromWallet) {
            uint256 allowance = IERC20(position.tokenIn).allowance(
                position.user,
                address(this)
            );
            uint256 balance = IERC20(position.tokenIn).balanceOf(position.user);
            uint256 limitedValue = allowance < balance ? allowance : balance;
            fromWalletData = FromWalletData({
                allowance: allowance,
                balance: balance,
                dcasRemaining: limitedValue / position.amountDCA
            });
        }

        txs = userTxs[_user];

        tokens = new UserTokenData[](allowedTokens.length());
        for (uint256 i = 0; i < allowedTokens.length(); i++) {
            if (allowedTokens.at(i) == NATIVE_TOKEN) {
                tokens[i] = UserTokenData({
                    token: allowedTokens.at(i),
                    allowance: type(uint256).max,
                    balance: _user.balance
                });
                continue;
            }

            tokens[i] = UserTokenData({
                token: allowedTokens.at(i),
                allowance: IERC20(allowedTokens.at(i)).allowance(
                    _user,
                    address(this)
                ),
                balance: IERC20(allowedTokens.at(i)).balanceOf(_user)
            });
        }
    }

    function fetchPosition(address _user)
        public
        view
        override
        returns (Position memory)
    {
        return positions[_user];
    }

    // ADMINISTRATION

    function setResolver(address _resolver) public onlyOwner {
        require(_resolver != address(0), "Missing resolver");
        resolver = _resolver;
    }

    function setPaused(bool _setPause) public onlyOwner {
        if (_setPause) _pause();
        else _unpause();
    }

    function setAllowedTokens(
        address[] calldata _tokens,
        bool[] calldata _alloweds
    ) public onlyOwner {
        require(_tokens.length == _alloweds.length, "Invalid length");

        for (uint256 i = 0; i < _tokens.length; i++) {
            _setAllowedToken(_tokens[i], _alloweds[i]);
        }
    }

    function _setAllowedToken(address _token, bool _allowed) internal {
        if (_allowed) allowedTokens.add(_token);
        else allowedTokens.remove(_token);
        emit SetAllowedToken(_token, _allowed);
    }

    function setBlacklistedPairs(
        address[] calldata _tokens,
        bool[] calldata _blacklisteds
    ) public onlyOwner {
        require(_tokens.length == (_blacklisteds.length * 2), "Invalid length");

        for (uint256 i = 0; i < _blacklisteds.length; i++) {
            _setBlacklistedPairs(
                _tokens[i * 2],
                _tokens[i * 2 + 1],
                _blacklisteds[i]
            );
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
        require(minSlippage != _minSlippage, "Same slippage value");
        require(_minSlippage <= 1000, "Min slippage too large");
        minSlippage = _minSlippage;

        emit MinSlippageSet(_minSlippage);
    }
}
