const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Configuration
const CONFIG = {
  OUTPUT_DIR: path.join(__dirname, 'output', 'metadata_batch2'),
  START_TOKEN_ID: 19600, // Starting after current batch
  END_TOKEN_ID: 100000,  // Target 100k tokens
  BATCH_SIZE: 1000,      // Generate 1000 files at a time
  PLACEHOLDER_IMAGE: 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN'
};

// Metadata template function
function generateMetadata(tokenId) {
  const paddedId = tokenId.toString().padStart(6, '0');
  return {
    name: `Players Ink Placeholder #${paddedId}`,
    description: `Players Ink Authentication Certificate #${paddedId} - This Certificate of Authenticity is pending final verification. Please check back soon.`,
    image: CONFIG.PLACEHOLDER_IMAGE,
    attributes: [
      {
        trait_type: "Signed By",
        value: "To Be Updated"
      },
      {
        trait_type: "Item Type",
        value: "To Be Updated"
      },
      {
        trait_type: "Date Signed",
        value: "To Be Updated"
      },
      {
        trait_type: "Order Identifier",
        value: "To Be Updated"
      },
      {
        trait_type: "Location",
        value: "To Be Updated"
      },
      {
        trait_type: "Team",
        value: "To Be Updated"
      },
      {
        trait_type: "Token ID",
        value: paddedId
      },
      {
        trait_type: "Status",
        value: "Placeholder"
      }
    ],
    tokenId: paddedId,
    final_metadata_pending: true,
    locked: true
  };
}

async function generateBatch(startId, endId) {
  const files = [];
  
  for (let tokenId = startId; tokenId <= endId; tokenId++) {
    const paddedId = tokenId.toString().padStart(6, '0');
    const metadata = generateMetadata(tokenId);
    const filename = `pia_placeholder_${paddedId}.json`;
    const filepath = path.join(CONFIG.OUTPUT_DIR, filename);
    
    files.push({
      path: filepath,
      content: JSON.stringify(metadata, null, 2)
    });
  }
  
  // Write all files in batch
  await Promise.all(
    files.map(({ path, content }) => fs.outputFile(path, content))
  );
  
  return files.length;
}

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Additional Placeholder Generator'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.cyan(`📊 Generating tokens ${CONFIG.START_TOKEN_ID} to ${CONFIG.END_TOKEN_ID}`));
  console.log(chalk.cyan(`📁 Output directory: ${CONFIG.OUTPUT_DIR}`));
  
  try {
    // Ensure output directory exists
    await fs.ensureDir(CONFIG.OUTPUT_DIR);
    
    const totalTokens = CONFIG.END_TOKEN_ID - CONFIG.START_TOKEN_ID + 1;
    const totalBatches = Math.ceil(totalTokens / CONFIG.BATCH_SIZE);
    let generatedCount = 0;
    
    console.log(chalk.cyan(`\n📊 Total tokens to generate: ${totalTokens.toLocaleString()}`));
    console.log(chalk.cyan(`📦 Batch size: ${CONFIG.BATCH_SIZE}`));
    console.log(chalk.cyan(`📦 Total batches: ${totalBatches}`));
    
    const startTime = Date.now();
    
    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const batchStart = CONFIG.START_TOKEN_ID + (batchNum * CONFIG.BATCH_SIZE);
      const batchEnd = Math.min(batchStart + CONFIG.BATCH_SIZE - 1, CONFIG.END_TOKEN_ID);
      
      process.stdout.write(chalk.yellow(`\r⏳ Generating batch ${batchNum + 1}/${totalBatches} (tokens ${batchStart}-${batchEnd})...`));
      
      const filesGenerated = await generateBatch(batchStart, batchEnd);
      generatedCount += filesGenerated;
      
      // Show progress every 10 batches
      if ((batchNum + 1) % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = generatedCount / elapsed;
        const remaining = (totalTokens - generatedCount) / rate;
        
        console.log(chalk.green(`\n✅ Progress: ${generatedCount.toLocaleString()}/${totalTokens.toLocaleString()} tokens generated`));
        console.log(chalk.cyan(`⏱️  Rate: ${Math.round(rate)} tokens/second`));
        console.log(chalk.cyan(`⏳ Estimated time remaining: ${Math.round(remaining / 60)} minutes`));
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    
    console.log(chalk.cyan('\n\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Generation Complete!'));
    console.log(chalk.cyan(`📊 Total files generated: ${generatedCount.toLocaleString()}`));
    console.log(chalk.cyan(`⏱️  Duration: ${duration} minutes`));
    console.log(chalk.cyan(`📁 Files saved to: ${CONFIG.OUTPUT_DIR}`));
    
    // Create a summary file
    const summary = {
      generatedAt: new Date().toISOString(),
      totalFiles: generatedCount,
      startTokenId: CONFIG.START_TOKEN_ID,
      endTokenId: CONFIG.END_TOKEN_ID,
      outputDirectory: CONFIG.OUTPUT_DIR,
      placeholderImage: CONFIG.PLACEHOLDER_IMAGE
    };
    
    await fs.writeJson(
      path.join(CONFIG.OUTPUT_DIR, '_generation_summary.json'),
      summary,
      { spaces: 2 }
    );
    
    console.log(chalk.green('\n📄 Summary file created: _generation_summary.json'));
    
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

module.exports = { main, generateMetadata };