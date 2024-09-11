// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./Interfaces/Foxer/IFoxerStrategy.sol";
import "./Interfaces/Foxer/IFoxerVault.sol";

contract FoxerVault is ERC20Upgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    uint256 public version = 1;
    IERC20 public bitcoin;
    address public feeRecipient;
    uint256 public accRewardPerShare;
    mapping(address => uint256) public userRewardDebt;
    mapping(address => uint256) public userTotalRewardsEarned;

    struct StratCandidate {
        address implementation;
        uint proposedTime;
    }

    // The last proposed strategy to switch to.
    StratCandidate public stratCandidate;
    // The strategy currently in use by the vault.
    IFoxerStrategy public strategy;
    // The minimum time it has to pass before a strat candidate can be approved.
    uint256 public approvalDelay;

    event NewStratCandidate(address implementation);
    event UpgradeStrat(address implementation);

    modifier onlyStrategy() {
        require(msg.sender == address(strategy), "!strategy");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Sets the value of {token} to the token that the vault will
     * hold as underlying value. It initializes the vault's own 'moo' token.
     * This token is minted when someone does a deposit. It is burned in order
     * to withdraw the corresponding portion of the underlying assets.
     * @param _owner the address of the owner of the vault.
     * @param _bitcoin the address of bitcoin.
     * @param _strategy the address of the strategy.
     * @param _name the name of the vault token.
     * @param _symbol the symbol of the vault token.
     * @param _approvalDelay the delay before a new strat can be approved.
     */
    function initialize(address _owner, address _bitcoin, address _strategy, string memory _name, string memory _symbol, uint256 _approvalDelay) public initializer {
        __ERC20_init(_name, _symbol);
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        bitcoin = IERC20(_bitcoin);
        strategy = IFoxerStrategy(_strategy);
        approvalDelay = _approvalDelay;
    }

    function decimals() public view override returns (uint8) {
        return IERC20Metadata(strategy.want()).decimals();
    }

    function want() public view returns (IERC20) {
        return IERC20(strategy.want());
    }

    /**
     * @dev It calculates the total underlying value of {token} held by the system.
     * It takes into account the vault contract balance, the strategy contract balance
     *  and the balance deployed in other contracts as part of the strategy.
     */
    function balance() public view returns (uint256) {
        return want().balanceOf(address(this)) + strategy.tvl();
    }

    /**
     * @dev Custom logic in here for how much the vault allows to be borrowed.
     * We return 100% of tokens for now. Under certain conditions we might
     * want to keep some of the system funds at hand in the vault, instead
     * of putting them to work.
     */
    function available() public view returns (uint256) {
        return want().balanceOf(address(this));
    }

    /**
     * @dev A helper function to call deposit() with all the sender's funds.
     */
    function depositAll(uint256 _satoshisPerWant) external {
        deposit(want().balanceOf(msg.sender), _satoshisPerWant);
    }

    /**
     * @dev The entrypoint of funds into the system. People deposit with this function
     * into the vault. The vault is then in charge of sending funds into the strategy.
     */
    function deposit(uint256 _amount, uint256 _satoshisPerWant) public nonReentrant {
        harvest(_satoshisPerWant);
        uint256 _pool = balance();
        want().transferFrom(msg.sender, address(this), _amount);
        earn(_satoshisPerWant);
        uint256 _after = balance();
        _amount = _after - _pool; // Additional check for deflationary tokens
        uint256 shares = 0;
        if (totalSupply() == 0) {
            shares = _amount;
        } else {
            shares = (_amount * totalSupply()) / _pool;
        }

        _mint(msg.sender, shares);

        userRewardDebt[msg.sender] = (accRewardPerShare * balanceOf(msg.sender)) / 1e12;
    }

    /**
     * @dev Function to send funds into the strategy and put them to work. It's primarily called
     * by the vault's deposit() function.
     */
    function earn(uint256 _satoshisPerWant) public {
        uint256 _bal = available();
        want().transfer(address(strategy), _bal);
        strategy.deposit(_satoshisPerWant);
    }

    /**
     * @dev A helper function to call withdraw() with all the sender's funds.
     */
    function withdrawAll(uint256 _satoshisPerWant) external {
        withdraw(balanceOf(msg.sender), _satoshisPerWant);
    }

    /**
     * @dev Function to exit the system. The vault will withdraw the required tokens
     * from the strategy and pay up the token holder. A proportional number of IOU
     * tokens are burned in the process.
     */
    function withdraw(uint256 _shares, uint256 _satoshisPerWant) public {
        harvest(_satoshisPerWant);

        if (_shares > balanceOf(msg.sender)) {
            _shares = balanceOf(msg.sender);
        }

        uint256 r = (balance() * _shares) / totalSupply();
        _burn(msg.sender, _shares);

        uint b = want().balanceOf(address(this));
        if (b < r) {
            uint _withdraw = r - b;
            strategy.withdraw(_withdraw, _satoshisPerWant);
            uint _after = want().balanceOf(address(this));
            uint _diff = _after - b;
            if (_diff < _withdraw) {
                r = b + _diff;
            }
        }

        userRewardDebt[msg.sender] = (accRewardPerShare * balanceOf(msg.sender)) / 1e12;

        want().transfer(msg.sender, r);
    }

    function addRewards(uint256 _amount) external onlyStrategy {
        accRewardPerShare += (_amount * 1e12) / totalSupply();
    }

    function harvestableRewards(address user) public view returns (uint256) {
        if (totalSupply() == 0 || balanceOf(user) == 0) {
            return 0;
        }
        return ((accRewardPerShare * balanceOf(user)) / 1e12) - userRewardDebt[user];
    }

    function estimatedPendingRewards(address user) public view returns (uint256) {
        return harvestableRewards(user) + ((strategy.estimatedRewardsAvailable() * balanceOf(user)) / totalSupply());
    }

    function _harvest(address user) internal {
        if (balanceOf(user) == 0) {
            return;
        }

        uint256 _pendingRewards = harvestableRewards(user);
        if (_pendingRewards > 0) {
            userTotalRewardsEarned[user] += _pendingRewards;
            bitcoin.transfer(user, _pendingRewards);
        }
        userRewardDebt[user] = (accRewardPerShare * balanceOf(user)) / 1e12;
    }

    function harvest(uint256 _satoshisPerWant) public {
        strategy.harvest(_satoshisPerWant);
        _harvest(msg.sender);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Force both users to harvest their rewards before updating balances
        if (from != address(0) && to != address(0)) {
            _harvest(from);
            _harvest(to);
        }

        // Do the transfer
        super._update(from, to, value);

        // Set the userRewardDebt to the correct values
        if (from != address(0) && to != address(0)) {
            userRewardDebt[from] = (accRewardPerShare * balanceOf(from)) / 1e12;
            userRewardDebt[to] = (accRewardPerShare * balanceOf(to)) / 1e12;
        }
    }

    /**
     * @dev Sets the candidate for the new strat to use with this vault.
     * @param _implementation The address of the candidate strategy.
     */
    function proposeStrat(address _implementation) public onlyOwner {
        require(address(this) == IFoxerStrategy(_implementation).vault(), "Proposal not valid for this Vault");
        require(address(want()) == IFoxerStrategy(_implementation).want(), "Different want");
        stratCandidate = StratCandidate({
            implementation: _implementation,
            proposedTime: block.timestamp
        });

        emit NewStratCandidate(_implementation);
    }

    function setApprovalDelay(uint256 _delay) public onlyOwner {
        require(_delay > approvalDelay, "<=approvalDelay");
        require(_delay <= 604800, ">1 week");
        approvalDelay = _delay;
    }

    /**
     * @dev It switches the active strat for the strat candidate. After upgrading, the
     * candidate implementation is set to the 0x00 address, and proposedTime to a time
     * happening in +100 years for ty.
     */
    function upgradeStrat() public onlyOwner {
        require(stratCandidate.implementation != address(0), "There is no candidate");
        require(stratCandidate.proposedTime + approvalDelay < block.timestamp, "Delay has not passed");

        emit UpgradeStrat(stratCandidate.implementation);

        strategy.retireStrat();
        strategy = IFoxerStrategy(stratCandidate.implementation);
        stratCandidate.implementation = address(0);
        stratCandidate.proposedTime = 5000000000;

        earn(0);
    }

    /**
     * @dev Rescues random funds stuck that the strat can't handle.
     * @param _token address of the token to rescue.
     */
    function inCaseTokensGetStuck(address _token) external onlyOwner {
        require(_token != address(want()), "!token");

        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).transfer(msg.sender, amount);
    }
}
