# TM5 ClaimFoundry Agent Specification (Brain-First Architecture)

## Purpose

TM5 (ClaimFoundry) is an extraction agent, not a prompt.

Its purpose is to convert arbitrary source material into a deterministic, auditable claim package suitable for EvidenceRun (ER1).

The agent externalizes reasoning instead of hiding it inside a single LLM completion.

## Core Principle

LLMs choose.
Code validates.
Every intermediate artifact is persisted.

## Architecture

Article
→ Normalize
→ Semantic Inventory
→ Theme Discovery
→ Theme Assignment
→ Candidate Extraction
→ Canonicalization
→ Atomicity Critic
→ Portfolio Selection
→ Package Validation
→ CF1 Package

## The Brain

The Brain orchestrates the workflow.

Responsibilities:
- decide next stage
- invoke LLM
- invoke validators
- persist artifacts
- repair one failed stage
- stop on unrecoverable failure

The Brain does not implement extraction logic.

## Stage Summary

### Stage 0
Normalize source into source units and citation sidecars.

### Stage 1
Extract semantic inventory.
No filtering.
No synthesis.

### Stage 2
Discover thesis and major themes.

### Stage 3
Assign inventory assertions to themes.

### Stage 4
Generate grounded candidate assertions.

### Stage 5
Canonicalize duplicates while preserving distinct evidence trails.

### Stage 6
Atomicity critic.

Checks:
- one evidence-verdictable relationship
- no bundled findings
- no unsupported synthesis

Repair once.

### Stage 7
Select the minimum representative portfolio preserving thesis, themes and evidence coverage.

### Stage 8
Validate schema, grounding, attribution, uniqueness and coverage.

## Deterministic Responsibilities

- schema validation
- duplicate detection
- scoring
- persistence
- diagnostics
- identifiers

## LLM Responsibilities

- semantic discovery
- clustering
- rewriting
- splitting
- semantic proposals

## Repair Policy

Attempt
→ Validate
→ Repair once
→ Validate
→ Pass or Fail

## Persistent Artifacts

Persist every stage:
- normalized article
- semantic inventory
- themes
- candidate claims
- canonical claims
- critic report
- selection report
- final package

## Philosophy

TM5 is not a giant prompt.

It is an agentic pipeline composed of small semantic tasks coordinated by a Brain and constrained by deterministic validation.
