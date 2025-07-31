const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Configuration for batch 3
const CONFIG = {
  START_TOKEN_ID: 100001,  // Starting from 100001
  END_TOKEN_ID: 200000,    // Ending at 200000 (100k tokens)
  BATCH_SIZE: 1000,        // Process 1000 at a time
  OUTPUT_DIR: path.join(__dirname, 'output', 'metadata_batch3'),
  MINT_LOG_PATH: path.join(__dirname, 'output', 'batch3_mint_log.json'),
  PLACEHOLDER_IMAGE: 'ipfs://QmRT8DUSsFLZrrhgyhcSwh8988xx1kKCuR5SLpDS2hWkDN'
};

// Ensure output directory exists
fs.ensureDirSync(CONFIG.OUTPUT_DIR, { recursive: true });

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
  console.log(chalk.cyan(`\n📦 Generating tokens ${startId} to ${endId}...`));
  
  const promises = [];
  for (let tokenId = startId; tokenId <= endId; tokenId++) {
    const metadata = generateMetadata(tokenId);
    const filename = `pia_placeholder_${tokenId.toString().padStart(6, '0')}.json`;
    const filepath = path.join(CONFIG.OUTPUT_DIR, filename);
    
    promises.push(fs.writeJson(filepath, metadata, { spaces: 2 }));
  }
  
  await Promise.all(promises);
  console.log(chalk.green(`✅ Generated ${endId - startId + 1} metadata files`));
}

async function createMintLog() {
  console.log(chalk.blue('\n📋 Creating mint log...'));
  
  const mintLog = {
    tokens: {},
    summary: {
      total: 0,
      successful: 0,
      failed: 0,
      pending: 0
    }
  };
  
  for (let tokenId = CONFIG.START_TOKEN_ID; tokenId <= CONFIG.END_TOKEN_ID; tokenId++) {
    const paddedId = tokenId.toString().padStart(6, '0');
    mintLog.tokens[paddedId] = {
      metadataUri: CONFIG.PLACEHOLDER_IMAGE,
      status: 'pending',
      addedAt: new Date().toISOString()
    };
    mintLog.summary.total++;
    mintLog.summary.pending++;
  }
  
  await fs.writeJson(CONFIG.MINT_LOG_PATH, mintLog, { spaces: 2 });
  console.log(chalk.green(`✅ Created mint log with ${mintLog.summary.total} tokens`));
}

async function main() {
  console.log(chalk.cyan('🚀 Blockticity Batch 3 Placeholder Generator'));
  console.log(chalk.cyan('='.repeat(50)));
  console.log(chalk.blue(`📊 Generating tokens ${CONFIG.START_TOKEN_ID} to ${CONFIG.END_TOKEN_ID}`));
  console.log(chalk.blue(`📁 Output directory: ${CONFIG.OUTPUT_DIR}`));
  
  const startTime = Date.now();
  
  try {
    // Generate metadata in batches
    for (let start = CONFIG.START_TOKEN_ID; start <= CONFIG.END_TOKEN_ID; start += CONFIG.BATCH_SIZE) {
      const end = Math.min(start + CONFIG.BATCH_SIZE - 1, CONFIG.END_TOKEN_ID);
      await generateBatch(start, end);
      
      // Show progress
      const progress = ((end - CONFIG.START_TOKEN_ID + 1) / (CONFIG.END_TOKEN_ID - CONFIG.START_TOKEN_ID + 1) * 100).toFixed(1);
      console.log(chalk.cyan(`📊 Progress: ${progress}%`));
    }
    
    // Create mint log
    await createMintLog();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.green('✅ Generation Complete!'));
    console.log(chalk.cyan(`⏱️  Duration: ${duration} seconds`));
    console.log(chalk.cyan(`📊 Total files generated: ${CONFIG.END_TOKEN_ID - CONFIG.START_TOKEN_ID + 1}`));
    console.log(chalk.yellow(`\n💡 Next step: Run the minting script with:`));
    console.log(chalk.white(`   node mint_existing_metadata_improved.js --inputDir=output/metadata_batch3 --logPath=output/batch3_mint_log.json`));
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

main().catch(console.error);