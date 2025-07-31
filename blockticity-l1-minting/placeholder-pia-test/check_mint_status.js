const fs = require('fs-extra');
const path = require('path');

async function checkStatus() {
  const mintLogPath = path.join(__dirname, 'output', 'mint_log.json');
  
  try {
    const mintLog = await fs.readJson(mintLogPath);
    
    // Count status
    const statusCounts = {
      completed: 0,
      pending: 0,
      failed: 0
    };
    
    Object.values(mintLog.tokens).forEach(token => {
      statusCounts[token.status] = (statusCounts[token.status] || 0) + 1;
    });
    
    console.log('=== MINT LOG STATUS ===');
    console.log(`Total tokens: ${Object.keys(mintLog.tokens).length}`);
    console.log(`Completed: ${statusCounts.completed}`);
    console.log(`Pending: ${statusCounts.pending}`);
    console.log(`Failed: ${statusCounts.failed}`);
    
    if (statusCounts.pending > 0) {
      console.log('\nThere are pending tokens that need to be minted!');
      console.log('Run mint_existing_metadata.js to mint them.');
    } else {
      console.log('\nAll tokens have been processed (no pending tokens).');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkStatus();