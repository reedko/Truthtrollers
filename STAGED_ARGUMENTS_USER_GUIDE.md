# 🎯 Staged Argument Mode - User Guide

## From Twitter Feed to Structured Argument: Complete Flow

---

## 📍 Starting Point: TT Live Feed

### Step 1: Navigate to TT Live
1. Go to your TruthTrollers dashboard
2. Click on **"TT Live"** in navigation menu
3. You'll see a feed of imported Twitter/X threads and native TT discussions

### Step 2: Choose a Thread
You have two options:

**Option A: Browse Existing Threads**
- Scroll through the feed
- Click on any thread card to open the full discussion

**Option B: Import a Twitter/X Thread**
- Click **"Import Thread"** button
- Paste Twitter/X URL
- System imports the conversation
- Thread appears in feed

---

## 🔄 The New Experience: Argument Mode

### What Changed?

**BEFORE (Traditional Commenting):**
```
User sees post → Clicks "Reply" → Types quick response → Posts
```

**AFTER (Staged Argument Mode):**
```
User sees post → Clicks "Construct Argument" → Builds structured case
→ Validates → Gets signoffs → Exports to X
```

---

## 🎨 The Staged Argument Interface

### Step 3: Open the Argument Builder

When you click on a thread, you'll see:

1. **Thread header** - Shows imported posts from X/Twitter
2. **Timeline** - Mix of imported posts and TT discussion
3. **"Construct Argument" button** (top right, blue)

Click this button to enter **Argument Mode**.

---

## 🏗️ Building Your Argument

### The Interface: Split Screen Layout

**LEFT SIDE - Input Fields:**
- Stance selector
- Claim field
- Reasoning field
- Citation manager

**RIGHT SIDE - Live Validation:**
- Civility check status
- Fallacy detection results
- Citation requirements
- Quality scores (gauges)

### Context Display (if replying)
At the top, you'll see the post you're responding to in a cyan-bordered box.

---

## ✍️ Step-by-Step: Constructing an Argument

### 1. Select Your Stance

Click the dropdown and choose:
- **Support** - You agree with the post
- **Refute** - You disagree
- **Nuance** - You add complexity/context
- **Question** - You're asking for clarification

### 2. Write Your Claim

**What is a Claim?**
- Your main thesis/position
- One clear statement
- What you're arguing for/against

**Example Good Claims:**
✅ "Electric vehicles reduce carbon emissions by 40% compared to gas cars"
✅ "The proposed tax policy would harm small businesses"
✅ "This study's methodology has three critical flaws"

**Example Bad Claims:**
❌ "I think maybe EVs are better?"
❌ "You're wrong about everything"
❌ "This is complicated"

### 3. Provide Reasoning

**What Goes Here?**
- Your logical explanation
- Step-by-step argument
- Connect premises to conclusion
- Address counterarguments

**Length:** At least 100 characters for good quality scores

**Example:**
```
The EPA's 2023 lifecycle analysis shows that even when
accounting for battery production, EVs emit 60% less CO2
over their lifetime compared to gasoline vehicles. As the
grid transitions to renewable energy, this gap will widen.
The manufacturing emissions are offset within 18 months
of average driving.
```

### 4. Add Citations

Click **"Add Citation"** in the citation panel.

**What to Include:**
- **URL** (required) - Link to your evidence
- **Quote** (optional) - Specific text from source

**Click "Add Citation"** and wait for:
- Automatic relevance scoring (0-100)
- Credibility assessment
- Visual relevance meter

**Requirement:** At least 1 citation with relevance score > 55%

**Tips for High Relevance:**
- Use primary sources when possible
- Include specific quotes
- Link directly to data/studies
- Avoid opinion pieces

---

## 🛡️ Real-Time Validation

As you type, the **RIGHT PANEL** updates automatically:

### Civility Check
- ✅ **Green checkmark** = No offensive language
- ❌ **Red X** = Flagged terms detected
  - Shows which phrases were flagged
  - Suggests revision

### Logical Validity
- ✅ **Green checkmark** = No fallacies detected
- ❌ **Red X** = Logical fallacies found
  - Expands to show which fallacy type
  - Explains why it's a fallacy
  - Shows excerpt from your text

**Common Fallacies Detected:**
- Ad Hominem (attacking person, not argument)
- Strawman (misrepresenting opponent)
- False Dichotomy (only two options when more exist)
- Appeal to Emotion (feelings over logic)
- Unsupported Claims (no evidence)

