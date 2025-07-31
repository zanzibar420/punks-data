require('dotenv').config();
const { ethers } = require('ethers');

const RPC_ENDPOINTS = [
  'https://subnets.avax.network/btic/mainnet/rpc',
  'https://mainnet-btic-wd732.avax.network/ext/bc/2pV5K35V1ohNSYhRU3z1Bud2oZys9bak7QYcmvbVvnieh4FJXc/rpc?token=90bd898ee2f77b6c45744ad57ae36724130c37e6478836c4cab1a50922d56dde'
];

async function testRPCHealth() {
  console.log('🏥 Testing RPC Endpoint Health...\n');
  
  for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
    const rpcUrl = RPC_ENDPOINTS[i];
    const rpcName = rpcUrl.includes('subnets') ? 'Public RPC' : 'Developer RPC';
    
    console.log(`📡 Testing ${rpcName}:`);
    console.log(`   URL: ${rpcUrl.slice(0, 50)}...`);
    
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true,
        timeout: 10000
      });
      
      // Test 1: Get block number
      const startTime = Date.now();
      const blockNumber = await provider.getBlockNumber();
      const responseTime = Date.now() - startTime;
      console.log(`   ✅ Block Number: ${blockNumber} (${responseTime}ms)`);
      
      // Test 2: Get network
      const network = await provider.getNetwork();
      console.log(`   ✅ Chain ID: ${network.chainId}`);
      
      // Test 3: Get balance
      const testAddress = '0xE2A506B43dF9c4e3B3c284F8cc18cF47Ac266929';
      const balance = await provider.getBalance(testAddress);
      console.log(`   ✅ Balance Check: ${ethers.formatEther(balance).slice(0, 10)}... BTIC`);
      
      // Test 4: Get transaction count
      const nonce = await provider.getTransactionCount(testAddress);
      console.log(`   ✅ Nonce: ${nonce}`);
      
      console.log(`   ✅ RPC is healthy!\n`);
      
    } catch (error) {
      console.log(`   ❌ RPC Error: ${error.message}`);
      console.log(`   ❌ RPC appears to be down or unresponsive\n`);
    }
  }
  
  // Test contract interaction
  console.log('🔍 Testing Contract Interaction...');
  try {
    const provider = new ethers.JsonRpcProvider(RPC_ENDPOINTS[0]);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      ['function owner() public view returns (address)'],
      provider
    );
    
    const owner = await contract.owner();
    console.log(`✅ Contract owner: ${owner}`);
    
    // Test gas estimation
    const mintAbi = ['function mintURI(address to, string uri) public'];
    const mintContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, mintAbi, wallet);
    
    try {
      const gasEstimate = await mintContract.mintURI.estimateGas(
        wallet.address, 
        'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN'
      );
      console.log(`✅ Gas estimation working: ${gasEstimate.toString()}`);
    } catch (error) {
      console.log(`❌ Gas estimation failed: ${error.message}`);
    }
    
  } catch (error) {
    console.log(`❌ Contract interaction failed: ${error.message}`);
  }
}

testRPCHealth().catch(console.error);