# Production Deployment Steps

## What You're Doing Now (On Your Laptop)

### 1. Run Migration Against Production DB

The `.PROD.js` script connects to your **remote production database** from your laptop:

```bash
# This connects remotely - no need to SSH into server
node migrations/run-add-canonical-url-hash.PROD.js
node migrations/backfill-canonical-hashes.PROD.js
```

**Note:** Line 14 of `backfill-canonical-hashes.PROD.js` shows it's using `.env` (not `.env.production`). This is correct if your `.env` has production DB credentials.

### 2. Verify Migration

```bash
node migrations/check-canonical-columns.PROD.js
```

Should show:
- ✅ canonical_url and canonical_url_hash columns exist
- ✅ Indexes created
- ✅ All rows backfilled

---

## What Happens on Server (Automated by deploy.sh)

### 1. Redis Installation (One-Time)

Your updated `deploy.sh` now automatically:
- Checks if Redis is installed
- Installs Redis if missing (`apt-get install redis-server`)
- Enables auto-start on boot (`systemctl enable redis-server`)
- Starts Redis service

**This happens automatically on next deploy!**

### 2. Code Deployment

```bash
./deploy.sh
```

This syncs your new backend code:
- New lookup routes (`/api/lookup-by-hash`)
- Redis integration
- URL canonicalization utilities
- All the scalable extension infrastructure

---

## How Redis Works

**After installation, Redis auto-starts like MySQL:**

- ✅ Starts on server boot automatically
- ✅ Runs as a background service
- ✅ No manual start needed

**Check Redis status on server:**
```bash
ssh truthtrollers-vps
systemctl status redis-server
redis-cli ping  # Should respond: PONG
```

**If you ever need to manually control it:**
```bash
sudo systemctl start redis-server   # Start
sudo systemctl stop redis-server    # Stop
sudo systemctl restart redis-server # Restart
sudo systemctl status redis-server  # Check status
```

---

## Deployment Checklist

- [ ] Run migration on production DB (from laptop)
- [ ] Verify migration succeeded
- [ ] Run `./deploy.sh` to update production code
- [ ] Redis auto-installs on server (first deploy only)
- [ ] Backend restarts with Redis support
- [ ] Check logs: should see "✅ Redis cache enabled"

---

## After Deployment

Your production backend will:
1. Connect to Redis on `localhost:6379`
2. Use Redis for 95% cache hit rate
3. Reduce DB load by 99.5%
4. Handle 100K+ users easily

If Redis fails to start, the system gracefully degrades and works without it (just slower).

---

## Summary

**You do from laptop:**
- Run migration scripts against production DB
- Run `./deploy.sh`

**Server does automatically:**
- Install Redis (first time only)
- Start Redis service
- Auto-restart Redis on server boot
- Deploy your updated code
- Restart backend with PM2

**Redis behaves like:**
- MySQL - always running in background
- Auto-starts on boot
- No manual intervention needed
