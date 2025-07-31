// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title BatchMintingUpgrade
 * @dev Extension for your existing ERC721 contract to add batch minting capabilities
 * Add these functions to your existing LayerZero-enabled ERC721 contract
 */
abstract contract BatchMintingUpgrade is Ownable, ReentrancyGuard {
    
    // Events
    event BatchMinted(uint256 indexed startTokenId, uint256 count, address indexed minter);
    event BatchMintFailed(uint256 indexed failureIndex, address indexed recipient, string reason);
    
    // Authorized minters mapping
    mapping(address => bool) public authorizedMinters;
    
    // Modifiers
    modifier onlyAuthorizedMinter() {
        require(
            authorizedMinters[msg.sender] || msg.sender == owner(),
            "Not authorized to mint"
        );
        _;
    }
    
    /**
     * @dev Add/remove authorized minters
     * @param minter Address to authorize/deauthorize
     * @param authorized Whether to authorize or deauthorize
     */
    function setAuthorizedMinter(address minter, bool authorized) external onlyOwner {
        require(minter != address(0), "Invalid minter address");
        authorizedMinters[minter] = authorized;
    }
    
    /**
     * @dev Batch mint NFTs to multiple recipients
     * @param to Array of recipient addresses
     * @param uri Array of token URIs corresponding to each recipient
     * @return startTokenId The first token ID minted in this batch
     * @return count Number of tokens successfully minted
     */
    function batchMint(
        address[] calldata to,
        string[] calldata uri
    ) external onlyAuthorizedMinter nonReentrant returns (uint256 startTokenId, uint256 count) {
        require(to.length > 0, "Empty batch");
        require(to.length == uri.length, "Arrays length mismatch");
        require(to.length <= 50, "Batch too large"); // Gas limit protection
        
        startTokenId = _nextTokenId(); // Assuming your contract has this function
        count = 0;
        
        for (uint256 i = 0; i < to.length; i++) {
            address recipient = to[i];
            string memory tokenUri = uri[i];
            
            // Validate recipient
            if (recipient == address(0)) {
                emit BatchMintFailed(i, recipient, "Invalid recipient address");
                continue;
            }
            
            // Validate URI
            if (bytes(tokenUri).length == 0) {
                emit BatchMintFailed(i, recipient, "Empty URI");
                continue;
            }
            
            try this._safeMintWithURI(recipient, tokenUri) {
                count++;
            } catch Error(string memory reason) {
                emit BatchMintFailed(i, recipient, reason);
            } catch {
                emit BatchMintFailed(i, recipient, "Unknown error");
            }
        }
        
        require(count > 0, "No tokens minted");
        
        emit BatchMinted(startTokenId, count, msg.sender);
        
        return (startTokenId, count);
    }
    
    /**
     * @dev Internal function to safely mint with URI
     * @param to Recipient address
     * @param tokenUri Token URI
     */
    function _safeMintWithURI(address to, string memory tokenUri) external {
        require(msg.sender == address(this), "Internal function only");
        
        uint256 tokenId = _nextTokenId();
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenUri);
    }
    
    /**
     * @dev Batch mint identical URI to multiple recipients (gas optimized)
     * @param to Array of recipient addresses
     * @param uri Single URI for all tokens
     * @return startTokenId The first token ID minted in this batch
     * @return count Number of tokens successfully minted
     */
    function batchMintSameURI(
        address[] calldata to,
        string calldata uri
    ) external onlyAuthorizedMinter nonReentrant returns (uint256 startTokenId, uint256 count) {
        require(to.length > 0, "Empty batch");
        require(to.length <= 50, "Batch too large");
        require(bytes(uri).length > 0, "Empty URI");
        
        startTokenId = _nextTokenId();
        count = 0;
        
        for (uint256 i = 0; i < to.length; i++) {
            address recipient = to[i];
            
            if (recipient == address(0)) {
                emit BatchMintFailed(i, recipient, "Invalid recipient address");
                continue;
            }
            
            try this._safeMintWithURI(recipient, uri) {
                count++;
            } catch Error(string memory reason) {
                emit BatchMintFailed(i, recipient, reason);
            } catch {
                emit BatchMintFailed(i, recipient, "Unknown error");
            }
        }
        
        require(count > 0, "No tokens minted");
        
        emit BatchMinted(startTokenId, count, msg.sender);
        
        return (startTokenId, count);
    }
    
    /**
     * @dev Get the next token ID to be minted
     * This should be implemented in your main contract
     */
    function _nextTokenId() internal view virtual returns (uint256);
    
    /**
     * @dev Safe mint function - should be implemented in your main contract
     */
    function _safeMint(address to, uint256 tokenId) internal virtual;
    
    /**
     * @dev Set token URI function - should be implemented in your main contract
     */
    function _setTokenURI(uint256 tokenId, string memory tokenUri) internal virtual;
}