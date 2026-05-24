# Social Media Discussion Units Feature

## 🎯 Overview

The Social Media Discussion Units feature allows TruthTrollers users to:

1. **Analyze** social media posts (primarily X/Twitter)
2. **Break down** content into structured "discussion units":
   - Claims
   - Supporting Evidence
   - Counter Evidence
   - Summary
3. **Select** which units to post back to X
4. **Post** them via the X API as threaded replies

**This is NOT spam automation.** The feature is:
- ✅ **User-controlled**: Manual selection required
- ✅ **Rate-limited**: Max 10 posts/hour, 1 bundle/minute
- ✅ **Structured**: Evidence-based, fact-checked content
- ✅ **Readable**: Tweet-optimized (≤280 chars)

---

## 🏗️ Architecture

### Backend Components

```
backend/
├── migrations/
│   └── add_discussion_units_system.sql      # Database schema
├── src/
│   ├── routes/
│   │   └── discussion/
│   │       ├── index.js                     # Route aggregator
│   │       ├── discussion.routes.js         # Discussion unit CRUD & posting
│   │       └── x-auth.routes.js            # X/Twitter OAuth
│   └── services/
│       ├── discussionUnitsGenerator.js     # AI-powered unit generation
│       └── xTwitterService.js              # X API v2 integration
```

### Frontend Components

```
dashboard/src/
├── components/
│   └── SocialMediaComposer.tsx             # Main UI component
└── types.ts                                # TypeScript definitions
```

### Database Tables

1. **discussion_bundles** - Groups of discussion units per content
2. **discussion_units** - Individual claims/evidence/summaries
3. **discussion_unit_posts** - Posted tweets with engagement metrics
4. **x_auth_tokens** - OAuth tokens for X API access
5. **social_post_rate_limits** - Per-user rate limit tracking

---

## 📋 Database Schema

### Core Tables

```sql
-- Bundle of discussion units for content
CREATE TABLE discussion_bundles (
  bundle_id INT AUTO_INCREMENT PRIMARY KEY,
  content_id INT NOT NULL,
  created_by INT NOT NULL,
  original_post_url VARCHAR(1000),
  tweet_id VARCHAR(100),
  generation_status ENUM('pending', 'processing', 'completed', 'failed'),
  created_at TIMESTAMP,
  FOREIGN KEY (content_id) REFERENCES content(content_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

-- Individual discussion units
CREATE TABLE discussion_units (
  unit_id INT AUTO_INCREMENT PRIMARY KEY,
  bundle_id INT NOT NULL,
  unit_type ENUM('claim', 'support', 'counter', 'summary'),
  unit_text TEXT NOT NULL,
  unit_order INT NOT NULL,
  claim_id INT NULL,                -- Links to claims table
  reference_content_id INT NULL,    -- Links to evidence
  confidence DECIMAL(5,3),
  support_level DECIMAL(5,3),       -- -1.2 to +1.2
  sources JSON,                     -- [{"title": "...", "url": "..."}]
  is_selected_for_posting BOOLEAN DEFAULT TRUE,
  is_edited BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (bundle_id) REFERENCES discussion_bundles(bundle_id)
);

-- Posted tweets
CREATE TABLE discussion_unit_posts (
  post_id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  bundle_id INT NOT NULL,
  user_id INT NOT NULL,
  platform ENUM('twitter_x', 'facebook', 'linkedin'),
  external_post_id VARCHAR(255),    -- Tweet ID from X
  external_url VARCHAR(1000),       -- Full tweet URL
  thread_position INT,
  posted_text TEXT NOT NULL,
  post_status ENUM('pending', 'posted', 'failed'),
  likes_count INT DEFAULT 0,
  retweets_count INT DEFAULT 0,
  posted_at TIMESTAMP,
  FOREIGN KEY (unit_id) REFERENCES discussion_units(unit_id)
);

-- X/Twitter OAuth tokens
CREATE TABLE x_auth_tokens (
  token_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  x_user_id VARCHAR(100),
  x_username VARCHAR(100),
  is_valid BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Rate limiting
CREATE TABLE social_post_rate_limits (
  user_id INT NOT NULL,
  platform ENUM('twitter_x') DEFAULT 'twitter_x',
  posts_in_last_hour INT DEFAULT 0,
  bundles_posted_today INT DEFAULT 0,
  last_post_at TIMESTAMP,
  is_temporarily_blocked BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (user_id, platform)
);
```

