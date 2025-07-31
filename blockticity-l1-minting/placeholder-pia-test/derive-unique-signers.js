require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// BIP-44 derivation paths for Ethereum (m/44'/60'/0'/0/index)
const DERIVATION_PATHS = [
  "m/44'/60'/0'/0/0", // Signer 0
  "m/44'/60'/0'/0/1", // Signer 1
  "m/44'/60'/0'/0/2", // Signer 2
  "m/44'/60'/0'/0/3", // Signer 3
  "m/44'/60'/0'/0/4", // Signer 4
  "m/44'/60'/0'/0/5"  // Signer 5
];

async function deriveUniqueSigners() {
  const mnemonic = process.env.MNEMONIC;
  
  if (!mnemonic) {
    console.error('❌ MNEMONIC not found in .env file');
    process.exit(1);
  }
  
  console.log('🔐 Deriving 6 unique signers from mnemonic...\n');
  
  const signers = [];
  const addresses = new Set();
  const privateKeys = new Set();
  
  for (let i = 0; i < DERIVATION_PATHS.length; i++) {
    try {
      // Derive wallet using specific path directly from mnemonic
      const derivedWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, DERIVATION_PATHS[i]);
      
      const signerData = {
        index: i,
        path: DERIVATION_PATHS[i],
        address: derivedWallet.address,
        privateKey: derivedWallet.privateKey
      };
      
      signers.push(signerData);
      addresses.add(signerData.address);
      privateKeys.add(signerData.privateKey);
      
      console.log(`✅ Signer ${i}: ${DERIVATION_PATHS[i]}`);
      console.log(`   Address: ${signerData.address}`);
      console.log(`   Private Key: ${signerData.privateKey}\n`);
      
    } catch (error) {
      console.error(`❌ Failed to derive signer ${i}:`, error.message);
      process.exit(1);
    }
  }
  
  // Verify uniqueness
  console.log('🔍 Verifying uniqueness...');
  console.log(`   Unique addresses: ${addresses.size}/6`);
  console.log(`   Unique private keys: ${privateKeys.size}/6`);
  
  if (addresses.size !== 6 || privateKeys.size !== 6) {
    console.error('❌ ERROR: Not all signers are unique!');
    console.error('   This indicates a problem with the mnemonic or derivation.');
    process.exit(1);
  }
  
  console.log('✅ All signers are unique!\n');
  
  // Update .env file
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  // Remove existing SIGNER_KEY entries
  const lines = envContent.split('\n').filter(line => 
    !line.trim().startsWith('SIGNER_KEY_')
  );
  
  // Add new SIGNER_KEY entries
  lines.push('');
  lines.push('# Multi-signer configuration (6 unique signers)');
  signers.forEach(signer => {
    lines.push(`SIGNER_KEY_${signer.index}=${signer.privateKey}`);
  });
  
  // Write updated .env file
  fs.writeFileSync(envPath, lines.join('\n'));
  
  console.log('📝 Updated .env file with unique signer keys');
  console.log(`✅ Successfully derived ${signers.length} unique signers`);
  console.log('\n🚀 Ready for multi-signer minting!');
  
  return signers;
}

// Test function to validate all signers work
async function testSigners() {
  console.log('\n🧪 Testing all signers...');
  
  for (let i = 0; i < 6; i++) {
    const privateKey = process.env[`SIGNER_KEY_${i}`];
    
    if (!privateKey) {
      console.error(`❌ SIGNER_KEY_${i} not found in environment`);
      continue;
    }
    
    try {
      const wallet = new ethers.Wallet(privateKey);
      
      // Test signing capability
      const message = `Test message for signer ${i}`;
      const signature = await wallet.signMessage(message);
      
      console.log(`✅ Signer ${i}: ${wallet.address} - Can sign messages`);
      
    } catch (error) {
      console.error(`❌ Signer ${i}: Failed to sign test message`);
    }
  }
}

async function main() {
  console.log('🔐 Unique Multi-Signer Derivation Tool');
  console.log('='.repeat(50));
  
  try {
    const signers = await deriveUniqueSigners();
    
    // Reload environment to test
    require('dotenv').config();
    await testSigners();
    
    console.log('\n📊 Summary:');
    console.log(`   Total signers: ${signers.length}`);
    console.log(`   All unique: ✅`);
    console.log(`   Ready for Avalanche L1 minting: ✅`);
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { deriveUniqueSigners, testSigners };