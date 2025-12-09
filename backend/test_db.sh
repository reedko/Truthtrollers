#!/bin/bash
# Test if original server connects to DB successfully
cd /Users/reedko/React/Truthtrollers_demo/Truthtrollers_root/backend
pkill -f "node temp/server.js" 2>/dev/null
pkill -f "node server.js" 2>/dev/null
sleep 1
node temp/server.js > /tmp/original_server.log 2>&1 &
sleep 5
grep -i "connection" /tmp/original_server.log | head -5
pkill -f "node temp/server.js"
