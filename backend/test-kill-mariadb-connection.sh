#!/bin/bash
# test-kill-mariadb-connection.sh
# Script to test database connection resilience by killing active connections

echo "🔍 Finding active MariaDB connections for truthtrollers..."

# Get list of connections
mysql -u root -p truthtrollers -e "
SELECT
  Id,
  User,
  Host,
  db,
  Command,
  Time,
  State,
  SUBSTRING(Info, 1, 50) as Query
FROM information_schema.PROCESSLIST
WHERE db = 'truthtrollers'
ORDER BY Time DESC;
"

echo ""
echo "📋 Choose a connection ID to kill (usually the oldest 'Sleep' connection from Node.js):"
read -p "Enter connection ID: " conn_id

if [ -z "$conn_id" ]; then
  echo "❌ No connection ID provided. Exiting."
  exit 1
fi

echo ""
echo "💀 Killing connection $conn_id..."
mysql -u root -p -e "KILL $conn_id;"

if [ $? -eq 0 ]; then
  echo "✅ Connection $conn_id killed successfully!"
  echo ""
  echo "🧪 Now try submitting text in TextPad to test if the pool recovers."
  echo ""
  echo "📊 Current connections:"
  mysql -u root -p truthtrollers -e "
  SELECT
    COUNT(*) as active_connections,
    SUM(CASE WHEN Command = 'Sleep' THEN 1 ELSE 0 END) as sleeping,
    SUM(CASE WHEN Command != 'Sleep' THEN 1 ELSE 0 END) as active
  FROM information_schema.PROCESSLIST
  WHERE db = 'truthtrollers';
  "
else
  echo "❌ Failed to kill connection $conn_id"
fi
