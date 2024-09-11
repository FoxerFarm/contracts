// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FoxerVaultFactory is Ownable {
    uint256 public version = 1;
    address public implementationContract;
    address[] public allClones;

    event NewClone(address indexed _instance);

    constructor(address _implementation) Ownable(msg.sender) {
        implementationContract = _implementation;
    }

    function createClone(
        address _owner,
        address _wbtc,
        address _strategy,
        string memory _name,
        string memory _symbol,
        uint256 _approvalDelay
    ) payable external onlyOwner returns(address instance) {
        instance = Clones.clone(implementationContract);
        (bool success, ) = instance.call{value: msg.value}(abi.encodeWithSignature(
            "initialize(address,address,address,string,string,uint256)",
            _owner, _wbtc, _strategy, _name, _symbol, _approvalDelay
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
