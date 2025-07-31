# Contract Verification Files

## Contract Information
- **Contract Address:** `0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926`
- **Network:** Blockticity L1 (Chain ID: 28530)
- **Contract Type:** LayerZero-enabled ERC-721 NFT Contract

## Required Files for Verification
To verify this contract on Avalanche block explorer, you need:

1. **BlockticityLayerZero.sol** - The main contract source file
2. **BlockticityLayerZero.json** - Compilation metadata with bytecode hash and compiler settings

## Current Status
❌ **Contract source files NOT FOUND in this project**

This project appears to be a minting client for an already-deployed contract. The actual contract source code and compilation artifacts are not present here.

## Next Steps
1. **Locate the deployment project** that contains the original contract files
2. **Check if contract is already verified** on the block explorer
3. **Retrieve source from block explorer** if already verified
4. **Contact the contract deployer** for the original source files

## Available Files
- `abi/BlockticityLayerZero_ABI.json` - Contract ABI (3 functions: mintURI, owner, paused)
- `contracts/BatchMintingUpgrade.sol` - Abstract contract for batch minting (not the deployed contract)

## Contract Functions (from ABI)
```solidity
function mintURI(address to, string uri) external
function owner() external view returns (address)  
function paused() external view returns (bool)
```