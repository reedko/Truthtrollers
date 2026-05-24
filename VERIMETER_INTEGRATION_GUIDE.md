# Verimeter & Reputation Integration Guide

## Overview

The Discussion Units feature integrates seamlessly with TruthTrollers' existing Verimeter scoring and user reputation systems.

---

## 🎯 How It Integrates

### 1. Content Quality → Discussion Units

```
Content Analysis Pipeline
    ↓
Claims Extraction (AI)
    ↓
Evidence Engine (Tavily/Bing search)
    ↓
Support Level Calculation
    ↓
Verimeter Score Computation
    ↓
Discussion Units Generation ← Uses verimeter data
    ↓
User Posts to X
    ↓
Engagement Tracking
    ↓
User Reputation Update
```

### 2. Data Flow

```javascript
// When generating discussion units:

const claims = await getClaims(contentId);
// Each claim has veracity_score, confidence_level

const evidence = await getEvidence(claimId);
// Each evidence has support_level (-1.2 to +1.2)

const discussionUnits = await generateUnits({
  claims,        // Source: claims table
  evidence,      // Source: reference_claim_links table
  tone: 'neutral'
});

// Units inherit quality metrics:
unit.confidence = claim.confidence_level;
unit.support_level = evidence.support_level;
unit.sources = evidence.references;
```

---

## 📊 Reputation System Updates

### New Reputation Metrics

```sql
ALTER TABLE user_reputation ADD COLUMN (
  -- Discussion posting activity
  discussion_bundles_created INT DEFAULT 0,
  discussion_units_posted INT DEFAULT 0,

  -- Engagement quality
  avg_engagement_score DECIMAL(5,2) DEFAULT 0,

  -- Existing metrics (for reference)
  content_ratings_submitted INT DEFAULT 0,
  content_ratings_approved INT DEFAULT 0,
  approval_rate DECIMAL(5,2) DEFAULT 0,
  verimeter_score DECIMAL(5,2) DEFAULT 50.0
);
```

### Reputation Calculation Enhancement

```javascript
// BEFORE (existing):
veracity_rating = (approval_rate * 0.6) + (avg_content_score * 0.4)

// AFTER (with discussion units):
veracity_rating =
  (approval_rate * 0.5) +           // Content rating approval
  (avg_content_score * 0.3) +       // Content quality
  (avg_engagement_score * 0.2)      // Social media engagement

// Where avg_engagement_score is calculated from:
engagement_per_post = (likes + retweets*2 + replies) / units_posted
avg_engagement_score = normalize(engagement_per_post, 0, 100)
```

### Reputation Bonuses

| Action | Reputation Impact | Rationale |
|--------|-------------------|-----------|
| Create discussion bundle | +1 point | Encouraging quality content creation |
| Post unit with high engagement (>50 likes) | +5 points | Valuable public education |
| Post unit with verimeter score >0.8 | +3 points | High-quality factual content |
| Post unit with balanced evidence (support + counter) | +2 points | Demonstrates nuance |
| Rate limit violation | -10 points | Spam prevention |
| Posted unit deleted by X | -5 points | Potential misinformation |

---

## 🔬 Evidence Quality Scoring

### How Support Levels Work

```javascript
// From reference_claim_links table:
support_level = stance_multiplier * confidence * quality

// Where:
stance_multiplier = {
  'support': +1.0,
  'refute': -1.0,
  'nuance': +0.5,
  'insufficient': 0.0
}

confidence = AI confidence (0.15 - 0.98)
quality = source quality score (0.0 - 1.0)

// Range: -1.2 to +1.2
```

### Discussion Unit Selection

Units are **automatically prioritized** based on:

1. **High absolute support_level** (|support_level| > 0.7)
   - Strong supporting evidence
   - Strong counter evidence

2. **High confidence** (confidence > 0.8)
   - AI is very certain

3. **High source quality** (quality > 0.8)
   - Reputable publishers (e.g., Nature, The Lancet)

```javascript
// In discussionUnitsGenerator.js:

// Select top supporting evidence
const supportEvidence = claim.references
  .filter(ref => ref.support_level > 0.3)  // Positive support
  .sort((a, b) => b.support_level - a.support_level)
  .slice(0, 2);  // Max 2 per claim

// Select top counter evidence
const counterEvidence = claim.references
  .filter(ref => ref.support_level < -0.3)  // Negative (refuting)
  .sort((a, b) => a.support_level - b.support_level)  // Most negative first
  .slice(0, 2);  // Max 2 per claim
```

