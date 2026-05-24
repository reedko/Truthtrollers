# Staged Argument Mode - Deployment & Usage Guide

## Overview

The Staged Argument Mode transforms reactive commenting into structured, evidence-backed argument construction. This system implements a pre-public debate pipeline where users must:

1. Construct arguments in a structured format
2. Pass civility and logical validation checks
3. Include relevant citations
4. Obtain participant signoffs
5. Only then can export to public platforms

---

## 🚀 Deployment Steps

### 1. Database Migration

Run the database migration to create the staged arguments tables:

```bash
# Find your MySQL binary path
find /usr/local -name mysql -type f 2>/dev/null

# Run migration (adjust path as needed)
/usr/local/mysql-8.0.33-macos13-x86_64/bin/mysql -h localhost -u root -p truthtrollers < backend/migrations/add_staged_arguments_system.sql
```

**Note:** You'll be prompted for the MySQL root password (`d1Mm0v3g!` from .env)

This will create 4 new tables:
- `ttlive_staged_arguments` - Core argument entities
- `ttlive_argument_citations` - Evidence/citations for arguments
- `ttlive_argument_fallacies` - Detected logical fallacies
- `ttlive_argument_signoffs` - Participant consensus tracking

### 2. Verify Environment Variables

Ensure your `.env` file has the OpenAI API key for validation services:

```bash
REACT_APP_OPENAI_API_KEY=sk-proj-...
```

### 3. Install Dependencies

```bash
cd backend
npm install openai

cd ../dashboard
npm install
```

### 4. Restart Backend Server

```bash
cd backend
npm run dev
```

The new routes will be mounted at `/api/ttlive/arguments/*`

### 5. Rebuild Frontend

```bash
cd dashboard
npm run build  # or npm run dev for development
```

---

## 📋 System Architecture

### Backend Components

#### 1. Database Schema
- **ttlive_staged_arguments**: Main argument storage with validation status
- **ttlive_argument_citations**: Citations with auto-scored relevance
- **ttlive_argument_fallacies**: AI-detected logical fallacies
- **ttlive_argument_signoffs**: Participant approvals/endorsements

#### 2. Validation Service (`backend/src/services/argumentValidationService.js`)
- **Civility Filter**: Detects abusive language using pattern matching + AI
- **Fallacy Detection**: Identifies 10 types of logical fallacies
- **Citation Scoring**: Evaluates relevance (0-100) of evidence
- **Quality Assessment**: Generates clarity, logic, and evidence scores

#### 3. API Routes (`backend/src/routes/ttlive/arguments.routes.js`)
- `POST /api/ttlive/arguments` - Create argument
- `GET /api/ttlive/arguments/:id` - Get argument details
- `PATCH /api/ttlive/arguments/:id` - Update argument (draft only)
- `DELETE /api/ttlive/arguments/:id` - Delete argument (draft only)
- `POST /api/ttlive/arguments/:id/citations` - Add citation
- `POST /api/ttlive/arguments/:id/signoff` - Sign off on argument
- `POST /api/ttlive/arguments/:id/export` - Export to social media

### Frontend Components

#### 1. StagedArgumentBuilder.tsx
Main HUD-style interface for constructing arguments
- Split layout: Input (left) | Validation (right)
- Real-time validation feedback
- Minority Report aesthetic

#### 2. ArgumentValidationPanel.tsx
Live validation status display
- Civility check indicator
- Fallacy detection results
- Citation requirement status
- AI quality gauges (clarity, logic, evidence)

#### 3. CitationManager.tsx
Evidence management with relevance scoring
- Add/remove citations
- Auto-score relevance
- Visual relevance meters

#### 4. FallacyDetectorPanel.tsx
Displays detected logical fallacies
- Collapsible details
- Excerpt highlighting
- Confidence scores

#### 5. ArgumentSignoffPanel.tsx
Participant consensus tracking
- Progress toward signoff threshold
- Approve/Endorse/Challenge actions
- Signoff history display

---

## 🎯 User Flow

