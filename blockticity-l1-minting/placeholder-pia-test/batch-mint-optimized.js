require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  // Contract details
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  
  // Network configuration
  RPC_ENDPOINTS: [
    'https://subnets.avax.network/btic/mainnet/rpc',
    'https://mainnet-btic-wd732.avax.network/ext/bc/2pV5K35V1ohNSYhRU3z1Bud2oZys9bak7QYcmvbVvnieh4FJXc/rpc?token=90bd898ee2f77b6c45744ad57ae36724130c37e6478836c4cab1a50922d56dde'
  ],
  
  // Minting configuration
  BATCH_SIZE: 25, // Tokens per batch
  BATCH_DELAY: 2000, // 2 seconds between batches
  RETRY_ATTEMPTS: 5,
  RETRY_DELAY: 3000,
  TX_TIMEOUT: 120000, // 2 minutes
  
  // File paths
  RECIPIENTS_FILE: path.join(__dirname, 'data', 'recipients.json'),
  RESULTS_FILE: path.join(__dirname, 'output', 'batch_mint_results.json'),
  LOG_FILE: path.join(__dirname, 'output', 'batch_mint.log'),
  
  // Contract ABI (add your batch mint functions)
  CONTRACT_ABI: [
    'function batchMint(address[] calldata to, string[] calldata uri) external returns (uint256 startTokenId, uint256 count)',
    'function batchMintSameURI(address[] calldata to, string calldata uri) external returns (uint256 startTokenId, uint256 count)',
    'function mintURI(address to, string uri) external',
    'function owner() external view returns (address)',
    'function balanceOf(address owner) external view returns (uint256)',
    'function tokenURI(uint256 tokenId) external view returns (string memory)'
  ]
};

class BatchMinter {
  constructor() {
    this.providers = [];
    this.currentProviderIndex = 0;
    this.wallet = null;
    this.contract = null;
    this.results = {
      startTime: new Date().toISOString(),
      endTime: null,
      totalBatches: 0,
      successfulBatches: 0,
      failedBatches: 0,
      totalTokensMinted: 0,
      batches: []
    };
  }
  
