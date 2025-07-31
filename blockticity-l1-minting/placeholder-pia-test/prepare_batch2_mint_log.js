const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  METADATA_DIR: path.join(__dirname, 'output', 'metadata_batch2'),
  OUTPUT_LOG_PATH: path.join(__dirname, 'output', 'batch2_mint_log.json')
};

async function buildMintLog() {
  console.log(chalk.cyan('🚀 Building Mint Log for Batch 2'));
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
    // Check if metadata directory exists
    const metadataExists = await fs.pathExists(CONFIG.METADATA_DIR);
    if (!metadataExists) {
      throw new Error(`Metadata directory not found: ${CONFIG.METADATA_DIR}`);
    }
    
    // Load all metadata files
    console.log(chalk.cyan('\n📂 Loading metadata files...'));
    const files = await fs.readdir(CONFIG.METADATA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f.startsWith('pia_placeholder_'));
    
    console.log(chalk.cyan(`📊 Found ${jsonFiles.length} metadata files`));
    
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
        
        // Load metadata
        const metadata = await fs.readJson(filePath);
        
        // Extract metadata URI (using the image field since these are placeholders)
        const metadataUri = metadata.image || '';
        
        // Add to mint log
        mintLog.tokens[tokenId] = {
          metadataUri: metadataUri,
          status: 'pending',
          addedAt: new Date().toISOString()
        };
        
        mintLog.summary.total++;
        mintLog.summary.pending++;
        
      } catch (error) {
        console.error(chalk.red(`❌ Error processing ${file}: ${error.message}`));
      }
    }
    
    // Save the mint log
    await fs.ensureDir(path.dirname(CONFIG.OUTPUT_LOG_PATH));
    await fs.writeJson(CONFIG.OUTPUT_LOG_PATH, mintLog, { spaces: 2 });
    
    // Final summary
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Mint log preparation complete!'));
    console.log(chalk.cyan(`📊 Total tokens in batch: ${mintLog.summary.total}`));
    console.log(chalk.cyan(`📄 Output saved to: ${CONFIG.OUTPUT_LOG_PATH}`));
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
    console.error(error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  buildMintLog().catch(console.error);
}

module.exports = { buildMintLog };