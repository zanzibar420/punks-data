require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Configuration for batch 4: 400,001 - 500,000
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  
  // RPC endpoints for round-robin
  RPC_ENDPOINTS: [
    'https://subnets.avax.network/btic/mainnet/rpc', // Public RPC
    'https://mainnet-btic-wd732.avax.network/ext/bc/2pV5K35V1ohNSYhRU3z1Bud2oZys9bak7QYcmvbVvnieh4FJXc/rpc?token=90bd898ee2f77b6c45744ad57ae36724130c37e6478836c4cab1a50922d56dde' // Developer RPC
  ],
  
  // Token range for batch 4
  START_TOKEN_ID: 400001,
  END_TOKEN_ID: 500000,
  
  // Conservative settings that worked well
  MINT_RATE_LIMIT: 5,
  BATCH_SIZE: 25,
  BATCH_DELAY: 5000,
  
  // Retry configuration
  RETRY_ATTEMPTS: 8,
  RETRY_DELAY: 3000,
  MAX_RETRY_DELAY: 20000,
  TX_TIMEOUT: 60000,
  
  // File paths
  MINT_LOG_PATH: path.join(__dirname, 'output', 'batch_400k_500k_mint_log.json'),
  
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { 
  batch: "400001-500000",
  tokens: {}, 
  summary: { total: 100000, successful: 0, failed: 0, pending: 100000 } 
};

let providers = [];
let wallets = [];
let rpcIndex = 0;
let nonce = null;
let nonceSequence = 0;

// Initialize round-robin RPC providers
async function initializeProviders() {
  console.log(chalk.blue('🔄 Setting up round-robin with 2 RPC endpoints'));
  
  providers = CONFIG.RPC_ENDPOINTS.map((rpcUrl, index) => {
    console.log(chalk.cyan(`  ${index + 1}. ${rpcUrl.includes('subnets') ? 'Public' : 'Developer'} RPC`));
    return new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
      timeout: 30000
    });
  });
  
  // Create wallets connected to each provider
  wallets = providers.map(provider => new ethers.Wallet(CONFIG.PRIVATE_KEY, provider));
  
  // Test connection
  try {
    const network = await providers[0].getNetwork();
    console.log(chalk.green(`✅ Connected to network: chainId ${network.chainId}`));
    
    const balance = await providers[0].getBalance(wallets[0].address);
    console.log(chalk.green(`💰 Wallet balance: ${ethers.formatEther(balance)} BTIC`));
    console.log(chalk.green(`🔑 Minting from: ${wallets[0].address}`));
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Network info unavailable, continuing...`));
  }
}

// Get next provider/wallet in round-robin fashion
function getNextProvider() {
  const index = rpcIndex;
  rpcIndex = (rpcIndex + 1) % providers.length;
  return {
    provider: providers[index],
    wallet: wallets[index],
    rpcName: CONFIG.RPC_ENDPOINTS[index].includes('subnets') ? 'PUB' : 'DEV',
    index: index
  };
}

// Build metadata URI
async function buildMetadataUri(tokenId) {
  return 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
}

// Get next nonce
async function getNextNonce() {
  return nonceSequence++;
}

// Calculate backoff delay
function calculateBackoffDelay(retryCount) {
  const baseDelay = CONFIG.RETRY_DELAY;
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, retryCount), CONFIG.MAX_RETRY_DELAY);
  const jitter = Math.random() * 1000;
  return exponentialDelay + jitter;
}

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
  if (message.includes('insufficient funds')) {
    return 'INSUFFICIENT_FUNDS';
  }
  
  return 'UNKNOWN_ERROR';
}

// Send transaction with timeout
async function sendTransactionWithTimeout(tokenId, metadataUri, wallet, provider, nonce, rpcName) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Transaction timeout after ${CONFIG.TX_TIMEOUT}ms`));
    }, CONFIG.TX_TIMEOUT);
    
    try {
      const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
      
      let gasLimit;
      try {
        const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
        gasLimit = gasEstimate * 130n / 100n;
      } catch (gasError) {
        gasLimit = 200000n;
      }
      
      const tx = await contract.mintURI(wallet.address, metadataUri, { gasLimit, nonce });
      console.log(chalk.blue(`  🎨 ${tokenId}: ${tx.hash.slice(0, 12)}... (nonce: ${nonce}, rpc: ${rpcName})`));
      
      const receipt = await tx.wait();
      clearTimeout(timeout);
      resolve(receipt);
      
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

// Mint single token
async function mintSingleToken(tokenId, retryCount = 0) {
  try {
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
    const currentNonce = await getNextNonce();
    const { provider, wallet, rpcName } = getNextProvider();
    
    const receipt = await sendTransactionWithTimeout(tokenId, metadataUri, wallet, provider, currentNonce, rpcName);
    
    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'completed',
      metadataUri: metadataUri,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      nonce: currentNonce,
      completedAt: new Date().toISOString()
    };
    
    mintLog.summary.successful++;
    mintLog.summary.pending--;
    
    console.log(chalk.green(`  ✅ ${tokenId}: Block ${receipt.blockNumber}`));
    return true;
    
  } catch (error) {
    const errorType = classifyError(error);
    console.error(chalk.red(`  ❌ ${tokenId}: ${errorType} - ${error.message.slice(0, 50)}`));
    
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
    
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      const delay = calculateBackoffDelay(retryCount);
      console.log(chalk.yellow(`  🔄 ${tokenId}: Retry ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS} in ${(delay/1000).toFixed(1)}s`));
      await new Promise(resolve => setTimeout(resolve, delay));
      return mintSingleToken(tokenId, retryCount + 1);
    }
    
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

// Process batch
async function processBatch(batch, batchNum, totalBatches) {
  const startTime = Date.now();
  
  console.log(chalk.blue(`\n📦 Batch ${batchNum}/${totalBatches}: ${batch.length} tokens`));
  console.log(chalk.blue(`🎯 Range: ${batch[0]} to ${batch[batch.length - 1]}`));
  
  const mintPromises = batch.map(tokenId =>
    mintLimit(() => mintSingleToken(tokenId))
  );
  
  const results = await Promise.all(mintPromises);
  const successful = results.filter(Boolean).length;
  const failed = results.length - successful;
  
  const duration = (Date.now() - startTime) / 1000;
  const rate = batch.length / duration;
  
  console.log(chalk.cyan(`📊 Batch ${batchNum} complete: ${successful} success, ${failed} failed in ${duration.toFixed(1)}s (${rate.toFixed(1)} tokens/sec)`));
  console.log(chalk.cyan(`📈 Total progress: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
  
  await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
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
  
  await fs.ensureDir(path.dirname(CONFIG.MINT_LOG_PATH));
  return false;
}

// Reset nonce sequence
async function resetNonceSequence() {
  const provider = providers[0];
  const wallet = wallets[0];
  
  try {
    nonce = await provider.getTransactionCount(wallet.address);
    console.log(chalk.yellow(`🔢 Reset nonce sequence to: ${nonce}`));
    nonceSequence = nonce;
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Could not get nonce, starting at 0`));
    nonceSequence = 0;
  }
}