### Step 1: User Clicks "Construct Argument"
Instead of a simple reply box, they enter the Staged Argument Builder

### Step 2: Fill in Structured Fields
1. **Stance**: Support | Refute | Nuance | Question
2. **Claim**: Primary thesis statement
3. **Reasoning**: Detailed logical argument
4. **Citations**: Add evidence with URLs

### Step 3: Real-Time Validation
As user types, the system validates:
- ✅ Civility (no abusive language)
- ✅ Logic (no fallacies)
- ✅ Evidence (≥1 citation with relevance >55%)

### Step 4: AI Quality Scoring
System generates scores:
- **Clarity** (0-100): How understandable
- **Logical Strength** (0-100): How sound
- **Evidence Support** (0-100): How well-supported

### Step 5: Approval Status
- **needs_revision**: Validation failed → must fix issues
- **approved**: All checks passed → ready for signoffs
- **signed_off**: Threshold met → ready for export

### Step 6: Participant Signoffs
Other users can:
- **Approve**: I agree with this argument
- **Endorse**: Strong support
- **Challenge**: I dispute this

When threshold reached (default: 2 signoffs) → status = `signed_off`

### Step 7: Export to X/Social Media
Only signed-off arguments can be exported
- System generates condensed social media format
- Includes claim + reasoning + citation
- Appends `#TruthTrollers` hashtag

---

## 🔧 Configuration Options

### Signoff Threshold
Adjust in `ttlive_staged_arguments` table:

```sql
UPDATE ttlive_staged_arguments
SET signoff_threshold = 3
WHERE thread_id = 'some-thread-id';
```

### Civility Patterns
Edit patterns in `argumentValidationService.js`:

```javascript
const uncivilPatterns = [
  /\b(custom|pattern|here)\b/gi,
  // Add more...
];
```

### Citation Relevance Threshold
Current: 55% (configurable in validation logic)

---

## 📊 Validation Rules

### Civility Filter
**FAIL CONDITIONS:**
- Contains offensive terms (pattern match)
- AI detects personal attacks
- Ad hominem arguments

**PASS:** Clean, respectful language

### Fallacy Detection
**DETECTED FALLACIES:**
1. Ad Hominem
2. Strawman
3. False Dichotomy
4. Appeal to Emotion
5. Appeal to Authority
6. Hasty Generalization
7. Slippery Slope
8. Circular Reasoning
9. Red Herring
10. Unsupported Claim

**FAIL:** Any non-dismissed fallacy detected
**PASS:** No fallacies OR all dismissed by user

### Citation Requirements
**MINIMUM:** 1 citation with relevance > 55%

Citation scoring considers:
- Direct support of claim
- Source credibility
- Quote relevance
- Evidence vs opinion

---

## 🎨 UI/UX Features

### Minority Report HUD Style
- Dark translucent backgrounds (`rgba(0, 20, 40, 0.95)`)
- Cyan/blue gradient borders
- Glowing effects on interactive elements
- Uppercase labels with letter-spacing
- Animated validation feedback
- Data overlays and gauges

### Color Coding
- **Green**: Passed validation
- **Orange**: Needs revision
- **Red**: Failed check
- **Cyan**: Primary UI accent
- **Blue**: Secondary accent

### Interactive Elements
- Real-time validation as user types
- Collapsible fallacy details
- Draggable citation cards
- Progress bars for signoffs
- Animated transitions

---

## 🔒 Security & Permissions

### Authentication
All argument routes require `authenticateToken` middleware

### Authorization
- **Create**: Any authenticated user
- **Edit**: Only author (draft/needs_revision only)
- **Delete**: Only author (draft only)
- **Signoff**: Any user except author
- **Export**: Only signed-off arguments

### Data Validation
- SQL injection protection via parameterized queries
- XSS prevention via React's built-in escaping
- Input sanitization on backend

---

## 🧪 Testing the System

### 1. Create a Test Argument

