require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Multi-signer configuration
const CONFIG = {
  // Contract details
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  
  // Multiple signer private keys
  SIGNER_KEYS: [
    process.env.SIGNER_KEY_1,
    process.env.SIGNER_KEY_2,
    process.env.SIGNER_KEY_3,
    process.env.SIGNER_KEY_4,
    process.env.SIGNER_KEY_5
  ].filter(Boolean), // Remove undefined keys
  
  // Network configuration
  RPC_ENDPOINTS: [
    'https://subnets.avax.network/btic/mainnet/rpc',
    'https://mainnet-btic-wd732.avax.network/ext/bc/2pV5K35V1ohNSYhRU3z1Bud2oZys9bak7QYcmvbVvnieh4FJXc/rpc?token=90bd898ee2f77b6c45744ad57ae36724130c37e6478836c4cab1a50922d56dde'
  ],
  
  // Minting configuration
  BATCH_SIZE: 25,
  CONCURRENT_SIGNERS: 3, // Number of signers to use concurrently
  SIGNER_BATCH_DELAY: 1000, // Delay between batches for same signer
  TX_TIMEOUT: 120000,
  RETRY_ATTEMPTS: 3,
  
  // File paths
  RECIPIENTS_FILE: path.join(__dirname, 'data', 'recipients.json'),
  RESULTS_FILE: path.join(__dirname, 'output', 'multi_signer_results.json'),
  
  CONTRACT_ABI: [
    'function batchMint(address[] calldata to, string[] calldata uri) external returns (uint256 startTokenId, uint256 count)',
    'function batchMintSameURI(address[] calldata to, string calldata uri) external returns (uint256 startTokenId, uint256 count)',
    'function setAuthorizedMinter(address minter, bool authorized) external',
    'function authorizedMinters(address) external view returns (bool)',
    'function owner() external view returns (address)'
  ]
};

class MultiSignerBatchMinter {
  constructor() {
    this.providers = [];
    this.signers = [];
    this.signerStats = [];
    this.currentProviderIndex = 0;
    this.results = {
      startTime: new Date().toISOString(),
      endTime: null,
      totalBatches: 0,
      successfulBatches: 0,
      failedBatches: 0,
      totalTokensMinted: 0,
      signerStats: {},
      batches: []
    };
  }
  
  async initialize() {
    console.log(chalk.cyan('🚀 Initializing Multi-Signer Batch Minter'));
    
    // Setup providers
    this.providers = CONFIG.RPC_ENDPOINTS.map((rpc, index) => {
      console.log(chalk.cyan(`  Provider ${index + 1}: ${rpc.includes('token') ? 'Developer' : 'Public'} RPC`));
      return new ethers.JsonRpcProvider(rpc, undefined, {
        timeout: CONFIG.TX_TIMEOUT
      });
    });
    
    // Setup signers
    console.log(chalk.cyan(`\n👥 Setting up ${CONFIG.SIGNER_KEYS.length} signers:`));
    
    for (let i = 0; i < CONFIG.SIGNER_KEYS.length; i++) {
      const provider = this.providers[i % this.providers.length];
      const wallet = new ethers.Wallet(CONFIG.SIGNER_KEYS[i], provider);
      const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
      
      this.signers.push({
        id: i,
        wallet,
        contract,
        provider,
        isActive: false,
        currentNonce: null,
        batchesMinted: 0,
        tokensMinted: 0,
        lastUsed: 0
      });
      
      this.results.signerStats[wallet.address] = {
        batches: 0,
        tokens: 0,
        errors: 0
      };
      
      console.log(chalk.green(`  Signer ${i + 1}: ${wallet.address}`));
    }
    
    // Verify connections and nonces
    await this.initializeSigners();
  }
  
  async initializeSigners() {
    console.log(chalk.cyan('\n🔄 Initializing signer nonces...'));
    
    const initPromises = this.signers.map(async (signer) => {
      try {
        const [network, balance, nonce] = await Promise.all([
          signer.provider.getNetwork(),
          signer.provider.getBalance(signer.wallet.address),
          signer.provider.getTransactionCount(signer.wallet.address, 'pending')
        ]);
        
        signer.currentNonce = nonce;
        
        console.log(chalk.green(`  ✅ Signer ${signer.id + 1}: Balance ${ethers.formatEther(balance)} ETH, Nonce ${nonce}`));
        
        return true;
      } catch (error) {
        console.error(chalk.red(`  ❌ Signer ${signer.id + 1} failed:`, error.message));
        return false;
      }
    });
    
    const results = await Promise.all(initPromises);
    const successCount = results.filter(Boolean).length;
    
    console.log(chalk.cyan(`📊 ${successCount}/${this.signers.length} signers initialized successfully`));
    
    if (successCount === 0) {
      throw new Error('No signers could be initialized');
    }
  }
  
