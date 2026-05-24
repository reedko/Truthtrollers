# 🐦 Social Media Discussion Units - Quick Start

## What Is This?

A feature that lets TruthTrollers users **post fact-checked analysis to X/Twitter** as structured, evidence-based threads.

**Not spam.** User-controlled, rate-limited, source-cited content.

---

## ⚡ Quick Start (5 Minutes)

### 1. Run Migration

```bash
mysql -u root -p truthtrollers_db < backend/migrations/add_discussion_units_system.sql
```

### 2. Add X API Credentials

Add to `backend/.env`:
```bash
X_CLIENT_ID=your_client_id
X_CLIENT_SECRET=your_client_secret
X_REDIRECT_URI=http://localhost:3000/api/x-auth/callback
```

### 3. Restart Server

```bash
cd backend
npm restart
```

### 4. Test It

```bash
# Server should start successfully
curl http://localhost:3000/health
# Returns: {"status":"ok"}
```

**Done!** ✅

---

## 🎨 How Users Use It

1. **Analyze Content**: User views a task with claims and evidence
2. **Generate Units**: System creates tweet-optimized discussion units
3. **Review & Edit**: User selects which to post, edits text
4. **Connect X**: User authenticates via OAuth (one-time)
5. **Post Thread**: System posts selected units as threaded replies
6. **Track Engagement**: Likes, retweets, replies tracked automatically

---

## 📊 Example Output

**Input:** Article claiming "Vaccines cause autism"

**Generated Units:**

```
Tweet 1 (Claim):
"Studies show no link between vaccines and autism according to CDC analysis of 1.2M children"

Tweet 2 (Support):
✅ Supporting: Meta-analysis of 14 studies found no correlation between MMR vaccine and autism
— The Lancet

Tweet 3 (Counter):
⚠️ However: Original 1998 study was retracted due to data falsification and conflicts of interest
— BMJ Investigation

Tweet 4 (Summary):
Scientific consensus: No causal link between vaccines and autism. Original claim based on fraudulent research.
```

---

## 🏗️ Architecture Overview

```
User Content → Claims Extracted → Evidence Gathered → Verimeter Scored
                                         ↓
                              Discussion Units Generated
                                         ↓
                              User Reviews & Selects
                                         ↓
                              OAuth to X/Twitter
                                         ↓
                              Thread Posted as Replies
                                         ↓
                              Engagement Tracked
                                         ↓
                              User Reputation Updated
```

---

## 📂 Files Created

### Backend
```
backend/
├── migrations/
│   └── add_discussion_units_system.sql          # Database schema
├── src/
│   ├── routes/discussion/
│   │   ├── index.js                             # Route aggregator
│   │   ├── discussion.routes.js                 # Generate & post units
│   │   └── x-auth.routes.js                    # OAuth flow
│   └── services/
│       ├── discussionUnitsGenerator.js         # AI generation
│       └── xTwitterService.js                  # X API integration
```

### Frontend
```
dashboard/src/
└── components/
    └── SocialMediaComposer.tsx                 # Main UI
```

### Documentation
```
root/
├── SOCIAL_MEDIA_DISCUSSION_FEATURE.md          # Complete guide
├── VERIMETER_INTEGRATION_GUIDE.md              # Reputation integration
├── DEPLOYMENT_CHECKLIST.md                      # Pre-launch checklist
└── SOCIAL_MEDIA_FEATURE_README.md (this file)
```

---

## 🔌 API Endpoints

### Generate Units
```http
POST /api/discussion/generate
Body: { "contentId": 123, "tone": "neutral" }
```

### Post to X
```http
POST /api/discussion/post-to-x
Body: { "bundleId": 456, "originalPostUrl": "..." }
```

### Connect X Account
```http
GET /api/x-auth/connect
Returns: { "auth_url": "https://twitter.com/..." }
```

### Check Status
```http
GET /api/x-auth/status
Returns: { "connected": true, "x_username": "johndoe" }
```

**See full API docs:** `SOCIAL_MEDIA_DISCUSSION_FEATURE.md`

---

## 🛡️ Safety Features

