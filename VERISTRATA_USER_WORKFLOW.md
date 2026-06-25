# VeriStrata User Workflow

This walkthrough describes the intended end-to-end VeriStrata review process: capture content, extract claims, match evidence, review sources, submit an evaluation, and publish transparent outputs.

## 1. Capture Content

A user installs the VeriStrata browser extension.

While viewing an article, video, social media post, PDF, or other reviewable content, the user clicks the VeriStrata extension and selects **Add to VeriStrata**.

VeriStrata then:

- Captures the page, post, file, or media context.
- Archives relevant metadata, including URL, title, publisher, author, platform, timestamps, and source hints when available.
- Identifies referenced sources, citations, links, and embedded evidence candidates.
- Creates a new evaluation workspace for the captured content.

The goal is to preserve the content and its source context before the reviewer begins manual evaluation.

**Suggested image:** Browser extension menu over an article page with **Add to VeriStrata** highlighted.

## 2. Automated Claim Extraction

VeriStrata analyzes the target content and, when available, its referenced source material.

The system:

- Breaks content into atomic, self-contained claims.
- Identifies the thesis, major argument pillars, supporting claims, evidence claims, and background claims.
- Extracts source assertions from referenced documents when source claim extraction is enabled.
- Generates structured claim data for matching, review, and later evidence graph construction.

Rather than treating an article as one indivisible unit, VeriStrata transforms it into a structured set of claims that can be inspected individually.

**Suggested image:** Before/after diagram: article text on the left, extracted claim stack on the right.

## 3. Evidence Discovery and Matching

VeriStrata searches for evidence related to the extracted case claims and compares those case claims against source material.

Potential relationships include:

- Support
- Refute
- Nuance
- Context
- Unrelated or insufficient

AI-generated relationships are presented as suggestions, not final judgments. Human reviewers remain responsible for approving, editing, or rejecting evidence links.

**Suggested image:** Claim card connected to multiple source cards with colored support/refute/nuance lines.

## 4. Workspace Review

The captured content opens in the VeriStrata Workspace.

The workspace provides:

- Case overview
- Case claim inventory
- Source inventory
- Publisher and author information
- Preliminary AI evidence matches
- Document-level evidence assessments
- Current credibility and VeriMeter signals

Reviewers can inspect the argument structure, source list, and evidence status before making any final evaluation.

**Suggested image:** Full workspace screenshot showing case claims on the left, relationship map in the center, and sources on the right.

## 5. Claim-Level Evidence Analysis

Selecting a case claim opens the **Relevance Scan Modal**.

The Relevance Scan Modal displays:

- Linked source documents
- Linked source assertions
- Document-level AI assessments
- Claim-level AI-suggested evidence relationships
- Existing human-reviewed relationships
- Relevance scores, confidence indicators, and rationales

This allows reviewers to examine the evidence behind each individual case claim instead of relying on a single whole-document score.

**Suggested image:** Relevance Scan Modal with document-level assessments and matching source assertions visible.

## 6. Source Navigation and Verification

Reviewers can navigate from a document-level assessment to the corresponding source card in the workspace.

Within a source, users can:

- Inspect extracted source assertions.
- Compare source assertions against case claims.
- Create new claim relationships.
- Confirm or reject AI-generated matches.
- Add reviewer rationale and supporting context.

Every evidence relationship should remain transparent and auditable.

**Suggested image:** Click path sequence: document-level assessment -> highlighted source card -> source claims modal.

## 7. Human Evidence Rating

Human reviewers assign structured evidence relationships between case claims and source claims.

Examples include:

- Strong Support
- Moderate Support
- Weak Support
- Nuance / Context
- Weak Refutation
- Strong Refutation

Each relationship contributes to the overall evaluation while preserving the evidence trail that produced it.

**Suggested image:** Claim-link dialog showing stance, support level, confidence, and rationale fields.

## 8. Evaluation Submission

When review is complete, the evaluator submits the analysis for review.

The submission may include:

- Claim evaluations
- Evidence relationships
- Reviewer rationale
- Supporting and refuting sources
- Publisher and source credibility assessments
- Current VeriMeter values

The evaluation is not hidden behind a single opaque score. The underlying claims, evidence, sources, and reviewer reasoning remain inspectable.

**Suggested image:** Evaluation submission screen with a summary of claims, links, sources, and rationale.

