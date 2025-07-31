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
  RPC_URL: process.env.RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc',
  
  MINT_RATE_LIMIT: 5, // Mints per second
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000, // 5 seconds
  
  MINT_LOG_PATH: path.join(__dirname, 'output', 'mint_log.json'),
  
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

let mintLog = {};

async function main() {
  console.log(chalk.cyan('🚀 RESUME MINTING ONLY - Players Ink Authentication'));
  console.log(chalk.cyan('='.repeat(50)));
  
  try {
    // Load existing progress
    if (!await fs.pathExists(CONFIG.MINT_LOG_PATH)) {
      throw new Error('No mint_log.json found. Run the main script first.');
    }
    
    mintLog = await fs.readJSON(CONFIG.MINT_LOG_PATH);
    
    // Count pending tokens
    const pendingTokens = Object.values(mintLog.tokens).filter(t => 
      t.status === 'pending' && t.metadataUri
    );
    
    console.log(chalk.blue(`📊 Found ${pendingTokens.length} pending tokens to mint`));
    console.log(chalk.blue(`✅ Already minted: ${mintLog.summary.successful || 0}`));
    console.log(chalk.blue(`❌ Failed: ${mintLog.summary.failed || 0}`));
    
    if (pendingTokens.length === 0) {
      console.log(chalk.yellow('No pending tokens to mint!'));
      return;
    }
    
    // Initialize blockchain connection
    const { provider, wallet, contract } = await initializeBlockchain();
    
    // Mint pending NFTs
    console.log(chalk.blue('\n🎨 Resuming minting process...'));
    await mintPendingNFTs(wallet, contract, pendingTokens);
    
    // Final summary
    printSummary();
    
  } catch (error) {
    console.error(chalk.red('❌ Fatal error:'), error);
    process.exit(1);
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
  
  console.log(chalk.green(`✅ Connected to network: Chain ID ${network.chainId}`));
  console.log(chalk.green(`✅ Wallet balance: ${ethers.formatEther(balance)} BTIC`));
  
  return { provider, wallet, contract };
}

// Mint pending NFTs
async function mintPendingNFTs(wallet, contract, pendingTokens) {
  const limit = pLimit(CONFIG.MINT_RATE_LIMIT);
  let successCount = mintLog.summary.successful || 0;
  let failCount = mintLog.summary.failed || 0;
  let processedCount = 0;
  
  // Sort by token ID to process in order
  pendingTokens.sort((a, b) => a.tokenId - b.tokenId);
  
  console.log(chalk.blue(`\n Starting from token ${pendingTokens[0].tokenId}...`));
  
  for (const tokenData of pendingTokens) {
    await limit(async () => {
      for (let attempt = 1; attempt <= CONFIG.RETRY_ATTEMPTS; attempt++) {
        try {
          console.log(chalk.blue(`🎨 Minting token ${tokenData.tokenId} (${tokenData.paddedId})...`));
          
          const tx = await contract.mintURI(wallet.address, tokenData.metadataUri);
          console.log(chalk.gray(`   TX: ${tx.hash}`));
          
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
          
          successCount++;
          processedCount++;
          mintLog.summary.successful = successCount;
          
          console.log(chalk.green(`✅ Token ${tokenData.tokenId} minted successfully`));
          
          // Save progress periodically
          if (processedCount % 10 === 0) {
            await saveMintLog();
            console.log(chalk.cyan(`📊 Progress: ${processedCount}/${pendingTokens.length} pending tokens processed`));
          }
          
          break; // Success, exit retry loop
          
        } catch (error) {
          console.error(chalk.red(`❌ Attempt ${attempt}/${CONFIG.RETRY_ATTEMPTS} failed for token ${tokenData.tokenId}: ${error.message}`));
          
          if (attempt === CONFIG.RETRY_ATTEMPTS) {
            // Final attempt failed
            mintLog.tokens[tokenData.tokenId] = {
              ...tokenData,
              status: 'failed',
              error: error.message,
              failedAt: new Date().toISOString()
            };
            failCount++;
            processedCount++;
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
  // Recalculate summary
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
  console.log(chalk.cyan('📊 MINTING SESSION COMPLETE'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.green(`✅ Successful: ${mintLog.summary.successful}`));
  console.log(chalk.red(`❌ Failed: ${mintLog.summary.failed}`));
  console.log(chalk.yellow(`⏳ Still Pending: ${mintLog.summary.pending}`));
  console.log(chalk.blue(`📁 Total Tokens: ${mintLog.summary.total}`));
  console.log(chalk.cyan('='.repeat(50)));
}

// Run the script
main().catch(error => {
  console.error(chalk.red('❌ Unhandled error:'), error);
  process.exit(1);
});