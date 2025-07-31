require('dotenv').config();
const { ethers } = require('ethers');

const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  RPC_URL: 'https://subnets.avax.network/btic/mainnet/rpc',
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public'
  ]
};

async function testSigner1Mint() {
  console.log('🧪 Testing Signer 1 mint transaction...\n');
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(process.env.SIGNER_KEY_1, provider);
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
  
  console.log(`🔑 Testing with Signer 1: ${wallet.address}`);
  
  try {
    const balance = await provider.getBalance(wallet.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} BTIC`);
    
    const nonce = await provider.getTransactionCount(wallet.address, 'latest');
    console.log(`🔢 Current nonce: ${nonce}`);
    
    // Try minting a test token
    const testTokenId = 999998;
    const metadataUri = 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
    
    console.log(`🎯 Attempting to mint token ${testTokenId}...`);
    
    // First estimate gas
    const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
    console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);
    
    // Send the transaction
    const tx = await contract.mintURI(wallet.address, metadataUri, {
      gasLimit: gasEstimate * 130n / 100n,
      nonce: nonce
    });
    
    console.log(`🟢 Transaction sent: ${tx.hash}`);
    console.log(`⏳ Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
    
  } catch (error) {
    console.log(`❌ Mint failed: ${error.message}`);
    console.log(`🔍 Error code: ${error.code}`);
    console.log(`📋 Full error: ${JSON.stringify(error, null, 2)}`);
  }
}

testSigner1Mint().catch(console.error);