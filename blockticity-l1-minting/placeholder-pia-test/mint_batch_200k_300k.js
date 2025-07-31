require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Configuration for batch 200,001 - 300,000
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: 'https://subnets.avax.network/btic/mainnet/rpc',
  
  // Token range for this batch
  START_TOKEN_ID: 200001,
  END_TOKEN_ID: 300000,
  
  // Optimized settings based on previous successful runs
  MINT_RATE_LIMIT: 10, // Concurrent mints
  BATCH_SIZE: 50, // Tokens per batch
  BATCH_DELAY: 3000, // 3 seconds between batches
  
  // Retry settings
  RETRY_ATTEMPTS: 5,
  RETRY_DELAY: 2000,
  MAX_RETRY_DELAY: 15000,
  
  // File paths
  MINT_LOG_PATH: path.join(__dirname, 'output', 'batch_200k_300k_mint_log.json'),
  
  // Contract ABI
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { 
  batch: "200001-300000",
  startedAt: new Date().toISOString(),
  tokens: {}, 
  summary: { 
    total: CONFIG.END_TOKEN_ID - CONFIG.START_TOKEN_ID + 1,
    successful: 0, 
    failed: 0, 
    pending: CONFIG.END_TOKEN_ID - CONFIG.START_TOKEN_ID + 1 
  } 
};

let provider = null;
let wallet = null;
let baseNonce = null;
let nonceOffset = 0;

// Error classification
function classifyError(error) {
  const message = error.message.toLowerCase();
  
  if (message.includes('already known') || message.includes('transaction already exists')) {
    return 'ALREADY_KNOWN';
  }
  if (message.includes('nonce') && (message.includes('too low') || message.includes('already been used'))) {
    return 'NONCE_ERROR';
  }
  if (message.includes('timeout') || message.includes('econnreset') || message.includes('network')) {
    return 'NETWORK_ERROR';
  }
  if (message.includes('replacement transaction underpriced')) {
    return 'REPLACEMENT_UNDERPRICED';
  }
  
  return 'UNKNOWN_ERROR';
}

// Nonce management
function getNextNonce() {
  const nonce = baseNonce + nonceOffset;
  nonceOffset++;
  return nonce;
}

async function resetNonceSequence() {
  try {
    baseNonce = await provider.getTransactionCount(wallet.address, 'pending');
    nonceOffset = 0;
    console.log(chalk.cyan(`🔢 Reset nonce sequence to: ${baseNonce}`));
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Failed to reset nonce: ${error.message}`));
  }
}

// Initialize blockchain connection
async function initializeBlockchain() {
  console.log(chalk.blue('\n🔗 Connecting to Blockticity L1 Mainnet...'));
  
  provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, undefined, {
    staticNetwork: true,
    batchMaxCount: 1
  });
  
  wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
  
  try {
    const [network, balance] = await Promise.all([
      provider.getNetwork(),
      provider.getBalance(wallet.address)
    ]);
    
    console.log(chalk.green(`✅ Connected to network: chainId ${network.chainId}`));
    console.log(chalk.green(`💰 Wallet balance: ${ethers.formatEther(balance)} BTIC`));
    console.log(chalk.green(`🔑 Minting from: ${wallet.address}`));
    
    // Initialize nonce
    await resetNonceSequence();
    
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Network info unavailable, continuing...`));
  }
  
  return { provider, wallet, contract };
}

// Build metadata URI
async function buildMetadataUri(tokenId) {
  // Using the same IPFS placeholder as before
  return 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
}

// Calculate backoff delay
function calculateBackoffDelay(retryCount) {
  const baseDelay = CONFIG.RETRY_DELAY;
  const exponentialDelay = Math.min(baseDelay * Math.pow(1.5, retryCount), CONFIG.MAX_RETRY_DELAY);
  const jitter = Math.random() * 500;
  return exponentialDelay + jitter;
}

