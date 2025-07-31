require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs-extra');
const path = require('path');
const pLimit = require('p-limit');
const chalk = require('chalk');

// Global crash guards
process.on('unhandledRejection', r => console.error('Unhandled rejection:', r));
process.on('uncaughtException', e => console.error('Uncaught exception:', e));

// Retry with exponential backoff wrapper
async function retryWithBackoff(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try { 
      return await fn(); 
    } catch (e) {
      if (i === retries - 1) throw e;
      const backoffDelay = delay * (i + 1);
      console.log(chalk.yellow(`  ⏳ Backing off for ${backoffDelay}ms...`));
      await new Promise(r => setTimeout(r, backoffDelay));
    }
  }
}

// RPC endpoints for rotation (stub - can be expanded)
const RPC_ENDPOINTS = [
  process.env.RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc',
  // Add more endpoints here if available
];
let currentRpcIndex = 0;

// Get healthy RPC endpoint with rotation on failure
function getHealthyRpc() {
  // For now, just return the primary RPC
  // Future: implement health checks and rotation
  return RPC_ENDPOINTS[currentRpcIndex];
}

// Parse optional CLI arguments
const args = process.argv.slice(2);
const inputArg = args.find(arg => arg.startsWith('--inputDir='));
const logArg = args.find(arg => arg.startsWith('--logPath='));

const METADATA_DIR = inputArg
  ? path.resolve(inputArg.split('=')[1])
  : path.join(__dirname, 'output', 'metadata');

const MINT_LOG_PATH = logArg
  ? path.resolve(logArg.split('=')[1])
  : path.join(__dirname, 'retry_metadata', 'retry_log.json');

// Configuration
const CONFIG = {
  CONTRACT_ADDRESS: process.env.MAINNET_CONTRACT || process.env.CONTRACT_ADDRESS || '0x7D1955F814f25Ec2065C01B9bFc0AcC29B3f2926',
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  RPC_URL: process.env.RPC_URL || 'https://subnets.avax.network/btic/mainnet/rpc',
  MINT_RATE_LIMIT: 3, // Reduced from 5 to minimize nonce conflicts
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000,
  BATCH_SIZE: 50,
  MINT_LOG_PATH: MINT_LOG_PATH,
  CONTRACT_ABI: [
    'function mintURI(address to, string uri) public',
    'function owner() public view returns (address)',
    'function paused() public view returns (bool)'
  ]
};

const mintLimit = pLimit(CONFIG.MINT_RATE_LIMIT);
let mintLog = { tokens: {}, summary: { total: 0, successful: 0, failed: 0, pending: 0 } };

