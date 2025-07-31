const { ethers } = require('ethers');
const fs = require('fs-extra');
const chalk = require('chalk');

// Configuration for RPC reliability testing
const CONFIG = {
  // Primary RPC endpoint
  PRIMARY_RPC: 'https://subnets.avax.network/btic/mainnet/rpc',
  
  // Test configuration
  TEST_DURATION: 300000, // 5 minutes of testing
  TEST_INTERVAL: 5000,   // Test every 5 seconds
  TIMEOUT_THRESHOLD: 10000, // 10 second timeout
  
  // Output file
  RESULTS_FILE: './rpc_reliability_results.json'
};

class RPCReliabilityMonitor {
  constructor() {
    this.results = {
      startTime: new Date().toISOString(),
      endTime: null,
      totalTests: 0,
      successfulTests: 0,
      failedTests: 0,
      timeouts: 0,
      averageResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      tests: []
    };
    
    this.provider = new ethers.JsonRpcProvider(CONFIG.PRIMARY_RPC, undefined, {
      timeout: CONFIG.TIMEOUT_THRESHOLD
    });
  }

  async runSingleTest() {
    const testStart = Date.now();
    const testId = this.results.totalTests + 1;
    
    try {
      console.log(chalk.cyan(`🔍 Test ${testId}: Testing RPC response...`));
      
      // Test multiple RPC calls to simulate real usage
      const promises = [
        this.provider.getBlockNumber(),
        this.provider.getNetwork(),
        this.provider.getFeeData(),
        this.provider.getBalance('0xE2A506B43dF9c4e3B3c284F8cc18cF47Ac266929')
      ];
      
      const results = await Promise.all(promises);
      const responseTime = Date.now() - testStart;
      
      // Record successful test
      this.results.successfulTests++;
      this.results.minResponseTime = Math.min(this.results.minResponseTime, responseTime);
      this.results.maxResponseTime = Math.max(this.results.maxResponseTime, responseTime);
      
      const testResult = {
        testId,
        timestamp: new Date().toISOString(),
        success: true,
        responseTime,
        blockNumber: results[0],
        chainId: results[1].chainId,
        gasPrice: results[2].gasPrice?.toString(),
        balance: ethers.formatEther(results[3])
      };
      
      this.results.tests.push(testResult);
      
      console.log(chalk.green(`✅ Test ${testId}: Success in ${responseTime}ms (Block: ${results[0]})`));
      
      return testResult;
      
    } catch (error) {
      const responseTime = Date.now() - testStart;
      
      // Classify error type
      let errorType = 'UNKNOWN';
      if (error.message.includes('timeout')) {
        errorType = 'TIMEOUT';
        this.results.timeouts++;
      } else if (error.message.includes('ECONNRESET')) {
        errorType = 'CONNECTION_RESET';
      } else if (error.message.includes('ENOTFOUND')) {
        errorType = 'DNS_ERROR';
      } else if (error.message.includes('429')) {
        errorType = 'RATE_LIMIT';
      }
      
      this.results.failedTests++;
      
      const testResult = {
        testId,
        timestamp: new Date().toISOString(),
        success: false,
        responseTime,
        errorType,
        errorMessage: error.message.slice(0, 100)
      };
      
      this.results.tests.push(testResult);
      
      console.log(chalk.red(`❌ Test ${testId}: ${errorType} in ${responseTime}ms - ${error.message.slice(0, 50)}...`));
      
      return testResult;
    }
  }

  calculateStatistics() {
    this.results.totalTests = this.results.successfulTests + this.results.failedTests;
    
    if (this.results.successfulTests > 0) {
      const successfulTests = this.results.tests.filter(t => t.success);
      const totalResponseTime = successfulTests.reduce((sum, test) => sum + test.responseTime, 0);
      this.results.averageResponseTime = totalResponseTime / successfulTests.length;
    }
    
    this.results.successRate = (this.results.successfulTests / this.results.totalTests) * 100;
    this.results.timeoutRate = (this.results.timeouts / this.results.totalTests) * 100;
    this.results.endTime = new Date().toISOString();
  }

  printReport() {
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan('🔍 RPC RELIABILITY REPORT'));
    console.log(chalk.cyan('='.repeat(60)));
    
    console.log(chalk.yellow(`📊 Test Period: ${this.results.startTime} to ${this.results.endTime}`));
    console.log(chalk.yellow(`🔢 Total Tests: ${this.results.totalTests}`));
    console.log(chalk.green(`✅ Successful: ${this.results.successfulTests} (${this.results.successRate.toFixed(1)}%)`));
    console.log(chalk.red(`❌ Failed: ${this.results.failedTests} (${(100 - this.results.successRate).toFixed(1)}%)`));
    console.log(chalk.yellow(`⏱️  Timeouts: ${this.results.timeouts} (${this.results.timeoutRate.toFixed(1)}%)`));
    
    if (this.results.successfulTests > 0) {
      console.log(chalk.cyan(`\n📈 Response Time Statistics:`));
      console.log(chalk.cyan(`   Average: ${this.results.averageResponseTime.toFixed(0)}ms`));
      console.log(chalk.cyan(`   Minimum: ${this.results.minResponseTime}ms`));
      console.log(chalk.cyan(`   Maximum: ${this.results.maxResponseTime}ms`));
    }
    
    // Error breakdown
    const errorTypes = {};
    this.results.tests.filter(t => !t.success).forEach(test => {
      errorTypes[test.errorType] = (errorTypes[test.errorType] || 0) + 1;
    });
    
