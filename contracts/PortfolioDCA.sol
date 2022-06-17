// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./external/OpsReady.sol";
import "./interfaces/IPortfolioDCA.sol";
import "./interfaces/IUniswapV2Router.sol";
import "./external/IWETH.sol";
import "./interfaces/IERC20Ext.sol";
import "hardhat/console.sol";

contract PortfolioDCA is OpsReady, IPortfolioDCA, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    IUniswapV2Router public uniRouter;
    address public resolver;

    EnumerableSet.AddressSet usersWithPositions;
    mapping(address => Position) public positions;
    mapping(address => UserTx[]) public userTxs;

    EnumerableSet.AddressSet allowedTokens;
    mapping(address => string) tokenSymbols;
    mapping(address => mapping(address => bool)) public blacklistedPairs;
    uint256 public minSlippage = 25; // 0.25%

    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public immutable weth;

    receive() external payable {}

    constructor(
        address payable _ops,
        address _uniRouter,
        address _weth,
        string memory _wethSymbol
    ) OpsReady(_ops) {
        uniRouter = IUniswapV2Router(_uniRouter);
        weth = _weth;

        // Allow weth
        _setAllowedToken(_weth, _wethSymbol, true);
    }

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
        string[] calldata _symbols,
        bool[] calldata _alloweds
    ) public onlyOwner {
        require(_tokens.length == _symbols.length, "Invalid length");
        require(_tokens.length == _alloweds.length, "Invalid length");

        for (uint256 i = 0; i < _tokens.length; i++) {
            _setAllowedToken(_tokens[i], _symbols[i], _alloweds[i]);
        }
    }
    function _setAllowedToken(
        address _token,
        string memory _symbol,
        bool _allowed
    ) internal {
        if (_allowed) allowedTokens.add(_token);
        else allowedTokens.remove(_token);
        tokenSymbols[_token] = _symbol;
        emit SetAllowedToken(_token, _allowed, _symbol);
    }
    function setBlacklistedPairs(
        address[] calldata _tokens,
        bool[] calldata _blacklisteds
    ) public onlyOwner {
        require(_tokens.length == (_blacklisteds.length * 2), "Invalid length");

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

    function getPosition(address _user) public view override returns (Position memory) {
        return positions[_user];
    }

    modifier positionExists() {
        require(positions[msg.sender].user == msg.sender, "User doesnt have a position");
        _;
    }


    function _validPair(address _in, address _out) internal view returns (bool) {
        return (
            allowedTokens.contains(_in) &&
            allowedTokens.contains(_out) &&
            _in != _out &&
            !blacklistedPairs[_in][_out]
        );
    }

    function _validRoute(address _tokenIn, uint256 _amountIn, TokenOutParams memory _tokenOut) internal view returns (bool) {
        if (
            _tokenIn != _tokenOut.route[0] ||
            _tokenOut.token != _tokenOut.route[_tokenOut.route.length - 1]
        ) return false;
        try uniRouter.getAmountsOut(_amountIn * _tokenOut.weight / 10_000, _tokenOut.route) {
            return true;
        } catch {
            return false;
        }
    }

    function setPosition(
        uint256 _treasuryAmount,
        address _tokenIn,
        TokenOutParams[] memory _tokensOut,
        uint256 _amountIn,
        uint256 _amountDCA,
        uint256 _intervalDCA,
        uint256 _maxGasPrice
    ) public payable whenNotPaused {
        require(_amountDCA > 0, "DCA amount must be > 0");
        require(_intervalDCA >= 60, "DCA interval must be > 60s");

        usersWithPositions.add(msg.sender);
        Position storage position = positions[msg.sender];

        // Handle deposit
        uint256 amountIn;
        address tokenIn;
        if (_tokenIn == NATIVE_TOKEN) {
            tokenIn = weth;
            IWETH(weth).deposit{value: msg.value - _treasuryAmount}();
            amountIn = msg.value - _treasuryAmount;
        } else {
            tokenIn = _tokenIn;
            IERC20(_tokenIn).safeTransferFrom(
                msg.sender,
                address(this),
                _amountIn
            );
            amountIn = _amountIn;
        }
        require(allowedTokens.contains(tokenIn), "Token is not allowed");

        // Clean up previous position
        if (position.user == msg.sender) {
            // Remove previous tokenIn if differs
            if (tokenIn != position.tokenIn && position.balanceIn > 0) {
                _withdrawTokenIn(position, position.balanceIn);
            }

            _withdrawTokensOut(position);
        }

        // Set Data
        position.user = msg.sender;
        position.tokenIn = tokenIn;

        position.treasury += _treasuryAmount;
        require(position.treasury > 0, "Treasury must not be 0");

        position.balanceIn += amountIn;
        require(position.balanceIn >= _amountDCA, "Deposit for at least 1 DCA");

        position.amountDCA = _amountDCA;
        position.intervalDCA = _intervalDCA;
        position.maxGasPrice = _maxGasPrice;

        // Add tokens to position
        delete position.tokensOut;
        uint256 weightsSum = 0;
        for (uint256 i = 0; i < _tokensOut.length; i++) {
            require(_tokensOut[i].token != tokenIn, "Same token both sides of pair");
            require(allowedTokens.contains(_tokensOut[i].token), "Token is not allowed");
            require(!blacklistedPairs[tokenIn][_tokensOut[i].token], "Pair is blacklisted");
            require(_tokensOut[i].maxSlippage >= minSlippage, "Invalid slippage");
            require(_tokensOut[i].weight > 0, "Non zero weight");
            require(_validRoute(tokenIn, position.amountDCA, _tokensOut[i]), "Invalid route");
            weightsSum += _tokensOut[i].weight;
            position.tokensOut.push(PositionOut({
                token: _tokensOut[i].token,
                weight: _tokensOut[i].weight,
                route: _tokensOut[i].route,
                maxSlippage: _tokensOut[i].maxSlippage,
                balance: 0
            }));
        }
        require(weightsSum == 10_000, "Weights do not sum to 10000");


        emit SetPosition(msg.sender, tokenIn, position.tokensOut, _amountDCA, _intervalDCA, _maxGasPrice);
        if (amountIn > 0) emit Deposit(msg.sender, tokenIn, amountIn);
        if (_treasuryAmount > 0) emit DepositToTreasury(msg.sender, _treasuryAmount);

        // New position needs to be initialized (must call from array of positions to persist taskId)
        _checkAndInitializeTask(positions[msg.sender]);
    }

    function _checkAndInitializeTask(Position storage _position) internal {
        if (_position.balanceIn < _position.amountDCA) return;
        if (_position.treasury == 0) return;
        if (_position.taskId != bytes32(0)) return;

        _position.taskId = IOps(ops).createTimedTask(
            0,
            uint128(_position.intervalDCA),
            address(this),
            this.executeDCA.selector,
            resolver,
            abi.encode(_position.user),
            NATIVE_TOKEN,
            false
        );

        emit InitializeTask(_position.user, _position.taskId);
    }

    function depositToTreasury() public payable whenNotPaused positionExists {
        require(msg.value > 0, "msg.value must be > 0");
        positions[msg.sender].treasury += msg.value;

        emit DepositToTreasury(msg.sender, msg.value);

        _checkAndInitializeTask(positions[msg.sender]);
    }

    function withdrawFromTreasury(uint256 _amount) public positionExists {
        require(_amount > 0, "_amount must be > 0");
        require(_amount <= positions[msg.sender].treasury, "Bad withdraw");
        _withdrawFromTreasury(_amount);

        _checkAndFinalizeTask(positions[msg.sender], 0);
    }
    function _withdrawFromTreasury(uint256 _amount) internal {
        (bool success, ) = payable(msg.sender).call{value: _amount}("");
        require(success, "ETH transfer failed");
        positions[msg.sender].treasury -= _amount;
        emit WithdrawFromTreasury(msg.sender, _amount);
    }

    function deposit(uint256 _amountIn) public payable whenNotPaused positionExists {
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

    function withdrawTokenIn(uint256 _amount) public positionExists {
        require(_amount > 0, "_amount must be > 0");
        require(positions[msg.sender].balanceIn >= _amount, "Bad withdraw");
        _withdrawTokenIn(positions[msg.sender], _amount);

        _checkAndFinalizeTask(positions[msg.sender], 0);
    }
    function _withdrawTokenIn(Position storage _position, uint256 _amount) internal {
        _position.balanceIn -= _amount;
        _transferTo(payable(_position.user), _position.tokenIn, _amount);
        emit WithdrawTokenIn(_position.user, _position.tokenIn, _amount);
    }

    function withdrawTokensOut() public positionExists {
        _withdrawTokensOut(positions[msg.sender]);
    }
    function _withdrawTokensOut(Position storage _position) internal {
        address[] memory tokens = new address[](_position.tokensOut.length);
        uint256[] memory amounts = new uint256[](_position.tokensOut.length);
        for (uint256 i = 0; i < _position.tokensOut.length; i++) {
            tokens[i] = _position.tokensOut[i].token;
            amounts[i] = _position.tokensOut[i].balance;
            if (_position.tokensOut[i].balance > 0) {
                _transferTo(payable(_position.user), _position.tokensOut[i].token, _position.tokensOut[i].balance);
                _position.tokensOut[i].balance = 0;
            }
        }
        emit WithdrawTokensOut(_position.user, tokens, amounts);
    }


    function _checkAndFinalizeTask(Position storage _position, uint256 _txFee) internal returns (bool) {
        if (_position.balanceIn < _position.amountDCA) {
            // Finalize: Insufficient funds
            _finalizeTask(_position, "Insufficient funds");
            return true;
        }
        if (_position.treasury <= _txFee) {

            if (_txFee > 0) {
                // Treasury is less than current tx fee, which is non-zero
                // Empty remainder of user's treasury
                _position.treasury = 0;
            }

            // Finalize: Treasury empty
            _finalizeTask(_position, "Treasury out of gas");
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
    

    function exitPosition() public positionExists {
        Position storage position = positions[msg.sender];

        // Remove in token
        if (position.balanceIn > 0) {
            _withdrawTokenIn(position, position.balanceIn);
        }

        // Remove out tokens
        _withdrawTokensOut(position);

        // Remove treasury
        _withdrawFromTreasury(position.treasury);

        // Stop task
        _finalizeTask(position, "User exited");

        // Clear data
        position.user = address(0);
        usersWithPositions.remove(msg.sender);
    }

    function executeDCA(address _user, uint256[] calldata swapsAmountOutMin)
        public
        override
        whenNotPaused
        onlyOps
    {
        Position storage position = positions[_user];
        require(position.user == _user, "User doesnt have a position");
        require(block.timestamp >= position.lastDCA + position.intervalDCA, "DCA not mature");
        position.lastDCA = block.timestamp;

        // Validate extraData length
        require(position.tokensOut.length == swapsAmountOutMin.length, "Invalid extra data");

        (uint256 fee,) = IOps(ops).getFeeDetails();
        _transfer(fee, NATIVE_TOKEN);

        // Check if tx will fail or treasury won't cover gas
        bool finalized = _checkAndFinalizeTask(position, fee);
        // Exit if tx will fail
        if (finalized) return;

        // Take transaction fee out of users treasury
        position.treasury -= fee;

        // Approve swap in amount
        IERC20(position.tokenIn).approve(
            address(uniRouter),
            position.amountDCA
        );

        // Perform swaps
        _executeDCASwaps(position, swapsAmountOutMin);

        emit ExecuteDCA(_user);
    }

    function _executeDCASwaps(Position storage position, uint256[] memory swapsAmountOutMin) internal {
        userTxs[position.user].push();
        UserTx storage userTx = userTxs[position.user][userTxs[position.user].length - 1];
        userTx.timestamp = block.timestamp;

        uint256[] memory amounts;
        bool validPair;
        string memory swapErrReason;
        bool swapErr;
        for (uint256 i = 0; i < position.tokensOut.length; i++) {
            validPair = _validPair(position.tokenIn, position.tokensOut[i].token);
            if (validPair) {
                (amounts, swapErr, swapErrReason) = _swap(
                    position.amountDCA * position.tokensOut[i].weight / 10_000,
                    swapsAmountOutMin[i],
                    position.tokensOut[i].route
                );
                if (!swapErr) {
                    position.balanceIn -= position.amountDCA * position.tokensOut[i].weight / 10_000;
                    position.tokensOut[i].balance += amounts[amounts.length - 1];
                }
            }
            userTx.tokenTxs.push(UserTokenTx({
                tokenIn: position.tokenIn,
                tokenOut: position.tokensOut[i].token,
                amountIn: validPair && !swapErr ? position.amountDCA * position.tokensOut[i].weight / 10_000 : 0,
                amountOut: validPair && !swapErr ? amounts[amounts.length - 1] : 0,
                err: swapErr ? swapErrReason : !validPair ? "Invalid pair" : ""
            }));
        }
    }

    function _swap(
        uint256 _amountIn,
        uint256 _amountOutMin,
        address[] memory _path
    ) internal returns (uint256[] memory amounts, bool err, string memory errReason) {
        try uniRouter.swapExactTokensForTokens(
            _amountIn,
            _amountOutMin,
            _path,
            address(this),
            block.timestamp
        ) returns (uint256[] memory _amounts) {
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

    function setMinSlippage(uint256 _minSlippage) public onlyOwner {
        require(minSlippage != _minSlippage, "Same slippage value");
        require(_minSlippage <= 1000, "Min slippage too large");
        minSlippage = _minSlippage;

        emit MinSlippageSet(_minSlippage);
    }





    // FETCHING
    function fetchAllowedTokens() public view returns (address[] memory) {
        return allowedTokens.values();
    }
    function fetchData(
        address _user
    ) public view returns (
        bool userHasPosition,
        Position memory position,
        UserTx[] memory txs,
        TokenData[] memory tokens
    ) {
        userHasPosition = usersWithPositions.contains(_user);

        position = positions[_user];

        txs = userTxs[_user];

        tokens = new TokenData[](allowedTokens.length());
        for (uint256 i = 0; i < allowedTokens.length(); i++) {
            tokens[i] = TokenData({
                token: allowedTokens.at(i),
                symbol: tokenSymbols[allowedTokens.at(i)],
                decimals: IERC20Ext(allowedTokens.at(i)).decimals(),
                allowance: allowedTokens.at(i) == NATIVE_TOKEN ?
                    type(uint256).max :
                    IERC20(allowedTokens.at(i)).allowance(_user, address(this)),
                balance: allowedTokens.at(i) == NATIVE_TOKEN ?
                    _user.balance :
                    IERC20(allowedTokens.at(i)).balanceOf(_user)
            });
        }
    }
}
