#!/bin/bash

# Players Ink Authentication Placeholder Minting Deployment Script

echo "🚀 Starting PIA Placeholder NFT Deployment Process"
echo "=================================================="

# Navigate to project directory
cd /Users/guppynft/blockticity-l1-minting/placeholder-pia-test

# Step 1: Install dependencies
echo ""
echo "📦 Step 1: Installing dependencies..."
npm install

# Step 2: Test connections
echo ""
echo "🔍 Step 2: Testing connections..."
node test-connection.js

# Step 3: Run test batch (10 NFTs)
echo ""
echo "🧪 Step 3: Running test batch (10 NFTs)..."
echo "Press any key to continue with test run..."
read -n 1 -s
npm start -- --test

# Step 4: Run production batch (100,000 NFTs)
echo ""
echo "🎯 Step 4: Ready for production run (100,000 NFTs)"
echo "⚠️  WARNING: This will mint 100,000 NFTs and take ~5-6 hours"
echo "Press 'y' to continue with production run, any other key to exit..."
read -n 1 -s key

if [[ $key = "y" ]]; then
    echo ""
    echo "🏭 Starting production run..."
    npm start
else
    echo ""
    echo "❌ Production run cancelled"
    exit 0
fi