  // Initialize providers and wallet
  async initialize() {
    console.log(chalk.cyan('🚀 Initializing Batch Minter'));
    
    // Setup providers with round-robin
    this.providers = CONFIG.RPC_ENDPOINTS.map((rpc, index) => {
      console.log(chalk.cyan(`  ${index + 1}. ${rpc.includes('token') ? 'Developer' : 'Public'} RPC`));
      return new ethers.JsonRpcProvider(rpc, undefined, {
        timeout: CONFIG.TX_TIMEOUT
      });
    });
    
    // Setup wallet and contract
    this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.providers[0]);
    this.contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, this.wallet);
    
    // Verify connection
    try {
      const network = await this.providers[0].getNetwork();
      const balance = await this.providers[0].getBalance(this.wallet.address);
      
      console.log(chalk.green(`✅ Connected to chainId: ${network.chainId}`));
      console.log(chalk.green(`💰 Wallet: ${this.wallet.address}`));
      console.log(chalk.green(`💳 Balance: ${ethers.formatEther(balance)} ETH`));
    } catch (error) {
      console.error(chalk.red('❌ Connection failed:'), error.message);
      throw error;
    }
  }
  
  // Get next provider in round-robin
  getNextProvider() {
    const provider = this.providers[this.currentProviderIndex];
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
    return provider;
  }
  
  // Load recipients from file
  async loadRecipients() {
    try {
      const data = await fs.readJson(CONFIG.RECIPIENTS_FILE);
      console.log(chalk.cyan(`📋 Loaded ${data.length} recipients`));
      return data;
    } catch (error) {
      console.error(chalk.red('❌ Failed to load recipients:'), error.message);
      throw error;
    }
  }
  
  // Create batches from recipients
  createBatches(recipients) {
    const batches = [];
    for (let i = 0; i < recipients.length; i += CONFIG.BATCH_SIZE) {
      batches.push(recipients.slice(i, i + CONFIG.BATCH_SIZE));
    }
    console.log(chalk.cyan(`📦 Created ${batches.length} batches of ${CONFIG.BATCH_SIZE} tokens each`));
    return batches;
  }
  
  // Execute single batch mint
  async executeBatchMint(batch, batchIndex, retryCount = 0) {
    const batchId = `batch_${batchIndex + 1}`;
    
    try {
      console.log(chalk.blue(`\n🔄 Processing ${batchId}: ${batch.length} tokens`));
      
      // Use round-robin provider
      const provider = this.getNextProvider();
      const walletWithProvider = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
      const contractWithProvider = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, walletWithProvider);
      
      // Prepare batch data
      const addresses = batch.map(item => item.address);
      const uris = batch.map(item => item.uri);
      
      // Check if all URIs are the same (optimization)
      const sameURI = uris.every(uri => uri === uris[0]);
      
      // Execute batch mint
      const startTime = Date.now();
      let tx;
      
      if (sameURI) {
        console.log(chalk.yellow(`  📄 Using batchMintSameURI (optimized)`));
        tx = await contractWithProvider.batchMintSameURI(addresses, uris[0]);
      } else {
        console.log(chalk.yellow(`  📄 Using batchMint (individual URIs)`));
        tx = await contractWithProvider.batchMint(addresses, uris);
      }
      
      console.log(chalk.yellow(`  🏷️  Transaction: ${tx.hash}`));
      
      // Wait for confirmation
      const receipt = await tx.wait();
      const duration = Date.now() - startTime;
      
      // Parse events to get token IDs
      const batchMintedEvents = receipt.logs.filter(log => {
        try {
          const parsed = contractWithProvider.interface.parseLog(log);
          return parsed.name === 'BatchMinted';
        } catch {
          return false;
        }
      });
      
      let startTokenId = 0;
      let tokenCount = 0;
      
      if (batchMintedEvents.length > 0) {
        const event = contractWithProvider.interface.parseLog(batchMintedEvents[0]);
        startTokenId = Number(event.args.startTokenId);
        tokenCount = Number(event.args.count);
      }
      
      // Record successful batch
      const batchResult = {
        batchId,
        batchIndex,
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        duration,
        startTokenId,
        tokenCount,
        recipients: batch.map((item, index) => ({
          address: item.address,
          uri: item.uri,
          tokenId: startTokenId + index
        })),
        timestamp: new Date().toISOString()
      };
      
      this.results.batches.push(batchResult);
      this.results.successfulBatches++;
      this.results.totalTokensMinted += tokenCount;
      
      console.log(chalk.green(`  ✅ Success: ${tokenCount} tokens minted in ${duration}ms`));
      console.log(chalk.green(`  🔢 Token IDs: ${startTokenId} - ${startTokenId + tokenCount - 1}`));
      
      return batchResult;
      
    } catch (error) {
      console.error(chalk.red(`  ❌ ${batchId} failed:`, error.message));
      
      // Retry logic
      if (retryCount < CONFIG.RETRY_ATTEMPTS) {
        console.log(chalk.yellow(`  🔄 Retrying ${batchId} (${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS})`));
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * (retryCount + 1)));
        return this.executeBatchMint(batch, batchIndex, retryCount + 1);
      }
      
      // Record failed batch
      const batchResult = {
        batchId,
        batchIndex,
        success: false,
        error: error.message,
        retryCount,
        recipients: batch,
        timestamp: new Date().toISOString()
      };
      
      this.results.batches.push(batchResult);
      this.results.failedBatches++;
      
      throw error;
    }
  }
  
  // Execute all batches
  async executeBatches(batches) {
    console.log(chalk.cyan(`\n🎯 Starting batch minting: ${batches.length} batches`));
    
    for (let i = 0; i < batches.length; i++) {
      try {
        await this.executeBatchMint(batches[i], i);
        
        // Progress update
        const progress = ((i + 1) / batches.length * 100).toFixed(1);
        console.log(chalk.cyan(`📊 Progress: ${i + 1}/${batches.length} batches (${progress}%)`));
        
        // Delay between batches
        if (i < batches.length - 1) {
          console.log(chalk.yellow(`⏸️  Waiting ${CONFIG.BATCH_DELAY}ms...`));
          await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
        }
        
      } catch (error) {
        console.error(chalk.red(`💥 Batch ${i + 1} failed permanently:`, error.message));
        // Continue with next batch
      }
    }
  }
  
  // Save results to file
  async saveResults() {
    this.results.endTime = new Date().toISOString();
    this.results.totalBatches = this.results.successfulBatches + this.results.failedBatches;
    
    await fs.ensureDir(path.dirname(CONFIG.RESULTS_FILE));
    await fs.writeJson(CONFIG.RESULTS_FILE, this.results, { spaces: 2 });
    
    console.log(chalk.cyan(`💾 Results saved to: ${CONFIG.RESULTS_FILE}`));
  }
  
  // Print final summary
  printSummary() {
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan('🎉 BATCH MINTING COMPLETE'));
    console.log(chalk.cyan('='.repeat(60)));
    
    console.log(chalk.yellow(`📊 Total Batches: ${this.results.totalBatches}`));
    console.log(chalk.green(`✅ Successful: ${this.results.successfulBatches}`));
    console.log(chalk.red(`❌ Failed: ${this.results.failedBatches}`));
    console.log(chalk.blue(`🎨 Total Tokens Minted: ${this.results.totalTokensMinted}`));
    
    const duration = new Date(this.results.endTime) - new Date(this.results.startTime);
    console.log(chalk.cyan(`⏱️  Total Duration: ${Math.round(duration / 1000)}s`));
    
    if (this.results.totalTokensMinted > 0) {
      const rate = this.results.totalTokensMinted / (duration / 1000);
      console.log(chalk.cyan(`🚀 Average Rate: ${rate.toFixed(2)} tokens/sec`));
    }
  }
  
  // Main execution
  async run() {
    try {
      await this.initialize();
      const recipients = await this.loadRecipients();
      const batches = this.createBatches(recipients);
      
      await this.executeBatches(batches);
      await this.saveResults();
      
      this.printSummary();
      
    } catch (error) {
      console.error(chalk.red('💥 Fatal error:'), error);
      await this.saveResults();
      process.exit(1);
    }
  }
}

// Create example recipients file
async function createExampleData() {
  const exampleRecipients = [];
  
  // Generate 100 example recipients
  for (let i = 1; i <= 100; i++) {
    exampleRecipients.push({
      address: `0x${Math.random().toString(16).slice(2, 42).padStart(40, '0')}`,
      uri: `ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN/${i}`
    });
  }
  
  await fs.ensureDir(path.dirname(CONFIG.RECIPIENTS_FILE));
  await fs.writeJson(CONFIG.RECIPIENTS_FILE, exampleRecipients, { spaces: 2 });
  
  console.log(chalk.green(`📝 Example recipients created: ${CONFIG.RECIPIENTS_FILE}`));
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--create-example')) {
    await createExampleData();
    return;
  }
  
  const minter = new BatchMinter();
  await minter.run();
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled rejection:'), error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n⏸️  Gracefully shutting down...'));
  process.exit(0);
});

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BatchMinter };