### Stored Procedures

```sql
-- Check if user can post
CALL check_rate_limit(user_id, platform, @can_post, @reason);

-- Record successful post
CALL record_social_post(user_id, platform, is_bundle_start);
```

---

## 🔌 API Endpoints

### Discussion Units

#### Generate Discussion Units
```http
POST /api/discussion/generate
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "contentId": 123,
  "tone": "neutral" | "assertive" | "question"
}

Response:
{
  "success": true,
  "bundle_id": 456,
  "units_count": 5,
  "engagement_potential": 75,
  "units": [
    {
      "unit_type": "claim",
      "unit_text": "Climate change is accelerating...",
      "confidence": 0.92,
      "sources": [{"title": "NASA", "url": "..."}],
      "character_count": 142
    }
  ]
}
```

#### Get Existing Bundle
```http
GET /api/discussion/:contentId
Authorization: Bearer <jwt>

Response:
{
  "success": true,
  "bundle": {
    "bundle_id": 456,
    "content_id": 123,
    "units": [...]
  }
}
```

#### Update Discussion Unit
```http
PUT /api/discussion/units/:unitId
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "unit_text": "Updated tweet text...",
  "is_selected_for_posting": true
}
```

#### Post to X/Twitter
```http
POST /api/discussion/post-to-x
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "bundleId": 456,
  "originalPostUrl": "https://twitter.com/user/status/123",
  "delayBetweenPosts": 5
}

Response:
{
  "success": true,
  "posted_count": 3,
  "failed_count": 0,
  "results": [
    {
      "success": true,
      "position": 1,
      "tweet_id": "789",
      "url": "https://twitter.com/..."
    }
  ],
  "first_tweet_url": "https://twitter.com/..."
}
```

### X/Twitter Authentication

#### Connect X Account
```http
GET /api/x-auth/connect
Authorization: Bearer <jwt>

Response:
{
  "success": true,
  "auth_url": "https://twitter.com/i/oauth2/authorize?...",
  "state": "csrf_token"
}
```

#### OAuth Callback
```http
GET /api/x-auth/callback?code=...&state=...
Authorization: Bearer <jwt>

Response:
{
  "success": true,
  "x_username": "johndoe",
  "x_display_name": "John Doe"
}
```

#### Check Auth Status
```http
GET /api/x-auth/status
Authorization: Bearer <jwt>

Response:
{
  "connected": true,
  "x_username": "johndoe",
  "expires_at": "2026-05-17T12:00:00Z",
  "needs_refresh": false
}
```

#### Get Rate Limits
```http
GET /api/x-auth/rate-limits
Authorization: Bearer <jwt>

Response:
{
  "posts_in_last_hour": 3,
  "posts_in_last_day": 12,
  "can_post": true,
  "hourly_limit": 10,
  "daily_limit": 50
}
```

---

## 🎨 Frontend Usage

### Basic Integration

```tsx
import SocialMediaComposer from '@/components/SocialMediaComposer';

function TaskDetailPage({ task }) {
  const [showComposer, setShowComposer] = useState(false);

  return (
    <Box>
      <Button onClick={() => setShowComposer(true)}>
        Post Analysis to X
      </Button>

      {showComposer && (
        <Modal isOpen onClose={() => setShowComposer(false)} size="xl">
          <ModalContent>
            <SocialMediaComposer
              contentId={task.content_id}
              contentName={task.content_name}
              originalUrl={task.url}
              onClose={() => setShowComposer(false)}
            />
          </ModalContent>
        </Modal>
      )}
    </Box>
  );
}
```

### Component Props

