# Players Ink Authentication - Placeholder NFT Minter

This tool batch mints 100,000 placeholder NFTs for Players Ink Authentication on Blockticity L1 mainnet.

## Features

- ✅ Batch minting of 100,000 placeholder NFTs
- ✅ Automatic metadata generation with padded token IDs
- ✅ IPFS upload via Pinata
- ✅ Rate-limited minting (5-10 TPS)
- ✅ Resumable in case of interruption
- ✅ Comprehensive logging and progress tracking
- ✅ Test mode for validation

## Setup

1. Install dependencies:
```bash
cd /Users/guppynft/blockticity-l1-minting/placeholder-pia-test
npm install
```

2. Configure environment variables:
```bash
cp .env.template .env
# Edit .env with your actual values
```

3. Ensure input files are on desktop:
- `/Users/guppynft/Desktop/placeholder_pia_qr.png`
- `/Users/guppynft/Desktop/pia_placeholder_metadata.json`

## Usage

### Test Mode (10 NFTs)
```bash
npm start -- --test
```

### Production Mode (100,000 NFTs)
```bash
npm start
```

## Output

- **Metadata files**: `output/metadata/pia_placeholder_XXXXXX.json`
- **Mint log**: `output/mint_log.json`

## Mint Log Structure

```json
{
  "placeholderImageUri": "ipfs://...",
  "tokens": {
    "1": {
      "tokenId": 1,
      "paddedId": "000001",
      "metadataUri": "ipfs://...",
      "status": "completed",
      "txHash": "0x...",
      "blockNumber": 12345,
      "gasUsed": "150000",
      "createdAt": "2025-06-14T...",
      "completedAt": "2025-06-14T..."
    }
  },
  "summary": {
    "total": 100000,
    "successful": 99950,
    "failed": 50,
    "pending": 0
  }
}
```

## Resuming After Interruption

The script automatically resumes from where it left off:
1. Skips already uploaded metadata
2. Skips already minted tokens
3. Retries failed tokens

Simply run `npm start` again to continue.

## Rate Limiting

- Default: 5 mints per second
- Adjustable via `MINT_RATE_LIMIT` in .env
- Prevents RPC overload

## Error Handling

- 3 retry attempts per mint
- 5-second delay between retries
- Failed mints logged for manual review

## Monitoring

The script provides real-time progress updates:
- Metadata upload progress
- Minting progress with percentage
- Transaction hashes for verification
- Final summary statistics