```bash
curl -X POST https://localhost:5001/api/ttlive/arguments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "thread_id": "some-thread-id",
    "claim": "Climate change requires immediate action",
    "stance": "support",
    "reasoning": "Scientific consensus shows rising temperatures...",
    "citations": [
      {
        "url": "https://climate.nasa.gov",
        "quote_text": "97% of climate scientists agree..."
      }
    ]
  }'
```

### 2. Check Validation Status

```bash
curl https://localhost:5001/api/ttlive/arguments/ARGUMENT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Add Signoff

```bash
curl -X POST https://localhost:5001/api/ttlive/arguments/ARGUMENT_ID/signoff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "signoff_type": "approve",
    "feedback_text": "Well-reasoned argument"
  }'
```

### 4. Export

```bash
curl -X POST https://localhost:5001/api/ttlive/arguments/ARGUMENT_ID/export \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "export_platform": "x"
  }'
```

---

## 🐛 Troubleshooting

### "Argument validation failed"
- Check OpenAI API key is valid
- Verify internet connection (AI calls)
- Check backend logs for specific error

### "Cannot create argument"
- Ensure thread_id exists in `ttlive_threads`
- Verify JWT token is valid
- Check required fields are provided

### "Civility check always fails"
- Review `flagged_terms` in response
- Check if AI detection is too strict
- Adjust patterns in validation service

### "Citation relevance too low"
- Ensure citation URL is accessible
- Add quote_text for better scoring
- Manually review relevance logic

### Signoffs not triggering sign-off status
- Check `signoff_threshold` value
- Verify signoffs are 'approve' or 'endorse' type
- Ensure argument status is 'approved' first

---

## 📈 Future Enhancements

### Phase 2 Potential Features
1. **Verimeter Integration**: Link arguments to TT's verification system
2. **Instagram/Facebook Support**: Expand beyond X/Twitter
3. **Ranked Debates**: Tournament-style argument competitions
4. **Evidence Engine**: Auto-suggest citations from TT database
5. **Collaborative Editing**: Multi-author arguments
6. **Version History**: Track argument revisions
7. **Analytics Dashboard**: Track argument quality metrics

---

## 📝 Database Maintenance

### Clean Up Old Drafts

```sql
DELETE FROM ttlive_staged_arguments
WHERE status = 'draft'
AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

### View Argument Statistics

```sql
SELECT
  status,
  COUNT(*) as count,
  AVG(overall_quality_score) as avg_quality
FROM ttlive_staged_arguments
GROUP BY status;
```

### Find Top Quality Arguments

```sql
SELECT
  argument_id,
  claim,
  overall_quality_score,
  signoff_count
FROM ttlive_staged_arguments
WHERE status = 'signed_off'
ORDER BY overall_quality_score DESC
LIMIT 10;
```

---

## 🎓 Best Practices

### For Users
1. **Be Specific**: Clear, concrete claims work best
2. **Cite Primary Sources**: Higher relevance scores
3. **Avoid Emotional Language**: Focus on logic
4. **Address Counterarguments**: Shows nuance
5. **Revise Based on Feedback**: Use signoff comments

### For Moderators
1. **Monitor Fallacy Dismissals**: Prevent abuse
2. **Adjust Thresholds**: Based on community size
3. **Review Export Formats**: Ensure quality
4. **Flag Pattern**: Watch for bad-faith actors

### For Developers
1. **Log Validation Failures**: Debug AI issues
2. **Monitor API Costs**: OpenAI usage
3. **Cache Validation Results**: Reduce redundant calls
4. **Test Edge Cases**: Empty reasoning, no citations, etc.

---

## 📞 Support & Questions

For issues or questions:
1. Check backend logs: `backend/logs/`
2. Review browser console for frontend errors
3. Test API endpoints directly via curl
4. Verify database migrations completed

---

**Built with:**
- React + TypeScript (Frontend)
- Node.js + Express (Backend)
- MySQL (Database)
- OpenAI GPT-4 (Validation AI)
- Chakra UI (Component Library)

**Status:** ✅ Ready for deployment (pending database migration)