  // Get next available signer (round-robin with delay consideration)
  getNextSigner() {
    const now = Date.now();
    
    // Filter available signers (not currently active and past delay)
    const availableSigners = this.signers.filter(signer => 
      !signer.isActive && 
      (now - signer.lastUsed) >= CONFIG.SIGNER_BATCH_DELAY
    );
    
    if (availableSigners.length === 0) {
      return null; // No signers available
    }
    
    // Return signer with least usage
    return availableSigners.reduce((least, current) => 
      current.batchesMinted < least.batchesMinted ? current : least
    );
  }
  
  // Execute batch with specific signer
  async executeBatchWithSigner(signer, batch, batchIndex) {
    const batchId = `batch_${batchIndex + 1}_signer_${signer.id + 1}`;
    
    try {
      signer.isActive = true;
      
      console.log(chalk.blue(`🔄 ${batchId}: Processing ${batch.length} tokens`));
      
      // Prepare batch data
      const addresses = batch.map(item => item.address);
      const uris = batch.map(item => item.uri);
      const sameURI = uris.every(uri => uri === uris[0]);
      
      // Execute transaction
      const startTime = Date.now();
      let tx;
      
      if (sameURI) {
        tx = await signer.contract.batchMintSameURI(addresses, uris[0], {
          nonce: signer.currentNonce++
        });
      } else {
        tx = await signer.contract.batchMint(addresses, uris, {
          nonce: signer.currentNonce++
        });
      }
      
      console.log(chalk.yellow(`  📝 ${batchId}: ${tx.hash}`));
      
      // Wait for confirmation
      const receipt = await tx.wait();
      const duration = Date.now() - startTime;
      
      // Parse events
      const batchMintedEvents = receipt.logs.filter(log => {
        try {
          const parsed = signer.contract.interface.parseLog(log);
          return parsed.name === 'BatchMinted';
        } catch {
          return false;
        }
      });
      
      let startTokenId = 0;
      let tokenCount = 0;
      
      if (batchMintedEvents.length > 0) {
        const event = signer.contract.interface.parseLog(batchMintedEvents[0]);
        startTokenId = Number(event.args.startTokenId);
        tokenCount = Number(event.args.count);
      }
      
      // Update signer stats
      signer.batchesMinted++;
      signer.tokensMinted += tokenCount;
      signer.lastUsed = Date.now();
      
      // Update results
      this.results.signerStats[signer.wallet.address].batches++;
      this.results.signerStats[signer.wallet.address].tokens += tokenCount;
      
      const batchResult = {
        batchId,
        batchIndex,
        signerId: signer.id,
        signerAddress: signer.wallet.address,
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        duration,
        startTokenId,
        tokenCount,
        timestamp: new Date().toISOString()
      };
      
      this.results.batches.push(batchResult);
      this.results.successfulBatches++;
      this.results.totalTokensMinted += tokenCount;
      
      console.log(chalk.green(`  ✅ ${batchId}: ${tokenCount} tokens in ${duration}ms`));
      
      return batchResult;
      
    } catch (error) {
      console.error(chalk.red(`  ❌ ${batchId}:`, error.message));
      
      // Update error stats
      this.results.signerStats[signer.wallet.address].errors++;
      
      // Reset nonce if needed
      if (error.message.includes('nonce')) {
        signer.currentNonce = await signer.provider.getTransactionCount(signer.wallet.address, 'pending');
      }
      
      throw error;
      
    } finally {
      signer.isActive = false;
    }
  }
  
  // Execute all batches with concurrent signers
  async executeBatches(batches) {
    console.log(chalk.cyan(`\n🎯 Starting multi-signer batch minting: ${batches.length} batches`));
    console.log(chalk.cyan(`👥 Using up to ${CONFIG.CONCURRENT_SIGNERS} concurrent signers`));
    
    const activeBatches = new Set();
    let batchIndex = 0;
    let completedBatches = 0;
    
    while (completedBatches < batches.length) {
      // Start new batches if we have available signers and pending batches
      while (activeBatches.size < CONFIG.CONCURRENT_SIGNERS && batchIndex < batches.length) {
        const signer = this.getNextSigner();
        
        if (signer) {
          const batch = batches[batchIndex];
          const currentBatchIndex = batchIndex;
          
          // Start batch processing
          const batchPromise = this.executeBatchWithSigner(signer, batch, currentBatchIndex)
            .then(result => {
              activeBatches.delete(batchPromise);
              completedBatches++;
              
              const progress = (completedBatches / batches.length * 100).toFixed(1);
              console.log(chalk.cyan(`📊 Progress: ${completedBatches}/${batches.length} (${progress}%)`));
              
              return result;
            })
            .catch(error => {
              activeBatches.delete(batchPromise);
              completedBatches++;
              this.results.failedBatches++;
              
              console.error(chalk.red(`💥 Batch ${currentBatchIndex + 1} failed:`, error.message));
              return null;
            });
          
          activeBatches.add(batchPromise);
          batchIndex++;
        } else {
          // No available signers, wait a bit
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Wait for at least one batch to complete
      if (activeBatches.size > 0) {
        await Promise.race(Array.from(activeBatches));
      }
    }
    
    // Wait for all remaining batches to complete
    if (activeBatches.size > 0) {
      await Promise.all(Array.from(activeBatches));
    }
  }
  
  // Print signer statistics
  printSignerStats() {
    console.log(chalk.cyan('\n👥 SIGNER STATISTICS'));
    console.log(chalk.cyan('='.repeat(60)));
    
    this.signers.forEach((signer, index) => {
      const stats = this.results.signerStats[signer.wallet.address];
      console.log(chalk.yellow(`Signer ${index + 1} (${signer.wallet.address}):`));
      console.log(chalk.green(`  📦 Batches: ${stats.batches}`));
      console.log(chalk.green(`  🎨 Tokens: ${stats.tokens}`));
      console.log(chalk.red(`  ❌ Errors: ${stats.errors}`));
      
      if (stats.batches > 0) {
        const avgTokens = (stats.tokens / stats.batches).toFixed(1);
        console.log(chalk.blue(`  📊 Avg tokens/batch: ${avgTokens}`));
      }
    });
  }
  
  // Load recipients and create batches
  async loadRecipients() {
    const data = await fs.readJson(CONFIG.RECIPIENTS_FILE);
    console.log(chalk.cyan(`📋 Loaded ${data.length} recipients`));
    
    const batches = [];
    for (let i = 0; i < data.length; i += CONFIG.BATCH_SIZE) {
      batches.push(data.slice(i, i + CONFIG.BATCH_SIZE));
    }
    
    console.log(chalk.cyan(`📦 Created ${batches.length} batches`));
    return batches;
  }
  
  // Save results
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
    console.log(chalk.cyan('🎉 MULTI-SIGNER BATCH MINTING COMPLETE'));
    console.log(chalk.cyan('='.repeat(60)));
    
    console.log(chalk.yellow(`📊 Total Batches: ${this.results.totalBatches}`));
    console.log(chalk.green(`✅ Successful: ${this.results.successfulBatches}`));
    console.log(chalk.red(`❌ Failed: ${this.results.failedBatches}`));
    console.log(chalk.blue(`🎨 Total Tokens: ${this.results.totalTokensMinted}`));
    console.log(chalk.magenta(`👥 Signers Used: ${this.signers.length}`));
    
    const duration = new Date(this.results.endTime) - new Date(this.results.startTime);
    console.log(chalk.cyan(`⏱️  Duration: ${Math.round(duration / 1000)}s`));
    
    if (this.results.totalTokensMinted > 0) {
      const rate = this.results.totalTokensMinted / (duration / 1000);
      console.log(chalk.cyan(`🚀 Rate: ${rate.toFixed(2)} tokens/sec`));
    }
    
    this.printSignerStats();
  }
  
  // Main execution
  async run() {
    try {
      await this.initialize();
      const batches = await this.loadRecipients();
      
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

// Main execution
async function main() {
  const minter = new MultiSignerBatchMinter();
  await minter.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { MultiSignerBatchMinter };