require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Optimized Configuration for Maximum Throughput
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: 'https://subnets.avax.network/btic/mainnet/rpc',
  MINT_RATE_LIMIT: 10, // Increased concurrency
  RETRY_ATTEMPTS: 5,
  RETRY_DELAY: 2000, // Reduced delay
  BATCH_SIZE: 50, // Larger batches
  BATCH_DELAY: 3000, // Shorter delay between batches
  FAILED_TOKENS_FILE: path.join(__dirname, 'failed_batch2_tokens.txt'),
  MINT_LOG_PATH: path.join(__dirname, 'retry_batch2_optimized_log.json'),
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };
let provider = null;
let wallet = null;
let baseNonce = null;
let nonceOffset = 0;

// Smart error classification
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

// Get next nonce in sequence
function getNextNonce() {
  const nonce = baseNonce + nonceOffset;
  nonceOffset++;
  return nonce;
}

// Reset nonce sequence
async function resetNonceSequence() {
  try {
    baseNonce = await provider.getTransactionCount(wallet.address, 'pending');
    nonceOffset = 0;
    console.log(chalk.cyan(`🔢 Reset nonce sequence to: ${baseNonce}`));
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Failed to reset nonce: ${error.message}`));
  }
}

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
    
    // Initialize nonce sequence
    await resetNonceSequence();
    
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Network info unavailable, continuing...`));
  }
  
  return { provider, wallet, contract };
}

async function buildMetadataUri(tokenId) {
  return 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
}

function calculateBackoffDelay(retryCount) {
  // Faster exponential backoff
  const baseDelay = CONFIG.RETRY_DELAY;
  const exponentialDelay = Math.min(baseDelay * Math.pow(1.5, retryCount), 15000);
  const jitter = Math.random() * 500;
  return exponentialDelay + jitter;
}

async function mintSingleTokenOptimized(contract, tokenId, retryCount = 0) {
  try {
    // Check if already completed
    if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'completed') {
      return true;
    }
    
    const metadataUri = await buildMetadataUri(tokenId);
    const nonce = getNextNonce();
    
    // Optimized gas settings
    let gasLimit;
    try {
      const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
      gasLimit = gasEstimate * 120n / 100n; // 20% buffer
    } catch (gasError) {
      gasLimit = 200000n; // Conservative default
    }
    
    // Send transaction with sequential nonce
    const tx = await contract.mintURI(wallet.address, metadataUri, { 
      gasLimit,
      nonce: nonce
    });
    
    console.log(chalk.yellow(`  🎨 ${tokenId}: ${tx.hash.slice(0, 10)}... (nonce: ${nonce})`));
    
    const receipt = await tx.wait();
    
    mintLog.tokens[tokenId] = {
      tokenId: tokenId,
      status: 'completed',
      metadataUri: metadataUri,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      nonce: nonce,
      completedAt: new Date().toISOString()
    };
    
    mintLog.summary.successful++;
    if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'pending') {
      mintLog.summary.pending--;
    }
    
    console.log(chalk.green(`  ✅ ${tokenId}: Block ${receipt.blockNumber}`));
    return true;
    
  } catch (error) {
    const errorType = classifyError(error);
    console.error(chalk.red(`  ❌ ${tokenId}: ${errorType} - ${error.message.slice(0, 100)}`));
    
    // Handle "already known" transactions
    if (errorType === 'ALREADY_KNOWN') {
      mintLog.tokens[tokenId] = {
        tokenId: tokenId,
        status: 'completed',
        metadataUri: await buildMetadataUri(tokenId),
        txHash: 'already_known',
        completedAt: new Date().toISOString(),
        note: 'Transaction already known'
      };
      
      mintLog.summary.successful++;
      if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'pending') {
        mintLog.summary.pending--;
      }
      
      console.log(chalk.blue(`  📝 ${tokenId}: Marked as completed (already known)`));
      return true;
    }
    
    // Reset nonce on nonce errors
    if (errorType === 'NONCE_ERROR') {
      console.log(chalk.yellow(`  🔄 Nonce error detected, resetting sequence...`));
      await resetNonceSequence();
    }
    
    // Retry logic
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      const delay = calculateBackoffDelay(retryCount);
      console.log(chalk.yellow(`  🔄 ${tokenId}: Retry ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS} in ${(delay/1000).toFixed(1)}s`));
      await new Promise(resolve => setTimeout(resolve, delay));
      return mintSingleTokenOptimized(contract, tokenId, retryCount + 1);
    }
    
    // Mark as failed after all retries
    mintLog.tokens[tokenId] = {
      tokenId: tokenId,
      status: 'failed',
      error: error.message,
      errorType: errorType,
      failedAt: new Date().toISOString(),
      retryCount: retryCount
    };
    
    mintLog.summary.failed++;
    if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'pending') {
      mintLog.summary.pending--;
    }
    
    return false;
  }
}

