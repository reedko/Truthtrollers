# Nginx Configuration Update Guide

## Quick Fix for Video Upload 413 Error

The 413 error happens when nginx blocks large file uploads. Follow these steps:

### Important: Nginx Config Location
The production nginx config is at: `/etc/nginx/conf.d/truthtrollers.config`
(NOT `/etc/nginx/sites-available/truthtrollers`)

### Manual Update (Required for nginx changes)

To update nginx config on the production server:

```bash
# SSH into server
ssh truthtrollers-vps

# Edit the nginx config at the CORRECT location
sudo nano /etc/nginx/conf.d/truthtrollers.config

# Find this line (should be around line 33):
# client_max_body_size 500M;

# Make sure it says 500M (not 50M or any smaller value)

# Save and exit (Ctrl+X, then Y, then Enter)

# Test the config
sudo nginx -t

# Reload nginx
sudo nginx -s reload
```

## For Future Reference

**Production nginx config location:** `/etc/nginx/conf.d/truthtrollers.config`

The `truthtrollers.nginx.conf` file in this repo is a reference copy. Changes must be manually applied to the production server.

### Verify the Fix

After updating nginx, try uploading your video again. The 413 error should be gone.

### Troubleshooting

If you still get 413 errors:

1. Check nginx error logs:
```bash
sudo tail -f /var/log/nginx/error.log
```

2. Verify the config is actually loaded:
```bash
sudo nginx -T | grep client_max_body_size
```

Should show: `client_max_body_size 500M;`

3. Make sure the symlink exists:
```bash
ls -la /etc/nginx/sites-enabled/truthtrollers
```

Should point to `/etc/nginx/sites-available/truthtrollers`
