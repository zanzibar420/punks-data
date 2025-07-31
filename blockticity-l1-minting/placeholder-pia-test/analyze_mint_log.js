const fs = require('fs-extra');
const path = require('path');

async function analyzeMintLog() {
  const mintLogPath = process.argv[2] || path.join(__dirname, 'output', 'mint_log.json');
  
  try {
    console.log('Loading mint log...');
    const mintLog = await fs.readJson(mintLogPath);
    
    // Find token 310
    const token310 = mintLog.tokens['310'];
    console.log('\n=== TOKEN 310 STATUS ===');
    if (token310) {
      console.log(JSON.stringify(token310, null, 2));
    } else {
      console.log('Token 310 not found in mint log!');
    }
    
    // Find the last successfully minted token
    let lastSuccessful = null;
    let lastSuccessfulId = 0;
    
    Object.entries(mintLog.tokens).forEach(([tokenId, data]) => {
      if (data.status === 'completed' && parseInt(tokenId) > lastSuccessfulId) {
        lastSuccessfulId = parseInt(tokenId);
        lastSuccessful = { tokenId, ...data };
      }
    });
    
    console.log('\n=== LAST SUCCESSFUL MINT ===');
    if (lastSuccessful) {
      console.log(`Token ID: ${lastSuccessful.tokenId}`);
      console.log(`Completed at: ${lastSuccessful.completedAt}`);
      console.log(`Transaction: ${lastSuccessful.txHash}`);
    }
    
    // Find first failed token
    const failedTokens = Object.entries(mintLog.tokens)
      .filter(([_, data]) => data.status === 'failed')
      .map(([tokenId, data]) => ({ tokenId, ...data }))
      .sort((a, b) => parseInt(a.tokenId) - parseInt(b.tokenId));
    
    console.log('\n=== FAILED TOKENS ===');
    console.log(`Total failed: ${failedTokens.length}`);
    if (failedTokens.length > 0) {
      console.log('First 5 failed tokens:');
      failedTokens.slice(0, 5).forEach(token => {
        console.log(`  Token ${token.tokenId}: ${token.error || 'No error message'}`);
      });
    }
    
    // Count status summary
    const statusCounts = {
      completed: 0,
      pending: 0,
      failed: 0
    };
    
    Object.values(mintLog.tokens).forEach(token => {
      statusCounts[token.status] = (statusCounts[token.status] || 0) + 1;
    });
    
    console.log('\n=== OVERALL SUMMARY ===');
    console.log(`Total tokens: ${Object.keys(mintLog.tokens).length}`);
    console.log(`Completed: ${statusCounts.completed}`);
    console.log(`Pending: ${statusCounts.pending}`);
    console.log(`Failed: ${statusCounts.failed}`);
    
    // Check for gaps in minting
    console.log('\n=== CHECKING FOR GAPS ===');
    const tokenIds = Object.keys(mintLog.tokens).map(id => parseInt(id)).sort((a, b) => a - b);
    let gaps = [];
    
    for (let i = 1; i < tokenIds.length; i++) {
      if (tokenIds[i] - tokenIds[i-1] > 1) {
        gaps.push({
          after: tokenIds[i-1],
          before: tokenIds[i],
          missing: tokenIds[i] - tokenIds[i-1] - 1
        });
      }
    }
    
    if (gaps.length > 0) {
      console.log(`Found ${gaps.length} gaps:`);
      gaps.slice(0, 5).forEach(gap => {
        console.log(`  Missing ${gap.missing} tokens between ${gap.after} and ${gap.before}`);
      });
    } else {
      console.log('No gaps found in token sequence');
    }
    
    // Check tokens around 310
    console.log('\n=== TOKENS AROUND 310 ===');
    for (let i = 305; i <= 315; i++) {
      const token = mintLog.tokens[i.toString()];
      if (token) {
        console.log(`Token ${i}: ${token.status}`);
      } else {
        console.log(`Token ${i}: NOT FOUND`);
      }
    }
    
  } catch (error) {
    console.error('Error analyzing mint log:', error.message);
    process.exit(1);
  }
}

analyzeMintLog().catch(console.error);