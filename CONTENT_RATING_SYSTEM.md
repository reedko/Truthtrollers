# Content Rating & Evaluation System

## Overview

This implements a 3-level reputation system for evaluating user-assembled evidence chains.

## The 3 Levels

### Level 1: Content Ratings (Evidence Chain Work)
- User creates `claim_links` for a piece of content (building evidence chain)
- When done, user submits their work → creates `content_rating` record
- Status: `pending` (needs approval)

### Level 2: Content Rating Evaluation (Peer Review)
- Other users (same/higher role) evaluate the evidence chain
- Give score: -99 (terrible) to +99 (excellent)
- Vote automatically determined: score >= 0 = approve, < 0 = reject
- **Approval requires 2+ approve votes**
- **Rejection requires 2+ reject votes**
- User earns points based on average score if approved

### Level 3: User Reputation (Track Record)
- Aggregates a user's submitted content ratings and evaluation activity
- Calculates:
  - Approval rate: % of ratings approved
  - Average score: avg across approved content ratings
  - Weighted average score: evaluator scores on approved ratings weighted by evaluator reputation snapshotted at evaluation time
  - Reputation confidence: log-scaled confidence from approved rating volume
  - Reviewer activity: log-scaled contribution from number of evaluations given
  - **Veracity rating (0-100)**: approval rate, weighted approved score, approved-volume confidence, and reviewer activity
  - Total points earned
- This is an operational trust score, not a mature or adversarially validated model.

## Database Tables

### `content_ratings`
- One record per user per content
- Tracks: completed status, approval_status, votes, avg_score, points

### `content_rating_evaluations`
- One record per evaluator per content_rating
- Tracks: score, vote (approve/reject), notes, points, evaluator reputation snapshot, evaluator weight

### `user_reputation`
- One record per user
- Aggregates: submitted/approved/rejected/pending ratings, approval rate, raw and weighted scores, confidence, reviewer activity, veracity score, points

## Installation

### 1. Run Migration
```bash
cd /Users/reedko/Desktop/Truthtrollers_root/backend
mysql -u root -pTrollers2020 truthtrollers < migrations/add_content_rating_system.sql
mysql -u root -pTrollers2020 truthtrollers < migrations/add_weighted_reputation_model.sql
```

### 2. Restart Backend
```bash
# The routes are already registered in server.js
npm run dev
```

## API Endpoints

### Submit Evidence Chain for Approval
```http
POST /api/content-rating/submit
Body: { content_id: 123 }
```
Creates/updates content_rating and marks it ready for evaluation.

### Get Pending Ratings to Evaluate
```http
GET /api/content-rating/pending
```
Returns content_ratings that need evaluation (same/lower role only).

### Get Rating Details
```http
GET /api/content-rating/:contentRatingId
```
Returns full evidence chain (claim_links) and existing evaluations.

### Submit Evaluation
```http
POST /api/content-rating/evaluate
Body: {
  content_rating_id: 456,
  score: 75,  // -99 to +99
  notes: "Good sources, well-researched"
}
```
Evaluates a content rating. Auto-approves at 2+ approvals.

### Get User Reputation
```http
GET /api/content-rating/user/:userId/reputation
```
Returns user's track record and veracity score.

### Get Leaderboard
```http
GET /api/content-rating/leaderboard
```
Top users by veracity rating.

## Workflow Example

1. **User A creates evidence chain:**
   - Adds claim_links for content_id=10
   - Clicks "Submit for Approval"
   - POST /api/content-rating/submit → content_rating created

2. **User B evaluates (first vote):**
   - Sees User A's pending rating
   - Reviews evidence chain
   - Gives score +75 → vote = approve
   - Status still "pending" (needs 2 approvals)

3. **User C evaluates (second vote):**
   - Gives score +60 → vote = approve
   - **Trigger fires:** 2 approvals reached!
   - Status → "approved"
   - User A gets points = avg(75, 60) = 67.5 points

4. **User A's reputation updates:**
   - content_ratings_approved += 1
   - avg_content_score recalculated
   - weighted_avg_content_score recalculated using evaluator reputation snapshotted at evaluation time
   - reputation_confidence updated from approved-rating volume
   - veracity_rating updated
   - The current weighted model uses:
     - 45% approval rate from submitted work
     - 35% evaluator-reputation-weighted score on approved work, damped by approved-volume confidence
     - 10% approved-rating volume confidence
     - 10% evaluation participation

## Auto-Approval Logic (Triggers)

```sql
-- After each evaluation:
- votes_approve >= 2 → approval_status = 'approved'
- votes_reject >= 2 → approval_status = 'rejected'
- Recalculate user_reputation aggregate stats
```

The weighted model is installed by `migrations/add_weighted_reputation_model.sql`. It adds `weighted_avg_content_score`, `reputation_confidence`, and `evaluator_activity_score` to `user_reputation`; adds evaluator reputation snapshot fields to `content_rating_evaluations`; then refreshes all existing user reputation rows.

## Views for Easy Querying

### `v_content_ratings_pending`
All pending content ratings with user info and claim link counts.

### `v_evaluations_detail`
All evaluations with full context (evaluator, subject, content).

### `v_reputation_leaderboard`
Users ranked by veracity rating.

## Next Steps

1. Run the migration
2. Test the API endpoints
3. Update the frontend evaluation page to use:
   - `/api/content-rating/pending` instead of `/api/evaluation/users-with-ratings`
   - Show evidence chain details (claim_links)
   - Allow scoring -99 to +99
   - Show vote count and approval status