async function initializeBlockchain() {
  console.log(chalk.blue('\n🔗 Connecting to blockchain...'));

  const rpcUrl = getHealthyRpc();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, wallet);

  try {
    const [network, balance, owner] = await Promise.all([
      provider.getNetwork(),
      provider.getBalance(wallet.address),
      contract.owner()
    ]);

    console.log(chalk.green(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`));
    console.log(chalk.green(`💰 Wallet balance: ${ethers.formatEther(balance)} ETH`));
    console.log(chalk.green(`📋 Contract owner: ${owner}`));
    console.log(chalk.green(`🔑 Minting from: ${wallet.address}`));

    return { provider, wallet, contract };
  } catch (error) {
    console.error(chalk.red(`Failed to connect to RPC: ${error.message}`));
    throw error;
  }
}

async function mintSingleToken(wallet, contract, tokenData, retryCount = 0) {
  const { tokenId, metadataUri } = tokenData;

  try {
    console.log(chalk.yellow(`  🎨 Minting token ${tokenId}...`));

    // Use retry wrapper for the actual mint call
    const tx = await retryWithBackoff(async () => {
      const nonce = await wallet.getNonce();
      return contract.mintURI(wallet.address, metadataUri, { nonce });
    });
    
    const receipt = await tx.wait();

    mintLog.tokens[tokenId] = {
      ...mintLog.tokens[tokenId],
      status: 'completed',
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      nonce: tx.nonce,
      retry_count: retryCount,
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
      console.log(chalk.yellow(`  🔄 Retrying in ${CONFIG.RETRY_DELAY / 1000} seconds...`));
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return mintSingleToken(wallet, contract, tokenData, retryCount + 1);
    }

    mintLog.tokens[tokenId].status = 'failed';
    mintLog.tokens[tokenId].error = error.message;
    mintLog.tokens[tokenId].failed_reason = error.code || 'UNKNOWN_ERROR';
    mintLog.tokens[tokenId].retry_count = retryCount;
    mintLog.summary.failed++;
    mintLog.summary.pending--;

    return false;
  }
}

async function mintPendingTokens(wallet, contract) {
  console.log(chalk.cyan('\n📋 Finding pending tokens...'));

  const pendingTokens = Object.entries(mintLog.tokens)
    .filter(([_, data]) => data.status === 'pending')
    .map(([tokenId, data]) => ({ tokenId, ...data }));

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

    // Add jitter between batches to reduce RPC stress
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

    console.log(chalk.cyan(`\n📊 Progress: ${mintLog.summary.successful} minted, ${mintLog.summary.failed} failed, ${mintLog.summary.pending} pending`));
  }
}

async function buildMintLogFromFolder() {
  const files = await fs.readdir(METADATA_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  for (const file of jsonFiles) {
    const filePath = path.join(METADATA_DIR, file);
    const metadata = await fs.readJson(filePath);

    const tokenIdMatch = file.match(/\d+/);
    if (!tokenIdMatch) {
      console.warn(`⚠️ Skipping file ${file} — no token ID found in filename.`);
      continue;
    }
    const tokenId = parseInt(tokenIdMatch[0], 10);
    mintLog.tokens[tokenId] = {
      metadataUri: metadata.external_url || metadata.token_uri || metadata.image || '',
      status: 'pending',
      addedAt: new Date().toISOString()
    };

    mintLog.summary.total++;
    mintLog.summary.pending++;
  }
}

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Metadata-to-Mint Processor'));
  console.log(chalk.cyan('='.repeat(50)));

  try {
    const mintLogExists = await fs.pathExists(CONFIG.MINT_LOG_PATH);

    if (mintLogExists) {
      mintLog = await fs.readJson(CONFIG.MINT_LOG_PATH);
      console.log(chalk.green(`✅ Loaded existing mint log`));
    } else {
      console.log(chalk.yellow('⚠️ No mint log found — creating from metadata files...'));
      await buildMintLogFromFolder();
      await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
      console.log(chalk.green(`✅ Initialized new mint log from ${METADATA_DIR}`));
    }

    const { provider, wallet, contract } = await initializeBlockchain();
    const startTime = Date.now();

    await mintPendingTokens(wallet, contract);

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Minting Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration} minutes`));
    console.log(chalk.cyan(`📊 Final Stats:`));
    console.log(chalk.green(`   ✅ Successful: ${mintLog.summary.successful}`));
    console.log(chalk.red(`   ❌ Failed: ${mintLog.summary.failed}`));
    console.log(chalk.yellow(`   ⏳ Pending: ${mintLog.summary.pending}`));
  } catch (error) {
    console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
    console.error(error);
    process.exit(1);
  }
}

// Top-level try/catch wrapper
(async () => {
  try {
    await main();
  } catch (err) {
    console.error('Fatal mint error:', err);
    process.exit(1);
  }
})();

// TODO: Future scalability - migrate to queue-based "MintWorker" pattern for 650k COAs
// This would include:
// - Redis/RabbitMQ job queue for distributing work across multiple workers
// - Separate nonce management per worker wallet
// - Health-check and auto-restart capabilities
// - Real-time monitoring dashboard