async function loadExistingProgress() {
  const mintLogExists = await fs.pathExists(CONFIG.MINT_LOG_PATH);
  
  if (mintLogExists) {
    mintLog = await fs.readJson(CONFIG.MINT_LOG_PATH);
    console.log(chalk.green(`✅ Loaded existing progress`));
    console.log(chalk.cyan(`📊 Status: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
  }
}

async function processBatchOptimized(contract, batch, batchNum, totalBatches) {
  const startTime = Date.now();
  
  console.log(chalk.blue(`\n📦 Batch ${batchNum}/${totalBatches}: ${batch.length} tokens`));
  console.log(chalk.blue(`🎯 Range: ${batch[0]} to ${batch[batch.length - 1]}`));
  
  // Process batch concurrently
  const mintPromises = batch.map(tokenId =>
    mintLimit(() => mintSingleTokenOptimized(contract, tokenId))
  );
  
  const results = await Promise.all(mintPromises);
  const successful = results.filter(Boolean).length;
  const failed = results.length - successful;
  
  const duration = (Date.now() - startTime) / 1000;
  const rate = batch.length / duration;
  
  console.log(chalk.cyan(`📊 Batch ${batchNum} complete: ${successful} success, ${failed} failed in ${duration.toFixed(1)}s (${rate.toFixed(1)} tokens/sec)`));
  console.log(chalk.cyan(`📈 Total progress: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
  
  // Save progress after each batch
  await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
}

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Batch 2 Optimized Retry'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.yellow(`⚡ Rate: ${CONFIG.MINT_RATE_LIMIT} concurrent, ${CONFIG.BATCH_SIZE} per batch`));
  
  try {
    // Load existing progress
    await loadExistingProgress();
    
    // Load failed tokens
    console.log(chalk.cyan('\n📂 Loading failed tokens...'));
    const tokensText = await fs.readFile(CONFIG.FAILED_TOKENS_FILE, 'utf8');
    const allTokenIds = tokensText.trim().split('\n').filter(id => id.trim()).sort((a, b) => parseInt(a) - parseInt(b));
    
    console.log(chalk.cyan(`📊 Found ${allTokenIds.length} failed tokens total`));
    
    // Find tokens that still need processing
    const pendingTokens = allTokenIds.filter(tokenId => {
      return !mintLog.tokens[tokenId] || mintLog.tokens[tokenId].status === 'pending' || mintLog.tokens[tokenId].status === 'failed';
    });
    
    console.log(chalk.cyan(`🎯 Need to process: ${pendingTokens.length} tokens`));
    
    if (pendingTokens.length === 0) {
      console.log(chalk.green('✅ All tokens completed!'));
      return;
    }
    
    // Initialize blockchain
    const { contract } = await initializeBlockchain();
    
    // Process in optimized batches
    const startTime = Date.now();
    const totalBatches = Math.ceil(pendingTokens.length / CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < pendingTokens.length; i += CONFIG.BATCH_SIZE) {
      const batch = pendingTokens.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      
      await processBatchOptimized(contract, batch, batchNum, totalBatches);
      
      // Brief pause between batches (not between individual tokens)
      if (i + CONFIG.BATCH_SIZE < pendingTokens.length) {
        console.log(chalk.yellow(`⏸️  Brief pause (${CONFIG.BATCH_DELAY/1000}s)...`));
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
        
        // Reset nonce sequence periodically
        if (batchNum % 10 === 0) {
          await resetNonceSequence();
        }
      }
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000 / 60;
    const rate = pendingTokens.length / (duration * 60);
    
    console.log(chalk.cyan('\n='.repeat(50)));
    console.log(chalk.green('✅ Optimized Processing Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration.toFixed(2)} minutes`));
    console.log(chalk.cyan(`⚡ Average rate: ${rate.toFixed(1)} tokens/second`));
    console.log(chalk.cyan('📊 Final Stats:'));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    
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
  console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful}`));
  console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
  
  if (CONFIG.MINT_LOG_PATH) {
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    console.log(chalk.cyan(`💾 Progress saved to: ${CONFIG.MINT_LOG_PATH}`));
  }
  
  process.exit(0);
});

if (require.main === module) {
  main();
}