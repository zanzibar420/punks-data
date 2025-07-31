require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// BIP-44 derivation paths for Ethereum (m/44'/60'/0'/0/index)
const DERIVATION_PATHS = [
  "m/44'/60'/0'/0/0", // Main account (SIGNER_KEY_0)
  "m/44'/60'/0'/0/1", // SIGNER_KEY_1
  "m/44'/60'/0'/0/2", // SIGNER_KEY_2
  "m/44'/60'/0'/0/3", // SIGNER_KEY_3
  "m/44'/60'/0'/0/4", // SIGNER_KEY_4
  "m/44'/60'/0'/0/5"  // SIGNER_KEY_5
];

async function deriveSigners() {
  const mnemonic = process.env.MNEMONIC;
  
  if (!mnemonic) {
    console.error('❌ MNEMONIC not found in .env file');
    process.exit(1);
  }
  
  console.log('🔐 Deriving signers from mnemonic...\n');
  
  const signers = [];
  const envUpdates = [];
  
  for (let i = 0; i < DERIVATION_PATHS.length; i++) {
    try {
      const wallet = ethers.Wallet.fromPhrase(mnemonic, undefined, DERIVATION_PATHS[i]);
      
      signers.push({
        index: i,
        address: wallet.address,
        privateKey: wallet.privateKey,
        derivationPath: DERIVATION_PATHS[i]
      });
      
      envUpdates.push(`SIGNER_KEY_${i}=${wallet.privateKey}`);
      
      console.log(`✅ SIGNER_${i}:`);
      console.log(`   Address: ${wallet.address}`);
      console.log(`   Private Key: ${wallet.privateKey}`);
      console.log(`   Derivation Path: ${DERIVATION_PATHS[i]}\n`);
      
    } catch (error) {
      console.error(`❌ Failed to derive signer ${i}:`, error.message);
      process.exit(1);
    }
  }
  
  // Read existing .env file
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
  lines.push('# Multi-signer configuration');
  lines.push(...envUpdates);
  
  // Write updated .env file
  fs.writeFileSync(envPath, lines.join('\n'));
  
  console.log('📝 Updated .env file with signer keys');
  console.log(`✅ Successfully derived ${signers.length} signers`);
  console.log('\n🚀 Ready for multi-signer minting!');
  
  return signers;
}

// Validate signers by checking they can sign transactions
async function validateSigners() {
  console.log('\n🔍 Validating signers...');
  
  for (let i = 0; i < 6; i++) {
    const privateKey = process.env[`SIGNER_KEY_${i}`];
    
    if (!privateKey) {
      console.error(`❌ SIGNER_KEY_${i} not found in environment`);
      continue;
    }
    
    try {
      const wallet = new ethers.Wallet(privateKey);
      console.log(`✅ SIGNER_${i}: ${wallet.address} - Valid`);
    } catch (error) {
      console.error(`❌ SIGNER_${i}: Invalid private key`);
    }
  }
}

async function main() {
  console.log('🔐 Multi-Signer Derivation Tool');
  console.log('='.repeat(40));
  
  try {
    await deriveSigners();
    
    // Reload environment to validate
    require('dotenv').config();
    await validateSigners();
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { deriveSigners, validateSigners };