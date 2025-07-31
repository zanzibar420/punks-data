require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  
  // Multi-signer configuration
  SIGNER_KEYS: [
    process.env.SIGNER_KEY_0,
    process.env.SIGNER_KEY_1,
    process.env.SIGNER_KEY_2,
    process.env.SIGNER_KEY_3,
    process.env.SIGNER_KEY_4,
    process.env.SIGNER_KEY_5
  ].filter(key => key),
  
  // RPC endpoints
  RPC_ENDPOINTS: [
    'https://subnets.avax.network/btic/mainnet/rpc',
    'https://mainnet-btic-wd732.avax.network/ext/bc/2pV5K35V1ohNSYhRU3z1Bud2oZys9bak7QYcmvbVvnieh4FJXc/rpc?token=90bd898ee2f77b6c45744ad57ae36724130c37e6478836c4cab1a50922d56dde'
  ],
  
  // Token range
  START_TOKEN_ID: 300001,
  END_TOKEN_ID: 400000,
  
  // Conservative multi-signer settings
  MINT_RATE_LIMIT: 10,    // 10 concurrent total
  BATCH_SIZE: 60,         // 60 tokens per batch
  BATCH_DELAY: 3000,      // 3 second delay between batches
  
  // Retry and backoff configuration
  RETRY_ATTEMPTS: 5,
  RETRY_DELAY: 2000,
  MAX_RETRY_DELAY: 15000,
  TX_TIMEOUT: 45000,
  SIGNER_BACKOFF_THRESHOLD: 3,  // Failures before backoff
  SIGNER_BACKOFF_DURATION: 30000, // 30 seconds
  
  // File paths
  MINT_LOG_PATH: path.join(__dirname, 'output', 'multi_signer_optimized_log.json'),
  
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

// Global state
const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { 
  batch: "multi-signer-optimized",
  signers: CONFIG.SIGNER_KEYS.length,
  tokens: {}, 
  summary: { total: 100000, successful: 0, failed: 0, pending: 100000 },
  signerStats: {} // Track usage per signer
};

let providers = [];
let signers = [];
let signerStates = {}; // Track signer health and backoff

// Initialize signer states
function initializeSignerStates() {
  for (let i = 0; i < signers.length; i++) {
    signerStates[i] = {
      consecutiveFailures: 0,
      isBackedOff: false,
      backoffUntil: 0,
      totalMinted: 0,
      totalFailed: 0,
      lastUsed: Date.now()
    };
    
    mintLog.signerStats[i] = {
      address: signers[i].address,
      minted: 0,
      failed: 0,
      backedOff: 0
    };
  }
}

// Get next available signer (with backoff logic)
function getNextAvailableSigner() {
  const now = Date.now();
  
  // First, check if any backed-off signers can be reactivated
  for (let i = 0; i < signers.length; i++) {
    if (signerStates[i].isBackedOff && now > signerStates[i].backoffUntil) {
      signerStates[i].isBackedOff = false;
      signerStates[i].consecutiveFailures = 0;
      console.log(chalk.green(`🔄 Signer ${i} reactivated after backoff`));
    }
  }
  
  // Find next available signer
  let attempts = 0;
  while (attempts < signers.length) {
    const oldestSignerIndex = Object.keys(signerStates)
      .filter(i => !signerStates[i].isBackedOff)
      .sort((a, b) => signerStates[a].lastUsed - signerStates[b].lastUsed)[0];
    
    if (oldestSignerIndex !== undefined) {
      signerStates[oldestSignerIndex].lastUsed = now;
      return {
        signer: signers[oldestSignerIndex],
        index: parseInt(oldestSignerIndex),
        provider: providers[parseInt(oldestSignerIndex) % providers.length] // Distribute signers across RPCs
      };
    }
    
    attempts++;
  }
  
  console.log(chalk.red('⚠️  All signers are backed off!'));
  return null;
}

// Handle signer failure
function handleSignerFailure(signerIndex, error) {
  signerStates[signerIndex].consecutiveFailures++;
  signerStates[signerIndex].totalFailed++;
  mintLog.signerStats[signerIndex].failed++;
  
  if (signerStates[signerIndex].consecutiveFailures >= CONFIG.SIGNER_BACKOFF_THRESHOLD) {
    signerStates[signerIndex].isBackedOff = true;
    signerStates[signerIndex].backoffUntil = Date.now() + CONFIG.SIGNER_BACKOFF_DURATION;
    mintLog.signerStats[signerIndex].backedOff++;
    
    console.log(chalk.yellow(
      `🚧 Signer ${signerIndex} paused due to repeated errors. Backoff for ${CONFIG.SIGNER_BACKOFF_DURATION/1000}s`
    ));
  }
}

// Handle signer success
function handleSignerSuccess(signerIndex) {
  signerStates[signerIndex].consecutiveFailures = 0;
  signerStates[signerIndex].totalMinted++;
  mintLog.signerStats[signerIndex].minted++;
}

