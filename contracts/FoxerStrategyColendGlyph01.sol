/**

Foxer Farm - Yield optimizer

🦊 Website: https://foxer.farm/
🦊 X: https://x.com/foxerfarm
🦊 Telegram: https://t.me/foxerfarm

**/

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./Interfaces/IERC20.sol";
import "./Interfaces/Foxer/IFoxerStrategy.sol";
import "./Interfaces/Foxer/IFoxerVault.sol";
import "./Interfaces/Colend/IDataProvider.sol";
import "./Interfaces/Colend/ILendingPool.sol";
import "./Interfaces/Colend/IPoolAddressesProvider.sol";
import "./Interfaces/Glyph/ISwapRouter.sol";

contract FoxerStrategyColendGlyph01 is IFoxerStrategy, PausableUpgradeable, OwnableUpgradeable {

    /// @custom:storage-location erc7201:openzeppelin.storage.FoxerStrategyColendGlyphStorage
    struct FoxerStrategyColendGlyphStorage {
        IFoxerVault vault; // The vault this strategy belongs to
        IERC20 want; // The underlying token we are going to farm on Colend (i.e. USDT)
        IERC20 wheat; // Token that is being farmed by strategy
        address feeRecipient; // Address to send fees to
        uint256 lastHarvest; // Timestamp of last harvest
        uint256 lastAWantBalance; // Last balance of aWant, the difference between the current aWant.balanceOf() and this value will is the harvested reward
        uint256 performanceFeeBps; // Performance fee in basis points
        uint256 swapThreshold; // Minimum amount of want to swap to avoid dust swaps
        uint256 eWantDecimals; // (10**decimals) of the want token
        bool isSwapEnabled; // In case of missing liquidity on the exchange, we can disable the swap.

        // Colend data
        IDataProvider dataProvider; // Colend data provider, giving addresses of lending pool and tokens
        ILendingPool lendingPool; // Colend pool contract
        ISwapRouter swapRouter; // Glyph exchange v4 (based on UniswapV3)
        IERC20 aWant; // The aWant we are going to receive
        IERC20 aWheat; // The aWheat token if the wheat is depositable on Colend (will be used in a future update)

        // Glyph data
        address[] swapHops; // Glyph exchange doesn't use the regular v3 bytes path, it's a list of abi-encoded addresses without fees
        bytes swapPath; // The compiled bytes will be saved for more convenience
    }

    // Free space for future upgrades
    uint256[50] private __gap;

    // -----------------------------------------------------------------------------------------------------------------
    // Fixed storage definition
    // -----------------------------------------------------------------------------------------------------------------
    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.FoxerStrategyColendGlyphStorage")) - 1)) & ~bytes32(uint256(0xff));
    bytes32 private constant FOXER_STRATEGY_COLEND_GLYPH_STORAGE_LOCATION = 0xf6fbfab4b30d8e5bc975e6ea27d21bce029cd396b51a29e0f49a44e99c4ac100;

    function _getFoxerStrategyColendGlyphStorage() private pure returns (FoxerStrategyColendGlyphStorage storage $) {
        assembly {
            $.slot := FOXER_STRATEGY_COLEND_GLYPH_STORAGE_LOCATION
        }
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------------------------------------------------------
    modifier onlyVault() {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        if (msg.sender != address($.vault)) {
            revert("!vault");
        }
        _;
    }

    // @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _want,
        address _wheat,
        address _feeRecipient,
        uint256 _performanceFeeBps,
        address _dataProvider,
        address _swapRouter,
        uint256 _swapThreshold
    ) external initializer {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        address aWant;
        __Ownable_init(_owner);
        __Pausable_init();
        $.want = IERC20(_want);
        $.wheat = IERC20(_wheat);
        $.feeRecipient = _feeRecipient;
        $.performanceFeeBps = _performanceFeeBps;
        $.dataProvider = IDataProvider(_dataProvider);
        $.lendingPool = ILendingPool(IPoolAddressesProvider($.dataProvider.ADDRESSES_PROVIDER()).getPool());
        $.swapRouter = ISwapRouter(payable(_swapRouter));
        $.swapThreshold = _swapThreshold;
        (aWant,,) = IDataProvider($.dataProvider).getReserveTokensAddresses(_want);
        $.aWant = IERC20(aWant);
        $.isSwapEnabled = true;
        $.eWantDecimals = 10 ** IERC20(_want).decimals();

        _giveAllowances();
    }

    function want() external view returns (address) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        return address($.want);
    }

    function wheat() external view returns (address) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        return address($.wheat);
    }

    function vault() external view returns (address) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        return address($.vault);
    }

    function aToken() external view returns (address) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        return address($.aWant);
    }

    /**
     * Puts the funds to work
     */
    function deposit(uint256 _wheatPrice) public whenNotPaused {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        uint256 wantBal = balanceOfWant();

        if (wantBal > 0) {
            _harvest(tx.origin, _wheatPrice);
            $.lendingPool.deposit(address($.want), wantBal, address(this), 0);
            $.lastAWantBalance = $.aWant.balanceOf(address(this));
            emit Deposit(tvl());
        }
    }

    /**
     * Withdraws funds and sends them back to the vault
     */
    function withdraw(uint256 _amount, uint256 _wheatPrice) external onlyVault {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        uint256 wantBal = balanceOfWant();
        uint256 aWantBal = $.aWant.balanceOf(address(this));
        if (wantBal < _amount) {
            if (!paused()) {
                _harvest(tx.origin, _wheatPrice);
            }
            if (_amount - wantBal > aWantBal) {
                // Handle rounding issues with the very last user withdrawing the remaining balance
                $.lendingPool.withdraw(address($.want), type(uint256).max, address(this));
            } else {
                // Normal process
                $.lendingPool.withdraw(address($.want), _amount - wantBal, address(this));
            }
            $.lastAWantBalance = $.aWant.balanceOf(address(this));
            wantBal = balanceOfWant();
        }

        if (wantBal > _amount) {
            wantBal = _amount;
        }

        $.want.transfer(address($.vault), wantBal);
        emit Withdraw(tvl());
    }

    /**
     * Harvests the strategy and charges fees
     */
    function harvest(uint256 _wheatPrice) public whenNotPaused {
        _harvest(msg.sender, _wheatPrice);
    }

    /**
     * Harvests the strategy and charges fees
     */
    function _harvest(address _harvester, uint256 _wheatPrice) internal {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        if ($.lastHarvest == block.timestamp) {
            // Nothing to harvest
            return;
        }

        // Calculate the amount of aWant harvested
        uint256 wantHarvested = $.aWant.balanceOf(address(this)) - $.lastAWantBalance;

        // We need at least a certain amount of token to swap, otherwise we will get dust or the swap might even fail
        if (wantHarvested < $.swapThreshold) {
            return;
        }

        // Ready to harvest something
        $.lastHarvest = block.timestamp;
        $.lendingPool.withdraw(address($.want), wantHarvested, address(this));

        // Execute the swap
        uint256 amountOut = _swapRewards(wantHarvested, _wheatPrice);

        if (amountOut > 0) {
            // Calculate fees and notify the vault of the rewards
            uint256 fees = _chargeFees(amountOut);
            amountOut -= fees;
            $.wheat.transfer(address($.vault), amountOut);
            $.vault.addRewards(amountOut);
        }

        emit StratHarvest(_harvester, wantHarvested, amountOut, tvl());
    }

    /**
     * Charge the performance fee
     */
    function _chargeFees(uint256 harvestedAmount) internal returns (uint256) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        if ($.performanceFeeBps == 0 || harvestedAmount == 0) {
            return 0;
        }

        uint256 feeAmount = harvestedAmount * $.performanceFeeBps / 10000;
        $.wheat.transfer($.feeRecipient, feeAmount);

        emit ChargedFees(feeAmount);

        return feeAmount;
    }

    /**
     * Returns supply and borrow balance
     */
    function userReserves() public view returns (uint256, uint256) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        (uint256 supplyBal,,uint256 borrowBal,,,,,,) = $.dataProvider.getUserReserveData(address($.want), address(this));
        return (supplyBal, borrowBal);
    }

    /**
     * Helper function that returns the user account data across all the reserves
     */
    function userAccountData() external view returns (
        uint256 totalCollateralETH,
        uint256 totalDebtETH,
        uint256 availableBorrowsETH,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    ) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        return $.lendingPool.getUserAccountData(address(this));
    }

    /**
     * Calculate the total underlying 'want' held by the strat.
     */
    function tvl() public view returns (uint256) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        return balanceOfWant() + $.lastAWantBalance;
    }

    /**
     * Calculates how much 'want' this contract holds.
     */
    function balanceOfWant() public view returns (uint256) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        return $.want.balanceOf(address(this));
    }

    /**
     * Calculates how much 'want' the strategy has working in the farm.
     */
    function balanceOfPool() external view returns (uint256) {
        (uint256 supplyBal, uint256 borrowBal) = userReserves();
        return supplyBal - borrowBal;
    }

    /**
     * Returns the estimated rewards available to be harvested. Must be used as an UI helper only.
     * It relies on a price determined by the pool sizes, which can be manipulated.
     */
    function estimatedRewardsAvailable() external view returns (uint256) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();

        // Calculate the expected wheat amount, rounded down to the dollar
        uint256 harvestableTokens = $.aWant.balanceOf(address(this)) - $.lastAWantBalance;
        if (harvestableTokens < $.swapThreshold) {
            return 0;
        }
        return harvestableTokens * (10000 - $.performanceFeeBps) / 10000;
    }

    /**
     * Swaps the rewards for wheat.
     * @param _amountIn the amount of want to be swapped
     * @param _wheatPrice the price of a full unit of wheat (1 * 10**decimals) in want, for slippage calculation
     * @return the amount of wheat received
     */
    function _swapRewards(uint256 _amountIn, uint256 _wheatPrice) internal returns (uint256) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();

        // Security in case the swap keeps failing, we can disable it.
        // When disabled, the strategy will simply auto compound the aWant.
        if (!$.isSwapEnabled) {
            return 0;
        }

        // Front-running prevention: users must specify the wheat price per one full unit of want
        // For MEV-safe networks or small amounts, _wheatPrice can be set to 0.
        uint256 amountOutMinimum = _wheatPrice * _amountIn / $.eWantDecimals;

        // Swap into wheat
        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: getPathBytes(),
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: _amountIn,
            amountOutMinimum: amountOutMinimum
        });

        return $.swapRouter.exactInput(params);
    }

    /**
     * Helper function that returns the glyphv4 swap path as a bytes array
     */
    function getPathBytes() public view returns (bytes memory path) {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        path = abi.encodePacked($.swapHops[0]);
        for (uint256 i = 1; i < $.swapHops.length; i++) {
            path = abi.encodePacked(path, $.swapHops[i]);
        }
    }

    /**
     * Allows the owner to update the swap path in case there are better pairs available without deploying a whole
     * new strategy contract.
     */
    function setSwapHops(address[] memory _hops) external onlyOwner {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        require(_hops.length >= 2, "invalid swap hops");
        delete $.swapHops;
        for (uint256 i = 0; i < _hops.length; i++) {
            $.swapHops.push(_hops[i]);
        }
        $.swapPath = getPathBytes();
    }

    function setVault(address _vault) external onlyOwner {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        require(address($.vault) == address(0), "vault already set");
        $.vault = IFoxerVault(_vault);
    }

    function setSwapThreshold(uint256 _swapThreshold) external onlyOwner {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        $.swapThreshold = _swapThreshold;
    }

    function setSwapEnabled(bool _isEnabled) external onlyOwner {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        $.isSwapEnabled = _isEnabled;
    }

    function panic() public onlyOwner {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        $.lendingPool.withdraw(address($.want), type(uint256).max, address(this));
        $.lastAWantBalance = 0;
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
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        $.want.approve(address($.lendingPool), type(uint256).max);
        $.wheat.approve(address($.lendingPool), type(uint256).max);
        $.want.approve(address($.swapRouter), type(uint256).max);
    }

    function _removeAllowances() internal {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        $.want.approve(address($.lendingPool), 0);
        $.wheat.approve(address($.lendingPool), 0);
        $.want.approve(address($.swapRouter), 0);
    }

    function rescueERC20(address _token) external onlyOwner {
        FoxerStrategyColendGlyphStorage storage $ = _getFoxerStrategyColendGlyphStorage();
        require(_token != address($.want), "!want");
        require(_token != address($.wheat), "!wheat");
        require(_token != address($.aWant), "!aWant");
        require(_token != address($.aWheat), "!aWheat");
        IERC20(_token).transfer(owner(), IERC20(_token).balanceOf(address(this)));
    }
}
