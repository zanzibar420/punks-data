# Blockticity Minting Project Transfer Guide

## Essential Files and Folders to Copy

### 1. **Root Project Directory**
Copy the entire directory: `/Users/guppynft/blockticity-l1-minting/placeholder-pia-test/`

### 2. **Critical Files** (MUST HAVE)

#### Environment Configuration
- `.env` - Contains your private keys and API credentials
  - PRIVATE_KEY (wallet private key)
  - RPC_URL 
  - CONTRACT_ADDRESS
  - PINATA_API_KEY
  - PINATA_SECRET_API_KEY

#### Core Scripts
- `mint_existing_metadata_improved.js` - The improved minting script with timeout protection
- `mint_existing_metadata.js` - Original minting script
- `generate_batch3_placeholders.js` - Script to generate new batches
- `generate_additional_placeholders.js` - Additional placeholder generator

#### Contract ABI
- `abi/BlockticityLayerZero_ABI.json` - Smart contract interface

### 3. **Mint Logs** (Track Progress)
- `output/batch2_mint_log.json` - Batch 2 minting progress (80,401 tokens)
- `output/batch3_mint_log.json` - Batch 3 minting progress (100,000 tokens)
- `output/next_placeholder_log.json` - Batch 1 retry log

### 4. **Metadata Folders** (Optional - Very Large)
These folders contain 100,000+ JSON files each. You may want to:
- Option A: Copy them all (several GB)
- Option B: Only copy the mint logs and regenerate metadata on the new machine

Folders:
- `output/metadata/` - Original batch metadata
- `output/metadata_batch2/` - Batch 2 (80,401 files)
- `output/metadata_batch3/` - Batch 3 (100,000 files)
- `retry_metadata/` - Failed tokens from batch 1

### 5. **Output Logs** (Optional)
- `retry_metadata/batch*.log` - Minting process logs
- Various output files showing minting history

## Quick Setup on New Machine

1. **Install Node.js** (v16 or higher)

2. **Copy the project folder** to your new machine

3. **Install dependencies**:
   ```bash
   cd /path/to/blockticity-l1-minting/placeholder-pia-test
   npm install
   ```

4. **Verify .env file** has all credentials

5. **Continue minting** where you left off:
   ```bash
   # For batch 3 (current batch)
   node mint_existing_metadata_improved.js --inputDir=output/metadata_batch3 --logPath=output/batch3_mint_log.json
   ```

## Key Commands

### Check Current Progress
```bash
node -e "
const fs = require('fs');
const log = JSON.parse(fs.readFileSync('output/batch3_mint_log.json', 'utf8'));
const tokens = Object.values(log.tokens);
const completed = tokens.filter(t => t.status === 'completed').length;
const pending = tokens.filter(t => t.status === 'pending').length;
console.log('Completed:', completed);
console.log('Pending:', pending);
console.log('Progress:', ((completed/tokens.length)*100).toFixed(2) + '%');
"
```

### Generate New Batch (if needed)
```bash
# Edit generate_batch3_placeholders.js to change token range
# Then run:
node generate_batch3_placeholders.js
```

### Resume Minting
```bash
# The script automatically picks up where it left off
node mint_existing_metadata_improved.js --inputDir=output/metadata_batch3 --logPath=output/batch3_mint_log.json
```

## Important Notes

1. **Private Key Security**: The .env file contains sensitive information. Keep it secure!

2. **Minting Progress**: The mint logs track which tokens are completed/failed/pending. The script automatically resumes from pending tokens.

3. **Network Issues**: The improved script handles network issues better with:
   - Timeout protection (30s max per retry)
   - Auto-exit after 5 minutes of no progress
   - Exponential backoff

4. **Current Status** (as of last check):
   - Batch 1: 14,662 completed
   - Batch 2: 70,804 completed (finished)
   - Batch 3: In progress (100,000 tokens)

## Minimal Transfer (If Space is Limited)

If you can't copy everything, at minimum copy:
1. `.env` file
2. All `.js` scripts in the root
3. `abi/` folder
4. All `*_mint_log.json` files from `output/`
5. This guide file

You can regenerate metadata files using the generator scripts.

## Contact for CLAUDE.md File
The CLAUDE.md file in the parent directory contains important context about the Blockticity project. Consider copying it as well for full context.