// Main function
async function main() {
  console.log(chalk.cyan('🚀 Blockticity Batch 400k-500k Minting'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.yellow(`🎯 Token Range: ${CONFIG.START_TOKEN_ID.toLocaleString()} - ${CONFIG.END_TOKEN_ID.toLocaleString()}`));
  console.log(chalk.yellow(`⚡ Settings: ${CONFIG.MINT_RATE_LIMIT} concurrent, ${CONFIG.BATCH_SIZE} per batch`));
  
  try {
    const resuming = await loadExistingProgress();
    
    const pendingTokens = [];
    for (let tokenId = CONFIG.START_TOKEN_ID; tokenId <= CONFIG.END_TOKEN_ID; tokenId++) {
      if (!mintLog.tokens[tokenId] || mintLog.tokens[tokenId].status === 'pending' || mintLog.tokens[tokenId].status === 'failed') {
        pendingTokens.push(tokenId);
      }
    }
    
    console.log(chalk.cyan(`\n🎯 Tokens to process: ${pendingTokens.length.toLocaleString()}`));
    
    if (pendingTokens.length === 0) {
      console.log(chalk.green('✅ All tokens completed!'));
      return;
    }
    
    console.log(chalk.blue('\n🔗 Connecting to Blockticity L1 Mainnet...'));
    await initializeProviders();
    await resetNonceSequence();
    
    const startTime = Date.now();
    const totalBatches = Math.ceil(pendingTokens.length / CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < pendingTokens.length; i += CONFIG.BATCH_SIZE) {
      const batch = pendingTokens.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      
      await processBatch(batch, batchNum, totalBatches);
      
      if (i + CONFIG.BATCH_SIZE < pendingTokens.length) {
        console.log(chalk.yellow(`⏸️  Stability pause ${CONFIG.BATCH_DELAY/1000}s...`));
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
      }
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000 / 60;
    
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Batch 400k-500k Minting Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration.toFixed(2)} minutes`));
    console.log(chalk.cyan('📊 Final Stats:'));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful.toLocaleString()}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
    
    mintLog.completedAt = new Date().toISOString();
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    
  } catch (error) {
    console.error(chalk.red(`\n💥 Fatal error: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

// Error handlers
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

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('💥 Unhandled Rejection at:'), promise, 'reason:', reason);
});

if (require.main === module) {
  main();
}

module.exports = { main };