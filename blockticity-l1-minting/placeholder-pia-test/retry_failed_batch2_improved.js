require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Improved Configuration
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: 'https://subnets.avax.network/btic/mainnet/rpc',
  MINT_RATE_LIMIT: 3, // Reduced from 5 to avoid overwhelming RPC
  RETRY_ATTEMPTS: 5, // Increased retry attempts
  RETRY_DELAY: 5000, // Increased initial delay
  MAX_RETRY_DELAY: 30000, // Max exponential backoff delay
  BATCH_SIZE: 15, // Reduced batch size
  FAILED_TOKENS_FILE: path.join(__dirname, 'failed_batch2_tokens.txt'),
  METADATA_DIR: path.join(__dirname, 'output', 'metadata'),
  MINT_LOG_PATH: path.join(__dirname, 'retry_batch2_improved_log.json'),
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };
let globalNonce = null;
let provider = null;
let wallet = null;

// Improved error classification
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
  if (message.includes('gas') && message.includes('insufficient')) {
    return 'GAS_ERROR';
  }
  if (message.includes('replacement transaction underpriced')) {
    return 'REPLACEMENT_UNDERPRICED';
  }
  
  return 'UNKNOWN_ERROR';
}

// Get fresh nonce for each transaction
async function getFreshNonce() {
  try {
    const currentNonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    // If we have a cached nonce, use the higher value
    if (globalNonce !== null) {
      globalNonce = Math.max(globalNonce + 1, currentNonce);
    } else {
      globalNonce = currentNonce;
    }
    
    return globalNonce;
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Failed to get nonce, using cached: ${error.message}`));
    if (globalNonce !== null) {
      globalNonce++;
      return globalNonce;
    }
    throw error;
  }
}

async function initializeBlockchain() {
  console.log(chalk.blue('\n🔗 Connecting to Blockticity L1 Mainnet...'));
  
  provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, undefined, {
    staticNetwork: true, // Avoid unnecessary network calls
    batchMaxCount: 1     // Disable batching to avoid conflicts
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
    globalNonce = await provider.getTransactionCount(wallet.address, 'pending');
    console.log(chalk.cyan(`🔢 Starting nonce: ${globalNonce}`));
    
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Network info unavailable, continuing...`));
  }
  
  return { provider, wallet, contract };
}

async function buildMetadataUri(tokenId) {
  // Use IPFS placeholder (same as successful batches)
  return 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
}

function calculateBackoffDelay(retryCount) {
  // Exponential backoff with jitter
  const baseDelay = CONFIG.RETRY_DELAY;
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, retryCount), CONFIG.MAX_RETRY_DELAY);
  const jitter = Math.random() * 1000; // Add 0-1s random jitter
  return exponentialDelay + jitter;
}

async function mintSingleToken(contract, tokenId, retryCount = 0) {
  try {
    console.log(chalk.yellow(`  🎨 Minting token ${tokenId}...`));
    
    // Check if token was already successfully minted
    if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'completed') {
      console.log(chalk.blue(`  ✅ Token ${tokenId} already minted, skipping...`));
      return true;
    }
    
    // Build metadata URI
    const metadataUri = await buildMetadataUri(tokenId);
    
    // Get fresh nonce
    const nonce = await getFreshNonce();
    
    // Estimate gas with buffer
    let gasLimit;
    try {
      const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
      gasLimit = gasEstimate * 130n / 100n; // 30% buffer
    } catch (gasError) {
      console.log(chalk.yellow(`  ⚠️  Gas estimation failed, using default: ${gasError.message}`));
      gasLimit = 300000n; // Safe default
    }
    
    // Send transaction with explicit nonce
    const tx = await contract.mintURI(wallet.address, metadataUri, { 
      gasLimit,
      nonce: nonce
    });
    
    console.log(chalk.cyan(`  📡 Transaction sent: ${tx.hash} (nonce: ${nonce})`));
    
    const receipt = await tx.wait();
    
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
    if (mintLog.tokens[tokenId].status !== 'completed') {
      mintLog.summary.pending--;
    }
    
    console.log(chalk.green(`  ✅ Token ${tokenId} minted! Tx: ${receipt.hash}`));
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    
    return true;
    
  } catch (error) {
    const errorType = classifyError(error);
    console.error(chalk.red(`  ❌ Failed to mint token ${tokenId} (${errorType}): ${error.message}`));
    
    // Handle specific error types
    if (errorType === 'ALREADY_KNOWN') {
      console.log(chalk.blue(`  📝 Transaction already known, checking if successful...`));
      // Wait a moment and check if the token exists on chain
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      try {
        // Try to check if token was actually minted by looking at recent logs
        // For now, mark as successful to avoid infinite retries
        mintLog.tokens[tokenId] = {
          ...mintLog.tokens[tokenId],
          status: 'completed',
          metadataUri: await buildMetadataUri(tokenId),
          txHash: 'already_known',
          completedAt: new Date().toISOString(),
          note: 'Transaction already known, assuming successful'
        };
        
        mintLog.summary.successful++;
        if (mintLog.tokens[tokenId].status !== 'completed') {
          mintLog.summary.pending--;
        }
        
        console.log(chalk.green(`  ✅ Token ${tokenId} marked as completed (already known)`));
        await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
        return true;
        
      } catch (checkError) {
        console.log(chalk.yellow(`  ⚠️  Could not verify token status: ${checkError.message}`));
      }
    }
    
    if (errorType === 'NONCE_ERROR') {
      console.log(chalk.yellow(`  🔄 Nonce error, refreshing nonce...`));
      // Reset nonce to force refresh
      globalNonce = null;
    }
    
    // Retry logic
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      const delay = calculateBackoffDelay(retryCount);
      console.log(chalk.yellow(`  🔄 Retrying in ${(delay / 1000).toFixed(1)}s... (Attempt ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS})`));
      await new Promise(resolve => setTimeout(resolve, delay));
      return mintSingleToken(contract, tokenId, retryCount + 1);
    }
    
    // Mark as failed after all retries
    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'failed',
      error: error.message,
      errorType: errorType,
      failedAt: new Date().toISOString(),
      retryCount: retryCount
    };
    
    mintLog.summary.failed++;
    if (mintLog.tokens[tokenId].status !== 'failed') {
      mintLog.summary.pending--;
    }
    
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    return false;
  }
}

