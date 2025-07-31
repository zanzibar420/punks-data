# Players Ink Authentication Placeholder Minting - Deployment Checklist

## Pre-Deployment Steps

### 1. Install Dependencies
```bash
cd /Users/guppynft/blockticity-l1-minting/placeholder-pia-test
npm install
```

### 2. Test Connections
```bash
node test-connection.js
```

### 3. Verify Configuration
- ✅ Contract Address: `0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926`
- ✅ Network: Blockticity L1 Mainnet (Chain ID: 28530)
- ✅ Wallet has sufficient BTIC balance for gas fees
- ✅ Pinata API keys are valid
- ✅ Input files exist on desktop

### 4. Estimate Costs
- **Gas per mint**: ~150,000 gas units
- **Total mints**: 100,000 NFTs
- **Rate**: 5 mints per second
- **Estimated time**: ~5.5 hours
- **IPFS storage**: ~10GB for metadata

## Deployment Commands

### Test Run (10 NFTs)
```bash
npm start -- --test
```

### Production Run (100,000 NFTs)
```bash
npm start
```

## Monitoring During Deployment

1. **Check Progress**:
   - Monitor `output/mint_log.json`
   - Watch console for real-time updates

2. **Verify on Explorer**:
   - https://subnets.avax.network/btic/address/0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926

3. **Check IPFS Uploads**:
   - Pinata dashboard: https://app.pinata.cloud

## Post-Deployment

1. **Backup mint log**:
```bash
cp output/mint_log.json output/mint_log_backup_$(date +%Y%m%d_%H%M%S).json
```

2. **Generate summary report**:
```bash
node -e "const log = require('./output/mint_log.json'); console.log(log.summary)"
```

3. **Verify random samples**:
   - Check metadata URIs resolve correctly
   - Verify NFT ownership on blockchain

## Troubleshooting

### If script fails:
1. Script automatically resumes from last successful mint
2. Simply run `npm start` again
3. Check `output/mint_log.json` for failed tokens

### Common issues:
- **Insufficient gas**: Top up wallet with BTIC
- **Rate limit errors**: Reduce MINT_RATE_LIMIT in .env
- **Pinata errors**: Check API key limits

## Emergency Stop
Press `Ctrl+C` to stop the script safely. Progress is saved automatically.