    if (Object.keys(errorTypes).length > 0) {
      console.log(chalk.red(`\n🚨 Error Breakdown:`));
      Object.entries(errorTypes).forEach(([type, count]) => {
        console.log(chalk.red(`   ${type}: ${count} occurrences`));
      });
    }
    
    // Reliability assessment
    console.log(chalk.cyan(`\n🎯 Reliability Assessment:`));
    if (this.results.successRate >= 95) {
      console.log(chalk.green(`   EXCELLENT (${this.results.successRate.toFixed(1)}% success rate)`));
    } else if (this.results.successRate >= 90) {
      console.log(chalk.yellow(`   GOOD (${this.results.successRate.toFixed(1)}% success rate)`));
    } else if (this.results.successRate >= 80) {
      console.log(chalk.yellow(`   FAIR (${this.results.successRate.toFixed(1)}% success rate)`));
    } else {
      console.log(chalk.red(`   POOR (${this.results.successRate.toFixed(1)}% success rate)`));
    }
    
    if (this.results.averageResponseTime > 5000) {
      console.log(chalk.red(`   ⚠️  HIGH LATENCY: ${this.results.averageResponseTime.toFixed(0)}ms average`));
    } else if (this.results.averageResponseTime > 2000) {
      console.log(chalk.yellow(`   ⚠️  MODERATE LATENCY: ${this.results.averageResponseTime.toFixed(0)}ms average`));
    } else {
      console.log(chalk.green(`   ✅ LOW LATENCY: ${this.results.averageResponseTime.toFixed(0)}ms average`));
    }
  }

  async run() {
    console.log(chalk.cyan('🚀 Starting RPC Reliability Monitor'));
    console.log(chalk.cyan(`🎯 Testing: ${CONFIG.PRIMARY_RPC}`));
    console.log(chalk.cyan(`⏱️  Duration: ${CONFIG.TEST_DURATION / 1000} seconds`));
    console.log(chalk.cyan(`🔄 Interval: ${CONFIG.TEST_INTERVAL / 1000} seconds`));
    console.log(chalk.cyan('='.repeat(60)));
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < CONFIG.TEST_DURATION) {
      await this.runSingleTest();
      await new Promise(resolve => setTimeout(resolve, CONFIG.TEST_INTERVAL));
    }
    
    this.calculateStatistics();
    this.printReport();
    
    // Save results to file
    await fs.writeJson(CONFIG.RESULTS_FILE, this.results, { spaces: 2 });
    console.log(chalk.cyan(`\n💾 Results saved to: ${CONFIG.RESULTS_FILE}`));
  }
}

// Network Quality Test
async function testNetworkQuality() {
  console.log(chalk.blue('\n🌐 NETWORK QUALITY TEST'));
  console.log(chalk.blue('='.repeat(40)));
  
  try {
    // Test DNS resolution speed
    const dnsStart = Date.now();
    await require('dns').promises.lookup('subnets.avax.network');
    const dnsTime = Date.now() - dnsStart;
    console.log(chalk.green(`✅ DNS Resolution: ${dnsTime}ms`));
    
    // Test basic connectivity
    const pingStart = Date.now();
    const response = await fetch('https://subnets.avax.network/btic/mainnet/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'net_version',
        params: [],
        id: 1
      })
    });
    const pingTime = Date.now() - pingStart;
    console.log(chalk.green(`✅ HTTP Connectivity: ${pingTime}ms`));
    
    if (response.ok) {
      const data = await response.json();
      console.log(chalk.green(`✅ RPC Response: Chain ID ${data.result}`));
    }
    
  } catch (error) {
    console.log(chalk.red(`❌ Network Test Failed: ${error.message}`));
  }
}

// Comparison test with other RPC endpoints (if available)
async function testAlternativeRPCs() {
  console.log(chalk.blue('\n🔄 ALTERNATIVE RPC TEST'));
  console.log(chalk.blue('='.repeat(40)));
  
  // List of potential alternative RPCs for Blockticity L1
  const alternativeRPCs = [
    'https://rpc.btic.network',
    'https://btic-mainnet.rpc.thirdweb.com',
    'https://blockticity.rpc.quicknode.pro'
  ];
  
  for (const rpcUrl of alternativeRPCs) {
    try {
      console.log(chalk.cyan(`Testing: ${rpcUrl}`));
      const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
        timeout: 10000
      });
      
      const start = Date.now();
      const blockNumber = await provider.getBlockNumber();
      const responseTime = Date.now() - start;
      
      console.log(chalk.green(`✅ ${rpcUrl}: ${responseTime}ms (Block: ${blockNumber})`));
      
    } catch (error) {
      console.log(chalk.red(`❌ ${rpcUrl}: ${error.message.slice(0, 50)}...`));
    }
  }
}

// Main execution
async function main() {
  console.log(chalk.cyan('🔍 RPC ENDPOINT RELIABILITY ANALYSIS'));
  console.log(chalk.cyan('='.repeat(60)));
  
  // Run network quality test first
  await testNetworkQuality();
  
  // Test alternative RPCs
  await testAlternativeRPCs();
  
  // Run main reliability monitor
  const monitor = new RPCReliabilityMonitor();
  await monitor.run();
  
  console.log(chalk.cyan('\n🎯 Analysis Complete!'));
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { RPCReliabilityMonitor };