require('dotenv').config({ path: '../../.env' });
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.MAINNET_PRIVATE_KEY,
  RPC_URL: process.env.PUBLIC_RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc',
  MINT_RATE_LIMIT: 3,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000,
  BATCH_SIZE: 25,
  METADATA_DIR: __dirname,
  MINT_LOG_PATH: path.join(__dirname, 'retry_mint_log.json'),
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)',
    'function totalSupply() public view returns (uint256)'
  ]
};

const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };

async function initializeBlockchain() {
  console.log(chalk.blue('\n🔗 Connecting to Blockticity L1 Mainnet...'));
  
  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);
  
  const [network, balance, owner] = await Promise.all([
    provider.getNetwork(),
    provider.getBalance(wallet.address),
    contract.owner()
  ]);
  
  console.log(chalk.green(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`));
  console.log(chalk.green(`💰 Wallet balance: ${ethers.formatEther(balance)} BTIC`));
  console.log(chalk.green(`📋 Contract owner: ${owner}`));
  console.log(chalk.green(`🔑 Minting from: ${wallet.address}`));
  
  return { provider, wallet, contract };
}

async function uploadMetadataToPinata(tokenId, metadata) {
  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;
  
  try {
    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': pinataApiKey,
        'pinata_secret_api_key': pinataSecretApiKey
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: {
          name: `Players Ink Placeholder #${tokenId}`,
          keyvalues: {
            tokenId: tokenId,
            type: 'placeholder',
            status: 'pending_verification'
          }
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Pinata API error: ${response.status}`);
    }
    
    const result = await response.json();
    return `ipfs://${result.IpfsHash}`;
  } catch (error) {
    console.error(chalk.red(`Failed to upload metadata for token ${tokenId}: ${error.message}`));
    throw error;
  }
}

async function mintSingleToken(wallet, contract, tokenData, retryCount = 0) {
  const { tokenId, metadata } = tokenData;
  
  try {
    console.log(chalk.yellow(`  🎨 Uploading metadata for token ${tokenId}...`));
    
    // Upload metadata to IPFS
    const metadataUri = await uploadMetadataToPinata(tokenId, metadata);
    console.log(chalk.green(`  ✅ Metadata uploaded: ${metadataUri}`));
    
    console.log(chalk.yellow(`  🎨 Minting token ${tokenId}...`));
    
    // Estimate gas
    const gasEstimate = await contract.mintURI.estimateGas(wallet.address, metadataUri);
    const gasLimit = gasEstimate * 125n / 100n; // 25% buffer
    
    const tx = await contract.mintURI(wallet.address, metadataUri, { gasLimit });
    const receipt = await tx.wait();
    
    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'completed',
      metadataUri: metadataUri,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      completedAt: new Date().toISOString()
    };
    
    mintLog.summary.successful++;
    mintLog.summary.pending--;
    
    console.log(chalk.green(`  ✅ Token ${tokenId} minted! Tx: ${receipt.hash}`));
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    
    return true;
  } catch (error) {
    console.error(chalk.red(`  ❌ Failed to mint token ${tokenId}: ${error.message}`));
    
    if (retryCount < CONFIG.RETRY_ATTEMPTS) {
      console.log(chalk.yellow(`  🔄 Retrying in ${CONFIG.RETRY_DELAY / 1000} seconds... (Attempt ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS})`));
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return mintSingleToken(wallet, contract, tokenData, retryCount + 1);
    }
    
    mintLog.tokens[tokenId].status = 'failed';
    mintLog.tokens[tokenId].error = error.message;
    mintLog.tokens[tokenId].failedAt = new Date().toISOString();
    mintLog.summary.failed++;
    mintLog.summary.pending--;
    
    await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
    return false;
  }
}

