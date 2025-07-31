#!/bin/bash
cd /Users/guppynft/blockticity-l1-minting/placeholder-pia-test
nohup node mint_existing_metadata.js > mint_existing_output.log 2>&1 &
echo $! > mint_existing.pid
echo "Minting process started with PID: $(cat mint_existing.pid)"
echo "Monitor progress with: tail -f mint_existing_output.log"