require('dotenv').config();
const { ethers } = require('ethers');

const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  RPC_ENDPOINTS: [
    'https://subnets.avax.network/btic/mainnet/rpc',
    'https://mainnet-btic-wd732.avax.network/ext/bc/2pV5K35V1ohNSYhRU3z1Bud2oZys9bak7QYcmvbVvnieh4FJXc/rpc?token=90bd898ee2f77b6c45744ad57ae36724130c37e6478836c4cab1a50922d56dde'
  ],
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)',
    'function balanceOf(address owner) public view returns (uint256)'
  ]
};

async function testContractStatus() {
  console.log('🔍 Testing contract status and RPC endpoints...\n');
  
  // Test both RPC endpoints
  for (let i = 0; i < CONFIG.RPC_ENDPOINTS.length; i++) {
    const rpcUrl = CONFIG.RPC_ENDPOINTS[i];
    const rpcName = rpcUrl.includes('subnets') ? 'Public RPC' : 'Developer RPC';
    
    console.log(`📡 Testing ${rpcName}:`);
    
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true,
        timeout: 10000
      });
      
      // Test basic connectivity
      const network = await provider.getNetwork();
      console.log(`  ✅ Connected to chainId: ${network.chainId}`);
      
      // Test contract calls
      const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, provider);
      
      try {
        const owner = await contract.owner();
        console.log(`  ✅ Contract owner: ${owner}`);
      } catch (error) {
        console.log(`  ❌ Contract owner call failed: ${error.message}`);
      }
      
      try {
        const paused = await contract.paused();
        console.log(`  ✅ Contract paused: ${paused}`);
      } catch (error) {
        console.log(`  ❌ Contract paused call failed: ${error.message}`);
      }
      
      // Test wallet balances
      const mainWallet = process.env.SIGNER_KEY_0;
      if (mainWallet) {
        const wallet = new ethers.Wallet(mainWallet, provider);
        try {
          const balance = await provider.getBalance(wallet.address);
          console.log(`  ✅ Main wallet balance: ${ethers.formatEther(balance)} BTIC`);
          
          // Test nonce
          const nonce = await provider.getTransactionCount(wallet.address, 'latest');
          console.log(`  ✅ Main wallet nonce: ${nonce}`);
          
        } catch (error) {
          console.log(`  ❌ Wallet balance/nonce failed: ${error.message}`);
        }
      }
      
    } catch (error) {
      console.log(`  ❌ RPC connection failed: ${error.message}`);
    }
    
    console.log('');
  }
  
  // Test a simple transaction estimation
  console.log('🧪 Testing transaction estimation...');
  try {
    const provider = new ethers.JsonRpcProvider(CONFIG.RPC_ENDPOINTS[0]);
    const wallet = new ethers.Wallet(process.env.SIGNER_KEY_0, provider);
    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
    
    const metadataUri = 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN';
    const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
    console.log(`  ✅ Gas estimate for mintURI: ${gasEstimate.toString()}`);
    
  } catch (error) {
    console.log(`  ❌ Gas estimation failed: ${error.message}`);
    console.log(`  🔍 Error details: ${JSON.stringify(error, null, 2)}`);
  }
}

testContractStatus().catch(console.error);