---

## 📈 Engagement Potential Calculation

```javascript
// Predicts how well a discussion bundle will perform

function calculateEngagementPotential(units) {
  let totalScore = 0;

  for (const unit of units) {
    let score = 50; // Base score

    // Bonus for high confidence
    if (unit.confidence > 0.8) score += 15;

    // Bonus for sources
    if (unit.sources?.length > 0) {
      score += unit.sources.length * 10;

      // Bonus for high-quality sources
      const avgQuality = unit.sources.reduce(
        (sum, s) => sum + (s.quality || 0.5),
        0
      ) / unit.sources.length;
      score += avgQuality * 20;
    }

    // Bonus for counter evidence (shows balance)
    if (unit.unit_type === 'counter') score += 10;

    totalScore += Math.min(score, 100);
  }

  return Math.round(totalScore / units.length);
}

// Usage:
const engagementScore = calculateEngagementPotential(units);
// Returns: 0-100 score
// 0-40: Low engagement potential
// 41-70: Moderate
// 71-100: High
```

---

## 🔄 Real-Time Reputation Updates

### When User Posts to X

```sql
-- Stored procedure: record_social_post

-- 1. Update rate limits
UPDATE social_post_rate_limits
SET
  posts_in_last_hour = posts_in_last_hour + 1,
  posts_in_last_day = posts_in_last_day + 1,
  last_post_at = NOW();

-- 2. Update user reputation
UPDATE user_reputation
SET
  discussion_units_posted = discussion_units_posted + 1,
  discussion_bundles_created = discussion_bundles_created + (CASE WHEN is_bundle_start THEN 1 ELSE 0 END),
  last_activity_at = NOW();
```

### When Engagement Metrics Update

```javascript
// Fetch tweet metrics from X API
const metrics = await getTweetMetrics(tweetId);

// Update post record
await query(`
  UPDATE discussion_unit_posts
  SET
    likes_count = ?,
    retweets_count = ?,
    replies_count = ?,
    last_metrics_update = NOW()
  WHERE post_id = ?
`, [metrics.likes, metrics.retweets, metrics.replies, postId]);

// Recalculate user's avg engagement
await query(`
  UPDATE user_reputation ur
  SET avg_engagement_score = (
    SELECT AVG(likes_count + retweets_count*2 + replies_count)
    FROM discussion_unit_posts
    WHERE user_id = ur.user_id
      AND post_status = 'posted'
  )
  WHERE user_id = ?
`, [userId]);
```

---

## 🎮 Gamification Integration

### Badges & Achievements

Suggested achievements tied to discussion units:

| Badge | Requirement | Reward |
|-------|-------------|--------|
| **Fact Checker** | Post 10 discussion bundles | +50 reputation |
| **Evidence Master** | Average support_level > 0.8 | +100 reputation |
| **Viral Truth** | Post with >1000 likes | +200 reputation |
| **Balanced Voice** | Post 5 bundles with both support & counter | +75 reputation |
| **Source Diversity** | Use >20 unique sources | +50 reputation |

### Leaderboards

```sql
-- Top discussion contributors (last 30 days)
SELECT
  u.username,
  ur.discussion_bundles_created,
  ur.discussion_units_posted,
  ur.avg_engagement_score,
  ur.verimeter_score,
  SUM(dup.likes_count + dup.retweets_count*2) as total_engagement
FROM users u
JOIN user_reputation ur ON u.user_id = ur.user_id
LEFT JOIN discussion_unit_posts dup ON u.user_id = dup.user_id
WHERE dup.posted_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY u.user_id
ORDER BY total_engagement DESC
LIMIT 10;
```

---

## 🛡️ Anti-Gaming Measures

### Preventing Reputation Exploitation

1. **Engagement Decay**
   ```javascript
   // Older posts contribute less to reputation
   engagement_weight = engagement_score * decay_factor;
   decay_factor = exp(-days_since_post / 30);  // 30-day half-life
   ```

2. **Minimum Quality Threshold**
   ```javascript
   // Only count posts with minimum verimeter score
   if (content.verimeter_score < 0.3) {
     reputation_bonus = 0;  // No credit for low-quality content
   }
   ```

