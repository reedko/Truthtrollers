# Theme Fusion Architecture Diagram

## Pipeline Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         CONTENT PROCESSING PIPELINE                        │
└────────────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────────┐
                         │  CONTENT + QUERY    │
                         │  (Article + Topic)  │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌──────────────────────┐        ┌──────────────────────┐
        │ CHUNK EXTRACTION     │        │ PROVISIONAL FRAME    │
        │ (Divide content)     │        │ (Prompt 4 - LLM)     │
        └──────────┬───────────┘        └──────────┬───────────┘
                   │                              │
        ┌──────────┴──────────────────────────────┘
        │
        │  (Chunks 0, 1, 2, ..., N)
        │
        ▼
┌────────────────────────────────────────────────────┐
│      PARALLEL CHUNK SURVEY (Prompt 5)              │
├────────────────────────────────────────────────────┤
│ Chunk 0  →  [Mini-Theme, Pillars, Anchors]       │
│ Chunk 1  →  [Mini-Theme, Pillars, Anchors]       │
│ Chunk 2  →  [Mini-Theme, Pillars, Anchors]       │
│ ...                                               │
│ Chunk N  →  [Mini-Theme, Pillars, Anchors]       │
└────────────────┬─────────────────────────────────┘
                 │
                 │  [Survey Results Aggregated]
                 │
                 ▼
        ┌────────────────────────┐
        │    RELATIONSHIP        │
        │    CLASSIFICATION      │
        │                        │
        │  For each chunk:       │
        │  - Direct support?     │
        │  - Contradiction?      │
        │  - Complication?       │
        │  - Alignment strength? │
        └────────┬───────────────┘
                 │
                 ▼
    ╔════════════════════════════════════════════════╗
    ║     THEME FUSION  [THIS MODULE]               ║
    ╠════════════════════════════════════════════════╣
    ║  Input:                                        ║
    ║  • Provisional frame                          ║
    ║  • All mini-themes                            ║
    ║  • Relationships to provisional frame         ║
    ║  • Pillar hints                               ║
    ║  • Candidate summaries                        ║
    ║  • Named anchors                              ║
    ║  • Repeated persuasion signals                ║
    ║                                               ║
    ║  Process:                                      ║
    ║  1. Single LLM call to fuse themes            ║
    ║  2. Schema validation                         ║
    ║  3. THEME_FUSION_COMPLETED logging            ║
    ║                                               ║
    ║  Output: Final Frame                          ║
    ║  • finalThesis                                ║
    ║  • finalStance                                ║
    ║  • themeShiftFromSeed                         ║
    ║  • finalPillars (canonical claims)            ║
    ║  • dominantNamedAnchors                       ║
    ║  • repeatedPersuasionPatterns                 ║
    ║  • coverageGaps                               ║
    ╚════════╤═════════════════════════════════════╝
             │
             │  [Final Frame → Downstream Processing]
             │
    ┌────────┴──────────────────────────────────┐
    │                                            │
    ▼                                            ▼
┌─────────────────────────┐        ┌──────────────────────┐
│  CLAIM CLUSTERING       │        │  COVERAGE ANALYSIS   │
│  (Use finalPillars)     │        │  (Use coverageGaps)  │
│                         │        │                      │
│ • Canonical claims      │        │ • Identify gaps      │
│ • Group variations      │        │ • Schedule searches  │
│ • Rank by strength      │        │ • Adjust confidence  │
└─────────┬───────────────┘        └──────────┬───────────┘
          │                                    │
          │                ┌───────────────────┘
          ▼                ▼
    ┌─────────────────────────────────────────┐
    │  DOWNSTREAM REDUCERS & NORMALIZATION    │
    │  (Use finalFrame for confidence)         │
    │                                         │
    │ • Normalize claims                      │
    │ • Deduplicate                           │
    │ • Rank by persuasion patterns           │
    │ • Prioritize anchors                    │
    └─────────┬───────────────────────────────┘
              │
              ▼
         ┌─────────────┐
         │  FINAL      │
         │  OUTPUT     │
         │  (Narrative)│
         └─────────────┘
```

## Theme Fusion Detail View

```
┌──────────────────────────────────────────────────────────────────┐
│                      THEME FUSION INTERNALS                      │
└──────────────────────────────────────────────────────────────────┘

INPUT AGGREGATION
┌────────────────────────────────────────────────────────────────┐
│ provisionalFrame      (1) ──────────────┐                      │
│ chunkMiniThemes       (N) ──────────────│                      │
│ relationshipMatrix    (N) ──────────────│                      │
│ pillarHints           (M) ──────────────│→ Template Variables  │
│ evaluationCandidates  (K) ──────────────│→ (9 substitutions)   │
│ backgroundCandidates  (L) ──────────────│                      │
│ namedAnchors          (A) ──────────────│                      │
│ repeatedSignals       (P) ──────────────┘                      │
└────────────────────────────────────────────────────────────────┘

