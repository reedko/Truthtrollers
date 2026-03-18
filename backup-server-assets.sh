#!/bin/bash
# Backup server assets to a timestamped directory
# Run this periodically to create backups of user content

set -euo pipefail

SERVER="truthtrollers-vps"
BACKUP_DIR="/root/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/assets_backup_$TIMESTAMP"

echo "📦 Creating backup on server..."

ssh "$SERVER" << EOF
set -e

# Create backup directory
mkdir -p $BACKUP_PATH

# Backup all user content
echo "Backing up assets..."
cp -r /root/backend/assets/data $BACKUP_PATH/ 2>/dev/null || true
cp -r /root/backend/assets/documents $BACKUP_PATH/ 2>/dev/null || true
cp -r /root/backend/assets/images $BACKUP_PATH/ 2>/dev/null || true
cp -r /root/backend/assets/pdf-thumbnails $BACKUP_PATH/ 2>/dev/null || true
cp -r /root/backend/assets/videos $BACKUP_PATH/ 2>/dev/null || true

# Backup .env file
cp /root/backend/.env $BACKUP_PATH/.env 2>/dev/null || true

# Show backup size
du -sh $BACKUP_PATH

# Keep only last 5 backups (delete older ones)
echo "Cleaning up old backups (keeping last 5)..."
cd $BACKUP_DIR
ls -t | tail -n +6 | xargs -r rm -rf

echo "✅ Backup complete: $BACKUP_PATH"
ls -lh $BACKUP_DIR
EOF

echo "✅ Backup complete on server"
