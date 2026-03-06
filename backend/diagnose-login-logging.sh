#!/bin/bash

echo "════════════════════════════════════════════════════════════"
echo "🔍 LOGIN LOGGING DIAGNOSTICS"
echo "════════════════════════════════════════════════════════════"
echo ""

# 1. Check table structure
echo "1️⃣ Checking login_attempts table structure:"
mysql -u root -p -D truthtrollers -e "DESCRIBE login_attempts;" 2>&1
echo ""

# 2. Check recent login attempts
echo "2️⃣ Recent login attempts (last 10):"
mysql -u root -p -D truthtrollers -e "SELECT id, created_at, username, success, ip_address, LENGTH(ip_address) as ip_len, reason FROM login_attempts ORDER BY created_at DESC LIMIT 10;" 2>&1
echo ""

# 3. Check PM2 process status
echo "3️⃣ PM2 process status:"
pm2 list
echo ""

# 4. Check PM2 logs for errors (last 100 lines)
echo "4️⃣ PM2 error logs (searching for login failures):"
echo "─────────────────────────────────────────────"
pm2 logs --err --lines 100 --nostream | grep -E "(🚨|LOGIN|login_attempts|FAILED)" || echo "No login-related errors found"
echo ""

# 5. Check for uncaught exceptions
echo "5️⃣ PM2 logs (searching for uncaught exceptions):"
echo "─────────────────────────────────────────────"
pm2 logs --err --lines 100 --nostream | grep -E "(UNCAUGHT|UNHANDLED|🔥|⚠️)" || echo "No uncaught exceptions found"
echo ""

# 6. Follow logs in real-time
echo "6️⃣ Following PM2 logs in real-time (Ctrl+C to stop):"
echo "════════════════════════════════════════════════════════════"
pm2 logs --lines 20