```tsx
interface SocialMediaComposerProps {
  contentId: number;         // Content to analyze
  contentName: string;       // Display name
  originalUrl?: string;      // X post URL (for replies)
  onClose?: () => void;      // Close callback
}
```

---

## 🔐 X/Twitter API Setup

### Prerequisites

1. **X Developer Account** - Apply at [developer.twitter.com](https://developer.twitter.com)
2. **Elevated Access** - Required for posting tweets
3. **OAuth 2.0 App** - Create in X Developer Portal

### Environment Variables

Add to `.env`:

```bash
# X/Twitter API Credentials
X_CLIENT_ID=your_client_id
X_CLIENT_SECRET=your_client_secret
X_REDIRECT_URI=https://yourdomain.com/api/x-auth/callback

# OAuth 2.0 Scopes: tweet.read tweet.write users.read offline.access
```

### X App Configuration

1. **App Type**: Web App, Automated App or Bot
2. **OAuth 2.0 Settings**:
   - Enable OAuth 2.0
   - Type of App: Web App
   - Callback URL: `https://yourdomain.com/api/x-auth/callback`
3. **Permissions**: Read and Write
4. **Required Scopes**:
   - `tweet.read`
   - `tweet.write`
   - `users.read`
   - `offline.access` (for refresh tokens)

---

## 🛡️ Security & Anti-Spam

### Rate Limiting

| Limit Type | Threshold | Window |
|------------|-----------|--------|
| Posts per hour | 10 | 1 hour |
| Posts per day | 50 | 24 hours |
| Bundle cooldown | 1 | 1 minute |
| Max units per bundle | 5 | Per post |

### Safety Constraints

1. **User Approval Required**
   - All units must be manually selected
   - User can edit text before posting
   - Preview shown before posting

2. **Content Validation**
   - Max 280 characters per tweet
   - No null characters
   - Evidence sources required

3. **Rate Limit Enforcement**
   - Checked before posting
   - Temporary blocks for violations
   - Auto-reset hourly/daily

4. **Audit Trail**
   - All posts logged
   - Engagement metrics tracked
   - User reputation updated

---

## 📊 Integration with Verimeter Scoring

### Reputation Tracking

New fields added to `user_reputation` table:

```sql
ALTER TABLE user_reputation ADD COLUMN (
  discussion_units_posted INT DEFAULT 0,
  discussion_bundles_created INT DEFAULT 0,
  avg_engagement_score DECIMAL(5,2) DEFAULT 0
);
```

### Engagement Score Calculation

```javascript
// Factors:
// - Post likes/retweets
// - Evidence quality (support_level)
// - Source diversity
// - User verimeter score

engagement_score = (
  (likes * 0.3) +
  (retweets * 0.5) +
  (replies * 0.2)
) * evidence_quality_multiplier
```

### Reputation Impact

- **Posting high-quality evidence** → +reputation
- **Posts with high engagement** → +reputation
- **Spam violations** → -reputation, temp block
- **Deleted posts** → neutral (no penalty)

---

## 🧪 Example Usage Flow

### 1. User Analyzes Content

```
1. User visits task: "Vaccine efficacy study"
2. Claims extracted: 3 claims
3. Evidence gathered: 12 references (6 support, 4 refute, 2 nuance)
4. Verimeter score computed: 0.72 (somewhat trustworthy)
```

### 2. Generate Discussion Units

```javascript
// Backend generates:
[
  {
    type: "claim",
    text: "Study shows 95% vaccine efficacy in preventing severe illness",
    confidence: 0.92,
    sources: []
  },
  {
    type: "support",
    text: "✅ Supporting: Peer-reviewed trial with 40,000 participants showed 95% efficacy\n— The Lancet",
    confidence: 0.89,
    sources: [{ title: "The Lancet", url: "..." }]
  },
  {
    type: "counter",
    text: "⚠️ Counter: Real-world effectiveness lower (85%) due to variants\n— Nature Medicine",
    confidence: 0.76,
    sources: [{ title: "Nature Medicine", url: "..." }]
  },
  {
    type: "summary",
    text: "Vaccine shows strong efficacy in trials, though real-world performance varies with variants.",
    confidence: null,
    sources: []
  }
]
```

### 3. User Selects & Posts

```
1. User connects X account (OAuth flow)
2. Reviews generated units
3. Deselects 1 unit (too technical)
4. Edits claim to be more concise
5. Clicks "Post to X"
6. System posts 3-tweet thread
```

### 4. Thread Posted to X

```
Tweet 1 (reply to original post):
"Study shows 95% vaccine efficacy in preventing severe illness"

Tweet 2 (reply to Tweet 1):
"✅ Supporting: Peer-reviewed trial with 40,000 participants showed 95% efficacy
— The Lancet"

Tweet 3 (reply to Tweet 2):
"⚠️ Counter: Real-world effectiveness lower (85%) due to variants
— Nature Medicine"
```

---

## 🎛️ Configuration Options

### Tone Modes

1. **Neutral** (default)
   - Objective, factual language
   - "Evidence shows that..."
   - Best for scientific/academic content

2. **Assertive**
   - Confident, emphatic language
   - Statements end with "!"
   - Best for advocacy/awareness

3. **Question-based**
   - Frames as questions
   - "Is it true that...?"
   - Best for engagement/discussion

### Delay Between Posts

- **Min**: 2 seconds
- **Max**: 30 seconds
- **Recommended**: 5-10 seconds
- **Purpose**: Avoid spam detection

---

## 🐛 Troubleshooting

### "X account not connected"
**Solution**: Click "Connect X Account", complete OAuth flow

### "Rate limit exceeded"
**Solution**: Wait for rate limit to reset (shown in UI)

### "Tweet exceeds 280 characters"
**Solution**: Edit unit text to be shorter, or click "Regenerate" with different tone

### "Token expired"
**Solution**: Refresh token via `/api/x-auth/refresh` or re-authenticate

### "Generation failed - No claims found"
**Solution**: Run claims extraction pipeline first (`POST /api/claims/add`)

---

## 🚀 Future Enhancements

### Platform Expansion
- [ ] Facebook posting
- [ ] LinkedIn posting
- [ ] Mastodon/Bluesky support

### Advanced Features
- [ ] Scheduled posting
- [ ] A/B testing different tones
- [ ] Auto-generate images/charts
- [ ] Sentiment analysis on replies
- [ ] Suggested hashtags

### AI Improvements
- [ ] GPT-4 for higher quality summaries
- [ ] Fact-check confidence visualization
- [ ] Auto-detect optimal posting time
- [ ] Thread optimization (minimize length)

---

## 📚 Key Design Decisions

### Why separate discussion units from claims?
- **Flexibility**: Claims are verbose, units are tweet-optimized
- **Editability**: Users can customize units without affecting source claims
- **Reusability**: Same claims → different units for different tones

### Why rate limiting?
- **Anti-spam**: Prevents abuse, protects platform reputation
- **X API compliance**: Avoids hitting X's rate limits
- **User protection**: Prevents accidental spam from single user

### Why OAuth 2.0 instead of API keys?
- **Security**: Each user controls their own account
- **Permissions**: Users can revoke access anytime
- **Compliance**: X requires OAuth for user actions

### Why max 5 units per bundle?
- **Readability**: Long threads lose engagement
- **Rate limits**: Reduces risk of hitting limits
- **Quality over quantity**: Forces users to curate best evidence

---

## 🔗 Related Documentation

- [TruthTrollers Claims Pipeline](./backend/src/core/claimsEngine.js)
- [Evidence Engine](./backend/src/core/evidenceEngine.js)
- [Verimeter Scoring](./backend/migrations/simple-verimeter-sp-fixed.sql)
- [X API v2 Documentation](https://developer.twitter.com/en/docs/twitter-api)

---

## 👥 Contributors

Feature designed and implemented for TruthTrollers fact-checking platform.

**Contact**: Support via [GitHub Issues](https://github.com/truthtrollers/issues)

---

## 📄 License

Proprietary - TruthTrollers Platform
