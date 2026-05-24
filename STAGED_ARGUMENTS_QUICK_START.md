# 🚀 Staged Arguments - Quick Start Guide

## ✅ What's Working Now

### Complete Flow: Twitter → TT Live → Structured Argument

```
1. TT Live Feed Page (/ttlive)
   ↓
2. Click "Import Thread" button (top right, blue)
   ↓
3. Paste Twitter/X URL → Click "Import"
   ↓
4. Redirects to Thread Detail Page
   ↓
5. Click "Construct Argument" button
   ↓
6. Fill structured form with validation
   ↓
7. Submit → Get signoffs → Export to X
```

---

## 📍 Step-by-Step Instructions

### Step 1: Navigate to TT Live
- URL: `http://localhost:5173/ttlive` (or your dashboard URL)
- You'll see the TT Live feed page with tabs

### Step 2: Import a Twitter Thread
1. Click **"Import Thread"** button (top right, blue button with + icon)
2. A modal will open
3. Paste a Twitter/X URL like:
   ```
   https://twitter.com/username/status/1234567890
   ```
   or
   ```
   https://x.com/username/status/1234567890
   ```
4. Click **"Import"** button
5. Wait for success toast: "Thread Imported!"
6. Automatically redirects to thread detail page

### Step 3: View Imported Thread
- You're now on `/ttlive/thread/[thread-id]`
- See:
  - Thread info card (title, source URL, stats)
  - Timeline of posts (imported + TT discussions)
  - **"Construct Argument" button** (top right, blue)

### Step 4: Construct Argument
1. Click **"Construct Argument"**
2. The **Staged Argument Builder** opens with:
   - **LEFT**: Input fields (Stance, Claim, Reasoning, Citations)
   - **RIGHT**: Live validation panel
   - **Dark HUD aesthetic** with cyan glowing borders

### Step 5: Fill the Form

**Stance Dropdown:**
- Choose: Support, Refute, Nuance, or Question

**Claim Field:**
```
Example: "Electric vehicles reduce lifetime emissions by 60%"
```

**Reasoning Field:**
```
Example: "EPA lifecycle analysis shows that despite battery
manufacturing emissions, EVs produce significantly less CO2
over their operational lifetime. Grid decarbonization will
further improve this advantage."
```

**Add Citation:**
1. Scroll to Citation panel
2. Enter URL: `https://epa.gov/greenvehicles`
3. (Optional) Add quote
4. Click "Add Citation"
5. Watch auto-scoring happen
6. Relevance meter appears (need >55%)

### Step 6: Watch Validation

**RIGHT PANEL shows:**
- ✅ Civility: Pass/Fail
- ✅ Logical Validity: Pass/Fail
- ✅ Evidence Support: Pass/Fail
- Quality gauges (Clarity, Logic, Evidence)
- Overall score

**Bottom shows:**
- 🟢 "Ready to Submit" (when all pass)
- 🟠 "X Issue(s)" (when checks fail)

### Step 7: Submit
1. Ensure all checks are green ✅
2. Click **"Submit to Staging"** (bottom right, cyan button)
3. Success toast appears
4. Builder closes
5. Your argument appears in thread timeline

