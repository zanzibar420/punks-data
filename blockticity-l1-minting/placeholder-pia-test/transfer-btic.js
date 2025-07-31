require('dotenv').config();
const { ethers } = require('ethers');

// Configuration
const CONFIG = {
  MAIN_SIGNER_PK: process.env.MAIN_SIGNER_PK,
  RPC_URL: process.env.RPC_URL,
  RECIPIENT_ADDRESSES: [
    process.env.SIGNER_ADDR_1,
    process.env.SIGNER_ADDR_2,
    process.env.SIGNER_ADDR_3,
    process.env.SIGNER_ADDR_4,
    process.env.SIGNER_ADDR_5
  ].filter(addr => addr), // Remove undefined addresses
  
  TRANSFER_AMOUNT: '0.2', // BTIC amount to transfer
  TX_TIMEOUT: 60000, // 60 second timeout
  CONFIRMATION_BLOCKS: 1 // Wait for 1 confirmation
};

// Validate configuration
function validateConfig() {
  if (!CONFIG.MAIN_SIGNER_PK) {
    throw new Error('MAIN_SIGNER_PK not found in .env file');
  }
  
  if (!CONFIG.RPC_URL) {
    throw new Error('RPC_URL not found in .env file');
  }
  
  if (CONFIG.RECIPIENT_ADDRESSES.length === 0) {
    throw new Error('No recipient addresses found. Check SIGNER_ADDR_1 through SIGNER_ADDR_5 in .env');
  }
  
  console.log(`✅ Configuration validated`);
  console.log(`   Main signer: ${CONFIG.MAIN_SIGNER_PK.slice(0, 10)}...`);
  console.log(`   RPC URL: ${CONFIG.RPC_URL}`);
  console.log(`   Recipients: ${CONFIG.RECIPIENT_ADDRESSES.length}`);
  console.log(`   Transfer amount: ${CONFIG.TRANSFER_AMOUNT} BTIC\n`);
}

// Initialize blockchain connection
async function initializeBlockchain() {
  console.log('🔗 Connecting to Blockticity L1...');
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, undefined, {
    staticNetwork: true,
    timeout: 30000
  });
  
  const wallet = new ethers.Wallet(CONFIG.MAIN_SIGNER_PK, provider);
  
  try {
    const [network, balance, nonce] = await Promise.all([
      provider.getNetwork(),
      provider.getBalance(wallet.address),
      provider.getTransactionCount(wallet.address, 'pending')
    ]);
    
    console.log(`✅ Connected to network: chainId ${network.chainId}`);
    console.log(`💰 Sender balance: ${ethers.formatEther(balance)} BTIC`);
    console.log(`🔑 Sender address: ${wallet.address}`);
    console.log(`🔢 Starting nonce: ${nonce}\n`);
    
    // Validate sufficient balance
    const totalRequired = ethers.parseEther((parseFloat(CONFIG.TRANSFER_AMOUNT) * CONFIG.RECIPIENT_ADDRESSES.length).toString());
    const gasRequired = ethers.parseEther('0.01'); // Estimate for gas fees
    const totalNeeded = totalRequired + gasRequired;
    
    if (balance < totalNeeded) {
      throw new Error(`Insufficient balance. Need ${ethers.formatEther(totalNeeded)} BTIC, have ${ethers.formatEther(balance)} BTIC`);
    }
    
    console.log(`✅ Sufficient balance for ${CONFIG.RECIPIENT_ADDRESSES.length} transfers + gas fees\n`);
    
    return { provider, wallet };
    
  } catch (error) {
    throw new Error(`Failed to connect to blockchain: ${error.message}`);
  }
}

// Send BTIC transfer with confirmation
async function sendBTICTransfer(wallet, recipient, amount, nonce) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Transaction timeout after ${CONFIG.TX_TIMEOUT}ms`));
    }, CONFIG.TX_TIMEOUT);
    
    try {
      // Prepare transaction
      const tx = {
        to: recipient,
        value: ethers.parseEther(amount),
        gasLimit: 21000n, // Standard ETH transfer gas limit
        nonce: nonce
      };
      
      // Send transaction
      console.log(`🚀 Sending ${amount} BTIC to ${recipient}...`);
      const txResponse = await wallet.sendTransaction(tx);
      
      console.log(`   📡 Transaction sent: ${txResponse.hash}`);
      console.log(`   ⏳ Waiting for confirmation...`);
      
      // Wait for confirmation
      const receipt = await txResponse.wait(CONFIG.CONFIRMATION_BLOCKS);
      
      clearTimeout(timeout);
      
      if (receipt.status === 1) {
        console.log(`   ✅ Sent ${amount} BTIC to ${recipient.slice(0, 10)}...${recipient.slice(-6)} – tx: ${txResponse.hash}`);
        console.log(`   📦 Block: ${receipt.blockNumber}, Gas used: ${receipt.gasUsed.toString()}\n`);
        resolve(receipt);
      } else {
        reject(new Error('Transaction failed'));
      }
      
    } catch (error) {
      clearTimeout(timeout);
      
      // Handle specific error types
      if (error.code === 'INSUFFICIENT_FUNDS') {
        reject(new Error(`Insufficient funds for transfer to ${recipient}`));
      } else if (error.code === 'NONCE_EXPIRED') {
        reject(new Error(`Nonce conflict for transfer to ${recipient}`));
      } else {
        reject(new Error(`Transfer failed to ${recipient}: ${error.message}`));
      }
    }
  });
}

// Main transfer function
async function transferBTICToSigners() {
  console.log('💸 BTIC Multi-Signer Funding Script');
  console.log('='.repeat(50));
  
  try {
    // Validate configuration
    validateConfig();
    
    // Initialize blockchain connection
    const { provider, wallet } = await initializeBlockchain();
    
    // Get current nonce
    let currentNonce = await provider.getTransactionCount(wallet.address, 'pending');
    
    console.log(`🎯 Starting transfers to ${CONFIG.RECIPIENT_ADDRESSES.length} recipients...\n`);
    
    // Process transfers sequentially
    for (let i = 0; i < CONFIG.RECIPIENT_ADDRESSES.length; i++) {
      const recipient = CONFIG.RECIPIENT_ADDRESSES[i];
      
      try {
        console.log(`📤 Transfer ${i + 1}/${CONFIG.RECIPIENT_ADDRESSES.length}:`);
        
        await sendBTICTransfer(wallet, recipient, CONFIG.TRANSFER_AMOUNT, currentNonce);
        currentNonce++;
        
        // Small delay between transfers
        if (i < CONFIG.RECIPIENT_ADDRESSES.length - 1) {
          console.log(`   ⏸️  Waiting 2s before next transfer...\n`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`   ❌ Transfer ${i + 1} failed: ${error.message}\n`);
        
        // Continue with remaining transfers
        currentNonce++;
        continue;
      }
    }
    
    // Final summary
    console.log('='.repeat(50));
    console.log('✅ BTIC funding complete!');
    
    // Check final balances
    console.log('\n📊 Final recipient balances:');
    for (const address of CONFIG.RECIPIENT_ADDRESSES) {
      try {
        const balance = await provider.getBalance(address);
        console.log(`   ${address}: ${ethers.formatEther(balance)} BTIC`);
      } catch (error) {
        console.log(`   ${address}: Error checking balance`);
      }
    }
    
  } catch (error) {
    console.error(`\n💥 Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Error handlers
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

if (require.main === module) {
  transferBTICToSigners();
}

module.exports = { transferBTICToSigners };