PROMPT CONSTRUCTION
┌────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────┐                                       │
│  │  Database Prompt?   │                                       │
│  │  (via PromptManager)│                                       │
│  └────────┬────────────┘                                       │
│           │ Yes                                                │
│           ├→ Load from DB (with cache)                         │
│           │                                                    │
│  ┌────────▼────────────┐     ┌──────────────────────────────┐ │
│  │  Fill Template      │────→│  Fallback Inline Prompts    │ │
│  │  Variables          │     │  (if DB unavailable)        │ │
│  │  (9 substitutions)  │     └──────────────────────────────┘ │
│  └────────┬────────────┘                                       │
│           │                                                    │
│  ┌────────▼────────────┐                                       │
│  │  Final User Prompt  │                                       │
│  │  (with context)     │                                       │
│  └────────┬────────────┘                                       │
└───────────┼────────────────────────────────────────────────────┘

LLM ORCHESTRATION
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ System Prompt: "You are a theme fusion expert..."       │ │
│  │ User Prompt: [filled with all input context]           │ │
│  │ Temperature: 0.2 (deterministic)                        │ │
│  │ Mode: JSON response format                             │ │
│  └──────────────────┬───────────────────────────────────────┘ │
│                     │                                          │
│                     ▼                                          │
│         ┌──────────────────────────┐                           │
│         │  openAiLLM.generate()    │                           │
│         │  • Timeout: 45s default  │                           │
│         │  • Retries: 2x on failure│                           │
│         │  • Model: gpt-4o-mini    │                           │
│         └──────────┬───────────────┘                           │
│                    │                                           │
│         ┌──────────▼───────────────┐                           │
│         │  Retry Loop              │                           │
│         │  • Network error? Retry  │                           │
│         │  • Timeout? Retry        │                           │
│         │  • Bad JSON? Fail fast   │                           │
│         │  • Schema invalid? Fail  │                           │
│         └──────────┬───────────────┘                           │
│                    │                                           │
│                    ▼                                           │
│         ┌──────────────────────────┐                           │
│         │  Raw LLM Response        │                           │
│         │  {json object}           │                           │
│         └──────────┬───────────────┘                           │
│                    │                                           │
└────────────────────┼──────────────────────────────────────────┘

SCHEMA VALIDATION
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ validateFinalFrame(output)                              │ │
│  │                                                          │ │
│  │ Checks:                                                 │ │
│  │ • finalThesis: string ✓                                │ │
│  │ • finalStance: enum [endorses|rejects|mixed|unclear] ✓│ │
│  │ • themeShiftFromSeed: enum (6 types) ✓                │ │
│  │ • finalPillars: array of Pillar ✓                     │ │
│  │   - pillarText: string ✓                              │ │
│  │   - supportingChunkIndexes: number[] ✓                │ │
│  │   - representativeCandidateIds: string[] ✓            │ │
│  │   - coverageStrength: 0-1 number ✓                    │ │
│  │ • dominantNamedAnchors: string[] ✓                    │ │
│  │ • repeatedPersuasionPatterns: array of Pattern ✓      │ │
│  │   - repeatedIdea: string ✓                            │ │
│  │   - variantCandidateIds: string[] ✓                   │ │
│  │   - notes: string ✓                                   │ │
│  │ • coverageGaps: string[] ✓                            │ │
│  │                                                        │ │
│  │ → All 7 checks pass = return finalFrame               │ │
│  │ → Any check fails = throw validation error            │ │
│  └──────────┬───────────────────────────────────────────┘ │
│             │                                              │
│             ▼                                              │
│    ┌─────────────────────────┐                             │
│    │  Valid Final Frame      │                             │
│    │  (return to caller)     │                             │
│    └─────────────────────────┘                             │
└────────────────────────────────────────────────────────────┘

LOGGING & COMPLETION
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ After successful validation:                            │ │
│  │                                                          │ │
│  │ logger.log(                                             │ │
│  │   "THEME_FUSION_COMPLETED |                            │ │
│  │    pillars=3 |                                          │ │
│  │    themeShift=expanded |                                │ │
│  │    gaps=2 |                                             │ │
│  │    anchors=5 |                                          │ │
│  │    patterns=2"                                          │ │
│  │ );                                                      │ │
│  │                                                          │ │
│  │ Format: METRIC=COUNT | METRIC=VALUE | ...              │ │
│  └──────────┬───────────────────────────────────────────┘ │
│             │                                              │
│             ▼                                              │
│    ┌─────────────────────────┐                             │
│    │  Return finalFrame      │                             │
│    │  to caller              │                             │
│    └─────────────────────────┘                             │
└────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
┌──────────────────────────────────────────────────────┐
│             ERROR HANDLING FLOW                      │
└──────────────────────────────────────────────────────┘

fuseSurveyThemesIntoFrame() call
         │
         ▼
    ┌────────────────┐
    │  Load Prompt   │
    │  from DB?      │
    └────┬─────┬─────┘
         │     │
      Yes│     │No
         ▼     ▼
      [DB]  [Fallback]
         │     │
         └─────┘
           │
           ▼
    ┌─────────────────────┐
    │  Template Subst.    │
    └────────┬────────────┘
             │
             ▼
    ┌─────────────────────┐
    │  Call LLM           │
    │  (with retries)     │
    └────┬────────────────┘
         │
    ┌────┴────────────────────────────┐
    │                                 │
 Success                          Error
    │                                 │
    ▼                                 ▼
