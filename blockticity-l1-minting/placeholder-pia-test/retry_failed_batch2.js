require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: 'https://subnets.avax.network/btic/mainnet/rpc',
  MINT_RATE_LIMIT: 5,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 3000,
  BATCH_SIZE: 20,
  FAILED_TOKENS_FILE: path.join(__dirname, 'failed_batch2_tokens.txt'),
  METADATA_DIR: path.join(__dirname, 'output', 'metadata'),
  MINT_LOG_PATH: path.join(__dirname, 'retry_batch2_log.json'),
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };

async function initializeBlockchain() {
  console.log(chalk.blue('\n🔗 Connecting to Blockticity L1 Mainnet...'));
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
  
  try {
    const [network, balance] = await Promise.all([
      provider.getNetwork(),
      provider.getBalance(wallet.address)
    ]);
    
    console.log(chalk.green(`✅ Connected to network: chainId ${network.chainId}`));
    console.log(chalk.green(`💰 Wallet balance: ${ethers.formatEther(balance)} BTIC`));
    console.log(chalk.green(`🔑 Minting from: ${wallet.address}`));
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Network info unavailable, continuing...`));
  }
  
  return { provider, wallet, contract };
}

async function buildMetadataUri(tokenId) {
  // Use IPFS placeholder (same as successful batches)
  return 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
}

async function mintSingleToken(wallet, contract, tokenId, retryCount = 0) {
  try {
    console.log(chalk.yellow(`  🎨 Minting token ${tokenId}...`));
    
    // Build metadata URI
    const metadataUri = await buildMetadataUri(tokenId);
    
    // Estimate gas
    const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
    const gasLimit = gasEstimate * 125n / 100n; // 25% buffer
    
    const tx = await contract.mintURI(wallet.address, metadataUri, { gasLimit });
    const receipt = await tx.wait();
    
    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'completed',
      metadataUri: metadataUri,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      completedAt: new Date().toISOString()
    };
    
    mintLog.summary.successful++;
    mintLog.summary.pending--;
    
    console.log(chalk.green(`  ✅ Token ${tokenId} minted! Tx: ${receipt.hash}`));
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    
    return true;
  } catch (error) {
    console.error(chalk.red(`  ❌ Failed to mint token ${tokenId}: ${error.message}`));
    
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      console.log(chalk.yellow(`  🔄 Retrying in ${CONFIG.RETRY_DELAY / 1000} seconds... (Attempt ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS})`));
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return mintSingleToken(wallet, contract, tokenId, retryCount + 1);
    }
    
    mintLog.tokens[tokenId].status = 'failed';
    mintLog.tokens[tokenId].error = error.message;
    mintLog.tokens[tokenId].failedAt = new Date().toISOString();
    mintLog.summary.failed++;
    mintLog.summary.pending--;
    
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

async function mintPendingTokens(wallet, contract, tokenIds) {
  console.log(chalk.cyan('\n📋 Finding pending tokens...'));
  
  const pendingTokens = Object.entries(mintLog.tokens)
    .filter(([_, data]) => data.status === 'pending')
    .map(([tokenId, data]) => tokenId);
  
  console.log(chalk.cyan(`📊 Found ${pendingTokens.length} pending tokens to mint`));
  
  if (pendingTokens.length === 0) {
    console.log(chalk.green('✅ No pending tokens to mint!'));
    return;
  }
  
  // Process in batches
  for (let i = 0; i < pendingTokens.length; i += CONFIG.BATCH_SIZE) {
    const batch = pendingTokens.slice(i, i + CONFIG.BATCH_SIZE);
    const batchEnd = Math.min(i + CONFIG.BATCH_SIZE, pendingTokens.length);
    
    console.log(chalk.blue(`\n📦 Processing batch ${i + 1}-${batchEnd} of ${pendingTokens.length}...`));
    
    const mintPromises = batch.map(tokenId =>
      mintLimit(() => mintSingleToken(wallet, contract, tokenId))
    );
    
    await Promise.all(mintPromises);
    
    console.log(chalk.cyan(`\n📊 Progress: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
    
    // Add a small delay between batches
    if (i + CONFIG.BATCH_SIZE < pendingTokens.length) {
      console.log(chalk.yellow('⏸️  Pausing between batches...'));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Batch 2 Failed Token Retry'));
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
    const { provider, wallet, contract } = await initializeBlockchain();
    
    // Start minting
    const startTime = Date.now();
    await mintPendingTokens(wallet, contract, tokenIds);
    
    // Final summary
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Batch 2 Retry Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration} minutes`));
    console.log(chalk.cyan(`📊 Final Stats:`));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
    
    // Export any remaining failed tokens
    const remainingFailedTokens = Object.entries(mintLog.tokens)
      .filter(([_, data]) => data.status === 'failed')
      .map(([tokenId, data]) => ({ tokenId, ...data }));
    
    if (remainingFailedTokens.length > 0) {
      await fs.writeJson(
        path.join(__dirname, 'remaining_failed_tokens.json'), 
        remainingFailedTokens, 
        { spaces: 2 }
      );
      console.log(chalk.yellow(`\n📄 Remaining failed tokens exported to remaining_failed_tokens.json`));
    }
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
    console.error(error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };