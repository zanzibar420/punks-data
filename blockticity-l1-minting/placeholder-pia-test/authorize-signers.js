require('dotenv').config();
const { ethers } = require('ethers');
const chalk = require('chalk');

const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  RPC_URL: process.env.RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc',
  
  // Load all 6 signer keys
  SIGNER_KEYS: [
    process.env.SIGNER_KEY_0, // Owner wallet
    process.env.SIGNER_KEY_1,
    process.env.SIGNER_KEY_2,
    process.env.SIGNER_KEY_3,
    process.env.SIGNER_KEY_4,
    process.env.SIGNER_KEY_5
  ].filter(key => key),
  
  CONTRACT_ABI: [
    'function setAuthorizedMinter(address minter, bool status) external',
    'function authorizedMinters(address) external view returns (bool)',
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)'
  ]
};

async function authorizeSigners() {
  console.log(chalk.cyan('🔐 LayerZero ERC721 - Signer Authorization'));
  console.log(chalk.cyan('=' .repeat(60)));
  
  try {
    // Initialize connection
    console.log(chalk.blue('🔗 Connecting to Avalanche L1...'));
    const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, undefined, {
      staticNetwork: true,
      timeout: 30000
    });
    
    // Verify network
    const network = await provider.getNetwork();
    console.log(chalk.green(`✅ Connected to chainId: ${network.chainId}`));
    
    // Initialize owner wallet (Signer 0)
    const ownerWallet = new ethers.Wallet(CONFIG.SIGNER_KEYS[0], provider);
    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, ownerWallet);
    
    console.log(chalk.cyan(`🔑 Owner wallet: ${ownerWallet.address}`));
    
    // Verify contract owner
    try {
      const contractOwner = await contract.owner();
      if (contractOwner.toLowerCase() !== ownerWallet.address.toLowerCase()) {
        throw new Error(`Wallet ${ownerWallet.address} is not the contract owner. Owner is: ${contractOwner}`);
      }
      console.log(chalk.green('✅ Owner verification successful'));
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not verify contract owner, proceeding...'));
    }
    
    // Check owner balance
    const balance = await provider.getBalance(ownerWallet.address);
    console.log(chalk.cyan(`💰 Owner balance: ${ethers.formatEther(balance)} BTIC`));
    
    if (parseFloat(ethers.formatEther(balance)) < 0.01) {
      throw new Error('Insufficient BTIC balance for authorization transactions');
    }
    
    console.log(chalk.blue('\\n🔍 Checking current authorization status...'));
    
    // Initialize all signers and check authorization status
    const signers = CONFIG.SIGNER_KEYS.map((privateKey, index) => {
      const wallet = new ethers.Wallet(privateKey, provider);
      return {
        index,
        address: wallet.address,
        privateKey,
        isOwner: index === 0
      };
    });
    
    // Check which signers need authorization
    const authorizationTasks = [];
    
    for (let i = 1; i < signers.length; i++) { // Skip index 0 (owner)
      const signer = signers[i];
      
      try {
        const isAuthorized = await contract.authorizedMinters(signer.address);
        
        if (isAuthorized) {
          console.log(chalk.green(`✅ Signer ${i} (${signer.address.slice(0, 8)}...) already authorized. Skipping...`));
        } else {
          console.log(chalk.yellow(`⏳ Signer ${i} (${signer.address.slice(0, 8)}...) needs authorization`));
          authorizationTasks.push(signer);
        }
      } catch (error) {
        console.log(chalk.yellow(`⚠️  Could not check Signer ${i} status, will attempt authorization`));
        authorizationTasks.push(signer);
      }
    }
    
    if (authorizationTasks.length === 0) {
      console.log(chalk.green('\\n🎉 All signers are already authorized! No action needed.'));
      return;
    }
    
    console.log(chalk.blue(`\\n🚀 Authorizing ${authorizationTasks.length} signers...`));
    
    // Get starting nonce
    let nonce = await provider.getTransactionCount(ownerWallet.address, 'latest');
    console.log(chalk.cyan(`🔢 Starting nonce: ${nonce}`));
    
    // Authorize each signer
    const authPromises = authorizationTasks.map(async (signer, index) => {
      const currentNonce = nonce + index;
      
      try {
        console.log(chalk.blue(`\\n📝 Authorizing Signer ${signer.index} (${signer.address})...`));
        
        // Estimate gas
        const gasEstimate = await contract.setAuthorizedMinter.estimateGas(signer.address, true);
        const gasLimit = gasEstimate * 130n / 100n;
        
        // Send authorization transaction
        const tx = await contract.setAuthorizedMinter(signer.address, true, {
          gasLimit,
          nonce: currentNonce
        });
        
        console.log(chalk.cyan(`  🟢 Transaction sent: ${tx.hash}`));
        console.log(chalk.cyan(`  ⏳ Waiting for confirmation...`));
        
        const receipt = await tx.wait();
        
        console.log(chalk.green(`  ✅ Signer ${signer.index} authorized in block ${receipt.blockNumber}`));
        console.log(chalk.green(`  ⛽ Gas used: ${receipt.gasUsed.toString()}`));
        
        return {
          signer: signer.index,
          address: signer.address,
          success: true,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString()
        };
        
      } catch (error) {
        console.log(chalk.red(`  ❌ Failed to authorize Signer ${signer.index}: ${error.message}`));
        
        return {
          signer: signer.index,
          address: signer.address,
          success: false,
          error: error.message
        };
      }
    });
    
    // Wait for all authorizations to complete
    const results = await Promise.all(authPromises);
    
    // Summary
    console.log(chalk.cyan('\\n' + '='.repeat(60)));
    console.log(chalk.cyan('📊 Authorization Summary:'));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(chalk.green(`✅ Successful authorizations: ${successful.length}`));
    
    successful.forEach(result => {
      console.log(chalk.green(`   Signer ${result.signer}: ${result.txHash} (Block ${result.blockNumber})`));
    });
    
    if (failed.length > 0) {
      console.log(chalk.red(`❌ Failed authorizations: ${failed.length}`));
      failed.forEach(result => {
        console.log(chalk.red(`   Signer ${result.signer}: ${result.error}`));
      });
    }
    
    // Final verification
    console.log(chalk.blue('\\n🔍 Final verification of all signers...'));
    
    for (let i = 0; i < signers.length; i++) {
      const signer = signers[i];
      
      if (i === 0) {
        console.log(chalk.green(`✅ Signer ${i} (${signer.address.slice(0, 8)}...) - CONTRACT OWNER`));
      } else {
        try {
          const isAuthorized = await contract.authorizedMinters(signer.address);
          const status = isAuthorized ? chalk.green('✅ AUTHORIZED') : chalk.red('❌ NOT AUTHORIZED');
          console.log(`${status} Signer ${i} (${signer.address.slice(0, 8)}...)`);
        } catch (error) {
          console.log(chalk.yellow(`⚠️  Signer ${i} (${signer.address.slice(0, 8)}...) - Status unknown`));
        }
      }
    }
    
    // Check if we can proceed with multi-signer minting
    const readySigners = signers.length; // Owner + authorized signers
    console.log(chalk.cyan(`\\n🎯 Ready for multi-signer minting with ${readySigners} signers`));
    
    if (successful.length === authorizationTasks.length || authorizationTasks.length === 0) {
      console.log(chalk.green('\\n🚀 All signers ready! You can now restart multi-signer minting.'));
      console.log(chalk.cyan('   Run: node multi-signer-optimized.js'));
    } else {
      console.log(chalk.yellow('\\n⚠️  Some authorizations failed. Check errors above.'));
    }
    
  } catch (error) {
    console.error(chalk.red(`\\n💥 Fatal error: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

// Error handlers
process.on('SIGINT', () => {
  console.log(chalk.yellow('\\n⏸️  Received interrupt signal...'));
  process.exit(0);
});

if (require.main === module) {
  authorizeSigners();
}

module.exports = { authorizeSigners };