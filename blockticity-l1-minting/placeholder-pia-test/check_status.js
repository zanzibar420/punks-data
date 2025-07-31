const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

async function checkStatus() {
  const logPath = path.join(__dirname, 'output', 'mint_log.json');
  
  if (!await fs.pathExists(logPath)) {
    console.log(chalk.red('No mint_log.json found!'));
    return;
  }
  
  const mintLog = await fs.readJSON(logPath);
  const tokens = Object.values(mintLog.tokens);
  
  // Recalculate accurate counts
  const completed = tokens.filter(t => t.status === 'completed').length;
  const failed = tokens.filter(t => t.status === 'failed').length;
  const pending = tokens.filter(t => t.status === 'pending').length;
  
  // Find last minted token
  const completedTokens = tokens
    .filter(t => t.status === 'completed')
    .sort((a, b) => b.tokenId - a.tokenId);
  
  const lastMinted = completedTokens[0];
  
  console.log(chalk.cyan('📊 MINTING STATUS REPORT'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.blue(`📁 Total tokens processed: ${tokens.length}`));
  console.log(chalk.green(`✅ Successfully minted: ${completed}`));
  console.log(chalk.red(`❌ Failed: ${failed}`));
  console.log(chalk.yellow(`⏳ Pending (metadata ready): ${pending}`));
  console.log(chalk.cyan('='.repeat(50)));
  
  if (lastMinted) {
    console.log(chalk.blue('\n🏁 Last Successfully Minted Token:'));
    console.log(chalk.gray(`   Token ID: ${lastMinted.tokenId}`));
    console.log(chalk.gray(`   TX Hash: ${lastMinted.txHash}`));
    console.log(chalk.gray(`   Block: ${lastMinted.blockNumber}`));
    console.log(chalk.gray(`   Completed: ${lastMinted.completedAt}`));
  }
  
  // Show failed tokens if any
  if (failed > 0) {
    console.log(chalk.red('\n❌ Failed Tokens:'));
    tokens
      .filter(t => t.status === 'failed')
      .slice(0, 10)
      .forEach(t => {
        console.log(chalk.red(`   Token ${t.tokenId}: ${t.error}`));
      });
    if (failed > 10) {
      console.log(chalk.red(`   ... and ${failed - 10} more`));
    }
  }
  
  // Show progress
  const totalTarget = 100000;
  const metadataProgress = (tokens.length / totalTarget * 100).toFixed(1);
  const mintingProgress = (completed / totalTarget * 100).toFixed(1);
  
  console.log(chalk.cyan('\n📈 Progress:'));
  console.log(chalk.blue(`   Metadata Generation: ${metadataProgress}% (${tokens.length}/${totalTarget})`));
  console.log(chalk.green(`   Minting: ${mintingProgress}% (${completed}/${totalTarget})`));
  
  // Time estimate
  if (pending > 0) {
    const remainingHours = (pending / (5 * 3600)).toFixed(1); // 5 TPS
    console.log(chalk.yellow(`\n⏱️  Estimated time to mint pending tokens: ${remainingHours} hours`));
  }
}

checkStatus();