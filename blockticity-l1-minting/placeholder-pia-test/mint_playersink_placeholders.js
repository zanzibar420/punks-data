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
  TOTAL_NFTS: 100000, // Full production run
  START_TOKEN_ID: 1,
  BATCH_SIZE: 100, // Upload metadata in batches
  MINT_RATE_LIMIT: 5, // Mints per second
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000, // 5 seconds
  
  // Paths
  OUTPUT_DIR: path.join(__dirname, 'output'),
  METADATA_DIR: path.join(__dirname, 'output', 'metadata'),
  MINT_LOG_PATH: path.join(__dirname, 'output', 'mint_log.json'),
  TEMPLATE_PATH: path.join('/Users/guppynft/Desktop', 'pia_placeholder_metadata.json'),
  IMAGE_PATH: path.join('/Users/guppynft/Desktop', 'placeholder_pia_qr.png'),
  
  // Contract ABI (minimal required functions)
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

// Initialize services
const pinata = new pinataSDK(CONFIG.PINATA_API_KEY, CONFIG.PINATA_SECRET_API_KEY);

// Progress tracking
let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };

// Main function
async function main() {
  console.log(chalk.cyan('🚀 Players Ink Authentication Placeholder Minter'));
  console.log(chalk.cyan('='.repeat(50)));
  
  // Check for test mode
  const isTestMode = process.argv.includes('--test');
  const totalToMint = isTestMode ? 10 : CONFIG.TOTAL_NFTS;
  
  if (isTestMode) {
    console.log(chalk.yellow('⚠️  Running in TEST MODE - Will only mint 10 NFTs'));
  }
  
  try {
    // Validate configuration
    await validateConfig();
    
    // Setup directories
    await setupDirectories();
    
    // Load existing progress if resuming
    await loadProgress();
    
    // Upload placeholder image to IPFS (if not already uploaded)
    const imageUri = await uploadPlaceholderImage();
    
    // Generate and upload metadata
    console.log(chalk.blue('\n📝 Generating metadata...'));
    await generateAndUploadMetadata(totalToMint, imageUri);
    
    // Initialize blockchain connection
    const { provider, wallet, contract } = await initializeBlockchain();
    
    // Mint NFTs
    console.log(chalk.blue('\n🎨 Starting minting process...'));
    await mintNFTs(wallet, contract, totalToMint);
    
    // Final summary
    printSummary();
    
  } catch (error) {
    console.error(chalk.red('❌ Fatal error:'), error);
    process.exit(1);
  }
}

// Validate configuration
async function validateConfig() {
  console.log(chalk.blue('🔍 Validating configuration...'));
  
  if (!CONFIG.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not found in environment variables');
  }
  
  if (!CONFIG.PINATA_API_KEY || !CONFIG.PINATA_SECRET_API_KEY) {
    throw new Error('Pinata API keys not found in environment variables');
  }
  
  // Test Pinata connection
  try {
    await pinata.testAuthentication();
    console.log(chalk.green('✅ Pinata authentication successful'));
  } catch (error) {
    throw new Error(`Pinata authentication failed: ${error.message}`);
  }
  
  // Check template files exist
  if (!await fs.pathExists(CONFIG.TEMPLATE_PATH)) {
    throw new Error(`Template file not found: ${CONFIG.TEMPLATE_PATH}`);
  }
  
  if (!await fs.pathExists(CONFIG.IMAGE_PATH)) {
    throw new Error(`Image file not found: ${CONFIG.IMAGE_PATH}`);
  }
  
  console.log(chalk.green('✅ Configuration validated'));
}

// Setup directories
async function setupDirectories() {
  await fs.ensureDir(CONFIG.OUTPUT_DIR);
  await fs.ensureDir(CONFIG.METADATA_DIR);
  console.log(chalk.green('✅ Output directories created'));
}

