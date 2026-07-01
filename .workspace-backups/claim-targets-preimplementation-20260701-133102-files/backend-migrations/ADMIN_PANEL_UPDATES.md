# Admin Panel Updates - Configuration Matrix

## Overview
Updated the Configuration Matrix in the admin panel to display all newly migrated prompts and show when they're used in the fact-checking pipeline.

## Changes Made

### 1. Pipeline Visualization (New Section)
Added a visual pipeline overview showing the 7 steps of fact-checking:
- **STEP 1**: Claim Extraction (claim_extraction_*)
- **STEP 2**: Claim Properties (claim_properties_evaluation_*)
- **STEP 3**: Query Generation (evidence_query_generation_*)
- **STEP 4**: Source Quality (source_quality_evaluation_*)
- **STEP 5**: Claim Matching (claim_matching_*)
- **STEP 6**: Relevance Check (claim_relevance_assessment_*)
- **STEP 7**: Claim Triage (claim_triage_*)

Each step is color-coded and shows which prompts are used.

### 2. New Prompt Sections Added

#### Section 3: Source Quality Evaluation Prompts
- Shows: source_quality_evaluation_system, source_quality_evaluation_user
- Used by: sourceQualityScorer.js
- Purpose: Evaluates 8 dimensions of source quality (0-10 scale)
- Color: Green

#### Section 4: Claim Properties Evaluation Prompts
- Shows: claim_properties_evaluation_system, claim_properties_evaluation_user
- Used by: claimEvaluationClassifier.js
- Purpose: Scores 5 claim characteristics (0.00-1.00 scale)
- Color: Pink

#### Section 5: Claim Triage Prompts
- Shows: claim_triage_system, claim_triage_user
- Used by: claimTriageEngine.js
- Purpose: Determines if claim is worth evaluating (6 triage options)
- Color: Orange

#### Section 6: Claim Matching Prompts
- Shows: claim_matching_system, claim_matching_user
- Used by: matchClaims.js
- Purpose: Matches reference claims to task claims
- Color: Purple

#### Section 7: Claim Relevance Assessment Prompts
- Shows: claim_relevance_assessment_system, claim_relevance_assessment_user
- Used by: assessClaimRelevance.js
- Purpose: Lightweight relevance checking
- Color: Blue

### 3. Enhanced Information Display

Each section now shows:
- ✅ **Database-Driven** badge (all prompts now in DB)
- Which file uses the prompts
- What the prompts do
- Key metrics/dimensions they evaluate
- Missing prompt warnings (red badge if not in DB)

### 4. Section Renumbering

Due to new sections, the existing sections have been renumbered:
- Section 1: Claim Extraction Configuration (unchanged)
- Section 2: Evidence Query Generation Prompts (unchanged)
- **Section 3-7: NEW prompt sections** (see above)
- Section 8: Evidence Search Mode Configurations (was Section 3)
- Custom Mode Builder (at end, unchanged)

## Visual Design

Each section uses a consistent design:
- Color-coded header matching the pipeline step color
- "Database-Driven" badge in green
- Gray text showing which file uses the prompts
- Monospace font for prompt names
- Dividers separating different parts
- "MISSING IN DB" red badges if prompts aren't found

## How to View

1. Navigate to Admin Panel: https://localhost:5173/vision-dashboard
2. Click on "Evidence Operations" tab
3. Select "Configuration Matrix" (third tab)
4. Scroll to see all 8 sections + pipeline overview

## Benefits

Users can now:
- See the complete fact-checking pipeline at a glance
- Understand when each prompt is used
- Verify all prompts are in the database
- See which files use which prompts
- Understand what each prompt evaluates
- Identify missing prompts quickly

## Files Modified

- `/dashboard/src/components/admin/ConfigurationMatrix.tsx`

## Next Steps

After running `COMPLETE_SESSION_MIGRATION.sql` on production and deploying:
1. Verify all prompts show as "Database-Driven" with no "MISSING IN DB" badges
2. Check that total prompt count shows 25+ prompts
3. Confirm pipeline visualization displays correctly
4. Test that each section expands/displays properly
