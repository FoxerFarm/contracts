// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IFoxerStrategy {

    event StratHarvest(address indexed harvester, uint256 wantHarvested, uint256 bitcoinHarvested, uint256 tvl);
    event Deposit(uint256 tvl);
    event Withdraw(uint256 tvl);
    event ChargedFees(uint256 performanceFee);

    function vault() external view returns (address);
    function want() external view returns (address);
    function wheat() external view returns (address);
    function deposit(uint256) external;
    function withdraw(uint256, uint256) external;
    function tvl() external view returns (uint256);
    function balanceOfWant() external view returns (uint256);
    function balanceOfPool() external view returns (uint256);
    function estimatedRewardsAvailable() external view returns (uint256);
    function harvest(uint256) external;
    function panic() external;
    function pause() external;
    function unpause() external;
}
