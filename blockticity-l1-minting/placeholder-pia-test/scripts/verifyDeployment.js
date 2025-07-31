require('dotenv').config();
const { ethers } = require('ethers');
const chalk = require('chalk');

async function verify() {
  console.log(chalk.blue('🔍 Verifying Blockticity LayerZero Contract Deployment...\n'));
  
  // Determine network from environment variable or default to mainnet
  const network = process.env.NETWORK || 'mainnet';
  
  const rpc = network === 'mainnet'
    ? 'https://subnets.avax.network/btic/mainnet/rpc'
    : 'https://subnets.avax.network/btest/testnet/rpc';

  const contract = network === 'mainnet'
    ? process.env.MAINNET_CONTRACT
    : process.env.TESTNET_CONTRACT;

  const chainId = network === 'mainnet' ? '28530' : '75234';

  console.log(chalk.yellow(`Network: ${network}`));
  console.log(chalk.yellow(`RPC: ${rpc}`));
  console.log(chalk.yellow(`Contract: ${contract}`));
  console.log(chalk.yellow(`Chain ID: ${chainId}\n`));

  if (!contract) {
    console.error(chalk.red(`❌ No contract address found for ${network} network`));
    console.error(chalk.red(`   Make sure ${network === 'mainnet' ? 'MAINNET_CONTRACT' : 'TESTNET_CONTRACT'} is set in .env`));
    process.exit(1);
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    
    // Check network connection
    console.log(chalk.gray('Connecting to network...'));
    const networkInfo = await provider.getNetwork();
    console.log(chalk.green(`✅ Connected to chain ID: ${networkInfo.chainId}`));
    
    if (networkInfo.chainId.toString() !== chainId) {
      console.warn(chalk.orange(`⚠️  Warning: Expected chain ID ${chainId}, got ${networkInfo.chainId}`));
    }
    
    // Check contract bytecode
    console.log(chalk.gray('Checking contract bytecode...'));
    const bytecode = await provider.getCode(contract);

    if (bytecode && bytecode.length > 4 && bytecode !== '0x') {
      console.log(chalk.green(`✅ Contract deployed successfully at ${contract}`));
      console.log(chalk.green(`   Bytecode length: ${bytecode.length} characters`));
      console.log(chalk.green(`   First 20 chars: ${bytecode.substring(0, 20)}...`));
      
      // Try to get contract balance
      try {
        const balance = await provider.getBalance(contract);
        console.log(chalk.blue(`💰 Contract balance: ${ethers.formatEther(balance)} ETH`));
      } catch (balanceError) {
        console.log(chalk.gray('   Could not fetch contract balance'));
      }
      
    } else {
      console.error(chalk.red(`❌ No contract found at ${contract}`));
      console.error(chalk.red(`   Bytecode returned: ${bytecode}`));
      process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red(`❌ Error verifying deployment:`));
    console.error(chalk.red(`   ${error.message}`));
    process.exit(1);
  }
  
  console.log(chalk.green('\n🎉 Deployment verification completed successfully!'));
}

// Handle command line arguments
if (process.argv.includes('--testnet') || process.argv.includes('-t')) {
  process.env.NETWORK = 'testnet';
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(chalk.blue('Blockticity Contract Deployment Verifier\n'));
  console.log('Usage:');
  console.log('  node scripts/verifyDeployment.js           # Verify mainnet deployment');
  console.log('  node scripts/verifyDeployment.js --testnet # Verify testnet deployment');
  console.log('  node scripts/verifyDeployment.js -t        # Verify testnet deployment (short)');
  console.log('  node scripts/verifyDeployment.js --help    # Show this help');
  console.log('\nEnvironment variables:');
  console.log('  MAINNET_CONTRACT - Mainnet contract address');
  console.log('  TESTNET_CONTRACT - Testnet contract address');
  console.log('  NETWORK          - Override network (mainnet|testnet)');
  process.exit(0);
}

verify().catch(console.error);