# ClaimFoundry Architecture Exploration Notes

## Core Principle

The unit of design is **not model calls**. It is **semantic
operations**.

A semantic operation may require: - 1 article-wide model call - N
chunk-level model calls - 1-3 batched claim calls

The objective is to ensure **each operation owns exactly one semantic
judgment**.

------------------------------------------------------------------------

# Architecture Comparison

  ------------------------------------------------------------------------
  Dimension         Structure-first   Coverage-first     Dual-lane
                    Funnel            Chunk Factory      Reconciliation
  ----------------- ----------------- ------------------ -----------------
  Primary idea      Thesis →          Chunks → Claims →  Run both
                    Subtheses →       Thesis             independently
                    Claims                               then reconcile

  Primary strength  Strong thematic   Maximum recall and Highest semantic
                    organization      coverage           robustness

  Biggest weakness  Bad thesis can    More               Highest cost and
                    poison later      duplicates/noise   complexity
                    stages                               

  Best against      Claim swamp       Top-of-article     Run variance and
                                      bias               omissions

  Typical requests  \~7--14           \~15--21           \~17--21

  Recommendation    Elegant           Best baseline      Best experimental
                                                         challenger
  ------------------------------------------------------------------------

------------------------------------------------------------------------

# Approach 1: Structure-first Funnel

## Stage 1

**Input** - Whole article

**Output** - Thesis - Subtheses - Grounding IDs

Purpose: Create article structure only.

------------------------------------------------------------------------

## Stage 2

Extract provisional claims from each subthesis region.

Returns only: - propositionId - text - grounding

------------------------------------------------------------------------

## Stage 3

Atomicity only.

Returns only: - parentId - atomic claims - grounding

No supplier. No stance. No evidence.

------------------------------------------------------------------------

## Stage 4

Supplier + article treatment only.

Returns: - claimId - supplier - treatment

------------------------------------------------------------------------

## Stage 5

Map claims to thesis.

Returns: - claimId - subthesisId - bearing

Claims remain locked.

------------------------------------------------------------------------

## Stage 6

Evidence preparation and portfolio selection.

Returns: - claimId - verification target - select/exclude

------------------------------------------------------------------------

# Approach 2: Coverage-first Chunk Factory

## Chunking

Mechanical chunks.

Rules:

-   paragraph boundaries
-   sentence fallback
-   10--15% overlap
-   preserve source unit IDs
-   no semantic chunking

Pipeline

1.  Chunk harvest
2.  Atomicity
3.  Dedupe
4.  Build thesis from inventory
5.  Supplier/treatment
6.  Portfolio

Advantages

-   Every region inspected.
-   Less introduction bias.
-   Easy auditing.
-   Parallel execution.

Disadvantages

-   More duplicate candidates.
-   Cross-boundary repair required.

------------------------------------------------------------------------

# Approach 3: Dual-lane Reconciliation

Lane A

Whole article

↓

Thesis

↓

Claims

Lane B

Mechanical chunks

↓

Claims

↓

Atomicity

↓

Reconciliation

↓

Final adjudication

Purpose

Compare two independent semantic interpretations instead of repeatedly
asking one interpretation to repair itself.

------------------------------------------------------------------------

# Historical Failure Modes

  Failure                  Proposed Structural Solution
  ------------------------ ----------------------------------------
  Top-of-article gravity   Mechanical chunk harvesting
  Crux omission            Independent lanes or region harvesting
  Compound claims          Dedicated atomicity stage
  Supplier confusion       Supplier-only annotation stage
  Stance collapse          Treatment-only stage
  Thesis rewriting         Represent bearing as graph edges
  Selection underfill      Select immutable claim IDs only
  Schema overload          Tiny schemas (2--3 fields)
  Giant JSON               Deterministic final assembly

------------------------------------------------------------------------

# Tool-backed Specialist Ideas

These are excellent candidates for model-backed tools.

## Atomicity Specialist

Input: - provisional claim - grounding

Output: - atomic claims

Trigger: Compound proposition detected.

------------------------------------------------------------------------

## Context Specialist

Purpose: Resolve pronouns, references and cross-paragraph context.

------------------------------------------------------------------------

## Attribution Specialist

Purpose: Recover attribution chain.

------------------------------------------------------------------------

## Boundary Specialist

Purpose: Reconnect claims crossing chunk boundaries.

------------------------------------------------------------------------

## Disagreement Specialist

Purpose: Compare competing semantic interpretations.

------------------------------------------------------------------------

# Guiding Design Rules

1.  One semantic judgment per stage.
2.  Tiny schemas.
3.  Lock claim text after atomicity.
4.  Later stages annotate only.
5.  Deterministic code assembles final package.
6.  Never regenerate the entire package.
7.  Relationships become edges, not rewritten claims.
8.  Repeat source text if needed.
9.  Never repeat ownership of semantic decisions.
10. Use specialist model calls only when uncertainty is localized.

------------------------------------------------------------------------

# Questions Worth Exploring

-   Should thesis be derived before or after claim discovery?
-   Should atomicity occur before supplier resolution?
-   Can chunk-first plus thesis-later outperform thesis-first?
-   Is a dual-lane adjudicator worth the additional cost?
-   Which semantic stages deserve specialist model-backed tools?
-   Where can deterministic algorithms replace model reasoning?