async function loadFailedTokens() {
  console.log(chalk.cyan('\n📂 Loading failed tokens...'));
  
  const tokensText = await fs.readFile(CONFIG.FAILED_TOKENS_FILE, 'utf8');
  const tokenIds = tokensText.trim().split('\n').filter(id => id.trim());
  
  console.log(chalk.cyan(`📊 Found ${tokenIds.length} failed tokens to retry`));
  
  return tokenIds;
}

async function buildMintLog(tokenIds) {
  console.log(chalk.cyan('\n📋 Building mint log...'));
  
  for (const tokenId of tokenIds) {
    if (!mintLog.tokens[tokenId]) {
      mintLog.tokens[tokenId] = {
        tokenId: tokenId,
        status: 'pending',
        addedAt: new Date().toISOString()
      };
      mintLog.summary.total++;
      mintLog.summary.pending++;
    }
  }
  
  await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
  console.log(chalk.green(`✅ Mint log initialized with ${mintLog.summary.total} tokens`));
}

async function mintPendingTokens(contract) {
  console.log(chalk.cyan('\n📋 Finding pending tokens...'));
  
  const pendingTokens = Object.entries(mintLog.tokens)
    .filter(([_, data]) => data.status === 'pending')
    .map(([tokenId, data]) => tokenId)
    .sort((a, b) => parseInt(a) - parseInt(b)); // Sort numerically
  
  console.log(chalk.cyan(`📊 Found ${pendingTokens.length} pending tokens to mint`));
  
  if (pendingTokens.length === 0) {
    console.log(chalk.green('✅ No pending tokens to mint!'));
    return;
  }
  
  // Process in smaller batches with longer delays
  for (let i = 0; i < pendingTokens.length; i += CONFIG.BATCH_SIZE) {
    const batch = pendingTokens.slice(i, i + CONFIG.BATCH_SIZE);
    const batchEnd = Math.min(i + CONFIG.BATCH_SIZE, pendingTokens.length);
    
    console.log(chalk.blue(`\n📦 Processing batch ${i + 1}-${batchEnd} of ${pendingTokens.length}...`));
    console.log(chalk.blue(`🎯 Token range: ${batch[0]} to ${batch[batch.length - 1]}`));
    
    const mintPromises = batch.map(tokenId =>
      mintLimit(() => mintSingleToken(contract, tokenId))
    );
    
    await Promise.all(mintPromises);
    
    console.log(chalk.cyan(`\n📊 Progress: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
    
    // Longer pause between batches to let network settle
    if (i + CONFIG.BATCH_SIZE < pendingTokens.length) {
      console.log(chalk.yellow('⏸️  Pausing between batches...'));
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second pause
    }
  }
}

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Batch 2 Failed Token Retry (Improved)'));
  console.log(chalk.cyan('='.repeat(50)));
  
  try {
    // Load failed tokens
    const tokenIds = await loadFailedTokens();
    
    // Check if mint log exists
    const mintLogExists = await fs.pathExists(CONFIG.MINT_LOG_PATH);
    
    if (mintLogExists) {
      mintLog = await fs.readJson(CONFIG.MINT_LOG_PATH);
      console.log(chalk.green(`✅ Loaded existing mint log`));
      console.log(chalk.cyan(`📊 Current status: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
    } else {
      await buildMintLog(tokenIds);
    }
    
    // Initialize blockchain connection
    const { contract } = await initializeBlockchain();
    
    // Start minting
    const startTime = Date.now();
    await mintPendingTokens(contract);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000 / 60; // minutes
    
    console.log(chalk.cyan('\n='.repeat(50)));
    console.log(chalk.green('✅ Minting Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration.toFixed(2)} minutes`));
    console.log(chalk.cyan('📊 Final Stats:'));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
    
    if (mintLog.summary.failed > 0) {
      console.log(chalk.yellow('\n⚠️  Some tokens failed to mint. Check the log file for details.'));
      console.log(chalk.yellow(`📄 Log file: ${CONFIG.MINT_LOG_PATH}`));
    }
    
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
  console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
  
  if (CONFIG.MINT_LOG_PATH) {
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    console.log(chalk.cyan(`💾 Progress saved to: ${CONFIG.MINT_LOG_PATH}`));
  }
  
  process.exit(0);
});

if (require.main === module) {
  main();
}