#!/bin/bash
# Enable maintenance mode with IP whitelist bypass

ALLOWED_IP="103.137.12.66"  # Your current IP

echo "Enabling maintenance mode (with bypass for $ALLOWED_IP)..."

# Create a maintenance-specific backup (don't overwrite .backup)
cp /etc/nginx/conf.d/truthtrollers.conf /etc/nginx/conf.d/truthtrollers.conf.live

# Create maintenance config with IP bypass
cat > /etc/nginx/conf.d/truthtrollers.conf << EOF
# Redirect all HTTP to HTTPS
server {
    listen 80;
    server_name truthtrollers.com www.truthtrollers.com;
    return 301 https://\$host\$request_uri;
}

# Main HTTPS server with maintenance mode + IP bypass
server {
    listen 443 ssl;
    server_name truthtrollers.com www.truthtrollers.com;

    ssl_certificate /etc/ssl/certs/truthtrollers.crt;
    ssl_certificate_key /etc/ssl/private/truthtrollers.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Set variable for maintenance mode
    set \$maintenance 1;

    # Bypass maintenance for whitelisted IP
    if (\$remote_addr = "$ALLOWED_IP") {
        set \$maintenance 0;
    }

    # Bypass for static assets always
    if (\$uri ~* ^/(assets|manifest.json|sw.js|favicon.ico)) {
        set \$maintenance 0;
    }

    # Show maintenance page if enabled
    if (\$maintenance = 1) {
        return 503;
    }

    error_page 503 @maintenance;
    location @maintenance {
        root /var/www/html;
        try_files /maintenance.html =503;
    }

    # ─────────────────────────────
    # Normal site config (for bypassed IPs)
    # ─────────────────────────────

    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    location /assets/ {
        proxy_pass http://localhost:3000/assets/;
    }

    location / {
        root /var/www/html;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

# Test and reload nginx
if nginx -t; then
    systemctl reload nginx
    echo ""
    echo "✓ Maintenance mode ENABLED with IP bypass"
    echo "  Your IP ($ALLOWED_IP) can access the full site"
    echo "  Everyone else sees the maintenance page"
    echo "  Run ./maintenance-off.sh to restore for everyone"
    echo ""
else
    echo ""
    echo "ERROR: nginx config test failed!"
    echo "Restoring live config..."
    cp /etc/nginx/conf.d/truthtrollers.conf.live /etc/nginx/conf.d/truthtrollers.conf
    exit 1
fi
