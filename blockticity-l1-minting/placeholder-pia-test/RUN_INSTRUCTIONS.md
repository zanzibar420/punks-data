# PIA Placeholder Minting - Run Instructions

Open Terminal and execute these commands in order:

## Make scripts executable (run once)
```bash
cd /Users/guppynft/blockticity-l1-minting/placeholder-pia-test
chmod +x *.sh
```

## Step 1: Install Dependencies
```bash
./step1-install.sh
```
Or manually:
```bash
npm install
```

## Step 2: Test Connections
```bash
./step2-test-connection.sh
```
Or manually:
```bash
node test-connection.js
```

## Step 3: Test Run (10 NFTs)
```bash
./step3-test-run.sh
```
Or manually:
```bash
npm start -- --test
```

## Step 4: Production Run (100,000 NFTs)
```bash
./step4-production-run.sh
```
Or manually:
```bash
npm start
```

## Alternative: Run all steps
```bash
./run-deployment.sh
```

## Monitor Progress
In a separate terminal window:
```bash
# Watch the log file
tail -f /Users/guppynft/blockticity-l1-minting/placeholder-pia-test/output/mint_log.json

# Check summary
cat /Users/guppynft/blockticity-l1-minting/placeholder-pia-test/output/mint_log.json | grep summary
```