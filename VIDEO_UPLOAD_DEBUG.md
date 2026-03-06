# Video Upload Debugging Guide

## Current Status

### Local Dev Environment (Working)
- ✅ Backend running on https://localhost:5001
- ✅ Frontend running on https://localhost:5173
- ✅ bodyParser limit: 500MB
- ✅ Multer limit: 500MB
- ✅ Axios timeout: 600s (10 minutes)
- ✅ Axios maxContentLength: 500MB

### Production Environment (Still Failing with 413)
- ❌ Getting 413 "Content Too Large" error
- 🔍 Issue: nginx configuration not updated on server

## The Problem

The error message shows:
```
POST https://truthtrollers.com/api/api/tutorials/upload 413 (Content Too Large)
```

Note the **double `/api/api/`** in the URL - this suggests a routing issue as well!

## Two Issues to Fix

### Issue 1: Double /api/ in URL
The URL should be:
```
https://truthtrollers.com/api/tutorials/upload
```

But it's requesting:
```
https://truthtrollers.com/api/api/tutorials/upload
```

Check dashboard/src/services/api.ts - the baseURL might have `/api` in it when it shouldn't.

### Issue 2: nginx 413 Error
Even after fixing the URL, nginx needs to be configured to allow 500MB uploads.

## Quick Fixes

### Fix 1: Check API Base URL

Open `dashboard/src/services/api.ts` and verify:
```typescript
export const api = axios.create({
  baseURL: import.meta.env.VITE_BASE_URL || "http://localhost:5001",
  // Should NOT have /api at the end
```

If the env var is set wrong, check `dashboard/.env` or `dashboard/.env.production`

### Fix 2: Update nginx on Production Server

**IMPORTANT:** The nginx config is at `/etc/nginx/conf.d/truthtrollers.config` (NOT sites-available)

SSH into the server and run:
```bash
ssh truthtrollers-vps

# Edit nginx config at CORRECT location
sudo nano /etc/nginx/conf.d/truthtrollers.config

# Make sure this line exists (around line 33):
client_max_body_size 500M;

# Also check that the /api location block exists
# Save and exit (Ctrl+X, Y, Enter)

# Test config
sudo nginx -t

# Reload nginx
sudo nginx -s reload
```

## Testing Locally

1. Open https://localhost:5173 in your browser
2. Login as super_admin
3. Navigate to Admin Panel > Tutorials (or /tutorials)
4. Try uploading a small video first (< 10MB)
5. Then try a larger video (60MB)

If it works locally but fails in production, it's definitely the nginx config.

## Manual nginx Config Update

Nginx config must be manually edited on the server:

```bash
ssh truthtrollers-vps

# Edit the production config (NOT sites-available!)
sudo nano /etc/nginx/conf.d/truthtrollers.config

# Make changes, then:
sudo nginx -t
sudo nginx -s reload
```

## Check if nginx Config is Applied

```bash
ssh truthtrollers-vps
sudo nginx -T | grep client_max_body_size
```

Should output:
```
client_max_body_size 500M;
```

If it shows `1M` or `10M` or nothing, the config wasn't applied.

---

**NOTE:** The `truthtrollers.nginx.conf` file in this repo is a reference copy only. The actual production config is at `/etc/nginx/conf.d/truthtrollers.config` and must be manually edited on the server.
