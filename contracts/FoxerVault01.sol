/**

Foxer Farm - Yield optimizer

🦊 Website: https://foxer.farm/
🦊 X: https://x.com/foxerfarm
🦊 Telegram: https://t.me/foxerfarm

**/

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./Interfaces/Foxer/IFoxerVault.sol";
import "./Interfaces/Foxer/IFoxerStrategy.sol";

contract FoxerVault01 is ERC20Upgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {

    /// @custom:storage-location erc7201:openzeppelin.storage.FoxerVaultStorage
    struct FoxerVaultStorage {
        IFoxerStrategy strategy;
        uint256 accRewardPerShare;
        mapping(address => uint256) userRewardDebt;
        mapping(address => uint256) userTotalRewardsEarned;
    }

    // Free space for future upgrades
    uint256[50] private __gap;

    // -----------------------------------------------------------------------------------------------------------------
    // Fixed storage definition
    // -----------------------------------------------------------------------------------------------------------------
    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.FoxerVaultStorage")) - 1)) & ~bytes32(uint256(0xff));
    bytes32 private constant FOXER_VAULT_STORAGE_LOCATION = 0xaa20dfc517bcf81d6c947988c3bdec31835f1727d05e722a802a1aeeaa3d5400;

    function _getFoxerVaultStorage() private pure returns (FoxerVaultStorage storage $) {
        assembly {
            $.slot := FOXER_VAULT_STORAGE_LOCATION
        }
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------------------------------------------------------
    modifier onlyStrategy() {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        if (msg.sender != address($.strategy)) {
            revert("!strategy");
        }
        _;
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Functions
    // ----------------------------------------------------------------------------------------------------------------
    // @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * Sets the value of {token} to the token that the vault will hold as underlying value. It initializes the vault's
     * own share token. This token is minted when someone does a deposit. It is burned in order to withdraw the
     * corresponding portion of the underlying assets.
     * @param _owner: the address of the owner of the vault.
     * @param _strategy: the address of the strategy.
     * @param _name: the name of the vault token.
     * @param _symbol: the symbol of the vault token.
     */
    function initialize(
        address _owner,
        address _strategy,
        string memory _name,
        string memory _symbol
    ) external initializer {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        __ERC20_init(_name, _symbol);
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        $.strategy = IFoxerStrategy(_strategy);
    }

    function decimals() public view override returns (uint8) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return IERC20Metadata($.strategy.want()).decimals();
    }

    function want() public view returns (IERC20) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return IERC20($.strategy.want());
    }

    function wheat() public view returns (IERC20) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return IERC20($.strategy.wheat());
    }

    function accRewardPerShare() public view returns (uint256) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return $.accRewardPerShare;
    }

    function userRewardDebt(address user) public view returns (uint256) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return $.userRewardDebt[user];
    }

    function userTotalRewardsEarned(address user) public view returns (uint256) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return $.userTotalRewardsEarned[user];
    }

    /**
     * It calculates the total underlying value of {token} held by the system. It takes into account the vault contract
     * balance, the strategy contract balance and the balance deployed in other contracts as part of the strategy.
     */
    function balance() public view returns (uint256) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return want().balanceOf(address(this)) + $.strategy.tvl();
    }

    /**
     * Custom logic in here for how much the vault allows to be borrowed.  We return 100% of tokens for now. Under
     * certain conditions we might want to keep some of the system funds at hand in the vault, instead of putting them
     * to work.
     */
    function available() public view returns (uint256) {
        return want().balanceOf(address(this));
    }

    /**
     * A helper function to call deposit() with all the sender's funds.
     */
    function depositAll(uint256 _wheatPrice) public {
        deposit(want().balanceOf(msg.sender), _wheatPrice);
    }

    /**
     * The entrypoint of funds into the system. People deposit with this function into the vault. The vault is then in
     * charge of sending funds into the strategy.
     */
    function deposit(uint256 _amount, uint256 _wheatPrice) public nonReentrant {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();

        // Start by harvesting pending rewards
        harvest(_wheatPrice);

        // Calculate the amount of shares to mint
        uint256 _pool = balance();
        want().transferFrom(msg.sender, address(this), _amount);
        earn(_wheatPrice);
        uint256 _after = balance();
        _amount = _after - _pool; // Additional check for deflationary tokens

        uint256 shares = 0;
        if (totalSupply() == 0) {
            // First depositor gets shares 1:1
            shares = _amount;
        } else {
            // In case some auto-compounding already happened, we need to calculate the correct amount of shares
            shares = (_amount * totalSupply()) / _pool;
        }

        _mint(msg.sender, shares);

        $.userRewardDebt[msg.sender] = ($.accRewardPerShare * balanceOf(msg.sender)) / 1e12;
    }

    /**
     * Function to send funds into the strategy and put them to work. It's primarily called by the deposit() function.
     */
    function earn(uint256 _wheatPrice) public {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        uint256 _bal = available();
        want().transfer(address($.strategy), _bal);
        $.strategy.deposit(_wheatPrice);
    }

    /**
     * A helper function to call withdraw() with all the sender's funds.
     */
    function withdrawAll(uint256 _wheatPrice) external {
        withdraw(balanceOf(msg.sender), _wheatPrice);
    }

    /**
     * Function to exit the system. The vault will withdraw the required tokens from the strategy and pay up the token
     * holder. A proportional number of IOU tokens are burned in the process.
     */
    function withdraw(uint256 _shares, uint256 _wheatPrice) public {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();

        // Start by harvesting pending rewards
        harvest(_wheatPrice);

        // Calculate the amount of underlying to withdraw
        if (_shares > balanceOf(msg.sender)) {
            _shares = balanceOf(msg.sender);
        }
        uint256 r = (balance() * _shares) / totalSupply();
        _burn(msg.sender, _shares);

        // Check if we have enough balance to withdraw, otherwise withdraw some from the strategy
        uint b = want().balanceOf(address(this));
        if (b < r) {
            uint _withdraw = r - b;
            $.strategy.withdraw(_withdraw, _wheatPrice);
            uint _after = want().balanceOf(address(this));
            uint _diff = _after - b;
            if (_diff < _withdraw) {
                r = b + _diff;
            }
        }

        $.userRewardDebt[msg.sender] = ($.accRewardPerShare * balanceOf(msg.sender)) / 1e12;

        want().transfer(msg.sender, r);
    }

    /**
     * The strategy will let the vault know we have accrued some profit by calling this function.
     */
    function addRewards(uint256 _amount) external onlyStrategy {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        $.accRewardPerShare += (_amount * 1e12) / totalSupply();
    }

    /**
     * Function to know the amount of confirmed pending reward for a user.
     */
    function harvestableRewards(address user) public view returns (uint256) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();

        if (totalSupply() == 0 || balanceOf(user) == 0) {
            return 0;
        }
        return (($.accRewardPerShare * balanceOf(user)) / 1e12) - $.userRewardDebt[user];
    }

    /**
     * Function to know the amount of estimated pending reward for a user. It includes the reward already confirmed and
     * the estimated reward from the strategy after swap. The estimated reward can vary, therefore this number should
     * be considered as a helper value for UIs and not as a source of truth.
     */
    function estimatedPendingRewards(address user) public view returns (uint256) {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        return harvestableRewards(user) + (($.strategy.estimatedRewardsAvailable() * balanceOf(user)) / totalSupply());
    }

    /**
     * Function to harvest the pending rewards for a user.
     */
    function _harvest(address user) internal {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();

        if (balanceOf(user) == 0) {
            return;
        }

        uint256 _pendingRewards = harvestableRewards(user);
        if (_pendingRewards > 0) {
            $.userTotalRewardsEarned[user] += _pendingRewards;
            IERC20($.strategy.wheat()).transfer(user, _pendingRewards);
        }
        $.userRewardDebt[user] = ($.accRewardPerShare * balanceOf(user)) / 1e12;
    }

    /**
     * Function to harvest the pending rewards for a user.
     */
    function harvest(uint256 _wheatPrice) public {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();
        $.strategy.harvest(_wheatPrice);
        _harvest(msg.sender);
    }

    /**
     * When tokens are transferred, we force a harvest for both users to prevent messing up with the reward calculation.
     */
    function _update(address from, address to, uint256 value) internal override {
        FoxerVaultStorage storage $ = _getFoxerVaultStorage();

        // Force both users to harvest their rewards before updating balances
        if (from != address(0) && to != address(0)) {
            _harvest(from);
            _harvest(to);
        }

        // Do the transfer
        super._update(from, to, value);

        // Set the userRewardDebt to the correct values
        if (from != address(0) && to != address(0)) {
            $.userRewardDebt[from] = ($.accRewardPerShare * balanceOf(from)) / 1e12;
            $.userRewardDebt[to] = ($.accRewardPerShare * balanceOf(to)) / 1e12;
        }
    }

    /**
     * Rescues random funds stuck that the strategy can't handle.
     * @param _token: address of the token to rescue.
     */
    function rescueToken(address _token) external onlyOwner {
        require(_token != address(want()), "!token");

        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).transfer(msg.sender, amount);
    }
}