// Mint single token
async function mintSingleToken(contract, tokenId, retryCount = 0) {
  try {
    // Initialize token in log if not exists
    if (!mintLog.tokens[tokenId]) {
      mintLog.tokens[tokenId] = {
        tokenId: tokenId,
        status: 'pending',
        attempts: 0,
        startedAt: new Date().toISOString()
      };
    }
    
    mintLog.tokens[tokenId].attempts++;
    
    const metadataUri = await buildMetadataUri(tokenId);
    const nonce = getNextNonce();
    
    // Estimate gas
    let gasLimit;
    try {
      const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
      gasLimit = gasEstimate * 120n / 100n; // 20% buffer
    } catch (gasError) {
      gasLimit = 200000n; // Conservative default
    }
    
    // Send transaction
    const tx = await contract.mintURI(wallet.address, metadataUri, { 
      gasLimit,
      nonce: nonce
    });
    
    console.log(chalk.yellow(`  🎨 ${tokenId}: ${tx.hash.slice(0, 10)}... (nonce: ${nonce})`));
    
    const receipt = await tx.wait();
    
    // Update log
    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'completed',
      metadataUri: metadataUri,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      nonce: nonce,
      completedAt: new Date().toISOString()
    };
    
    mintLog.summary.successful++;
    mintLog.summary.pending--;
    
    console.log(chalk.green(`  ✅ ${tokenId}: Block ${receipt.blockNumber}`));
    return true;
    
  } catch (error) {
    const errorType = classifyError(error);
    console.error(chalk.red(`  ❌ ${tokenId}: ${errorType} - ${error.message.slice(0, 100)}`));
    
    // Handle "already known" as success
    if (errorType === 'ALREADY_KNOWN') {
      mintLog.tokens[tokenId] = {
        ...mintLog.tokens[tokenId],
        status: 'completed',
        metadataUri: await buildMetadataUri(tokenId),
        txHash: 'already_known',
        completedAt: new Date().toISOString(),
        note: 'Transaction already known'
      };
      
      mintLog.summary.successful++;
      mintLog.summary.pending--;
      
      console.log(chalk.blue(`  📝 ${tokenId}: Marked as completed (already known)`));
      return true;
    }
    
    // Reset nonce on nonce errors
    if (errorType === 'NONCE_ERROR') {
      await resetNonceSequence();
    }
    
    // Retry logic
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      const delay = calculateBackoffDelay(retryCount);
      console.log(chalk.yellow(`  🔄 ${tokenId}: Retry ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS} in ${(delay/1000).toFixed(1)}s`));
      await new Promise(resolve => setTimeout(resolve, delay));
      return mintSingleToken(contract, tokenId, retryCount + 1);
    }
    
    // Mark as failed
    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'failed',
      error: error.message,
      errorType: errorType,
      failedAt: new Date().toISOString(),
      finalAttempt: retryCount + 1
    };
    
    mintLog.summary.failed++;
    mintLog.summary.pending--;
    
    return false;
  }
}

