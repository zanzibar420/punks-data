require('dotenv').config();
const { ethers } = require('ethers');
const pinataSDK = require('@pinata/sdk');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: process.env.RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc',
  PINATA_API_KEY: process.env.PINATA_API_KEY,
  PINATA_SECRET_API_KEY: process.env.PINATA_SECRET_API_KEY,
  
  // Batch configuration
  TOTAL_NFTS: 100000,
  START_TOKEN_ID: 1,
  BATCH_SIZE: 50, // Process in smaller batches
  MINT_RATE_LIMIT: 5, // Mints per second
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000, // 5 seconds
  
  // Paths
  OUTPUT_DIR: path.join(__dirname, 'output'),
  METADATA_DIR: path.join(__dirname, 'output', 'metadata'),
  MINT_LOG_PATH: path.join(__dirname, 'output', 'mint_log.json'),
  TEMPLATE_PATH: path.join('/Users/guppynft/Desktop', 'pia_placeholder_metadata.json'),
  IMAGE_PATH: path.join('/Users/guppynft/Desktop', 'placeholder_pia_qr.png'),
  
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

// Initialize services
const pinata = new pinataSDK(CONFIG.PINATA_API_KEY, CONFIG.PINATA_SECRET_API_KEY);
let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };
let provider, wallet, contract;

async function main() {
  console.log(chalk.cyan('🚀 Players Ink Authentication - Immediate Minting Mode'));
  console.log(chalk.cyan('='.repeat(50)));
  
  try {
    // Validate configuration
    await validateConfig();
    
    // Setup directories
    await setupDirectories();
    
    // Load existing progress
    await loadProgress();
    
    // Initialize blockchain connection
    ({ provider, wallet, contract } = await initializeBlockchain());
    
    // Get or upload placeholder image
    const imageUri = await getOrUploadPlaceholderImage();
    
    // Load template
    const template = await fs.readJSON(CONFIG.TEMPLATE_PATH);
    
    // Find where to start
    const startToken = findNextTokenToProcess();
    console.log(chalk.blue(`\n📍 Starting from token ${startToken}`));
    
    // Process in batches with immediate minting
    for (let batchStart = startToken; batchStart <= CONFIG.TOTAL_NFTS; batchStart += CONFIG.BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + CONFIG.BATCH_SIZE - 1, CONFIG.TOTAL_NFTS);
      console.log(chalk.blue(`\n📦 Processing batch ${batchStart}-${batchEnd}...`));
      
      // Generate metadata for batch
      const batchTokens = [];
      for (let tokenId = batchStart; tokenId <= batchEnd; tokenId++) {
        // Skip if already processed
        if (mintLog.tokens[tokenId]?.status === 'completed') {
          console.log(chalk.gray(`   Token ${tokenId} already minted, skipping...`));
          continue;
        }
        
        // Generate metadata if not exists
        if (!mintLog.tokens[tokenId]?.metadataUri) {
          const paddedId = tokenId.toString().padStart(6, '0');
          const metadata = {
            ...template,
            name: `Players Ink Placeholder #${paddedId}`,
            description: `Players Ink Authentication Certificate #${paddedId} - This Certificate of Authenticity is pending final verification. Please check back soon.`,
            image: imageUri,
            tokenId: paddedId,
            final_metadata_pending: true,
            locked: true,
            attributes: [
              ...template.attributes,
              { trait_type: "Token ID", value: paddedId },
              { trait_type: "Status", value: "Placeholder" }
            ]
          };
          
          // Save metadata locally
          const metadataPath = path.join(CONFIG.METADATA_DIR, `pia_placeholder_${paddedId}.json`);
          await fs.writeJSON(metadataPath, metadata, { spaces: 2 });
          
          // Upload to IPFS
          try {
            const result = await pinata.pinJSONToIPFS(metadata, {
              pinataMetadata: {
                name: `PIA_Placeholder_${paddedId}`,
                keyvalues: {
                  tokenId: paddedId,
                  type: 'placeholder',
                  project: 'PlayersInkAuthentication'
                }
              }
            });
            
            const metadataUri = `ipfs://${result.IpfsHash}`;
            mintLog.tokens[tokenId] = {
              tokenId,
              paddedId,
              metadataUri,
              status: 'pending',
              createdAt: new Date().toISOString()
            };
            
            console.log(chalk.green(`   ✅ Metadata uploaded for token ${tokenId}`));
          } catch (error) {
            console.error(chalk.red(`   ❌ Failed to upload metadata for token ${tokenId}: ${error.message}`));
            continue;
          }
        }
        
        if (mintLog.tokens[tokenId]?.status === 'pending') {
          batchTokens.push(mintLog.tokens[tokenId]);
        }
      }
      
      // Save progress after metadata generation
      await saveMintLog();
      
      // Mint this batch immediately
      if (batchTokens.length > 0) {
        console.log(chalk.blue(`\n🎨 Minting ${batchTokens.length} tokens from this batch...`));
        await mintBatch(batchTokens);
      }
      
      // Print progress
      const completed = Object.values(mintLog.tokens).filter(t => t.status === 'completed').length;
      const progress = (completed / CONFIG.TOTAL_NFTS * 100).toFixed(2);
      console.log(chalk.cyan(`\n📊 Overall Progress: ${completed}/${CONFIG.TOTAL_NFTS} (${progress}%)`));
    }
    
    // Final summary
    printSummary();
    
  } catch (error) {
    console.error(chalk.red('❌ Fatal error:'), error);
    process.exit(1);
  }
}

