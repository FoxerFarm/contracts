/**
Foxer Farm - Yield optimizer
🦊 Website: https://foxer.farm/
🦊 X: https://x.com/foxerfarm
🦊 Telegram: https://t.me/foxerfarm
**/

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Interfaces/IERC20.sol";
import "./Interfaces/Aave/IDataProvider.sol";
import "./Interfaces/Aave/ILendingPool.sol";
import "./Interfaces/Aave/IPoolAddressesProvider.sol";
import "./Interfaces/Uniswap/ISwapRouter.sol";
import "./Interfaces/Chainlink/IOracle.sol";
import "./Interfaces/Foxer/IFoxerVault.sol";
import "./Interfaces/Foxer/IFoxerStrategy.sol";

contract FoxerStrategyColend02 is IFoxerStrategy, Pausable, Ownable {
    address public vault; // The vault this strategy belongs to
    address public bitcoin; // Wrapped bitcoin token on this blockchain
    address public want; // The underlying token we are going to farm on Aave (i.e. USDT)
    address public aToken; // The aToken we are going to receive
    address[] public swapHops; // Glyph exchange doesn't use the regular v3 bytes path, it's a list of abi-encoded addresses without fees
    bytes private swapPath; // The compiled bytes will be saved for easier use
    uint256 public lastHarvest;
    uint256 public lastATokenBalance;
    uint256 public performanceFeePer1000;
    uint256 public swapThreshold;
    address public feeRecipient;
    uint256 private eWantDecimals;
    bool private isSwapEnabled;
    bool public isRetired;

    // Third party contracts
    IDataProvider public dataProvider; // Colend data provider, giving addresses of lending pool and tokens
    ILendingPool public lendingPool; // Colend pool contract
    ISwapRouter public swapRouter; // UniswapV3 compatible router (Glyph exchange v4)

    modifier onlyVault() {
        require(msg.sender == vault, "!vault");
        _;
    }

    constructor(
        address _admin,
        address _want,
        address _bitcoin,
        address _feeRecipient,
        uint256 _performanceFeePer1000,
        address _dataProvider,
        address _swapRouter,
        uint256 _swapThreshold
    ) Ownable(_admin) {
        want = _want;
        bitcoin = _bitcoin;
        feeRecipient = _feeRecipient;
        performanceFeePer1000 = _performanceFeePer1000;
        dataProvider = IDataProvider(_dataProvider);
        lendingPool = ILendingPool(IPoolAddressesProvider(dataProvider.ADDRESSES_PROVIDER()).getPool());
        swapRouter = ISwapRouter(payable(_swapRouter));
        swapThreshold = _swapThreshold;
        (aToken,,) = IDataProvider(dataProvider).getReserveTokensAddresses(_want);
        isSwapEnabled = true;
        eWantDecimals = 10 ** IERC20(_want).decimals();

        _giveAllowances();
    }

    // puts the funds to work
    function deposit(uint256 _satoshisPerWant) public whenNotPaused {
        uint256 wantBal = balanceOfWant();

        if (wantBal > 0) {
            _harvest(tx.origin, _satoshisPerWant);
            lendingPool.deposit(want, wantBal, address(this), 0);
            lastATokenBalance = IERC20(aToken).balanceOf(address(this));
            emit Deposit(tvl());
        }
    }

    /**
    * @dev Withdraws funds and sends them back to the vault
    */
    function withdraw(uint256 _amount, uint256 _satoshisPerWant) external onlyVault {
        uint256 wantBal = balanceOfWant();
        uint256 aTokenBal = IERC20(aToken).balanceOf(address(this));
        if (wantBal < _amount) {
            _harvest(tx.origin, _satoshisPerWant);
            if (_amount - wantBal > aTokenBal) {
                // Handle rounding issues with the very last user withdrawing the remaining balance
                lendingPool.withdraw(want, type(uint256).max, address(this));
            } else {
                // Normal process
                lendingPool.withdraw(want, _amount - wantBal, address(this));
            }
            lastATokenBalance = IERC20(aToken).balanceOf(address(this));
            wantBal = balanceOfWant();
        }

        if (wantBal > _amount) {
            wantBal = _amount;
        }

        IERC20(want).transfer(vault, wantBal);
        emit Withdraw(tvl());
    }

    /**
    * @dev Harvests the strategy and charges fees
    */
    function harvest(uint256 _satoshisPerWant) public whenNotPaused {
        _harvest(msg.sender, _satoshisPerWant);
    }

    /**
    * @dev Harvests the strategy and charges fees
    */
    function _harvest(address _harvester, uint256 _satoshisPerWant) internal {
        if (lastHarvest == block.timestamp) {
            return;
        }

        // Calculate the amount of aToken harvested
        uint256 wantHarvested = IERC20(aToken).balanceOf(address(this)) - lastATokenBalance;

        // We want at least 0.1 token to do something
        if (wantHarvested < swapThreshold) {
            return;
        }

        lastHarvest = block.timestamp;

        lendingPool.withdraw(want, wantHarvested, address(this));

        uint256 amountOut = _swapRewards(wantHarvested, _satoshisPerWant);

        if (amountOut > 0) {
            uint256 fees = _chargeFees(amountOut);
            amountOut -= fees;
            IERC20(bitcoin).transfer(vault, amountOut);
            IFoxerVault(vault).addRewards(amountOut);
        }

        emit StratHarvest(_harvester, wantHarvested, amountOut, tvl());
    }

    /**
    * @dev Charge the performance fee
    */
    function _chargeFees(uint256 harvestedAmount) internal returns (uint256) {
        if (performanceFeePer1000 == 0) {
            return 0;
        }

        uint256 feeAmount = harvestedAmount * performanceFeePer1000 / 1000;
        IERC20(bitcoin).transfer(feeRecipient, feeAmount);

        emit ChargedFees(feeAmount);

        return feeAmount;
    }

    /**
    * @dev Returns supply and borrow balance
    */
    function userReserves() public view returns (uint256, uint256) {
        (uint256 supplyBal,,uint256 borrowBal,,,,,,) = IDataProvider(dataProvider).getUserReserveData(want, address(this));
        return (supplyBal, borrowBal);
    }

    // returns the user account data across all the reserves
    function userAccountData() public view returns (
        uint256 totalCollateralETH,
        uint256 totalDebtETH,
        uint256 availableBorrowsETH,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    ) {
        return lendingPool.getUserAccountData(address(this));
    }

    // calculate the total underlaying 'want' held by the strat.
    function tvl() public view returns (uint256) {
        return balanceOfWant() + lastATokenBalance;
    }

    // it calculates how much 'want' this contract holds.
    function balanceOfWant() public view returns (uint256) {
        return IERC20(want).balanceOf(address(this));
    }

    // it calculates how much 'want' the strategy has working in the farm.
    function balanceOfPool() public view returns (uint256) {
        (uint256 supplyBal, uint256 borrowBal) = userReserves();
        return supplyBal - borrowBal;
    }

    // returns ESTIMATED rewards unharvested
    /**
    * @dev Returns the estimated rewards available to be harvested.
    * THIS FUNCTION IS NOT SAFE, as it relies on the price determined by the pool sizes, which can be manipulated.
    * Only use it as a helper function outside of any smart contract or on-chain process.
    */
    function estimatedRewardsAvailable() external view returns (uint256) {
        // Calculate the expected bitcoin amount, rounded down to the dollar
        uint256 harvestableTokens = IERC20(aToken).balanceOf(address(this)) - lastATokenBalance;
        if (harvestableTokens < swapThreshold) {
            return 0;
        }
        //uint256[] memory amountsOut = swapRouter.getAmountsOut(harvestableTokens, swapPath);
        //return amountsOut[amountsOut.length - 1] * (1000 - performanceFeePer1000) / 1000;
        // @todo make a quote and return the number of BTC harvestable after fees
        return harvestableTokens * (1000 - performanceFeePer1000) / 1000;
    }


    /**
    * @dev Swaps the rewards for WBTC
    */
    function _swapRewards(uint256 _amountIn, uint256 _satoshisPerWant) internal returns (uint256) {
        // Security in case the swap keeps failing, we can disable it
        if (!isSwapEnabled) {
            return 0;
        }

        uint256 amountOutMinimum = _satoshisPerWant * _amountIn / eWantDecimals;
        //uint256 amountOutMinimum = 0;


        // Swap into WBTC
        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: getPathBytes(),
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: _amountIn,
            amountOutMinimum: amountOutMinimum
        });

        return swapRouter.exactInput(params);
    }

    function getPathBytes() public view returns (bytes memory path) {
        path = abi.encodePacked(swapHops[0]);
        for (uint256 i = 1; i < swapHops.length; i++) {
            path = abi.encodePacked(path, swapHops[i]);
        }
    }

    function setSwapHops(address[] memory _hops) external onlyOwner {
        require(_hops.length >= 2, "invalid swap hops");
        delete swapHops;
        for (uint256 i = 0; i < _hops.length; i++) {
            swapHops.push(_hops[i]);
        }
        swapPath = getPathBytes();
    }

    function setVault(address _vault) external onlyOwner {
        require(vault == address(0), "vault already set");
        vault = _vault;
    }

    function setSwapThreshold(uint256 _swapThreshold) external onlyOwner {
        swapThreshold = _swapThreshold;
    }

    function setSwapEnabled(bool _isEnabled) external onlyOwner {
        isSwapEnabled = _isEnabled;
    }

    // called as part of strat migration. Sends all the available funds back to the vault.
    function retireStrat() external onlyVault {
        lendingPool.withdraw(want, type(uint256).max, address(this));
        lastATokenBalance = 0;

        uint256 wantBal = balanceOfWant();
        IERC20(want).transfer(vault, wantBal);

        isRetired = true;
    }

    // pauses deposits and withdraws all funds from third party systems.
    function panic() public onlyOwner {
        lendingPool.withdraw(want, type(uint256).max, address(this));
        lastATokenBalance = 0;
        pause();
    }

    function pause() public onlyOwner {
        _pause();
        _removeAllowances();
    }

    function unpause() external onlyOwner {
        _unpause();
        _giveAllowances();
        deposit(0);
    }

    function _giveAllowances() internal {
        IERC20(want).approve(address(lendingPool), type(uint256).max);
        IERC20(want).approve(address(swapRouter), type(uint256).max);
    }

    function _removeAllowances() internal {
        IERC20(want).approve(address(lendingPool), 0);
        IERC20(want).approve(address(swapRouter), 0);
    }

    function rescueERC20(address _token) external onlyOwner {
        if (!isRetired) {
            require(_token != want, "!want");
            require(_token != bitcoin, "!bitcoin");
            require(_token != aToken, "!aToken");
        }
        IERC20(_token).transfer(owner(), IERC20(_token).balanceOf(address(this)));
    }
}