// Load existing progress
async function loadProgress() {
  if (await fs.pathExists(CONFIG.MINT_LOG_PATH)) {
    mintLog = await fs.readJSON(CONFIG.MINT_LOG_PATH);
    const pending = Object.values(mintLog.tokens).filter(t => t.status === 'pending').length;
    const completed = Object.values(mintLog.tokens).filter(t => t.status === 'completed').length;
    
    if (pending > 0 || completed > 0) {
      console.log(chalk.yellow(`📊 Resuming from previous session:`));
      console.log(chalk.yellow(`   - Completed: ${completed}`));
      console.log(chalk.yellow(`   - Pending: ${pending}`));
    }
  }
}

// Upload placeholder image
async function uploadPlaceholderImage() {
  console.log(chalk.blue('\n🖼️  Uploading placeholder image to IPFS...'));
  
  // Check if already uploaded in previous run
  if (mintLog.placeholderImageUri) {
    console.log(chalk.green(`✅ Using existing image: ${mintLog.placeholderImageUri}`));
    return mintLog.placeholderImageUri;
  }
  
  try {
    const imageStream = fs.createReadStream(CONFIG.IMAGE_PATH);
    const result = await pinata.pinFileToIPFS(imageStream, {
      pinataMetadata: {
        name: 'PIA_Placeholder_QR',
        keyvalues: {
          type: 'placeholder',
          project: 'PlayersInkAuthentication'
        }
      }
    });
    
    const imageUri = `ipfs://${result.IpfsHash}`;
    mintLog.placeholderImageUri = imageUri;
    await saveMintLog();
    
    console.log(chalk.green(`✅ Image uploaded: ${imageUri}`));
    return imageUri;
    
  } catch (error) {
    throw new Error(`Failed to upload image: ${error.message}`);
  }
}

// Generate and upload metadata
async function generateAndUploadMetadata(totalToMint, imageUri) {
  const template = await fs.readJSON(CONFIG.TEMPLATE_PATH);
  const limit = pLimit(10); // Concurrent upload limit
  
  // Process in batches
  for (let batchStart = CONFIG.START_TOKEN_ID; batchStart <= totalToMint; batchStart += CONFIG.BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + CONFIG.BATCH_SIZE - 1, totalToMint);
    console.log(chalk.blue(`\n📦 Processing batch ${batchStart}-${batchEnd}...`));
    
    const batchPromises = [];
    
    for (let tokenId = batchStart; tokenId <= batchEnd; tokenId++) {
      // Skip if already processed
      if (mintLog.tokens[tokenId]?.metadataUri) {
        continue;
      }
      
      batchPromises.push(
        limit(async () => {
          try {
            // Generate metadata
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
            
            // Update log
            mintLog.tokens[tokenId] = {
              tokenId,
              paddedId,
              metadataUri,
              status: 'pending',
              createdAt: new Date().toISOString()
            };
            
            if (tokenId % 100 === 0) {
              console.log(chalk.gray(`   Processed ${tokenId}/${totalToMint}`));
              await saveMintLog();
            }
            
          } catch (error) {
            console.error(chalk.red(`   ❌ Failed to process token ${tokenId}: ${error.message}`));
            mintLog.tokens[tokenId] = {
              tokenId,
              status: 'failed',
              error: error.message,
              createdAt: new Date().toISOString()
            };
          }
        })
      );
    }
    
    await Promise.all(batchPromises);
    await saveMintLog();
    console.log(chalk.green(`✅ Batch ${batchStart}-${batchEnd} metadata uploaded`));
  }
}

// Initialize blockchain connection
async function initializeBlockchain() {
  console.log(chalk.blue('\n🔗 Connecting to blockchain...'));
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
  
  // Verify connection
  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  const owner = await contract.owner();
  
  console.log(chalk.green(`✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`));
  console.log(chalk.green(`✅ Wallet address: ${wallet.address}`));
  console.log(chalk.green(`✅ Wallet balance: ${ethers.formatEther(balance)} BTIC`));
  console.log(chalk.green(`✅ Contract owner: ${owner}`));
  
  // Check if paused
  try {
    const isPaused = await contract.paused();
    if (isPaused) {
      throw new Error('Contract is paused');
    }
  } catch (error) {
    if (!error.message.includes('paused')) {
      console.log(chalk.yellow('⚠️  Contract does not have pause functionality'));
    }
  }
  
  return { provider, wallet, contract };
}