### Evidence Support
- ✅ **Green checkmark** = Citation requirement met
- ❌ **Red X** = Need more/better citations
  - Shows "0 / 1 required"
  - Lists citation relevance scores

### Quality Gauges

Three animated progress bars:

1. **Clarity** (0-100)
   - How clear and understandable
   - Penalized for vague language
   - Rewarded for structure

2. **Logical Strength** (0-100)
   - How sound your reasoning is
   - Checks for gaps in logic
   - Validates premise → conclusion

3. **Evidence Support** (0-100)
   - Quality of your citations
   - Relevance of evidence
   - Primary vs secondary sources

**Overall Quality Score:** Average of all three

---

## ⚠️ Status Indicators

### Bottom of Builder

You'll see one of these badges:

**🟢 "Ready to Submit" (Green)**
- All validation passed
- Can submit to staging

**🟠 "X Issue(s)" (Orange)**
- Some checks failed
- Lists what needs fixing
- Submit button disabled

---

## 📤 Submitting to Staging

### When You're Ready

1. All checks show green ✅
2. "Ready to Submit" badge appears
3. Click **"Submit to Staging"** button (bottom right)

### What Happens Next

Your argument is saved with status: **`approved`**

**You'll see a success message:**
```
✓ Argument Created
  Your argument has been staged for review
```

The builder closes and you return to the thread timeline.

---

## 👥 Signoff System (Consensus Phase)

### Why Signoffs?

Arguments need community consensus before going public. This ensures:
- Quality control
- Collective accountability
- Reduced impulsive posting

### How It Works

**Your approved argument appears in the thread with:**
- Full content visible
- **Signoff Panel** at the bottom
- Progress bar showing: "X / 2 signoffs"

### Other Users Can:

**1. Approve** (Green button)
- "I agree this argument is sound"
- Counts toward signoff threshold

**2. Endorse** (Blue button)
- "Strong agreement, excellent argument"
- Counts toward signoff threshold

**3. Challenge** (Orange button)
- "I dispute this argument"
- Does NOT count toward threshold
- Prompts discussion

### Optional Feedback

When signing off, users can add:
- Feedback text (visible to all)
- Suggested improvements
- Personal quality rating

### Threshold Met

When **2 signoffs** are collected:
- Status changes: `approved` → **`signed_off`**
- Badge changes to **"SIGNED OFF"** (green)
- Export button becomes available

---

## 🚀 Exporting to X/Twitter

### Final Step: Go Public

Once your argument is **signed off**:

1. **Export button** appears in the argument card
2. Click **"Export to X"**
3. Choose platform (currently supports X/Twitter)
4. System generates optimized format:

**Export Format:**
```
[Your claim]

[Key reasoning point]

Source: [citation URL]

#TruthTrollers
```

**Character limit:** Auto-formatted for X's 280 characters

### Post-Export

- Argument marked as `exported`
- Link to X post appears
- Engagement metrics tracked
- Remains in TT Live timeline

---

## 🎯 Complete Example Flow

### Scenario: Responding to Climate Post

**1. You see an imported X post:**
```
@someone: "EVs are worse for the environment
because of battery production"
```

**2. Click "Construct Argument"**

**3. Fill in the builder:**

**Stance:** Refute

**Claim:**
"Electric vehicles produce 60% less lifetime CO2 than gas cars, even with battery manufacturing"

**Reasoning:**
"The EPA's 2023 lifecycle analysis accounts for all emissions, including battery production. Manufacturing emissions are offset within 18 months. As renewable energy adoption increases, EVs become progressively cleaner while gas cars remain static."

**Citations:**
- https://epa.gov/greenvehicles/electric-vehicle-myths
- Quote: "EVs produce less than half the emissions of comparable gasoline cars"
- Relevance: 89%

**4. Validation passes:**
- ✅ Civility: Clean
- ✅ Logic: No fallacies
- ✅ Evidence: 1 citation (89% relevance)
- Quality: 84/100

**5. Submit to staging** → Status: `approved`

**6. Wait for signoffs:**
- User @truthseeker: Approves ✓
- User @sciencefan: Endorses ✓
- Threshold met (2/2)

**7. Export to X:**
System generates:
```
Electric vehicles produce 60% less lifetime CO2 than
gas cars. EPA's 2023 analysis shows battery emissions
are offset in 18 months.

Source: epa.gov/greenvehicles/myths

#TruthTrollers
```

**8. Posted to X!**
Your evidence-backed argument is now public, with community validation.

---

## 🎨 UI Visual Guide

### The HUD Aesthetic

**Minority Report Style Features:**

