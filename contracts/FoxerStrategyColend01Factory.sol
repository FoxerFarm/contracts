// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FoxerStrategyColend01Factory is Ownable {
    uint256 public version = 1;
    address public implementationContract;
    address[] public allClones;

    event NewClone(address indexed _instance);

    constructor(address _implementation) Ownable(msg.sender) {
        implementationContract = _implementation;
    }

    function createClone(
        address _owner,
        address _want,
        address _bitcoin,
        address _feeRecipient,
        uint256 _performanceFeePer1000,
        address _dataProvider,
        address _swapRouter,
        address[] calldata _swapPath,
        uint256 _swapThreshold
    ) payable external onlyOwner returns(address instance) {
        instance = Clones.clone(implementationContract);
        (bool success, ) = instance.call{value: msg.value}(abi.encodeWithSignature(
            "initialize(address,address,address,address,uint256,address,address,address[],uint256)",
            _owner, _want, _bitcoin, _feeRecipient, _performanceFeePer1000, _dataProvider, _swapRouter, _swapPath, _swapThreshold
        ));
        require(success, "Failed to initialize");
        allClones.push(instance);
        emit NewClone(instance);
        return instance;
    }

    function allClonesLength() external view returns (uint256) {
        return allClones.length;
    }

    function latestClone() external view returns (address) {
        return allClones[allClones.length - 1];
    }
}
