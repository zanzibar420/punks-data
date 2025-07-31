require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Ultra-conservative Configuration
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: 'https://subnets.avax.network/btic/mainnet/rpc',
  RETRY_ATTEMPTS: 10,
  RETRY_DELAY: 10000, // 10 seconds
  TX_TIMEOUT: 180000, // 3 minutes
  DELAY_BETWEEN_TOKENS: 15000, // 15 seconds between each token
  FAILED_TOKENS_FILE: path.join(__dirname, 'failed_batch2_tokens.txt'),
  MINT_LOG_PATH: path.join(__dirname, 'retry_batch2_conservative_log.json'),
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };
let provider = null;
let wallet = null;

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
    
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Network info unavailable, continuing...`));
  }
  
  return { provider, wallet, contract };
}

async function waitForTransactionWithTimeout(txPromise, timeout = CONFIG.TX_TIMEOUT) {
  return Promise.race([
    txPromise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Transaction timeout')), timeout)
    )
  ]);
}

async function mintSingleTokenConservative(contract, tokenId, retryCount = 0) {
  try {
    console.log(chalk.yellow(`\n🎯 Processing token ${tokenId} (attempt ${retryCount + 1})...`));
    
    // Check if already completed
    if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'completed') {
      console.log(chalk.blue(`✅ Token ${tokenId} already completed, skipping...`));
      return true;
    }
    
    // Get fresh nonce each time
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    console.log(chalk.cyan(`🔢 Using nonce: ${nonce}`));
    
    const metadataUri = 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
    
    // Use higher gas limit and price for reliability
    const gasLimit = 400000n;
    const gasPrice = await provider.getFeeData();
    
    console.log(chalk.cyan(`📡 Sending transaction...`));
    
    const tx = await contract.mintURI(wallet.address, metadataUri, { 
      gasLimit,
      gasPrice: gasPrice.gasPrice,
      nonce: nonce
    });
    
    console.log(chalk.cyan(`📡 Transaction sent: ${tx.hash}`));
    console.log(chalk.yellow(`⏳ Waiting for confirmation (up to ${CONFIG.TX_TIMEOUT/1000}s)...`));
    
    // Wait for transaction with timeout
    const receipt = await waitForTransactionWithTimeout(tx.wait());
    
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
    
    console.log(chalk.green(`✅ Token ${tokenId} minted successfully!`));
    console.log(chalk.green(`   Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`));
    
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Failed to mint token ${tokenId}: ${error.message}`));
    
    // Handle specific error cases
    if (error.message.includes('already known') || error.message.includes('transaction already exists')) {
      console.log(chalk.blue(`📝 Transaction already known, marking as completed...`));
      
      mintLog.tokens[tokenId] = {
        tokenId: tokenId,
        status: 'completed',
        metadataUri: 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN',
        txHash: 'already_known',
        completedAt: new Date().toISOString(),
        note: 'Transaction already known'
      };
      
      mintLog.summary.successful++;
      if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'pending') {
        mintLog.summary.pending--;
      }
      
      await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
      return true;
    }
    
    // Retry logic
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      const delay = CONFIG.RETRY_DELAY * (retryCount + 1); // Linear backoff
      console.log(chalk.yellow(`🔄 Retrying in ${delay/1000}s... (${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS})`));
      await new Promise(resolve => setTimeout(resolve, delay));
      return mintSingleTokenConservative(contract, tokenId, retryCount + 1);
    }
    
    // Mark as failed
    mintLog.tokens[tokenId] = {
      tokenId: tokenId,
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString(),
      retryCount: retryCount
    };
    
    mintLog.summary.failed++;
    if (mintLog.tokens[tokenId] && mintLog.tokens[tokenId].status === 'pending') {
      mintLog.summary.pending--;
    }
    
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
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

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Batch 2 Conservative Retry'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.yellow('⚠️  Processing ONE token at a time for maximum reliability'));
  
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
    
    // Process tokens one by one
    const startTime = Date.now();
    
    for (let i = 0; i < pendingTokens.length; i++) {
      const tokenId = pendingTokens[i];
      
      console.log(chalk.blue(`\n📍 Progress: ${i + 1}/${pendingTokens.length} (${((i/pendingTokens.length)*100).toFixed(1)}%)`));
      
      const success = await mintSingleTokenConservative(contract, tokenId);
      
      console.log(chalk.cyan(`📊 Session: ${mintLog.summary.successful} success, ${mintLog.summary.failed} failed`));
      
      // Delay between tokens (except for the last one)
      if (i < pendingTokens.length - 1) {
        console.log(chalk.yellow(`⏸️  Waiting ${CONFIG.DELAY_BETWEEN_TOKENS/1000}s before next token...`));
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_TOKENS));
      }
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000 / 60;
    
    console.log(chalk.cyan('\n='.repeat(50)));
    console.log(chalk.green('✅ Processing Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration.toFixed(2)} minutes`));
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