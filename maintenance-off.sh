#!/bin/bash
# Disable maintenance mode and restore live site

echo "Disabling maintenance mode..."

# Try to restore from maintenance backup first, then fall back to .backup
if [ -f /etc/nginx/conf.d/truthtrollers.conf.live ]; then
    cp /etc/nginx/conf.d/truthtrollers.conf.live /etc/nginx/conf.d/truthtrollers.conf
    RESTORED_FROM="truthtrollers.conf.live"
elif [ -f /etc/nginx/conf.d/truthtrollers.conf.backup ]; then
    cp /etc/nginx/conf.d/truthtrollers.conf.backup /etc/nginx/conf.d/truthtrollers.conf
    RESTORED_FROM="truthtrollers.conf.backup"
else
    echo "ERROR: No backup file found!"
    echo "Looked for: truthtrollers.conf.live and truthtrollers.conf.backup"
    exit 1
fi

# Test and reload nginx
if nginx -t; then
    systemctl reload nginx
    echo ""
    echo "✓ Live site RESTORED (from $RESTORED_FROM)"
    echo "  Site is now back online for everyone"
    echo ""
else
    echo "ERROR: nginx config test failed after restore!"
    exit 1
fi
