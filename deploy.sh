#!/bin/bash
set -euo pipefail

SERVER="truthtrollers-vps"
FRONTEND_PATH="/var/www/html"
BACKEND_PATH="/root/backend"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="backend/.env"
ENV_PROD="backend/.env.prod"
ENV_DEV="backend/.env.dev"

echo "🔎 Preflight: SSH connectivity..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" "echo '✅ SSH OK'"

echo "🔐 Temporarily switching backend/.env to PROD for build steps..."

HAD_ENV=0
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$ENV_FILE.bak"
  HAD_ENV=1
fi

if [[ ! -f "$ENV_PROD" ]]; then
  echo "❌ Missing $ENV_PROD"
  exit 1
fi
cp "$ENV_PROD" "$ENV_FILE"

cleanup() {
  echo "🧼 Restoring local backend/.env..."
  if [[ $HAD_ENV -eq 1 ]]; then
    mv -f "$ENV_FILE.bak" "$ENV_FILE"
  else
    rm -f "$ENV_FILE" "$ENV_FILE.bak"
    if [[ -f "$ENV_DEV" ]]; then
      cp "$ENV_DEV" "$ENV_FILE"
    fi
  fi
}
trap cleanup EXIT

echo "🧩 Build extension..."
(cd extension && npm run build)

echo "🔧 Build dashboard..."
(cd dashboard && npm run build)

echo "📤 Sync dashboard dist → server..."
rsync -azP --delete --partial --inplace \
  dashboard/dist/ "$SERVER:$FRONTEND_PATH/"

echo "📦 Sync backend code → server (excluding env + node_modules + user content)..."
rsync -azP --delete --partial --inplace \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '*.log' \
  --exclude 'assets/documents/' \
  --exclude 'assets/images/content/' \
  --exclude 'assets/images/users/' \
  --exclude 'assets/images/authors/' \
  --exclude 'assets/images/publishers/' \
  --exclude 'assets/pdf-thumbnails/' \
  --exclude 'temp/' \
  --exclude 'temp-out/' \
  backend/ "$SERVER:$BACKEND_PATH/"

echo "🖥 Remote steps: perms, logs, restart..."
ssh "$SERVER" << EOF
set -e

# Frontend permissions (nginx serves these)
chown -R nginx:nginx $FRONTEND_PATH/
chmod 644 $FRONTEND_PATH/favicon.png $FRONTEND_PATH/manifest.json $FRONTEND_PATH/sw.js 2>/dev/null || true

# Backend permissions (Node.js runs these)
chown -R root:root $BACKEND_PATH/

# User content directories (ensure they exist with correct permissions)
mkdir -p $BACKEND_PATH/assets/documents/tasks
mkdir -p $BACKEND_PATH/assets/images/content
mkdir -p $BACKEND_PATH/assets/images/users
mkdir -p $BACKEND_PATH/assets/images/authors
mkdir -p $BACKEND_PATH/assets/images/publishers
mkdir -p $BACKEND_PATH/assets/pdf-thumbnails
mkdir -p $BACKEND_PATH/temp
mkdir -p $BACKEND_PATH/temp-out

chmod -R 755 $BACKEND_PATH/assets/
chmod -R 755 $BACKEND_PATH/temp/
chmod -R 755 $BACKEND_PATH/temp-out/

pm2 flush
pm2 restart truthtrollers --update-env

# Show last logs without streaming forever (works on many pm2 versions)
pm2 logs truthtrollers --lines 60 --nostream 2>/dev/null || pm2 logs truthtrollers --lines 60

EOF

echo "✅ Deploy complete."