// Get fresh nonce for signer
async function getFreshNonce(signerIndex) {
  try {
    const provider = providers[signerIndex % providers.length];
    const nonce = await provider.getTransactionCount(signers[signerIndex].address, 'latest');
    return nonce;
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Failed to get nonce for signer ${signerIndex}: ${error.message}`));
    throw error;
  }
}

// Initialize blockchain connection
async function initializeBlockchain() {
  console.log(chalk.blue('\n🔗 Connecting to Blockticity L1 Mainnet...'));
  console.log(chalk.cyan(`🔄 Setting up ${CONFIG.SIGNER_KEYS.length} signers with ${CONFIG.RPC_ENDPOINTS.length} RPC endpoints`));
  
  // Initialize providers
  providers = CONFIG.RPC_ENDPOINTS.map((rpcUrl, index) => {
    console.log(chalk.cyan(`  RPC ${index + 1}: ${rpcUrl.includes('subnets') ? 'Public' : 'Developer'}`));
    return new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
      timeout: 30000
    });
  });
  
  // Initialize signers with RPC distribution
  signers = CONFIG.SIGNER_KEYS.map((privateKey, index) => {
    const provider = providers[index % providers.length];
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(chalk.cyan(`  Signer ${index}: ${wallet.address} → RPC ${(index % providers.length) + 1}`));
    return wallet;
  });
  
  // Initialize signer states
  initializeSignerStates();
  
  // Check network and display balances
  try {
    const network = await providers[0].getNetwork();
    console.log(chalk.green(`✅ Connected to network: chainId ${network.chainId}`));
    
    // Check all signer balances
    console.log(chalk.cyan('\n💰 Signer balances:'));
    for (let i = 0; i < signers.length; i++) {
      try {
        const balance = await providers[i % providers.length].getBalance(signers[i].address);
        console.log(chalk.cyan(`   Signer ${i}: ${ethers.formatEther(balance)} BTIC`));
      } catch (error) {
        console.log(chalk.yellow(`   Signer ${i}: Unable to check balance`));
      }
    }
    
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Network info unavailable, continuing...`));
  }
  
  return { providers, signers };
}

// Build metadata URI
async function buildMetadataUri(tokenId) {
  return 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
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
  if (message.includes('-32000')) {
    return 'RPC_ERROR';
  }
  if (message.includes('insufficient funds')) {
    return 'INSUFFICIENT_FUNDS';
  }
  
  return 'UNKNOWN_ERROR';
}