// Load existing progress
async function loadExistingProgress() {
  const mintLogExists = await fs.pathExists(CONFIG.MINT_LOG_PATH);
  
  if (mintLogExists) {
    mintLog = await fs.readJson(CONFIG.MINT_LOG_PATH);
    console.log(chalk.green(`✅ Loaded existing progress`));
    console.log(chalk.cyan(`📊 Status: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
    return true;
  }
  
  // Initialize mint log for all tokens
  for (let tokenId = CONFIG.START_TOKEN_ID; tokenId <= CONFIG.END_TOKEN_ID; tokenId++) {
    mintLog.tokens[tokenId] = {
      tokenId: tokenId.toString(),
      status: 'pending'
    };
  }
  
  await fs.ensureDir(path.dirname(CONFIG.MINT_LOG_PATH));
  await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
  console.log(chalk.green(`✅ Initialized mint log for tokens ${CONFIG.START_TOKEN_ID} - ${CONFIG.END_TOKEN_ID}`));
  return false;
}

// Process batch
async function processBatch(contract, batch, batchNum, totalBatches) {
  const startTime = Date.now();
  
  console.log(chalk.blue(`\n📦 Batch ${batchNum}/${totalBatches}: ${batch.length} tokens`));
  console.log(chalk.blue(`🎯 Range: ${batch[0]} to ${batch[batch.length - 1]}`));
  
  // Process batch concurrently
  const mintPromises = batch.map(tokenId =>
    mintLimit(() => mintSingleToken(contract, tokenId))
  );
  
  const results = await Promise.all(mintPromises);
  const successful = results.filter(Boolean).length;
  const failed = results.length - successful;
  
  const duration = (Date.now() - startTime) / 1000;
  const rate = batch.length / duration;
  
  console.log(chalk.cyan(`📊 Batch ${batchNum} complete: ${successful} success, ${failed} failed in ${duration.toFixed(1)}s (${rate.toFixed(1)} tokens/sec)`));
  console.log(chalk.cyan(`📈 Total progress: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
  
  // Save progress
  await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
}

// Main function
async function main() {
  console.log(chalk.cyan('🚀 Blockticity Batch 200k-300k Minting'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.yellow(`🎯 Token Range: ${CONFIG.START_TOKEN_ID.toLocaleString()} - ${CONFIG.END_TOKEN_ID.toLocaleString()}`));
  console.log(chalk.yellow(`⚡ Settings: ${CONFIG.MINT_RATE_LIMIT} concurrent, ${CONFIG.BATCH_SIZE} per batch`));
  
  try {
    // Load existing progress
    const resuming = await loadExistingProgress();
    
    // Find pending tokens
    const pendingTokens = Object.entries(mintLog.tokens)
      .filter(([_, data]) => data.status === 'pending' || data.status === 'failed')
      .map(([tokenId, _]) => parseInt(tokenId))
      .sort((a, b) => a - b);
    
    console.log(chalk.cyan(`\n🎯 Tokens to process: ${pendingTokens.length.toLocaleString()}`));
    
    if (pendingTokens.length === 0) {
      console.log(chalk.green('✅ All tokens completed!'));
      return;
    }
    
    // Initialize blockchain
    const { contract } = await initializeBlockchain();
    
    // Process in batches
    const startTime = Date.now();
    const totalBatches = Math.ceil(pendingTokens.length / CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < pendingTokens.length; i += CONFIG.BATCH_SIZE) {
      const batch = pendingTokens.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      
      await processBatch(contract, batch, batchNum, totalBatches);
      
      // Pause between batches
      if (i + CONFIG.BATCH_SIZE < pendingTokens.length) {
        console.log(chalk.yellow(`⏸️  Pausing ${CONFIG.BATCH_DELAY/1000}s...`));
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
        
        // Reset nonce periodically
        if (batchNum % 10 === 0) {
          await resetNonceSequence();
        }
      }
    }
    
    // Final summary
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000 / 60;
    const rate = (mintLog.summary.successful - (resuming ? mintLog.summary.successful : 0)) / (duration * 60);
    
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Batch 200k-300k Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration.toFixed(2)} minutes`));
    console.log(chalk.cyan(`⚡ Average rate: ${rate.toFixed(1)} tokens/second`));
    console.log(chalk.cyan('📊 Final Stats:'));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful.toLocaleString()}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
    
    // Update final timestamp
    mintLog.completedAt = new Date().toISOString();
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    
  } catch (error) {
    console.error(chalk.red(`\n💥 Fatal error: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n⏸️  Received interrupt signal...'));
  console.log(chalk.cyan('📊 Current progress:'));
  console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful.toLocaleString()}`));
  console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
  console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending.toLocaleString()}`));
  
  if (CONFIG.MINT_LOG_PATH) {
    mintLog.pausedAt = new Date().toISOString();
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    console.log(chalk.cyan(`💾 Progress saved to: ${CONFIG.MINT_LOG_PATH}`));
  }
  
  process.exit(0);
});

// Error handlers
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled rejection:'), error);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught exception:'), error);
  process.exit(1);
});

// Start minting
if (require.main === module) {
  main();
}