┌───────────────────┐     ┌──────────────────────┐
│  Parse JSON       │     │  Retry? (2x)         │
└────────┬──────────┘     │  - Network error     │
         │                │  - Timeout           │
         ▼                │                      │
┌───────────────────┐     │  No retry:          │
│  Validate Schema  │     │  - Bad JSON         │
└────┬──────┬───────┘     │  - 4xx error       │
     │      │             └──────────┬──────────┘
  Valid  Invalid                      │
     │      │                         ▼
     │      └──────────────→┌──────────────────┐
     │                      │  Throw Error     │
     │                      │  (caller handle) │
     ▼                      └──────────────────┘
┌─────────────┐
│  Log        │
│  COMPLETED  │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│  Return          │
│  finalFrame      │
└──────────────────┘
```

## Component Interaction

```
┌───────────────────────────────────────────────────────────┐
│               COMPONENT DEPENDENCIES                      │
└───────────────────────────────────────────────────────────┘

themeFusion.js
    ├── Imports
    │   ├── openAiLLM          (for LLM calls)
    │   ├── PromptManager      (for DB prompts)
    │   └── logger             (for logging)
    │
    ├── Exports
    │   ├── fuseSurveyThemesIntoFrame()
    │   └── validateFinalFrame()
    │
    └── Used By
        ├── Chunk orchestration layer
        ├── Evidence gathering pipeline
        └── Downstream clustering/reducers

    ┌──────────────────────────────────────┐
    │  openAiLLM.generate()                │
    │  ├── Input: system, user, schemaHint│
    │  ├── Process: gpt-4o-mini in JSON   │
    │  ├── Retry: 2x on network/timeout   │
    │  └── Output: parsed JSON object     │
    └──────────────────────────────────────┘

    ┌──────────────────────────────────────┐
    │  PromptManager.getPrompt()           │
    │  ├── Input: prompt_name             │
    │  ├── Source: llm_prompts table      │
    │  ├── Cache: 5 min TTL               │
    │  └── Fallback: if DB unavailable    │
    └──────────────────────────────────────┘

    ┌──────────────────────────────────────┐
    │  logger.log()                        │
    │  ├── Console output                 │
    │  ├── File logging                   │
    │  └── Timestamped entries            │
    └──────────────────────────────────────┘
```

## Input→Output Data Flow

```
┌──────────────────────────────────────────────────────────┐
│           THEME FUSION DATA TRANSFORMATION               │
└──────────────────────────────────────────────────────────┘

INPUT: 8 Arrays + 2 Optional Parameters
├─ provisionalFrame: string (seed frame)
├─ chunkMiniThemes: array (N mini-themes)
├─ relationshipToProvisionalFrame: array (N relationships)
├─ pillarHints: array (M hints)
├─ evaluationCandidateSummaries: array (K candidates)
├─ sourceBackgroundCandidateSummaries: array (L summaries)
├─ namedAnchors: array (A anchors)
├─ repeatedPersuasionSignals: array (P patterns)
├─ promptManager: PromptManager? (optional)
└─ timeout: number? (optional, default 45000)

      ↓ [Aggregation & Template Substitution]

LLM INPUT: Single JSON-based Prompt
├─ System message: Theme fusion expert role
├─ User message: Filled template with all inputs
├─ Schema hint: Expected JSON structure
├─ Temperature: 0.2 (deterministic)
└─ Model: gpt-4o-mini

      ↓ [LLM Processing (8-35s depending on size)]

LLM OUTPUT: Raw JSON String
└─ {...json object...}

      ↓ [Parsing & Validation]

OUTPUT: Validated FinalFrame Object
├─ finalThesis: string (consolidated thesis)
├─ finalStance: enum (endorses|rejects|mixed|unclear)
├─ themeShiftFromSeed: enum (6 categories)
├─ finalPillars: array of {
│   ├─ pillarText: string
│   ├─ supportingChunkIndexes: [0, 2, 5]
│   ├─ representativeCandidateIds: ["c0", "c3"]
│   └─ coverageStrength: 0.0-1.0
│  }
├─ dominantNamedAnchors: array of string
├─ repeatedPersuasionPatterns: array of {
│   ├─ repeatedIdea: string
│   ├─ variantCandidateIds: ["c1", "c5"]
│   └─ notes: string
│  }
└─ coverageGaps: array of string

      ↓ [Logging & Return]

LOGGING: Single structured line
└─ THEME_FUSION_COMPLETED | pillars=N | themeShift=TYPE | gaps=M | anchors=A | patterns=P

RETURN: FinalFrame object (for downstream processing)
```

## Summary

Theme fusion is a **single LLM orchestration point** that:
1. **Consolidates** chunk mini-themes into a final frame
2. **Validates** output against strict schema
3. **Logs** completion with key metrics
4. **Feeds** final frame to downstream clustering/reducers

The function is **stateless** (no persistence), **error-resilient** (retries & fallbacks), and **configurable** (database prompts).
