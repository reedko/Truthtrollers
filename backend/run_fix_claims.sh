#!/bin/bash
# Fix claims table unique constraint

if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

DB_HOST=${DB_HOST:-localhost}
DB_USER=${DB_USER:-root}
DB_PASSWORD=${DB_PASSWORD:-rootrootnow}
DB_NAME=${DB_NAME:-truthtrollers_db}

echo "🔧 Fixing claims table constraint..."

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" < fix_claims_constraint.sql

if [ $? -eq 0 ]; then
  echo "✅ Claims table fixed! claim_text is no longer unique."
else
  echo "❌ Fix failed!"
  exit 1
fi
