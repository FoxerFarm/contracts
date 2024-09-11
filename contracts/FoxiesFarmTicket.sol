// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FoxiesFarmTicket is ERC721, Ownable {
    using Strings for uint256;

    fallback() external payable{}
    receive() external payable{}

    uint256 public mintPrice;
    uint256 public incrementPrice;
    uint256 public totalSupply;
    string public baseURI;
    address public treasury;

    event Minted(address indexed owner, uint256 indexed tokenId, uint256 price);

    constructor() ERC721("Foxies Farm Ticket", "FOXTIKT") Ownable(msg.sender) {
        mintPrice = 1 ether;
        incrementPrice = 1 ether;
        baseURI = "https://nft.foxer.farm/core/ticket";
        treasury = 0xa123788F1fE1Bb9Aa406579a85547148CB80B1AC;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseURI(), "/", tokenId.toString());
    }

    function mint() external payable {
        require(msg.value >= mintPrice, "Insufficient amount sent");
        require(balanceOf(msg.sender) == 0, "You already own a ticket");

        totalSupply++;
        _safeMint(msg.sender, totalSupply);
        emit Minted(msg.sender, totalSupply, mintPrice);

        mintPrice += incrementPrice;

        payable(treasury).transfer(msg.value);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setMintPrice(uint256 _mintPrice) external onlyOwner {
        mintPrice = _mintPrice;
    }

    function setIncrementPrice(uint256 _incrementPrice) external onlyOwner {
        incrementPrice = _incrementPrice;
    }

    function setBaseURI(string memory _newBaseURI) external onlyOwner {
        baseURI = _newBaseURI;
    }

    function withdrawTokens(address _token) external onlyOwner {
        IERC20(_token).transfer(msg.sender, IERC20(_token).balanceOf(address(this)));
    }

    function withdrawNFT(address _token, uint256 _tokenId) external onlyOwner {
        IERC721(_token).transferFrom(address(this), msg.sender, _tokenId);
    }

    function withdrawETH() external onlyOwner {
        payable(msg.sender).transfer(address(this).balance);
    }
}
