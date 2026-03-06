# Production Routes Not Loading - Diagnostic Steps

## Issue
- `/api/tutorials` returns 404
- Admin panel routes likely also 404
- Suggests PM2 didn't restart properly or server has import errors

## SSH to Production and Check

```bash
ssh truthtrollers-vps

# 1. Check PM2 status
pm2 status

# 2. Check recent logs for errors
pm2 logs truthtrollers --lines 100

# 3. Check if tutorials and admin route files exist
ls -la /root/backend/src/routes/tutorials/
ls -la /root/backend/src/routes/admin/

# 4. Check server.js for the imports
grep -n "createTutorialsRouter\|createAdminRouter" /root/backend/server.js

# 5. Try to restart PM2 manually
pm2 restart truthtrollers

# 6. Watch logs in real-time for errors
pm2 logs truthtrollers --lines 0

# 7. If server crashes, check for import errors:
cd /root/backend && node server.js
# (Ctrl+C to exit if it starts successfully)
```

## Common Issues

### Issue 1: Files didn't sync
If the files are missing, the deploy might have excluded them. Run deploy again:
```bash
# On local machine
./deploy.sh
```

### Issue 2: Import path error
The import might fail if Node can't find the modules:
```bash
# On server
cd /root/backend
node -e "import('./src/routes/tutorials/tutorials.routes.js').then(() => console.log('OK')).catch(e => console.error(e))"
```

### Issue 3: Database table missing
The tutorials table might not exist:
```bash
mysql -u reedko -p truthtrollers
# Enter password when prompted

# Check if tutorial_videos table exists
SHOW TABLES LIKE 'tutorial%';
DESC tutorial_videos;
```

If the table doesn't exist, create it:
```sql
CREATE TABLE IF NOT EXISTS tutorial_videos (
  tutorial_video_id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  video_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500) NULL,
  duration_seconds INT NULL,
  category VARCHAR(100) NULL,
  order_index INT DEFAULT 0,
  uploaded_by_user_id INT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_category (category),
  INDEX idx_is_active (is_active),
  INDEX idx_uploaded_by (uploaded_by_user_id),

  FOREIGN KEY (uploaded_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Issue 4: PM2 is stuck
Sometimes PM2 gets stuck and doesn't properly restart:
```bash
# Nuclear option - stop and delete, then restart
pm2 stop truthtrollers
pm2 delete truthtrollers
cd /root/backend
pm2 start server.js --name truthtrollers
pm2 save
```

## Quick Fix

Most likely the issue is that PM2 didn't restart properly. Try:

```bash
ssh truthtrollers-vps
pm2 restart truthtrollers --update-env
pm2 logs truthtrollers
```

Look for any error messages about missing modules or import failures.
