require('dotenv').config();
const { ethers } = require('ethers');
const pinataSDK = require('@pinata/sdk');
const fs = require('fs-extra');
const chalk = require('chalk');

async function testConnection() {
  console.log(chalk.cyan('🔍 Testing Connections...'));
  console.log(chalk.cyan('='.repeat(50)));
  
  // Test Pinata
  try {
    const pinata = new pinataSDK(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_API_KEY);
    const result = await pinata.testAuthentication();
    console.log(chalk.green('✅ Pinata authentication successful'));
  } catch (error) {
    console.log(chalk.red('❌ Pinata authentication failed:'), error.message);
  }
  
  // Test Blockchain
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    const network = await provider.getNetwork();
    const balance = await provider.getBalance(wallet.address);
    
    console.log(chalk.green('✅ Blockchain connection successful'));
    console.log(chalk.gray(`   Network: ${network.name} (Chain ID: ${network.chainId})`));
    console.log(chalk.gray(`   Wallet: ${wallet.address}`));
    console.log(chalk.gray(`   Balance: ${ethers.formatEther(balance)} BTIC`));
    
    // Test contract
    const contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      ['function owner() public view returns (address)'],
      provider
    );
    const owner = await contract.owner();
    console.log(chalk.gray(`   Contract Owner: ${owner}`));
    
  } catch (error) {
    console.log(chalk.red('❌ Blockchain connection failed:'), error.message);
  }
  
  // Check files
  const templatePath = '/Users/guppynft/Desktop/pia_placeholder_metadata.json';
  const imagePath = '/Users/guppynft/Desktop/placeholder_pia_qr.png';
  
  console.log(chalk.blue('\n📁 Checking input files...'));
  
  if (await fs.pathExists(templatePath)) {
    console.log(chalk.green('✅ Template file found'));
  } else {
    console.log(chalk.red('❌ Template file not found'));
  }
  
  if (await fs.pathExists(imagePath)) {
    const stats = await fs.stat(imagePath);
    console.log(chalk.green(`✅ Image file found (${(stats.size / 1024).toFixed(2)} KB)`));
  } else {
    console.log(chalk.red('❌ Image file not found'));
  }
  
  console.log(chalk.cyan('\n' + '='.repeat(50)));
}

testConnection();