**Colors:**
- **Background:** Dark translucent blue-black
- **Borders:** Glowing cyan/blue gradients
- **Text:** Light cyan (labels), White (content)
- **Accents:** Animated glows on hover

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  CONSTRUCT ARGUMENT          [Replying to post]  [X]│
├──────────────────────┬──────────────────────────────┤
│                      │                              │
│  [Context Box]       │  VALIDATION STATUS           │
│                      │  ✅ Civility: Pass           │
│  Stance: [Dropdown]  │  ✅ Logic: Pass              │
│                      │  ✅ Evidence: 1 citation     │
│  Claim:              │                              │
│  [────────────────]  │  QUALITY METRICS             │
│  [────────────────]  │  Clarity:        ████░ 85   │
│                      │  Logic:          ███░░ 78   │
│  Reasoning:          │  Evidence:       ████░ 90   │
│  [────────────────]  │                              │
│  [────────────────]  │  OVERALL: 84/100             │
│  [────────────────]  │  ████████████░░░             │
│                      │                              │
│  Citations:          │  Issues: None                │
│  • url1 (89%) [X]    │                              │
│  [+ Add Citation]    │                              │
│                      │                              │
├──────────────────────┴──────────────────────────────┤
│  ⚠ Ready to Submit      [Cancel] [Submit to Stage] │
└─────────────────────────────────────────────────────┘
```

---

## ❓ FAQ

### Q: Can I edit my argument after submitting?
**A:** Only if status is `draft` or `needs_revision`. Once `approved`, you cannot edit (to preserve signoff integrity).

### Q: What if I disagree with a fallacy detection?
**A:** You can dismiss false positives. Each fallacy has a "Dismiss" button with a reason field.

### Q: How long does validation take?
**A:** Instant for civility/citations. 1-2 seconds for AI fallacy detection and quality scoring.

### Q: Can I see other users' staged arguments?
**A:** Yes! All approved arguments appear in the thread timeline with their validation scores and signoff progress.

### Q: What if I can't get 2 signoffs?
**A:** Arguments remain in `approved` status. You can revise and resubmit, or engage with the community to build support.

### Q: Can I export without signoffs?
**A:** No. The export feature only unlocks after reaching the signoff threshold (default: 2).

### Q: What platforms can I export to?
**A:** Currently X/Twitter. Future support planned for Instagram, Facebook, Reddit.

---

## 🚫 What NOT to Do

### Don't:
❌ Write arguments in all caps (hurts clarity score)
❌ Use emotional/inflammatory language (fails civility)
❌ Link to opinion pieces only (low relevance)
❌ Make claims without reasoning (fails logic)
❌ Copy-paste from elsewhere without attribution
❌ Try to bypass validation (won't work)

### Do:
✅ Be clear and concise
✅ Support claims with evidence
✅ Engage constructively with counterarguments
✅ Use primary sources
✅ Revise based on feedback
✅ Build consensus through discussion

---

## 🎓 Tips for High-Quality Arguments

### Clarity
- Use simple, direct language
- One idea per sentence
- Logical paragraph structure
- Avoid jargon unless necessary

### Logic
- State premises clearly
- Show how premises lead to conclusion
- Acknowledge limitations
- Address obvious counterarguments

### Evidence
- Primary sources > secondary
- Recent data > old data
- Peer-reviewed > blog posts
- Direct quotes strengthen relevance

---

## 🔄 The Full Journey

```
Twitter Feed
    ↓
Import Thread → TT Live Feed
    ↓
Click Thread → Thread Detail Page
    ↓
Click "Construct Argument" → Builder Opens
    ↓
Fill Form + Validate → Real-time Feedback
    ↓
Submit → Status: approved
    ↓
Get Signoffs → Progress: 0/2 → 1/2 → 2/2
    ↓
Status: signed_off → Export Available
    ↓
Export to X → Posted on Twitter
    ↓
Engagement Tracked → Visible in TT Live
```

---

## 🎯 Success Checklist

Before submitting, verify:

- [ ] Stance selected
- [ ] Claim is clear and specific
- [ ] Reasoning is detailed (100+ chars)
- [ ] At least 1 citation added
- [ ] Citation relevance > 55%
- [ ] Civility check: Green ✅
- [ ] Fallacy check: Green ✅
- [ ] Evidence check: Green ✅
- [ ] Overall quality > 50
- [ ] "Ready to Submit" badge visible

---

**Welcome to evidence-backed discourse! 🚀**

**Transform your Twitter reactions into TruthTroller arguments.**