3. **Spam Detection**
   ```javascript
   // Flag suspicious patterns
   if (posts_in_last_hour > 5 && avg_engagement < 5) {
     flag_for_review = true;
     apply_temporary_block();
   }
   ```

4. **Source Diversity Requirement**
   ```javascript
   // Penalize using same source repeatedly
   unique_sources = new Set(units.map(u => u.sources).flat());
   if (unique_sources.size < units.length * 0.5) {
     reputation_multiplier = 0.5;  // 50% penalty
   }
   ```

---

## 📊 Analytics & Reporting

### User Dashboard Metrics

```tsx
// Components to display:

1. Discussion Activity
   - Bundles created: 23
   - Units posted: 87
   - Avg engagement: 42 likes/post

2. Quality Metrics
   - Avg verimeter score: 0.76
   - Avg support level: 0.68
   - Source diversity: 34 unique sources

3. Engagement Trends
   - [Chart] Likes over time
   - [Chart] Retweets over time
   - Top performing post

4. Reputation Impact
   - Current reputation: 1,245
   - Discussion contribution: +127 (10%)
   - Rank: #47 of 5,000 users
```

### Admin Analytics

```sql
-- Platform-wide metrics

SELECT
  COUNT(DISTINCT bundle_id) as total_bundles,
  COUNT(DISTINCT unit_id) as total_units,
  COUNT(DISTINCT post_id) as total_posts,
  SUM(likes_count) as total_likes,
  SUM(retweets_count) as total_retweets,
  AVG(CASE WHEN post_status = 'posted' THEN 1 ELSE 0 END) as success_rate,
  COUNT(DISTINCT user_id) as active_posters
FROM discussion_unit_posts
WHERE posted_at > DATE_SUB(NOW(), INTERVAL 7 DAY);
```

---

## 🔮 Future Integration Ideas

### 1. Verimeter-Driven Auto-Selection
```javascript
// Auto-select units based on verimeter confidence
if (unit.confidence > 0.9 && unit.support_level > 0.8) {
  unit.is_selected_for_posting = true;  // High-quality, auto-select
} else if (unit.confidence < 0.5) {
  unit.is_selected_for_posting = false;  // Low-quality, auto-deselect
}
```

### 2. Dynamic Tone Selection
```javascript
// Choose tone based on content verimeter
if (content.verimeter_score > 0.8) {
  recommended_tone = 'assertive';  // High confidence → assertive
} else if (content.verimeter_score < 0.4) {
  recommended_tone = 'question';  // Low confidence → inquisitive
} else {
  recommended_tone = 'neutral';  // Moderate → neutral
}
```

### 3. Collaborative Fact-Checking
```javascript
// Multiple users can contribute to same bundle
// Final verimeter score = weighted average of all contributors

const collaborativeBundleScore = contributors.reduce((score, user) => {
  return score + (user.verimeter_score * user.contribution_weight);
}, 0) / contributors.length;
```

### 4. Real-Time Fact-Check Alerts
```javascript
// Monitor X for misinformation, auto-generate discussion units
if (detectMisinformation(tweet)) {
  const bundle = await generateDiscussionUnits({
    contentId: tweet.content_id,
    tone: 'assertive',
    auto_reply: true  // Auto-post high-confidence refutations
  });
}
```

---

## 🎓 Best Practices

### For Users

1. **Quality over Quantity**
   - Focus on high verimeter content (>0.7)
   - Use diverse sources
   - Include both supporting and counter evidence

2. **Engage Authentically**
   - Don't spam-post
   - Respond to replies
   - Update posts if new evidence emerges

3. **Maintain Reputation**
   - Consistently post quality content
   - Avoid deleted/reported posts
   - Participate in peer review

### For Admins

1. **Monitor for Abuse**
   - Flag users with high post volume + low engagement
   - Review reported posts
   - Adjust rate limits as needed

2. **Optimize Algorithms**
   - A/B test tone recommendations
   - Tune engagement potential scoring
   - Refine reputation calculations

3. **Foster Community**
   - Highlight top contributors
   - Share engagement insights
   - Reward quality over volume

---

## 📚 Related Documentation

- [Verimeter Scoring Algorithm](./backend/migrations/simple-verimeter-sp-fixed.sql)
- [User Reputation System](./backend/src/routes/scores/scores.routes.js)
- [Social Media Feature](./SOCIAL_MEDIA_DISCUSSION_FEATURE.md)

---

**Last Updated**: 2026-04-17
