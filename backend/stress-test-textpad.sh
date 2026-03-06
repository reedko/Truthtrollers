#!/bin/bash
# stress-test-textpad.sh
# Rapidly submit text to TextPad to stress test the connection pool

API_URL="https://truthtrollers.com/api/submit-text"
TOKEN="YOUR_JWT_TOKEN_HERE"  # Replace with actual token from browser

echo "🔥 Starting TextPad stress test..."
echo "📊 Will submit 20 texts rapidly to test connection pool"
echo ""

for i in {1..20}; do
  echo "📝 Submitting text #$i..."

  curl -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"text\": \"Stress test submission #$i - Testing connection pool resilience under load. This is an automated test to ensure the database connection pool handles concurrent requests properly.\", \"assigned_to_user_id\": 1}" \
    -s -o /dev/null -w "   Status: %{http_code} | Time: %{time_total}s\n" &

  # Small delay to space out requests slightly
  sleep 0.2
done

echo ""
echo "⏳ Waiting for all requests to complete..."
wait

echo "✅ Stress test complete!"
echo ""
echo "📊 Check MariaDB connections:"
echo "   mysql -u root -p -e 'SHOW PROCESSLIST;'"