// Send transaction with timeout
async function sendTransactionWithTimeout(tokenId, metadataUri, signerData, nonce) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Transaction timeout after ${CONFIG.TX_TIMEOUT}ms`));
    }, CONFIG.TX_TIMEOUT);
    
    try {
      const contract = new ethers.Contract(
        CONFIG.CONTRACT_ADDRESS, 
        CONFIG.CONTRACT_ABI, 
        signerData.signer
      );
      
      let gasLimit;
      try {
        const gasEstimate = await contract.mintURI.estimateGas(signerData.signer.address, metadataUri);
        gasLimit = gasEstimate * 130n / 100n;
      } catch (gasError) {
        gasLimit = 300000n;
      }
      
      const tx = await contract.mintURI(signerData.signer.address, metadataUri, { 
        gasLimit,
        nonce: nonce
      });
      
      console.log(chalk.green(
        `🟢 Batch ${tokenId} submitted by Signer ${signerData.index} (${signerData.signer.address.slice(0, 6)}...) – tx: ${tx.hash}`
      ));
      
      const receipt = await tx.wait();
      clearTimeout(timeout);
      resolve(receipt);
      
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

// Mint single token with signer management
async function mintSingleTokenOptimized(tokenId, retryCount = 0) {
  try {
    // Get available signer
    const signerData = getNextAvailableSigner();
    if (!signerData) {
      // All signers backed off, wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
      return mintSingleTokenOptimized(tokenId, retryCount);
    }
    
    // Initialize token in log
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
    const nonce = await getFreshNonce(signerData.index);
    
    // Send transaction
    const receipt = await sendTransactionWithTimeout(tokenId, metadataUri, signerData, nonce);
    
    // Success - update state
    handleSignerSuccess(signerData.index);
    
    // Update log
    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'completed',
      metadataUri: metadataUri,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      signerIndex: signerData.index,
      signerAddress: signerData.signer.address,
      nonce: nonce,
      completedAt: new Date().toISOString()
    };
    
    mintLog.summary.successful++;
    mintLog.summary.pending--;
    
    console.log(chalk.green(`  ✅ ${tokenId}: Block ${receipt.blockNumber} (Signer ${signerData.index})`));
    return true;
    
  } catch (error) {
    const errorType = classifyError(error);
    console.error(chalk.red(`  ❌ ${tokenId}: ${errorType} - ${error.message.slice(0, 80)}`));
    
    // Get signer info for error handling
    const lastSignerIndex = mintLog.tokens[tokenId]?.lastSignerIndex || 0;
    
    // Handle "already known" as success
    if (errorType === 'ALREADY_KNOWN') {
      handleSignerSuccess(lastSignerIndex);
      
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
    
    // Handle signer failure
    if (mintLog.tokens[tokenId]?.lastSignerIndex !== undefined) {
      handleSignerFailure(mintLog.tokens[tokenId].lastSignerIndex, error);
    }
    
    // Store signer index for next attempt
    mintLog.tokens[tokenId].lastSignerIndex = lastSignerIndex;
    
    // Retry logic
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      const delay = calculateBackoffDelay(retryCount);
      console.log(chalk.yellow(`  🔄 ${tokenId}: Retry ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS} in ${(delay/1000).toFixed(1)}s`));
      await new Promise(resolve => setTimeout(resolve, delay));
      return mintSingleTokenOptimized(tokenId, retryCount + 1);
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

// Process batch
async function processBatchOptimized(batch, batchNum, totalBatches) {
  const startTime = Date.now();
  
  console.log(chalk.blue(`\n📦 Batch ${batchNum}/${totalBatches}: ${batch.length} tokens`));
  console.log(chalk.blue(`🎯 Range: ${batch[0]} to ${batch[batch.length - 1]}`));
  
  // Display active signers
  const activeSigners = Object.keys(signerStates).filter(i => !signerStates[i].isBackedOff);
  console.log(chalk.cyan(`👥 Active signers: ${activeSigners.length}/${signers.length}`));
  
  const mintPromises = batch.map(tokenId =>
    mintLimit(() => mintSingleTokenOptimized(tokenId))
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

// Display signer utilization summary
function displaySignerSummary() {
  console.log(chalk.cyan('\n📊 Signer Utilization Summary:'));
  
  for (let i = 0; i < signers.length; i++) {
    const stats = mintLog.signerStats[i];
    const utilization = ((stats.minted / (stats.minted + stats.failed || 1)) * 100).toFixed(1);
    
    console.log(chalk.cyan(
      `   Signer ${i}: ${stats.minted} minted, ${stats.failed} failed, ${stats.backedOff} backoffs (${utilization}% success)`
    ));
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
  
  return false;
}

// Main function
async function main() {
  console.log(chalk.cyan('🚀 Optimized Multi-Signer Batch Minting'));
  console.log(chalk.cyan('='.repeat(60)));
  console.log(chalk.yellow(`🎯 Token Range: ${CONFIG.START_TOKEN_ID.toLocaleString()} - ${CONFIG.END_TOKEN_ID.toLocaleString()}`));
  console.log(chalk.yellow(`⚡ Settings: ${CONFIG.MINT_RATE_LIMIT} concurrent, ${CONFIG.BATCH_SIZE} per batch, ${CONFIG.SIGNER_KEYS.length} signers`));
  
  try {
    // Load existing progress
    const resuming = await loadExistingProgress();
    
    // Find pending tokens
    const pendingTokens = [];
    for (let tokenId = CONFIG.START_TOKEN_ID; tokenId <= CONFIG.END_TOKEN_ID; tokenId++) {
      if (!mintLog.tokens[tokenId] || mintLog.tokens[tokenId].status === 'pending' || mintLog.tokens[tokenId].status === 'failed') {
        pendingTokens.push(tokenId);
      }
    }
    
    console.log(chalk.cyan(`\n🎯 Tokens to process: ${pendingTokens.length.toLocaleString()}`));
    
    if (pendingTokens.length === 0) {
      console.log(chalk.green('✅ All tokens completed!'));
      displaySignerSummary();
      return;
    }
    
    // Initialize blockchain
    await initializeBlockchain();
    
    // Process batches
    const startTime = Date.now();
    const totalBatches = Math.ceil(pendingTokens.length / CONFIG.BATCH_SIZE);
    
    for (let i = 0; i < pendingTokens.length; i += CONFIG.BATCH_SIZE) {
      const batch = pendingTokens.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      
      await processBatchOptimized(batch, batchNum, totalBatches);
      
      // Pause between batches
      if (i + CONFIG.BATCH_SIZE < pendingTokens.length) {
        console.log(chalk.yellow(`⏸️  Stability pause ${CONFIG.BATCH_DELAY/1000}s...`));
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
      }
    }
    
    // Final summary
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000 / 60;
    
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.green('✅ Multi-Signer Minting Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration.toFixed(2)} minutes`));
    console.log(chalk.cyan('📊 Final Stats:'));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful.toLocaleString()}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
    
    displaySignerSummary();
    
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
  
  displaySignerSummary();
  
  if (CONFIG.MINT_LOG_PATH) {
    mintLog.pausedAt = new Date().toISOString();
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    console.log(chalk.cyan(`💾 Progress saved to: ${CONFIG.MINT_LOG_PATH}`));
  }
  
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = { main };