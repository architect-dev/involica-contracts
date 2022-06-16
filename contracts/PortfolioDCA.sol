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

    function setPosition(
        uint256 _treasuryAmount,
        address _tokenIn,
        address[] memory _tokensOut,
        uint256[] memory _weights,
        uint256 _amountIn,
        uint256 _amountDCA,
        uint256 _intervalDCA,
        uint256[] memory _maxSlippages,
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
        require(allowedTokens.contains(tokenIn), "Invalid token");

        // Clean up previous position
        if (position.user == msg.sender) {
            // Remove previous tokenIn if differs
            if (tokenIn != position.tokenIn && position.balanceIn > 0) {
                _withdrawTokenIn(position, position.balanceIn);
            }

            _withdrawTokensOut(position);
        }

        // Validate pair
        require(_tokensOut.length == _weights.length, "Lengths dont match");
        require(_tokensOut.length == _maxSlippages.length, "Lengths dont match");

        // Add tokens to position
        delete position.tokensOut;
        uint256 weightsSum = 0;
        for (uint256 i = 0; i < _tokensOut.length; i++) {
            require(
                _tokensOut[i] != tokenIn &&
                allowedTokens.contains(_tokensOut[i]) &&
                !blacklistedPairs[tokenIn][_tokensOut[i]] &&
                _maxSlippages[i] >= minSlippage &&
                _weights[i] > 0,
                "Invalid token data"
            );
            weightsSum += _weights[i];
            position.tokensOut.push(PositionOut({
                token: _tokensOut[i],
                weight: _weights[i],
                maxSlippage: _maxSlippages[i],
                balance: 0
            }));
        }
        require(weightsSum == 10_000, "Incorrect weights");

        // Set Data
        position.user = msg.sender;

        position.treasury += _treasuryAmount;
        require(position.treasury > 0, "Treasury must not be 0");

        position.balanceIn += amountIn;
        require(position.balanceIn >= _amountDCA, "Deposit for at least 1 DCA");

        position.tokenIn = tokenIn;

        position.amountDCA = _amountDCA;
        position.intervalDCA = _intervalDCA;
        position.maxGasPrice = _maxGasPrice;

        emit SetPosition(msg.sender, tokenIn, position.tokensOut, _amountDCA, _intervalDCA, _maxGasPrice);
        emit Deposit(msg.sender, tokenIn, amountIn);
        emit DepositToTreasury(msg.sender, _treasuryAmount);

        // New position needs to be initialized (must call from array of positions to persist taskId)
        _initializeTaskIfNecessary(positions[msg.sender]);
    }

    function _initializeTaskIfNecessary(Position storage _position) internal {
        if (_position.balanceIn < _position.amountDCA) return;
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
    }

    function depositToTreasury() public payable whenNotPaused positionExists {
        require(msg.value > 0, "msg.value must be > 0");
        IWETH(weth).deposit{value: msg.value}();
        positions[msg.sender].treasury += msg.value;
        emit DepositToTreasury(msg.sender, msg.value);
    }

    function withdrawFromTreasury(uint256 _amount) public positionExists {
        require(_amount > 0, "_amount must be > 0");
        _withdrawFromTreasury(_amount);
    }
    function _withdrawFromTreasury(uint256 _amount) internal {
        _transferTokenOrNative(payable(msg.sender), weth, _amount);
        positions[msg.sender].treasury -= _amount;
        emit WithdrawFromTreasury(msg.sender, _amount);
    }

    function deposit(address _tokenIn, uint256 _amountIn) public payable whenNotPaused positionExists {
        uint256 amountIn;
        if (_tokenIn == NATIVE_TOKEN) {
            IWETH(weth).deposit{value: msg.value}();
            amountIn = msg.value;
        } else {
            IERC20(_tokenIn).safeTransferFrom(
                msg.sender,
                address(this),
                _amountIn
            );
            amountIn = _amountIn;
        }

        require(amountIn > 0, "_amount must be > 0");

        positions[msg.sender].balanceIn += amountIn;

        emit Deposit(msg.sender, _tokenIn, amountIn);
    }

    function withdrawTokenIn(uint256 _amount) public positionExists {
        require(_amount > 0, "_amount must be > 0");
        require(positions[msg.sender].balanceIn >= _amount, "Bad withdraw");
        _withdrawTokenIn(positions[msg.sender], _amount);

        if (positions[msg.sender].balanceIn == 0) {
            _finalizePosition(positions[msg.sender], "User Exited");
        }
    }
    function _withdrawTokenIn(Position storage _position, uint256 _amount) internal {
        _position.balanceIn -= _amount;
        _transferTokenOrNative(payable(_position.user), _position.tokenIn, _amount);
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
                _transferTokenOrNative(payable(_position.user), _position.tokensOut[i].token, _position.tokensOut[i].balance);
                _position.tokensOut[i].balance = 0;
            }
        }
        emit WithdrawTokensOut(_position.user, tokens, amounts);
    }


    function _finalizePosition(Position storage _position, string memory _reason) internal {
        if (_position.taskId == bytes32(0)) return;

        // TODO: End timer task
        _position.taskId = bytes32(0);
        _position.finalizationReason = _reason;

        emit FinalizePosition(_position.user, _reason);
    }
    

    function exitPosition(address _user) public positionExists {
        _exitPosition(_user);
    }
    function _exitPosition(address _user) internal {
        Position storage position = positions[_user];

        // Remove in token
        if (position.balanceIn > 0) {
            _withdrawTokenIn(position, position.balanceIn);
        }

        // Remove out tokens
        _withdrawTokensOut(position);

        // Remove treasury
        _withdrawFromTreasury(position.treasury);

        // Stop task
        _finalizePosition(position, "User Exited");

        // Clear data
        positions[_user].user = address(0);
    }

    function executeDCA(address _user, DCAExtraData[] memory extraData)
        public
        override
        whenNotPaused
        onlyOps
    {
        Position storage position = positions[_user];
        require(position.user == _user, "User doesnt have a position");

        // Validate extraData length
        require(position.tokensOut.length == extraData.length, "Invalid extra data");

        (uint256 fee, address feeToken) = IOps(ops).getFeeDetails();
        _transfer(fee, feeToken);


        (bool finalize, string memory finalizeReason, uint8 finalizeCode) = _positionShouldBeFinalized(position, fee);
        if (finalize) {
             // Clear user treasury if they don't have gas money to pay for tx
            if (finalizeCode == 2) position.treasury = 0;
            _finalizePosition(position, finalizeReason);
            return;
        }

        // Take transaction fee out of users treasury
        position.treasury -= fee;

        IERC20(position.tokenIn).approve(
            address(uniRouter),
            position.amountDCA
        );

        // Perform swaps
        _executeDCASwaps(position, extraData);

        emit ExecuteDCA(_user);
    }

    function _executeDCASwaps(Position storage position, DCAExtraData[] memory extraData) internal {
        UserTx storage userTx = userTxs[position.user][userTxs[position.user].length];
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
                    extraData[i].swapAmountOutMin,
                    extraData[i].swapPath
                );
                if (!swapErr) {
                    position.balanceIn -= position.amountDCA * position.tokensOut[i].weight / 10_000;
                    position.tokensOut[i].balance += amounts[amounts.length - 1];
                }
            }
            userTx.tokenTxs[i] = UserTokenTx({
                tokenIn: position.tokenIn,
                tokenOut: position.tokensOut[i].token,
                amountIn: validPair && !swapErr ? position.amountDCA * position.tokensOut[i].weight / 10_000 : 0,
                amountOut: validPair && !swapErr ? amounts[amounts.length - 1] : 0,
                err: swapErr ? swapErrReason : validPair ? "" : "Invalid pair"
            });
        }

        // Store results
        userTxs[position.user].push(userTx);
    }

    function _positionShouldBeFinalized(Position memory _position, uint256 txFee)
        internal
        pure
        returns (bool finalize, string memory reason, uint8 code)
    {
        if (_position.balanceIn < _position.amountDCA) {
            return (true, "Insufficient funds", 1);
        }
        if (txFee > _position.treasury) {
            return (true, "Treasury out of gas", 2);
        }
        return (false, "", 0);
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

    function _transferTokenOrNative(
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
        require(_minSlippage <= 1000, "Min slippage too large"); // sanity check max slippage under 10%
        minSlippage = _minSlippage;

        emit MinSlippageSet(_minSlippage);
    }





    // FETCHING
    function fetchData(
        address _user
    ) public view returns (
        Position memory position,
        TokenData[] memory tokens
    ) {
        position = positions[_user];

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
