const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  METADATA_DIR: path.join(__dirname, 'output', 'metadata'),
  RETRY_LOG_PATH: path.join(__dirname, 'retry_metadata', 'retry_log.json'),
  OUTPUT_LOG_PATH: path.join(__dirname, 'output', 'next_placeholder_log.json')
};

async function loadCompletedTokenIds() {
  console.log(chalk.cyan('📋 Loading completed tokens from retry log...'));
  
  try {
    const retryLog = await fs.readJson(CONFIG.RETRY_LOG_PATH);
    const completedTokenIds = Object.entries(retryLog.tokens)
      .filter(([_, data]) => data.status === 'completed')
      .map(([tokenId, _]) => tokenId);
    
    console.log(chalk.green(`✅ Found ${completedTokenIds.length} completed tokens`));
    return new Set(completedTokenIds);
  } catch (error) {
    console.log(chalk.yellow('⚠️  No retry log found, assuming no tokens completed'));
    return new Set();
  }
}

async function buildRemainingPlaceholderLog() {
  console.log(chalk.cyan('🚀 Building Remaining Placeholder Batch'));
  console.log(chalk.cyan('='.repeat(50)));
  
  const mintLog = {
    tokens: {},
    summary: {
      total: 0,
      successful: 0,
      failed: 0,
      pending: 0
    }
  };
  
  try {
    // Load completed token IDs
    const completedTokenIds = await loadCompletedTokenIds();
    
    // Check if metadata directory exists
    const metadataExists = await fs.pathExists(CONFIG.METADATA_DIR);
    if (!metadataExists) {
      throw new Error(`Metadata directory not found: ${CONFIG.METADATA_DIR}`);
    }
    
    // Load all metadata files
    console.log(chalk.cyan('\n📂 Loading metadata files...'));
    const files = await fs.readdir(CONFIG.METADATA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(chalk.cyan(`📊 Found ${jsonFiles.length} total metadata files`));
    
    let skippedCount = 0;
    let addedCount = 0;
    
    // Process each metadata file
    for (const file of jsonFiles) {
      const filePath = path.join(CONFIG.METADATA_DIR, file);
      
      try {
        // Extract token ID from filename
        const tokenIdMatch = file.match(/\d+/);
        if (!tokenIdMatch) {
          console.warn(chalk.yellow(`⚠️  Skipping file ${file} — no token ID found in filename`));
          continue;
        }
        
        const tokenId = tokenIdMatch[0];
        
        // Skip if already minted (ensure both are strings for comparison)
        if (completedTokenIds.has(tokenId) || completedTokenIds.has(parseInt(tokenId, 10).toString())) {
          skippedCount++;
          continue;
        }
        
        // Load metadata
        const metadata = await fs.readJson(filePath);
        
        // Extract metadata URI
        const metadataUri = metadata.external_url || metadata.token_uri || metadata.image || '';
        
        // Add to mint log
        mintLog.tokens[tokenId] = {
          metadataUri: metadataUri,
          status: 'pending',
          addedAt: new Date().toISOString()
        };
        
        mintLog.summary.total++;
        mintLog.summary.pending++;
        addedCount++;
        
      } catch (error) {
        console.error(chalk.red(`❌ Error processing ${file}: ${error.message}`));
      }
    }
    
    // Save the mint log
    await fs.ensureDir(path.dirname(CONFIG.OUTPUT_LOG_PATH));
    await fs.writeJson(CONFIG.OUTPUT_LOG_PATH, mintLog, { spaces: 2 });
    
    // Final summary
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Batch preparation complete!'));
    console.log(chalk.cyan(`📊 Summary:`));
    console.log(chalk.green(`   ✅ Added to batch: ${addedCount}`));
    console.log(chalk.yellow(`   ⏭️  Skipped (already minted): ${skippedCount}`));
    console.log(chalk.cyan(`   📄 Total in new batch: ${mintLog.summary.total}`));
    console.log(chalk.cyan(`\n📄 Output saved to: ${CONFIG.OUTPUT_LOG_PATH}`));
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
    console.error(error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  buildRemainingPlaceholderLog().catch(console.error);
}

module.exports = { buildRemainingPlaceholderLog };