# Batch Minting Optimization Guide

## Overview
This implementation provides optimized batch minting for LayerZero-enabled ERC721 contracts with support for single and multi-signer configurations.

## Features

### Smart Contract Enhancements
- ✅ `batchMint(address[], string[])` - Mint multiple tokens with different URIs
- ✅ `batchMintSameURI(address[], string)` - Gas-optimized for identical URIs
- ✅ Authorization system with `authorizedMinters` mapping
- ✅ Event logging for batch operations
- ✅ Error handling with detailed failure reporting

### Node.js Scripts
- ✅ **Single Signer**: `batch-mint-optimized.js` - Basic batch minting
- ✅ **Multi-Signer**: `multi-signer-batch-mint.js` - High-throughput parallel minting
- ✅ Round-robin RPC endpoint usage
- ✅ Comprehensive error handling and retry logic
- ✅ Real-time progress tracking
- ✅ Detailed reporting and analytics

## Installation

1. Install dependencies:
```bash
npm install ethers@^6.8.0 fs-extra@^11.1.1 chalk@^4.1.2 dotenv@^16.3.1
```

2. Set up environment variables:
```bash
cp .env.batch-minting .env
# Edit .env with your configuration
```

## Smart Contract Integration

### 1. Add to your existing contract:

```solidity
// Import the batch minting upgrade
import "./contracts/BatchMintingUpgrade.sol";

contract YourERC721Contract is ERC721, BatchMintingUpgrade {
    // Your existing contract code...
    
    // Implement required functions
    function _nextTokenId() internal view override returns (uint256) {
        return _currentIndex; // Use your token counter
    }
    
    function _safeMint(address to, uint256 tokenId) internal override {
        _mint(to, tokenId);
    }
    
    function _setTokenURI(uint256 tokenId, string memory uri) internal override {
        _tokenURIs[tokenId] = uri;
    }
}
```

### 2. Deploy contract upgrades:

```bash
# Authorize your minting addresses
cast send $CONTRACT_ADDRESS "setAuthorizedMinter(address,bool)" $MINTER_ADDRESS true --private-key $PRIVATE_KEY
```

## Usage

### Single Signer Batch Minting

1. **Create recipient data**:
```bash
node batch-mint-optimized.js --create-example
```

2. **Edit `data/recipients.json`**:
```json
[
  {
    "address": "0x1234567890123456789012345678901234567890",
    "uri": "ipfs://QmYourMetadataHash1"
  },
  {
    "address": "0x2345678901234567890123456789012345678901",
    "uri": "ipfs://QmYourMetadataHash2"
  }
]
```

3. **Run batch minting**:
```bash
node batch-mint-optimized.js
```

### Multi-Signer High-Throughput Minting

1. **Configure multiple signers in `.env`**:
```bash
SIGNER_KEY_1=0x1111111111111111111111111111111111111111111111111111111111111111
SIGNER_KEY_2=0x2222222222222222222222222222222222222222222222222222222222222222
SIGNER_KEY_3=0x3333333333333333333333333333333333333333333333333333333333333333
```

2. **Authorize all signers**:
```bash
# For each signer address
cast send $CONTRACT_ADDRESS "setAuthorizedMinter(address,bool)" $SIGNER_ADDRESS true --private-key $OWNER_KEY
```

3. **Run multi-signer minting**:
```bash
node multi-signer-batch-mint.js
```

## Configuration Options

### Batch Minting Config
```javascript
const CONFIG = {
  BATCH_SIZE: 25,           // Tokens per batch
  BATCH_DELAY: 2000,        // Delay between batches (ms)
  RETRY_ATTEMPTS: 5,        // Max retry attempts
  TX_TIMEOUT: 120000,       // Transaction timeout (ms)
  CONCURRENT_SIGNERS: 3,    // Multi-signer concurrency
}
```

### Performance Expectations

| Configuration | Throughput | Use Case |
|---------------|------------|----------|
| Single Signer | ~1-2 tokens/sec | Small batches, testing |
| Multi-Signer (3) | ~5-10 tokens/sec | Medium batches |
| Multi-Signer (5) | ~10-20 tokens/sec | Large batches |

## Monitoring and Analytics

### Real-time Monitoring
- ✅ Batch completion times
- ✅ Individual signer performance
- ✅ Error rates and classifications
- ✅ Gas usage tracking
- ✅ Token ID assignments

### Output Files
- `output/batch_mint_results.json` - Detailed results
- `output/multi_signer_results.json` - Multi-signer stats
- Console logs with color-coded status

## Error Handling

### Automatic Retry Logic
- ✅ Network timeouts
- ✅ Nonce conflicts
- ✅ Gas estimation failures
- ✅ RPC endpoint failures

### Failure Recovery
- ✅ Automatic nonce resetting
- ✅ RPC endpoint failover
- ✅ Partial batch success handling
- ✅ Detailed error logging

## Advanced Features

### Gas Optimization
- ✅ `batchMintSameURI()` for identical metadata
- ✅ Dynamic batch sizing based on gas limits
- ✅ Efficient event parsing

### Scalability
- ✅ Round-robin RPC endpoint usage
- ✅ Concurrent signer management
- ✅ Nonce conflict prevention
- ✅ Load balancing across signers

## Troubleshooting

### Common Issues

1. **"Not authorized to mint"**
   - Solution: Run `setAuthorizedMinter()` for each signer

2. **Nonce conflicts**
   - Solution: Script automatically resets nonces

3. **RPC timeouts**
   - Solution: Add more RPC endpoints to `RPC_ENDPOINTS` array

4. **Gas estimation failures**
   - Solution: Increase `TX_TIMEOUT` or reduce `BATCH_SIZE`

### Debug Mode
```bash
DEBUG=1 node batch-mint-optimized.js
```

## Security Considerations

- ✅ Authorization checks in smart contract
- ✅ ReentrancyGuard protection
- ✅ Input validation for addresses and URIs
- ✅ Event logging for audit trails
- ✅ Private key management best practices

## Performance Optimization Tips

1. **Batch Size**: Start with 25, adjust based on gas limits
2. **Concurrent Signers**: Use 3-5 signers for optimal performance
3. **RPC Endpoints**: Use multiple high-quality RPC endpoints
4. **Network Timing**: Consider network congestion patterns
5. **Monitoring**: Watch for nonce conflicts and adjust delays

## Support

For issues or questions:
1. Check the console logs for detailed error messages
2. Review the generated result files for batch-specific data
3. Ensure all signers are properly authorized
4. Verify RPC endpoint connectivity