## 9. Community Review and Approval

Additional reviewers can:

- Inspect the evidence trail.
- Challenge weak or incorrect relationships.
- Add missing evidence.
- Agree or disagree with conclusions.
- Improve source and claim-level ratings.

Once approved, the evaluation becomes part of VeriStrata's public knowledge base.

**Suggested image:** Community review queue showing pending evaluations, reviewer status, and evidence counts.

## 10. VeriMeter Aggregation

Approved evaluations contribute to the VeriMeter.

The VeriMeter reflects:

- Community consensus
- Evidence strength
- Source quality
- Support and refutation balance
- Confidence and uncertainty
- Reviewer credibility signals where applicable

Because every rating is tied to visible evidence, users can inspect the reasoning behind the score.

**Suggested image:** VeriMeter gauge with an expandable evidence breakdown.

## 11. Knowledge Graph and Evidence Maps

As evaluations accumulate, VeriStrata builds interconnected evidence networks.

Users can explore:

- Evidence Maps
- Claim Networks
- Publisher Relationships
- Source Relationships
- Knowledge Graphs
- Repeated claims across multiple cases

This allows users to move beyond isolated articles and examine larger evidence ecosystems.

**Suggested image:** Knowledge graph showing claims, sources, publishers, and relationships.

## 12. Publication and Reporting

Users can generate publication-ready outputs from completed evaluations.

Examples include:

- Research summaries
- Evidence reports
- Investigation dossiers
- Fact-checking briefs
- Substack-style articles
- Public case summaries

Generated reports may include:

- VeriMeter results
- Evidence Maps
- Knowledge Graph visualizations
- Supporting and refuting evidence
- Source quality analysis
- Reviewer conclusions

The result is a transparent, evidence-based review process where readers can inspect not only the conclusion, but the reasoning used to reach it.

**Suggested image:** Generated report preview with VeriMeter, claim findings, and evidence map.

## Screenshot Checklist

Capture these images for a stronger walkthrough:

1. Extension capture menu on a real article or social post.
2. New workspace immediately after scrape/import.
3. Claim stack showing thesis, pillar, pillar support, evidence, and background claims.
4. Source list with SourceCrest indicators visible.
5. Relevance Scan Modal for a claim with document-level and claim-level evidence.
6. Source card highlight after clicking a document-level assessment.
7. Source claims modal with extracted source assertions.
8. Claim-link overlay showing support/refute/nuance selection.
9. VeriMeter with evidence breakdown.
10. Knowledge graph or evidence map.
11. Final report/export preview.

## Corrections and Implementation Notes

These points should be verified or corrected in product copy depending on the current build:

- **Source claim extraction:** Source assertion extraction may be configurable. If `ENABLE_REFERENCE_CLAIM_EXTRACTION` is disabled, source documents can still receive document-level assessments, but may not always produce claim-level source assertions.
- **AI suggestions:** AI-generated evidence links should be described as suggestions until a human reviewer approves them.
- **Embeddings:** Only say embeddings are generated if the current scrape pipeline is actually generating and storing them for the relevant claim/source objects.
- **Video and social capture:** Use careful language for video/social support. The extension may capture page/post context, but transcript extraction and platform-specific metadata can vary by source.
- **SourceCrest:** SourceCrest/Admiralty evaluation can be triggered during scrape, reference scrape, enrichment, or modal actions, but it depends on publisher identity resolution and available provider data.
- **Document-level vs claim-level evidence:** A source can have a document-level support/refute/nuance assessment even when no claim-level source assertion has been linked yet. The UI should make this distinction explicit.
- **Community approval:** If the approval workflow is still evolving, describe it as "review and approval" rather than implying a fully finalized governance process.
- **Publication outputs:** If report generation is not fully productized, describe these as planned or supported export targets rather than guaranteed one-click outputs.

## Suggested Copy Corrections

Use **case claim** for claims extracted from the target content.

Use **source assertion** or **source claim** for claims extracted from supporting documents.

Use **document-level assessment** when the system judges an entire source document against a case claim.

Use **claim-level relationship** when a specific source assertion is linked to a specific case claim.

Avoid saying VeriStrata "fact-checks" automatically. More accurate language:

> VeriStrata organizes claims, discovers evidence, suggests relationships, and gives reviewers a transparent workspace for human evaluation.

