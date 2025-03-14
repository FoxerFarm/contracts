// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IFoxerVault {
    function strategy() external view returns (address);
    function addRewards(uint256 _amount) external;
}
