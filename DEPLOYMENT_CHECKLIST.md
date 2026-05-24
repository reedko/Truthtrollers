# Social Media Discussion Feature - Deployment Checklist

## ✅ Implementation Status: COMPLETE

All code has been implemented and the server starts successfully!

---

## 📋 Pre-Deployment Steps

### 1. Database Migration

Run the SQL migration to create required tables:

```bash
mysql -u root -p truthtrollers_db < backend/migrations/add_discussion_units_system.sql
```

**Tables Created:**
- ✅ `discussion_bundles` - Groups of discussion units
- ✅ `discussion_units` - Individual claims/evidence/summaries
- ✅ `discussion_unit_posts` - Posted tweets with metrics
- ✅ `x_auth_tokens` - OAuth tokens for X API
- ✅ `social_post_rate_limits` - Rate limiting per user

**Stored Procedures:**
- ✅ `check_rate_limit(user_id, platform, @can_post, @reason)`
- ✅ `record_social_post(user_id, platform, is_bundle_start)`

**Views:**
- ✅ `user_posting_stats` - Aggregated posting statistics

---

### 2. X/Twitter API Setup

#### A. Apply for X Developer Account
1. Go to https://developer.twitter.com
2. Apply for Elevated Access (required for posting)
3. Create a new Project + App
4. Enable OAuth 2.0 in App Settings

#### B. Configure App Settings

**App Type:** Web App, Automated App or Bot

**OAuth 2.0 Settings:**
- ✅ Enable OAuth 2.0
- Type: Web App
- Callback URLs:
  - Development: `http://localhost:3000/api/x-auth/callback`
  - Production: `https://yourdomain.com/api/x-auth/callback`

**App Permissions:** Read and Write

**Required Scopes:**
- ✅ `tweet.read`
- ✅ `tweet.write`
- ✅ `users.read`
- ✅ `offline.access` (for refresh tokens)

#### C. Get API Credentials

From your X Developer Portal:
1. Copy **Client ID**
2. Copy **Client Secret**
3. Note your **Redirect URI**

---

### 3. Environment Variables

Add to `/backend/.env`:

```bash
# X/Twitter API Credentials
X_CLIENT_ID=your_x_client_id_here
X_CLIENT_SECRET=your_x_client_secret_here

# Redirect URI (must match X app settings)
# Development:
X_REDIRECT_URI=http://localhost:3000/api/x-auth/callback

# Production:
# X_REDIRECT_URI=https://truthtrollers.com/api/x-auth/callback
```

**Important:**
- Keep credentials secure (never commit to git)
- Use different credentials for dev/staging/production

---

### 4. Verify Installation

#### Test Backend Startup

```bash
cd backend
node server.js
```

**Expected Output:**
```
✅ Database connection successful
✅ Redis connected
🌐 HTTP server on http://localhost:3000
🔐 HTTPS server on https://localhost:5001
```

#### Test API Endpoints

```bash
# 1. Health check
curl http://localhost:3000/health

# 2. Check if discussion routes loaded
curl -H "Authorization: Bearer YOUR_JWT" \
  http://localhost:3000/api/x-auth/status
```

---

## 🚀 Deployment Steps

### Step 1: Deploy Backend

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies (if any new ones)
cd backend
npm install

# 3. Run database migration
mysql -u root -p truthtrollers_db < migrations/add_discussion_units_system.sql

# 4. Update .env with X API credentials
nano .env

# 5. Restart backend server
pm2 restart truthtrollers-backend
# or
npm run restart
```

### Step 2: Deploy Frontend

```bash
# 1. Ensure types are updated
cd dashboard
npm run build