// Mint NFTs with rate limiting
async function mintNFTs(wallet, contract, totalToMint) {
  const limit = pLimit(CONFIG.MINT_RATE_LIMIT);
  let successCount = 0;
  let failCount = 0;
  
  for (let tokenId = CONFIG.START_TOKEN_ID; tokenId <= totalToMint; tokenId++) {
    const tokenData = mintLog.tokens[tokenId];
    
    // Skip if already minted
    if (tokenData?.status === 'completed') {
      successCount++;
      continue;
    }
    
    // Skip if no metadata
    if (!tokenData?.metadataUri) {
      console.error(chalk.red(`❌ No metadata for token ${tokenId}`));
      failCount++;
      continue;
    }
    
    await limit(async () => {
      for (let attempt = 1; attempt <= CONFIG.RETRY_ATTEMPTS; attempt++) {
        try {
          console.log(chalk.blue(`🎨 Minting token ${tokenId} (${tokenData.paddedId})...`));
          
          const tx = await contract.mintURI(wallet.address, tokenData.metadataUri);
          console.log(chalk.gray(`   TX: ${tx.hash}`));
          
          const receipt = await tx.wait();
          
          // Update log
          mintLog.tokens[tokenId] = {
            ...tokenData,
            status: 'completed',
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            completedAt: new Date().toISOString()
          };
          
          successCount++;
          mintLog.summary.successful = successCount;
          
          console.log(chalk.green(`✅ Token ${tokenId} minted successfully`));
          
          // Save progress periodically
          if (successCount % 10 === 0) {
            await saveMintLog();
            console.log(chalk.cyan(`📊 Progress: ${successCount}/${totalToMint} (${((successCount/totalToMint)*100).toFixed(1)}%)`));
          }
          
          break; // Success, exit retry loop
          
        } catch (error) {
          console.error(chalk.red(`❌ Attempt ${attempt}/${CONFIG.RETRY_ATTEMPTS} failed for token ${tokenId}: ${error.message}`));
          
          if (attempt === CONFIG.RETRY_ATTEMPTS) {
            // Final attempt failed
            mintLog.tokens[tokenId] = {
              ...tokenData,
              status: 'failed',
              error: error.message,
              failedAt: new Date().toISOString()
            };
            failCount++;
            mintLog.summary.failed = failCount;
          } else {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
          }
        }
      }
    });
    
    // Rate limiting delay
    await new Promise(resolve => setTimeout(resolve, 1000 / CONFIG.MINT_RATE_LIMIT));
  }
  
  // Save final state
  await saveMintLog();
}

// Save mint log
async function saveMintLog() {
  mintLog.summary.total = Object.keys(mintLog.tokens).length;
  mintLog.lastUpdated = new Date().toISOString();
  await fs.writeJSON(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
}

// Print summary
function printSummary() {
  console.log(chalk.cyan('\n' + '='.repeat(50)));
  console.log(chalk.cyan('📊 MINTING COMPLETE - SUMMARY'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.green(`✅ Successful: ${mintLog.summary.successful}`));
  console.log(chalk.red(`❌ Failed: ${mintLog.summary.failed}`));
  console.log(chalk.yellow(`⏳ Pending: ${mintLog.summary.pending}`));
  console.log(chalk.blue(`📁 Total Processed: ${mintLog.summary.total}`));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.gray(`\nLogs saved to: ${CONFIG.MINT_LOG_PATH}`));
  console.log(chalk.gray(`Metadata saved to: ${CONFIG.METADATA_DIR}`));
}

// Run the script
main().catch(error => {
  console.error(chalk.red('❌ Unhandled error:'), error);
  process.exit(1);
});