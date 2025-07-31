require('dotenv').config();
const { ethers } = require('ethers');

const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  RPC_URL: process.env.RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc'
};

async function testAuthorizationMethods() {
  console.log('🧪 Testing different authorization methods...\n');
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const ownerWallet = new ethers.Wallet(process.env.SIGNER_KEY_0, provider);
  const testAddress = process.env.SIGNER_KEY_1 ? new ethers.Wallet(process.env.SIGNER_KEY_1, provider).address : '0x0033AbD22b24Ef80942C5794aD8EA2b215dD5151';
  
  console.log(`🔑 Owner: ${ownerWallet.address}`);
  console.log(`🎯 Test address: ${testAddress}\n`);
  
  // Method 1: Check authorizedMinters mapping
  console.log('1️⃣ Testing authorizedMinters mapping...');
  try {
    const abi1 = ['function authorizedMinters(address) external view returns (bool)'];
    const contract1 = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi1, provider);
    const isAuthorized = await contract1.authorizedMinters(testAddress);
    console.log(`   ✅ authorizedMinters(${testAddress.slice(0, 8)}...): ${isAuthorized}`);
  } catch (error) {
    console.log(`   ❌ authorizedMinters failed: ${error.message}`);
  }
  
  // Method 2: Test setAuthorizedMinter function
  console.log('\n2️⃣ Testing setAuthorizedMinter function...');
  try {
    const abi2 = ['function setAuthorizedMinter(address minter, bool status) external'];
    const contract2 = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi2, ownerWallet);
    
    // Try to estimate gas for setting authorization
    const gasEstimate = await contract2.setAuthorizedMinter.estimateGas(testAddress, true);
    console.log(`   ✅ setAuthorizedMinter gas estimate: ${gasEstimate.toString()}`);
    
    // Test the actual call (but don't send)
    const tx = await contract2.setAuthorizedMinter.populateTransaction(testAddress, true);
    console.log(`   ✅ setAuthorizedMinter transaction data: ${tx.data.slice(0, 20)}...`);
    
  } catch (error) {
    console.log(`   ❌ setAuthorizedMinter failed: ${error.message}`);
  }
  
  // Method 3: Test isMinter function
  console.log('\n3️⃣ Testing isMinter function...');
  try {
    const abi3 = ['function isMinter(address account) public view returns (bool)'];
    const contract3 = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi3, provider);
    const isMinter = await contract3.isMinter(testAddress);
    console.log(`   ✅ isMinter(${testAddress.slice(0, 8)}...): ${isMinter}`);
    
    // Check if owner is minter
    const ownerIsMinter = await contract3.isMinter(ownerWallet.address);
    console.log(`   ✅ isMinter(owner): ${ownerIsMinter}`);
  } catch (error) {
    console.log(`   ❌ isMinter failed: ${error.message}`);
  }
  
  // Method 4: Test addMinter function
  console.log('\n4️⃣ Testing addMinter function...');
  try {
    const abi4 = ['function addMinter(address minter) external'];
    const contract4 = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi4, ownerWallet);
    
    const gasEstimate = await contract4.addMinter.estimateGas(testAddress);
    console.log(`   ✅ addMinter gas estimate: ${gasEstimate.toString()}`);
    
  } catch (error) {
    console.log(`   ❌ addMinter failed: ${error.message}`);
  }
  
  // Method 5: Test AccessControl grantRole
  console.log('\n5️⃣ Testing AccessControl grantRole...');
  try {
    // First get the MINTER_ROLE
    const minterRoleHash = ethers.keccak256(ethers.toUtf8Bytes('MINTER_ROLE'));
    console.log(`   🔑 MINTER_ROLE hash: ${minterRoleHash}`);
    
    const abi5 = [
      'function grantRole(bytes32 role, address account) public',
      'function hasRole(bytes32 role, address account) public view returns (bool)'
    ];
    const contract5 = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi5, ownerWallet);
    
    // Check if test address has role
    const hasRole = await contract5.hasRole(minterRoleHash, testAddress);
    console.log(`   ✅ hasRole(MINTER_ROLE, ${testAddress.slice(0, 8)}...): ${hasRole}`);
    
    // Check if owner has role
    const ownerHasRole = await contract5.hasRole(minterRoleHash, ownerWallet.address);
    console.log(`   ✅ hasRole(MINTER_ROLE, owner): ${ownerHasRole}`);
    
    // Try to estimate gas for granting role
    const gasEstimate = await contract5.grantRole.estimateGas(minterRoleHash, testAddress);
    console.log(`   ✅ grantRole gas estimate: ${gasEstimate.toString()}`);
    
  } catch (error) {
    console.log(`   ❌ grantRole failed: ${error.message}`);
  }
  
  // Method 6: Try different role names
  console.log('\n6️⃣ Testing different role names...');
  
  const roleNames = ['MINTER', 'MINT_ROLE', 'MINTER_ROLE', 'AUTHORIZED_MINTER'];
  
  for (const roleName of roleNames) {
    try {
      const roleHash = ethers.keccak256(ethers.toUtf8Bytes(roleName));
      const abi6 = ['function hasRole(bytes32 role, address account) public view returns (bool)'];
      const contract6 = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi6, provider);
      
      const hasRole = await contract6.hasRole(roleHash, ownerWallet.address);
      console.log(`   ${hasRole ? '✅' : '❌'} ${roleName} (owner): ${hasRole}`);
      
    } catch (error) {
      console.log(`   ❌ ${roleName} failed: ${error.message}`);
    }
  }
  
  console.log('\n📊 Testing complete!');
}

testAuthorizationMethods().catch(console.error);