### Step 8: Get Signoffs (Community Phase)
- Your argument shows with **Signoff Panel**
- Other users see it and can:
  - **Approve** (counts toward threshold)
  - **Endorse** (counts toward threshold)
  - **Challenge** (doesn't count)
- Progress bar: "0 / 2" → "1 / 2" → "2 / 2"
- When threshold reached → Status: `signed_off`

### Step 9: Export to X
1. Once signed off, **Export button** appears
2. Click "Export to X"
3. System generates optimized format
4. Posted to Twitter/X with `#TruthTrollers`

---

## 🎨 UI Features You'll See

### Import Modal
- Clean modal with URL input
- Blue "Import" button
- Auto-validates URL format

### Staged Argument Builder
**Visual Style:**
- Dark blue-black translucent background
- Cyan glowing borders
- Split screen layout
- Real-time updating validation
- Animated progress bars
- HUD-style data panels

**Interactive Elements:**
- Dropdowns glow cyan on focus
- Text areas expand with content
- Citations show relevance meters
- Fallacy panels are collapsible
- Signoff panel shows participant avatars

---

## 🧪 Test It Right Now

### Quick Test Flow:

1. **Open TT Live:**
   ```
   http://localhost:5173/ttlive
   ```

2. **Click "Import Thread"**

3. **Use this test URL** (or any real Twitter thread):
   ```
   https://twitter.com/elonmusk/status/1234567890
   ```

4. **Wait for import** (may take 5-10 seconds)

5. **Thread opens automatically**

6. **Click "Construct Argument"**

7. **Fill quick test:**
   - Stance: Support
   - Claim: "This is a test argument"
   - Reasoning: "Testing the staged argument system with sufficient text to trigger quality scoring and validation checks."
   - Citation: Add `https://example.com` (will get low score but tests the system)

8. **Watch validation happen in real-time**

9. **Click "Submit to Staging"** when ready

---

## ✅ What's Been Implemented

### Backend ✅
- [x] Database tables created (4 tables)
- [x] Validation service (AI-powered)
- [x] API routes (10+ endpoints)
- [x] Import X thread functionality
- [x] Authentication middleware

### Frontend ✅
- [x] Import button on feed page
- [x] Import modal with URL input
- [x] StagedArgumentBuilder component
- [x] ArgumentValidationPanel
- [x] CitationManager
- [x] FallacyDetectorPanel
- [x] ArgumentSignoffPanel
- [x] Integration with TTLiveThreadPage
- [x] Routing configured

### Features ✅
- [x] Real-time validation
- [x] Civility filtering
- [x] Fallacy detection
- [x] Citation scoring
- [x] AI quality assessment
- [x] Signoff system
- [x] Export formatting
- [x] HUD visual design

---

## ⚠️ Known Limitations

### Current State:
1. **X Import requires authentication** - User must have connected X account
2. **Export to X is stubbed** - Generates format but doesn't actually post (needs X API integration)
3. **AI calls require OpenAI key** - Make sure `REACT_APP_OPENAI_API_KEY` is set
4. **Database must be migrated** - Run the SQL migration file first

### Still TODO:
- [ ] Actually post to X (needs X OAuth flow completion)
- [ ] Real-time updates via WebSocket
- [ ] Argument editing after submission
- [ ] Thread search/filter
- [ ] Analytics dashboard

---

## 🔧 Troubleshooting

### "Import Failed"
- **Check:** X account connected at `/social-media`
- **Check:** Valid Twitter/X URL format
- **Check:** Backend server running

### "Validation always fails"
- **Check:** OpenAI API key in `.env`
- **Check:** Backend logs for errors
- **Try:** Simpler text first

### "Can't see imported thread"
- **Check:** Feed refresh (click refresh icon)
- **Check:** Database has `ttlive_threads` table
- **Navigate:** Manually to `/ttlive/thread/[id]`

### "Construct Argument button not showing"
- **Check:** Thread is not locked
- **Check:** You're logged in
- **Try:** Hard refresh (Cmd+Shift+R)

---

## 🎯 Example Test Data

### Good Test Claim:
```
Solar energy installations have grown 400% since 2015
```

### Good Test Reasoning:
```
According to the International Energy Agency's 2023 report,
global solar capacity has expanded from 250 GW in 2015 to
over 1,000 GW today. This growth is driven by declining
costs and policy incentives. The trend is accelerating as
manufacturing scales improve.
```

### Good Test Citation:
```
URL: https://iea.org/reports/solar-pv
Quote: "Solar PV capacity reached 1 TW globally"
```

**This should score:**
- Civility: ✅ Pass
- Logic: ✅ Pass
- Evidence: ✅ Pass (high relevance)
- Quality: ~80-85/100

---

## 🚀 Ready to Use!

The complete flow is working:
1. ✅ Import Twitter thread
2. ✅ Open thread detail
3. ✅ Construct structured argument
4. ✅ Real-time validation
5. ✅ Submit to staging
6. ✅ Get community signoffs
7. ✅ Export format generated

**Start here:** `http://localhost:5173/ttlive`

**Click:** "Import Thread" (blue button, top right)

**Transform reactive tweets into structured arguments! 🎯**
