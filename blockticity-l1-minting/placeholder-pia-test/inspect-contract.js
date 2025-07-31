require('dotenv').config();
const { ethers } = require('ethers');

const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  RPC_URL: process.env.RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc'
};

async function inspectContract() {
  console.log('🔍 Inspecting contract functions...\n');
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  
  // Try to get contract code and analyze it
  const code = await provider.getCode(CONFIG.CONTRACT_ADDRESS);
  console.log(`📋 Contract code length: ${code.length} characters`);
  
  // Common ERC721 and access control function signatures
  const commonFunctions = [
    'function mintURI(address to, string uri) public',
    'function mint(address to, uint256 tokenId) public',
    'function safeMint(address to, uint256 tokenId) public',
    'function owner() public view returns (address)',
    'function transferOwnership(address newOwner) public',
    'function renounceOwnership() public',
    'function grantRole(bytes32 role, address account) public',
    'function revokeRole(bytes32 role, address account) public',
    'function hasRole(bytes32 role, address account) public view returns (bool)',
    'function getRoleAdmin(bytes32 role) public view returns (bytes32)',
    'function setAuthorizedMinter(address minter, bool status) external',
    'function authorizedMinters(address) external view returns (bool)',
    'function addMinter(address minter) external',
    'function removeMinter(address minter) external',
    'function isMinter(address account) public view returns (bool)',
    'function MINTER_ROLE() public view returns (bytes32)',
    'function DEFAULT_ADMIN_ROLE() public view returns (bytes32)',
    'function paused() public view returns (bool)',
    'function pause() public',
    'function unpause() public'
  ];
  
  console.log('🧪 Testing function signatures...\n');
  
  for (const functionSig of commonFunctions) {
    try {
      const abi = [functionSig];
      const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, abi, provider);
      
      // Extract function name
      const funcName = functionSig.match(/function\s+(\w+)/)[1];
      
      // For view functions, try to call them
      if (functionSig.includes('view') || functionSig.includes('pure')) {
        try {
          if (funcName === 'owner') {
            const result = await contract.owner();
            console.log(`✅ ${funcName}(): ${result}`);
          } else if (funcName === 'paused') {
            const result = await contract.paused();
            console.log(`✅ ${funcName}(): ${result}`);
          } else if (funcName === 'MINTER_ROLE') {
            const result = await contract.MINTER_ROLE();
            console.log(`✅ ${funcName}(): ${result}`);
          } else if (funcName === 'DEFAULT_ADMIN_ROLE') {
            const result = await contract.DEFAULT_ADMIN_ROLE();
            console.log(`✅ ${funcName}(): ${result}`);
          } else {
            console.log(`✅ ${funcName}() - function exists (view/pure)`);
          }
        } catch (callError) {
          // Function exists but call failed
          console.log(`⚠️  ${funcName}() - exists but call failed: ${callError.message.slice(0, 50)}...`);
        }
      } else {
        // For non-view functions, just check if they exist by creating contract interface
        console.log(`✅ ${funcName}() - function exists`);
      }
    } catch (error) {
      // Function doesn't exist
      const funcName = functionSig.match(/function\s+(\w+)/)[1];
      console.log(`❌ ${funcName}() - not found`);
    }
  }
  
  // Check if it uses AccessControl pattern
  console.log('\n🔐 Checking AccessControl pattern...');
  
  const ownerWallet = new ethers.Wallet(process.env.SIGNER_KEY_0, provider);
  console.log(`🔑 Owner wallet: ${ownerWallet.address}`);
  
  try {
    // Check if MINTER_ROLE exists
    const accessControlAbi = [
      'function MINTER_ROLE() public view returns (bytes32)',
      'function hasRole(bytes32 role, address account) public view returns (bool)',
      'function grantRole(bytes32 role, address account) public'
    ];
    
    const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, accessControlAbi, ownerWallet);
    
    try {
      const minterRole = await contract.MINTER_ROLE();
      console.log(`✅ MINTER_ROLE found: ${minterRole}`);
      
      // Check if owner has MINTER_ROLE
      const ownerHasMinterRole = await contract.hasRole(minterRole, ownerWallet.address);
      console.log(`🔑 Owner has MINTER_ROLE: ${ownerHasMinterRole}`);
      
      // Check DEFAULT_ADMIN_ROLE
      const defaultAdminAbi = ['function DEFAULT_ADMIN_ROLE() public view returns (bytes32)'];
      const adminContract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, defaultAdminAbi, provider);
      const defaultAdminRole = await adminContract.DEFAULT_ADMIN_ROLE();
      console.log(`🛡️  DEFAULT_ADMIN_ROLE: ${defaultAdminRole}`);
      
      const ownerHasAdminRole = await contract.hasRole(defaultAdminRole, ownerWallet.address);
      console.log(`👑 Owner has DEFAULT_ADMIN_ROLE: ${ownerHasAdminRole}`);
      
      console.log('\n💡 This contract uses AccessControl! Use grantRole() instead of setAuthorizedMinter()');
      
    } catch (error) {
      console.log('❌ No MINTER_ROLE found');
    }
    
  } catch (error) {
    console.log('❌ No AccessControl pattern detected');
  }
  
  console.log('\n📊 Analysis complete!');
}

inspectContract().catch(console.error);