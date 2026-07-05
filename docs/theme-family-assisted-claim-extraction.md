# Theme-Family-Assisted Case Claim Extraction

## Goal

Use an article's themes and familiar rhetoric families as **attention guides**
for claim extraction. The theme family should help the extractor notice important
claims, but must never supply facts or allegations that the article does not make.

## Proposed progression

### 1. Detect the article's local themes

First map what the article is arguing, for example:

- vaccine harms are being concealed;
- public-health authorities are dishonest;
- dissenting speech or films are being censored;
- scientific findings were manipulated;
- industry influence controls public institutions.

This pass should identify the thesis, argument pillars, named actors, alleged
actions, affected groups, cited studies, and key narrative transitions.

### 2. Map local themes to broader theme families

The local themes can be mapped to a reusable family such as **anti-vaccine
rhetoric**, with trope lenses including:

- corrupt or manipulated science;
- destroyed, hidden, or omitted evidence;
- government/public-health deception;
- censorship of dissent;
- pharmaceutical capture or profit motive;
- vaccines causing concealed chronic harm;
- liability immunity enabling misconduct;
- institutions endangering children while denying injury.

Other article types would use other families. An article may belong to several
families, and the classifier must retain an `unknown/other` path.

### 3. Rescan the article through those lenses

For every selected trope lens, rescan the actual article text and ask:

- Does the article make a concrete, externally testable assertion of this kind?
- Who allegedly did what, to whom or to what?
- What study, event, date, institution, quotation, or causal mechanism identifies
  the allegation?
- Is the statement a factual allegation, an interpretation, or rhetoric only?

Every extracted claim must include an exact supporting source passage. No passage
means no claim.

### 4. Atomize compound allegations

One paragraph can produce several separately testable propositions. For example:

- William Thompson said statistically significant information was omitted.
- CDC officials ordered scientists to destroy evidence.
- The 2004 analysis was changed improperly.
- Those actions concealed evidence of an MMR-autism association.

These must not be collapsed into the single vague claim “the CDC manipulated
data.” Attribution, conduct, study identity, and causal inference require separate
evaluation targets.

Likewise, the Tribeca passage could yield:

- Tribeca removed *Vaxxed* from its program.
- The removal followed pressure from specified people or organizations.
- Pharmaceutical-industry influence caused the removal.

Only propositions actually asserted by the article should be emitted.

## Suggested extraction record

Each candidate claim should carry:

- `visible_claim_text`
- `atomic_claim_text`
- `source_excerpt`
- `article_local_theme`
- `broader_theme_family`
- `trope_lens`
- `actor`, `action`, and `object`
- named study/event/document identifiers
- `claim_kind`: attribution, conduct, causal inference, study finding, or other
- centrality, verifiability, and extraction confidence

Theme metadata explains why the claim matters; it does not affect its truth or
stance.

## Selection strategy

A practical three-pass design is:

1. **Argument map:** identify thesis, pillars, and theme families.
2. **Theme-guided harvest:** extract all source-grounded atomic allegations,
   including claims that instantiate recognized trope lenses.
3. **Coverage-aware selection:** deduplicate, then reserve claim slots for each
   major argument pillar and each high-centrality concrete allegation before
   filling remaining slots by general rank.

This prevents several generic vaccine-safety claims from displacing the article's
distinctive and readily checkable allegations about destroyed evidence or Tribeca.

## Implementation options

1. **Prompt-only first pass:** add theme-family mapping, source excerpts, and
   atomicization requirements to the database-managed case-extraction prompt.
   This is the smallest experiment but remains sensitive to LLM variability.
2. **Two-call extraction:** use one bounded call for the argument/theme map and a
   second call for source-grounded claim harvesting. This should improve coverage
   but costs an additional LLM call.
3. **Maintained trope taxonomy:** store concise theme-family definitions and
   retrieval cues in configuration, retrieving only relevant families for each
   article. This is more controllable than placing a large trope catalog in every
   prompt.
4. **Evidence-history enrichment:** later retrieve previously successful claim
   patterns by semantic similarity. Historical patterns may suggest where to
   look, but the new article's text must still independently support every claim.

The recommended starting point is a small two-pass trial with a short,
configurable trope taxonomy and strict source-excerpt validation. Evaluate it by
whether it recovers predetermined pillar allegations—not merely by total claim
count.

## Trope-to-method registry

The future local taxonomy should map a detected trope not only to extraction
cues, but also to the evaluation mistakes and evidence methods commonly required
for that trope. This is an attention and methodology registry, not a table of
preassigned verdicts.

A human-readable table such as `theme_family_trope_methods` should use explicit
columns rather than a generic polymorphic payload. Suggested fields include:

- `theme_family_code`
- `trope_code`
- `trope_label`
- `trigger_entities_json`
- `trigger_patterns_json`
- `claim_split_rules_json`
- `required_checks_json`
- `invalid_inference_patterns_json`
- `preferred_evidence_types_json`
- `method_note`
- version and active-status fields

### Example: treating VAERS reports as causal or rate evidence

- **Theme family:** anti-vaccine rhetoric
- **Trope/method code:** `passive_surveillance_as_causal_evidence`
- **Typical trigger:** a claim cites VAERS counts, percentages, temporal
  clustering, or selected case reports to imply that vaccination caused an
  event or increased its incidence.
- **Important split:** preserve a descriptive database claim separately from
  the causal inference. For example, “17% of selected VAERS death reports were
  filed as occurring on the day of vaccination” is not the same proposition as
  “vaccination caused those deaths” or “day-zero clustering demonstrates an
  elevated mortality risk.”
- **Required checks:** query definition; selected vaccines, years, ages, and
  outcomes; duplicate/follow-up handling; event-date completeness; reporting
  and stimulated-reporting bias; verification status; background incidence;
  vaccinated-population denominator; an appropriate comparison group; and
  corroboration in active-surveillance or controlled epidemiological data.
- **Invalid inference warning:** raw report counts or proportions within VAERS
  do not supply incidence, relative risk, or causality. VAERS accepts reports
  without first determining that vaccination caused the event, and reports may
  be incomplete, inaccurate, coincidental, biased, or unverifiable.
- **Correct evidentiary role:** VAERS is valuable for signal detection and
  hypothesis generation. A descriptive claim about what the database contains
  may be verified from VAERS, but a causal claim requires independent evidence.

The extractor should not automatically refute a claim merely because VAERS is
cited. It should atomize the database observation and the causal/risk inference,
then attach the appropriate evaluation method to each proposition.
