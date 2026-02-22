#!/bin/bash
# Enable maintenance mode

echo "Enabling maintenance mode..."

# Backup current nginx config
cp /etc/nginx/conf.d/truthtrollers.conf /etc/nginx/conf.d/truthtrollers.conf.backup

# Create maintenance config
cat > /etc/nginx/conf.d/truthtrollers.conf << 'EOF'
server {
    listen 443 ssl;
    server_name truthtrollers.com www.truthtrollers.com;

    ssl_certificate /etc/ssl/certs/truthtrollers.crt;
    ssl_certificate_key /etc/ssl/private/truthtrollers.key;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    root /var/www/html;

    location / {
        return 503;
    }

    error_page 503 /maintenance.html;
    location = /maintenance.html {
        internal;
    }
}

server {
    listen 80;
    server_name truthtrollers.com www.truthtrollers.com;
    return 301 https://$host$request_uri;
}
EOF

# Test and reload nginx
if nginx -t; then
    systemctl reload nginx
    echo ""
    echo "✓ Maintenance mode ENABLED"
    echo "  Site now showing maintenance page"
    echo "  Run ./maintenance-off.sh to restore live site"
    echo ""
else
    echo ""
    echo "ERROR: nginx config test failed!"
    echo "Restoring backup..."
    cp /etc/nginx/conf.d/truthtrollers.conf.backup /etc/nginx/conf.d/truthtrollers.conf
    exit 1
fi