// Find next token to process
function findNextTokenToProcess() {
  const processedTokens = Object.keys(mintLog.tokens).map(Number).sort((a, b) => a - b);
  if (processedTokens.length === 0) return CONFIG.START_TOKEN_ID;
  
  // Find first gap or return next after highest
  for (let i = 0; i < processedTokens.length - 1; i++) {
    if (processedTokens[i + 1] - processedTokens[i] > 1) {
      return processedTokens[i] + 1;
    }
  }
  
  return Math.min(processedTokens[processedTokens.length - 1] + 1, CONFIG.START_TOKEN_ID);
}

// Mint a batch of tokens
async function mintBatch(tokens) {
  const limit = pLimit(CONFIG.MINT_RATE_LIMIT);
  
  for (const tokenData of tokens) {
    await limit(async () => {
      for (let attempt = 1; attempt <= CONFIG.RETRY_ATTEMPTS; attempt++) {
        try {
          console.log(chalk.blue(`   🎨 Minting token ${tokenData.tokenId}...`));
          
          const tx = await contract.mintURI(wallet.address, tokenData.metadataUri);
          const receipt = await tx.wait();
          
          // Update log
          mintLog.tokens[tokenData.tokenId] = {
            ...tokenData,
            status: 'completed',
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            completedAt: new Date().toISOString()
          };
          
          console.log(chalk.green(`   ✅ Token ${tokenData.tokenId} minted (TX: ${receipt.hash})`));
          break; // Success
          
        } catch (error) {
          console.error(chalk.red(`   ❌ Attempt ${attempt}/${CONFIG.RETRY_ATTEMPTS} failed: ${error.message}`));
          
          if (attempt === CONFIG.RETRY_ATTEMPTS) {
            mintLog.tokens[tokenData.tokenId] = {
              ...tokenData,
              status: 'failed',
              error: error.message,
              failedAt: new Date().toISOString()
            };
          } else {
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
          }
        }
      }
    });
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000 / CONFIG.MINT_RATE_LIMIT));
  }
  
  await saveMintLog();
}

// Validate configuration
async function validateConfig() {
  if (!CONFIG.PRIVATE_KEY) throw new Error('PRIVATE_KEY not found');
  if (!CONFIG.PINATA_API_KEY || !CONFIG.PINATA_SECRET_API_KEY) throw new Error('Pinata keys not found');
  
  await pinata.testAuthentication();
  console.log(chalk.green('✅ Configuration validated'));
}

// Setup directories
async function setupDirectories() {
  await fs.ensureDir(CONFIG.OUTPUT_DIR);
  await fs.ensureDir(CONFIG.METADATA_DIR);
}

// Load existing progress
async function loadProgress() {
  if (await fs.pathExists(CONFIG.MINT_LOG_PATH)) {
    mintLog = await fs.readJSON(CONFIG.MINT_LOG_PATH);
    const completed = Object.values(mintLog.tokens).filter(t => t.status === 'completed').length;
    const pending = Object.values(mintLog.tokens).filter(t => t.status === 'pending').length;
    
    if (completed > 0 || pending > 0) {
      console.log(chalk.yellow(`📊 Resuming from previous session:`));
      console.log(chalk.yellow(`   - Completed: ${completed}`));
      console.log(chalk.yellow(`   - Pending: ${pending}`));
      console.log(chalk.yellow(`   - Total processed: ${Object.keys(mintLog.tokens).length}`));
    }
  }
}

// Get or upload placeholder image
async function getOrUploadPlaceholderImage() {
  if (mintLog.placeholderImageUri) {
    return mintLog.placeholderImageUri;
  }
  
  console.log(chalk.blue('🖼️  Uploading placeholder image...'));
  const imageStream = fs.createReadStream(CONFIG.IMAGE_PATH);
  const result = await pinata.pinFileToIPFS(imageStream, {
    pinataMetadata: {
      name: 'PIA_Placeholder_QR',
      keyvalues: { type: 'placeholder', project: 'PlayersInkAuthentication' }
    }
  });
  
  const imageUri = `ipfs://${result.IpfsHash}`;
  mintLog.placeholderImageUri = imageUri;
  await saveMintLog();
  
  return imageUri;
}

// Initialize blockchain
async function initializeBlockchain() {
  console.log(chalk.blue('🔗 Connecting to blockchain...'));
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(chalk.green(`✅ Connected. Balance: ${ethers.formatEther(balance)} BTIC`));
  
  return { provider, wallet, contract };
}

// Save mint log
async function saveMintLog() {
  const tokens = Object.values(mintLog.tokens);
  mintLog.summary = {
    total: tokens.length,
    successful: tokens.filter(t => t.status === 'completed').length,
    failed: tokens.filter(t => t.status === 'failed').length,
    pending: tokens.filter(t => t.status === 'pending').length
  };
  
  mintLog.lastUpdated = new Date().toISOString();
  await fs.writeJSON(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
}

// Print summary
function printSummary() {
  console.log(chalk.cyan('\n' + '='.repeat(50)));
  console.log(chalk.cyan('📊 FINAL SUMMARY'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.green(`✅ Successful: ${mintLog.summary.successful}`));
  console.log(chalk.red(`❌ Failed: ${mintLog.summary.failed}`));
  console.log(chalk.yellow(`⏳ Pending: ${mintLog.summary.pending}`));
  console.log(chalk.blue(`📁 Total: ${mintLog.summary.total}`));
  console.log(chalk.cyan('='.repeat(50)));
}

// Run
main().catch(error => {
  console.error(chalk.red('❌ Unhandled error:'), error);
  process.exit(1);
});