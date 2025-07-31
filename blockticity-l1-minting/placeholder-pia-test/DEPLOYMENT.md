# Blockticity LayerZero Contract Deployment

## Blockticity Contract Addresses

**Mainnet (Blockticity Avalanche L1)**  
- Address: `0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926`  
- Chain ID: 28530  
- RPC: https://subnets.avax.network/btic/mainnet/rpc

**Testnet (Blockticity Avalanche L1 Testnet)**  
- Address: `0x600D115075768548527BCcd156ccC921D7861f87`  
- Chain ID: 75234  
- RPC: https://subnets.avax.network/btest/testnet/rpc

## Environment Configuration

### Mainnet (.env)
```bash
MAINNET_CONTRACT=0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926
CONTRACT_ADDRESS=0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926
CHAIN_ID=28530
RPC_URL=https://subnets.avax.network/btic/mainnet/rpc
```

### Testnet (.env.test)
```bash
TESTNET_CONTRACT=0x600D115075768548527BCcd156ccC921D7861f87
CONTRACT_ADDRESS=0x600D115075768548527BCcd156ccC921D7861f87
CHAIN_ID=75234
RPC_URL=https://subnets.avax.network/btest/testnet/rpc
```

## Usage

All scripts have been updated to use environment variables:
- `process.env.MAINNET_CONTRACT` for mainnet operations
- `process.env.TESTNET_CONTRACT` for testnet operations
- Fallback to `process.env.CONTRACT_ADDRESS` for backward compatibility

To switch between networks:
1. **Mainnet**: Use `.env` file (default)
2. **Testnet**: Copy `.env.test` to `.env` or set `NODE_ENV=test`

## Verification

To verify contract deployment:

### Mainnet
```bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926", "latest"],"id":1}' \
  https://subnets.avax.network/btic/mainnet/rpc
```

### Testnet
```bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x600D115075768548527BCcd156ccC921D7861f87", "latest"],"id":1}' \
  https://subnets.avax.network/btest/testnet/rpc
```

## Updated Scripts

The following scripts have been updated to use the new environment variables:
- `authorize-signers.js`
- `batch-mint-optimized.js`
- `inspect-contract.js`
- `mint_batch_*.js`
- `multi-signer-batch-mint.js`

All scripts now use `process.env.MAINNET_CONTRACT` with fallback to `process.env.CONTRACT_ADDRESS`.