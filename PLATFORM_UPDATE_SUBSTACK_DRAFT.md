# VeriStrata Platform Update: Evidence Maps, SourceCrests, and Public Review Articles

## Headline Options

- We Are Making Evidence Inspectable
- Introducing the VeriStrata Evidence Map
- From Claims to Sources: A More Transparent VeriStrata
- What We Are Building Next: Evidence Maps, SourceCrests, and Public Reviews

## Short Substack Draft

Most fact-checking tools ask the public to trust a verdict. VeriStrata is moving in a different direction: we want people to inspect the path from an original claim, to the evidence cited for or against it, to the sources behind that evidence.

The newest platform work is about making that path visible.

### The Evidence Map

The new Evidence Map turns a review into a live claim graph. Instead of reading a single score in isolation, users can see how the reviewed article breaks into origin claims, how those claims connect to evidence claims, and which sources those evidence claims came from.

The map distinguishes support, refutation, qualification, and insufficient evidence. It also separates user-created evidence links from AI-suggested links, so people can tell the difference between human judgment and machine assistance.

This matters because a public verdict is only as strong as the evidence trail behind it. The Evidence Map gives readers a way to challenge, verify, and understand that trail.

### SourceCrests

We are also adding SourceCrests: visual source reputation marks that show source context at a glance.

A SourceCrest uses an Admiralty-style signal: a letter for source reliability and a number for the confidence or evidentiary strength of the claim. Stronger, better-established sources show differently from uncertain or unassessed ones. Unknown or legacy values display as an unassessed state rather than pretending we know more than we do.

The goal is not to reduce credibility to a decorative icon. The goal is to make source context visible everywhere it matters: in the evidence map, in source details, in claim links, and eventually in public review pages.

### Source Detail and Enrichment

Clicking into a source can now open a detail workflow for publisher and source context. This includes publisher enrichment, credibility checks, and source identity resolution work.

Under the hood, VeriStrata is improving how it remembers source identity. The platform is being prepared to track publisher domains, normalize source URLs, flag sources that need human review, and distinguish original reporting from reposts, excerpts, syndicated copies, pointers, and archive wrappers.

That is important because misinformation often travels through copies, screenshots, summaries, and reposts. A source is not just a URL. It has lineage.

### Public Review Articles

We are adding a review-article workflow that turns structured evidence into public-facing explainers.

From a review, the platform can generate a draft article, assemble evidence modules, include a snapshot of the Evidence Map, and provide Markdown that can be copied or downloaded for publication. There is also a public VeriStrata review page flow for published reviews.

This is designed for transparent publishing. A reader should not only see a conclusion; they should see the claims, the strongest refuting evidence, any supporting or qualifying evidence, source context, and a link back to the live evidence map.

### Better Claim Structure

The platform is also getting stronger internal tools for claim hierarchy. Admins can organize claims as thesis, pillar, evidence, or background claims, and can use AI-assisted suggestions to repair or improve that structure.

This is the foundation for richer reasoning maps. Today, the Evidence Map shows the current data model: content, extracted claims, evidence claims, and sources. The next step is promoting the most important claims into clearer thesis and pillar structures.

### A More Explainable Verimeter

The Verimeter is being tied more directly to evidence links and source context.

Instead of treating every link as equal, the scoring model can account for user-created claim-link strength, SourceCrest weights, reviewer reputation, and optional publisher or author ratings. Missing ratings are treated neutrally rather than punished.

This is an important principle: uncertainty should not be converted into a false negative. Where the platform does not yet know enough, it should say so.

### What This Unlocks

Together, these updates move VeriStrata closer to a public-interest review system where every conclusion can be traced.

Readers will be able to see:

- What claim is being reviewed.
- Which evidence supports it.
- Which evidence refutes it.
- Which evidence only qualifies it.
- Which sources are behind the evidence.
- Whether links were created by a user or suggested by AI.
- How source reliability affects the overall review.
- Where more human review is still needed.

That is the direction we believe public fact-checking has to go: away from opaque labels, toward inspectable reasoning.

We are still building, testing, and refining these systems. But the direction is clear. VeriStrata is becoming a platform where the public can inspect the evidence, not just consume the verdict.

## Feature Inventory for Editing

### Evidence Map

- New React Flow evidence graph at `/evidence-map` and `/evidence-map/:contentId`.
- Maps content, origin claims, evidence claims, and source nodes.
- Shows link stance: supports, refutes, qualifies, or insufficient.
- Shows provenance: user-linked versus AI-suggested.
- Includes link filter controls for all links, user links, or AI links.
- Includes counts for claims, evidence claims, sources, user links, and AI links.
- Supports focus/reframe behavior so a user can inspect a local chain.
- Includes a legend, minimap, custom edge labels, and source detail panel.
- Pulls Verimeter content and claim scores into the map.
- Can capture and save an Evidence Map snapshot into the review-article workflow.

### SourceCrest and Source Detail

- Adds `SourceCrest`, a shield-shaped source context marker.
- Displays Admiralty-style codes: reliability letter plus confidence/evidence number.
- Normalizes legacy `F` and `6` values into unassessed display states.
- Adds reusable SVG data URI generation for graph use cases.
- Adds source profile normalization across publisher, reference, rating, and candidate-claim fields.
- Source details can display publisher, author, source URL, Admiralty code, enrichment status, and credibility workflow access.

### Source Identity and Lineage

- Adds database support for publisher domain aliases.
- Adds source identity caching by normalized URL.
- Tracks source type, reliability, resolution status, and whether human review is needed.
- Adds source lineage caching for original, excerpt, repost, syndicated, pointer, archive, and unknown source relationships.
- Stores upstream URL, upstream publisher, chain depth, lineage chain, detection signals, and confidence.

### Public Review Articles

- Adds review article generation from a content review.
- Adds editable article composer with title, verdict, confidence, summary, module controls, Markdown editor, and preview.
- Adds essay draft generation.
- Adds public publishing flow with slugs.
- Adds Markdown export and download for manual Substack publishing.
- Adds Evidence Map snapshot attachment as a review module.
- Adds public article pages at `/public/reviews/:slug`.

### Claim Hierarchy

- Adds admin claim hierarchy endpoints for loading, batch updating, single-claim updating, and AI suggestion.
- Supports roles: thesis, pillar, evidence, and background.
- Stores parent claim, claim depth, centrality score, verifiability score, and claim order.
- Adds admin UI for editing and applying hierarchy suggestions.
- Feeds future evidence-map reasoning layers.

### Verimeter and Reputation

- Adds configurable Verimeter weighting policy.
- SourceCrest is an enabled scoring factor by default.
- Reviewer reputation is supported as a scoring factor.
- Publisher and author ratings are available as optional factors.
- Missing credibility data defaults to neutral weight.
- Adds admin preview for scoring policy and link-level explanation.
- Adds weighted reputation model work for content-rating governance.

## Suggested Closing Line

VeriStrata is being built around a simple standard: if a platform makes a truth claim, the public should be able to inspect the evidence path behind it.
