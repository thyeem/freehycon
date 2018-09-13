#!/bin/bash
echo "start stratum"
pm2 start ./node_modules/.bin/ts-node -- src/miner/main.ts --port=8148 --str_port=9081 --api --api_port=2442 --cpuMiners=0 --freehycon 