| Feature | Purpose |
|---------|---------|
| Rate Limiting | Max 10 posts/hour, prevents spam |
| User Approval | Manual selection required for each post |
| Character Validation | Enforces 280 char limit |
| Source Citation | All evidence linked to sources |
| Audit Trail | Every post logged with engagement |
| Token Refresh | Automatic OAuth token renewal |
| Temporary Blocks | Auto-block users who violate limits |

---

## 🎯 Key Design Decisions

### Why Discussion Units?
Raw claims are too verbose for Twitter. Units are tweet-optimized (≤280 chars) while preserving meaning.

### Why Rate Limits?
- Prevents spam/abuse
- Protects platform reputation
- Complies with X API limits
- Encourages quality over quantity

### Why OAuth 2.0?
- Each user controls their own account
- Can revoke access anytime
- More secure than shared API keys
- Required by X for user actions

### Why Max 5 Units?
- Long threads lose engagement
- Forces curation of best evidence
- Reduces rate limit risk
- Improves readability

---

## 🔗 Integration Points

### Existing Systems Used

1. **Claims Extraction** → Provides source claims for units
2. **Evidence Engine** → Finds supporting/refuting references
3. **Verimeter Scoring** → Prioritizes high-quality evidence
4. **User Reputation** → Tracks posting activity & engagement
5. **Source Quality Scorer** → Filters low-quality sources

### Data Flow

```
content.claims → discussion_units.claim_id
reference_claim_links.support_level → discussion_units.support_level
claims.confidence_level → discussion_units.confidence
discussion_unit_posts.likes_count → user_reputation.avg_engagement_score
```

---

## 📈 Success Metrics

**User Engagement:**
- Active posters per week
- Avg posts per user
- Avg engagement per post

**Content Quality:**
- Avg verimeter score of posted content
- Source diversity (unique sources)
- Balance ratio (support vs counter evidence)

**Platform Health:**
- Post success rate (>95% target)
- Token refresh success
- Rate limit violations (<1%)

---

## 🐛 Troubleshooting

### Server Won't Start
```bash
# Check logs
tail -f backend/logs/evidence-*.log

# Common issue: Missing module
npm install

# Check database
mysql -u root -p -e "USE truthtrollers_db; SHOW TABLES LIKE 'discussion_%';"
```

### OAuth Not Working
```bash
# Verify .env has credentials
cat backend/.env | grep X_CLIENT

# Check X app callback URL matches
# Must be: http://localhost:3000/api/x-auth/callback
```

### Generation Fails
```bash
# Check if claims exist
curl http://localhost:3000/api/claims/123

# Run claims extraction if empty
curl -X POST http://localhost:3000/api/claims/add \
  -d '{"contentId": 123}'
```

---

## 🚀 Next Steps

1. ✅ **Test locally** - Generate units from existing content
2. ✅ **Connect X account** - Complete OAuth flow
3. ✅ **Post test thread** - Verify posting works
4. ✅ **Monitor engagement** - Check metrics update
5. 📝 **Add UI buttons** - Integrate into task pages
6. 📊 **Create dashboard** - Show user posting stats
7. 🎮 **Add gamification** - Badges for top posters
8. 🌍 **Deploy production** - Follow deployment checklist

---

## 📚 Full Documentation

- **Complete Guide:** `SOCIAL_MEDIA_DISCUSSION_FEATURE.md`
- **Reputation Integration:** `VERIMETER_INTEGRATION_GUIDE.md`
- **Deployment:** `DEPLOYMENT_CHECKLIST.md`
- **X API Docs:** https://developer.twitter.com/en/docs/twitter-api

---

## 💡 Tips

**For Best Results:**
- Post content with high verimeter scores (>0.7)
- Include both supporting AND counter evidence (shows balance)
- Use diverse sources (not all from same publisher)
- Engage with replies to your posts
- Monitor engagement and iterate on tone

**For Developers:**
- Check logs regularly: `backend/logs/`
- Monitor rate limit violations
- Track post success rate
- A/B test different tones
- Optimize engagement potential algorithm

---

## 🎉 You're Ready!

The feature is **fully implemented** and ready to use. Just run the migration, add X credentials, and start posting fact-checked content! 🚀

---

**Questions?** See full documentation or create a GitHub issue.

**Last Updated:** 2026-04-17