# 2. Deploy built assets
# (depends on your hosting setup)
```

### Step 3: Test OAuth Flow

1. Login to TruthTrollers dashboard
2. Navigate to a task with claims
3. Click "Post to X" (or wherever you add the button)
4. Click "Connect X Account"
5. Complete OAuth flow
6. Verify connection status shows your X username

---

## 🧪 Testing Checklist

### Backend Tests

- [ ] Server starts without errors
- [ ] Database tables exist (`SHOW TABLES LIKE 'discussion_%'`)
- [ ] Stored procedures exist (`SHOW PROCEDURE STATUS WHERE Db = 'truthtrollers_db'`)
- [ ] `/api/x-auth/status` returns connection status
- [ ] `/api/discussion/generate` requires authentication

### OAuth Flow Tests

- [ ] `/api/x-auth/connect` returns auth URL
- [ ] OAuth popup opens X authorization page
- [ ] After authorization, callback saves token
- [ ] `/api/x-auth/status` shows connected
- [ ] Token refresh works when expired

### Discussion Units Tests

- [ ] Generate units from content with claims
- [ ] Units contain claim, support, counter, summary
- [ ] Unit text ≤280 characters
- [ ] Sources properly linked
- [ ] Edit unit text saves correctly
- [ ] Toggle selection works

### Posting Tests

- [ ] Rate limit check works
- [ ] Post to X creates thread
- [ ] Thread replies to original tweet (if URL provided)
- [ ] Posting updates rate limits
- [ ] Engagement metrics fetchable
- [ ] Failed posts logged correctly

---

## 🔒 Security Checklist

### Credentials
- [ ] X API credentials in `.env` (not hardcoded)
- [ ] `.env` in `.gitignore`
- [ ] Different credentials for dev/prod
- [ ] Regular credential rotation schedule

### Rate Limiting
- [ ] Rate limits enforced (10 posts/hour)
- [ ] Bundle cooldown works (1 min between bundles)
- [ ] Temporary blocks for violations
- [ ] Admin can view/adjust rate limits

### User Authentication
- [ ] All endpoints require JWT
- [ ] JWT validated on each request
- [ ] Users can only post from their own account
- [ ] Users can only see their own bundles

### Data Validation
- [ ] Tweet text validated (≤280 chars)
- [ ] No SQL injection in queries
- [ ] XSS prevention in frontend
- [ ] CSRF protection on OAuth flow

---

## 📊 Monitoring & Maintenance

### Metrics to Track

**User Engagement:**
```sql
-- Daily posting activity
SELECT
  DATE(posted_at) as date,
  COUNT(DISTINCT user_id) as active_users,
  COUNT(*) as total_posts,
  AVG(likes_count + retweets_count) as avg_engagement
FROM discussion_unit_posts
WHERE posted_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(posted_at);
```

**Platform Health:**
```sql
-- Post success rate
SELECT
  post_status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM discussion_unit_posts
GROUP BY post_status;
```

**Top Contributors:**
```sql
-- Users with highest engagement
SELECT * FROM user_posting_stats
ORDER BY avg_engagement DESC
LIMIT 10;
```

### Logs to Monitor

- Backend logs: `/backend/logs/evidence-*.log`
- X API errors: Search logs for "Post to X error"
- OAuth failures: Search logs for "X auth" or "OAuth"
- Rate limit violations: Check `social_post_rate_limits.violations_count`

### Alerts to Set Up

1. **High Error Rate**: >5% post failures
2. **OAuth Expiration**: Tokens expiring without refresh
3. **Rate Limit Abuse**: User hitting limits repeatedly
4. **Low Engagement**: Avg engagement dropping significantly
5. **Database Load**: Slow queries on discussion tables

---

## 🐛 Common Issues & Solutions

### Issue: "Cannot find module openAIClient.js"
**Solution:** ✅ FIXED - Updated to use `openAiLLM.js`

### Issue: "X account not connected"
**Cause:** User hasn't completed OAuth flow
**Solution:** User clicks "Connect X Account" and authorizes

### Issue: "Rate limit exceeded"
**Cause:** User exceeded 10 posts/hour or 1 bundle/minute
**Solution:** Wait for rate limit to reset (shown in UI)

### Issue: "Tweet exceeds 280 characters"
**Cause:** Generated unit text too long
**Solution:**
- Regenerate with different tone
- Edit unit text manually
- Check `optimizeForTwitter()` function

### Issue: "Token expired"
**Cause:** X access token expired (typically 2 hours)
**Solution:**
- Auto-refresh via `/api/x-auth/refresh`
- Or re-authenticate if refresh token missing

### Issue: "Generation failed - No claims found"
**Cause:** Content has no extracted claims
**Solution:** Run claims extraction first:
```bash
curl -X POST http://localhost:3000/api/claims/add \
  -H "Content-Type: application/json" \
  -d '{"contentId": 123}'
```

---

## 📱 Frontend Integration Examples

### Example 1: Add Button to Task Page

```tsx
// In TaskDetailPage.tsx or similar

import { useState } from 'react';
import { Modal, ModalContent, ModalOverlay, Button } from '@chakra-ui/react';
import SocialMediaComposer from '@/components/SocialMediaComposer';

function TaskDetailPage({ task }) {
  const [showComposer, setShowComposer] = useState(false);

  return (
    <Box>
      {/* Existing task UI */}

      <Button
        leftIcon={<FiTwitter />}
        colorScheme="twitter"
        onClick={() => setShowComposer(true)}
      >
        Post Analysis to X
      </Button>

      <Modal
        isOpen={showComposer}
        onClose={() => setShowComposer(false)}
        size="xl"
      >
        <ModalOverlay />
        <ModalContent maxW="800px">
          <SocialMediaComposer
            contentId={task.content_id}
            contentName={task.content_name}
            originalUrl={task.url}
            onClose={() => setShowComposer(false)}
          />
        </ModalContent>
      </Modal>
    </Box>
  );
}
```

### Example 2: Add to User Dashboard

```tsx
// In UserDashboard.tsx

function UserDashboard() {
  return (
    <VStack spacing={6}>
      {/* Existing dashboard sections */}

      <Box>
        <Heading size="md" mb={4}>Social Media Activity</Heading>
        <MyXPostsWidget />
      </Box>
    </VStack>
  );
}

function MyXPostsWidget() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch('/api/discussion/bundles/user', {
      headers: { Authorization: `Bearer ${localStorage.getItem('jwt')}` }
    })
      .then(r => r.json())
      .then(data => setStats(data));
  }, []);

  return (
    <SimpleGrid columns={3} spacing={4}>
      <Stat>
        <StatLabel>Bundles Created</StatLabel>
        <StatNumber>{stats?.bundles.length || 0}</StatNumber>
      </Stat>
      <Stat>
        <StatLabel>Total Posts</StatLabel>
        <StatNumber>{stats?.total_posts || 0}</StatNumber>
      </Stat>
      <Stat>
        <StatLabel>Avg Engagement</StatLabel>
        <StatNumber>{stats?.avg_engagement || 0}</StatNumber>
      </Stat>
    </SimpleGrid>
  );
}
```

---

## 🎯 Success Criteria

### Week 1
- [ ] 10+ users connect X accounts
- [ ] 50+ discussion bundles created
- [ ] 200+ tweets posted
- [ ] <5% error rate
- [ ] 0 spam violations

### Month 1
- [ ] 100+ active posters
- [ ] 1,000+ bundles created
- [ ] 5,000+ tweets posted
- [ ] Avg engagement >10 likes/tweet
- [ ] User reputation integration working

### Quarter 1
- [ ] 500+ active posters
- [ ] 10,000+ bundles
- [ ] Platform recognized as fact-checking source
- [ ] Featured by X as quality content creator
- [ ] Integration with trending topics

---

## 📚 Additional Resources

- **API Documentation:** `/SOCIAL_MEDIA_DISCUSSION_FEATURE.md`
- **Verimeter Integration:** `/VERIMETER_INTEGRATION_GUIDE.md`
- **X API Docs:** https://developer.twitter.com/en/docs/twitter-api
- **OAuth 2.0 Guide:** https://developer.twitter.com/en/docs/authentication/oauth-2-0

---

## 🆘 Support

**Issues:** Create GitHub issue with logs and reproduction steps

**Questions:**
- Check documentation first
- Search existing issues
- Contact dev team

**Urgent Issues:**
- Server down: Check logs, restart server
- Security breach: Revoke X credentials immediately
- Data loss: Restore from backup

---

## ✅ Final Pre-Launch Checklist

- [ ] Database migration completed successfully
- [ ] X API credentials configured
- [ ] Environment variables set correctly
- [ ] Server starts without errors
- [ ] OAuth flow tested end-to-end
- [ ] Discussion generation works
- [ ] Posting to X works
- [ ] Rate limiting enforced
- [ ] Engagement metrics tracked
- [ ] User reputation updated
- [ ] Frontend integrated
- [ ] Security review completed
- [ ] Monitoring/alerts configured
- [ ] Documentation reviewed
- [ ] Team trained on feature

---

**Deployment Date:** _________________

**Deployed By:** _________________

**Notes:**
_________________________________
_________________________________
_________________________________

---

## 🎉 You're Ready to Launch!

Once all items above are checked, you're ready to enable this feature for users. Good luck! 🚀
