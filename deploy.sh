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

# Check if --no-backup flag is set
SKIP_BACKUP=${1:-}
if [[ "$SKIP_BACKUP" == "--no-backup" ]]; then
  echo "⏭️  Skipping backup (--no-backup flag set)"
else
  echo "💾 Creating incremental backup on production server..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ssh -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$SERVER" bash << EOF
set -e

# Create backup directory if it doesn't exist
mkdir -p /root/backups

# Find the most recent backup to use as a reference
LATEST_BACKUP=\$(ls -td /root/backups/backup_* 2>/dev/null | head -1)

# Create timestamped backup
BACKUP_DIR="/root/backups/backup_${TIMESTAMP}"
echo "Creating incremental backup at \$BACKUP_DIR..."

# Backup backend code (excluding node_modules and temp files)
# Using --link-dest for hard links to unchanged files from previous backup
mkdir -p \$BACKUP_DIR/backend
if [ -n "\$LATEST_BACKUP" ] && [ -d "\$LATEST_BACKUP/backend" ]; then
  echo "Using \$LATEST_BACKUP as reference (hard-linking unchanged files)"
  rsync -a --link-dest="\$LATEST_BACKUP/backend" \
    --exclude 'node_modules' --exclude 'temp/' --exclude 'temp-out/' --exclude '*.log' \
    $BACKEND_PATH/ \$BACKUP_DIR/backend/
else
  echo "No previous backup found, creating full backup"
  rsync -a --exclude 'node_modules' --exclude 'temp/' --exclude 'temp-out/' --exclude '*.log' \
    $BACKEND_PATH/ \$BACKUP_DIR/backend/
fi

# Backup frontend
mkdir -p \$BACKUP_DIR/frontend
if [ -n "\$LATEST_BACKUP" ] && [ -d "\$LATEST_BACKUP/frontend" ]; then
  rsync -a --link-dest="\$LATEST_BACKUP/frontend" \
    $FRONTEND_PATH/ \$BACKUP_DIR/frontend/
else
  rsync -a $FRONTEND_PATH/ \$BACKUP_DIR/frontend/
fi

# Create backup info file
BACKUP_SIZE=\$(du -sh \$BACKUP_DIR | cut -f1)
cat > \$BACKUP_DIR/backup_info.txt << BACKUPINFO
Backup created: \$(date)
Backend path: $BACKEND_PATH
Frontend path: $FRONTEND_PATH
Backup size: \$BACKUP_SIZE
Reference backup: \${LATEST_BACKUP:-none}
BACKUPINFO

echo "✅ Incremental backup created: \$BACKUP_DIR size: \$BACKUP_SIZE"

# Keep only last 10 backups
cd /root/backups
ls -t | tail -n +11 | xargs -r rm -rf
echo "✅ Old backups cleaned keeping last 10"
EOF
fi

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

echo "📦 Sync backend code → server (excluding user content)..."
rsync -azP --partial --inplace \
  --include 'assets/images/content/content_id_default.png' \
  --include 'assets/images/authors/author_id_default.png' \
  --include 'assets/images/publishers/publisher_id_default.png' \
  --exclude '.env*' \
  --exclude 'assets/data/' \
  --exclude 'assets/documents/' \
  --exclude 'assets/images/content/' \
  --exclude 'assets/images/users/' \
  --exclude 'assets/images/authors/' \
  --exclude 'assets/images/publishers/' \
  --exclude 'assets/images/tutorials/' \
  --exclude 'assets/pdf-thumbnails/' \
  --exclude 'assets/videos/' \
  --exclude 'temp/' \
  --exclude 'temp-out/' \
  --exclude 'node_modules' \
  --exclude '*.log' \
  backend/ "$SERVER:$BACKEND_PATH/"

echo "🖥 Remote steps: Redis check, perms, logs, restart..."
ssh -o ConnectTimeout=60 -o ServerAliveInterval=15 -o ServerAliveCountMax=6 "$SERVER" bash << EOF
set -e

# Check if Redis is installed, if not install it
if ! command -v redis-server &> /dev/null && ! command -v redis-cli &> /dev/null; then
  echo "📦 Redis not found, installing..."
  # Detect package manager and install
  if command -v dnf &> /dev/null; then
    dnf install -y redis
  elif command -v yum &> /dev/null; then
    yum install -y redis
  elif command -v apt-get &> /dev/null; then
    apt-get update -qq
    apt-get install -y redis-server
  else
    echo "❌ Could not detect package manager (dnf/yum/apt-get)"
    exit 1
  fi
  systemctl enable redis
  systemctl start redis
  echo "✅ Redis installed and started"
else
  echo "✅ Redis already installed"
  # Ensure it's running (works for both redis and redis-server service names)
  if ! systemctl is-active --quiet redis 2>/dev/null && ! systemctl is-active --quiet redis-server 2>/dev/null; then
    echo "🔄 Starting Redis..."
    systemctl start redis 2>/dev/null || systemctl start redis-server 2>/dev/null || true
  fi
fi

# Frontend permissions (nginx serves these)
chown -R nginx:nginx $FRONTEND_PATH/
find $FRONTEND_PATH -type f -exec chmod 644 {} \;
find $FRONTEND_PATH -type d -exec chmod 755 {} \;

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