async function loadMetadataFiles() {
  console.log(chalk.cyan('\n📂 Loading metadata files...'));
  
  const files = await fs.readdir(CONFIG.METADATA_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json') && f.startsWith('pia_placeholder_'));
  
  console.log(chalk.cyan(`📊 Found ${jsonFiles.length} metadata files`));
  
  const metadataMap = {};
  
  for (const file of jsonFiles) {
    const filePath = path.join(CONFIG.METADATA_DIR, file);
    const metadata = await fs.readJson(filePath);
    const tokenId = file.match(/\d+/)[0];
    
    metadataMap[tokenId] = metadata;
  }
  
  return metadataMap;
}

async function buildMintLog(metadataMap) {
  console.log(chalk.cyan('\n📋 Building mint log...'));
  
  for (const [tokenId, metadata] of Object.entries(metadataMap)) {
    if (!mintLog.tokens[tokenId]) {
      mintLog.tokens[tokenId] = {
        tokenId: tokenId,
        status: 'pending',
        addedAt: new Date().toISOString()
      };
      mintLog.summary.total++;
      mintLog.summary.pending++;
    }
  }
  
  await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
  console.log(chalk.green(`✅ Mint log initialized with ${mintLog.summary.total} tokens`));
}

async function mintPendingTokens(wallet, contract, metadataMap) {
  console.log(chalk.cyan('\n📋 Finding pending tokens...'));
  
  const pendingTokens = Object.entries(mintLog.tokens)
    .filter(([_, data]) => data.status === 'pending')
    .map(([tokenId, data]) => ({ 
      tokenId, 
      metadata: metadataMap[tokenId],
      ...data 
    }));
  
  console.log(chalk.cyan(`📊 Found ${pendingTokens.length} pending tokens to mint`));
  
  if (pendingTokens.length === 0) {
    console.log(chalk.green('✅ No pending tokens to mint!'));
    return;
  }
  
  for (let i = 0; i < pendingTokens.length; i += CONFIG.BATCH_SIZE) {
    const batch = pendingTokens.slice(i, i + CONFIG.BATCH_SIZE);
    const batchEnd = Math.min(i + CONFIG.BATCH_SIZE, pendingTokens.length);
    
    console.log(chalk.blue(`\n📦 Processing batch ${i + 1}-${batchEnd} of ${pendingTokens.length}...`));
    
    const mintPromises = batch.map(tokenData =>
      mintLimit(() => mintSingleToken(wallet, contract, tokenData))
    );
    
    await Promise.all(mintPromises);
    
    console.log(chalk.cyan(`\n📊 Progress: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
    
    // Add a small delay between batches
    if (i + CONFIG.BATCH_SIZE < pendingTokens.length) {
      console.log(chalk.yellow('⏸️  Pausing between batches...'));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Retry Metadata Batch Minter'));
  console.log(chalk.cyan('='.repeat(50)));
  
  try {
    // Load metadata files
    const metadataMap = await loadMetadataFiles();
    
    // Check if mint log exists
    const mintLogExists = await fs.pathExists(CONFIG.MINT_LOG_PATH);
    
    if (mintLogExists) {
      mintLog = await fs.readJson(CONFIG.MINT_LOG_PATH);
      console.log(chalk.green(`✅ Loaded existing mint log`));
      console.log(chalk.cyan(`📊 Current status: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
    } else {
      await buildMintLog(metadataMap);
    }
    
    // Initialize blockchain connection
    const { provider, wallet, contract } = await initializeBlockchain();
    
    // Start minting
    const startTime = Date.now();
    await mintPendingTokens(wallet, contract, metadataMap);
    
    // Final summary
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Batch Minting Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration} minutes`));
    console.log(chalk.cyan(`📊 Final Stats:`));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
    
    // Export failed tokens for analysis
    const failedTokens = Object.entries(mintLog.tokens)
      .filter(([_, data]) => data.status === 'failed')
      .map(([tokenId, data]) => ({ tokenId, ...data }));
    
    if (failedTokens.length > 0) {
      await fs.writeJson(
        path.join(__dirname, 'failed_tokens.json'), 
        failedTokens, 
        { spaces: 2 }
      );
      console.log(chalk.yellow(`\n📄 Failed tokens exported to failed_tokens.json`));
    }
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
    console.error(error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };