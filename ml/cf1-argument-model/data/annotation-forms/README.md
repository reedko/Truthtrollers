# CF1 Argument Annotation Forms

The full project plan is [ML_APPROACH_IMPLEMENTATION_PLAN.md](../../ML_APPROACH_IMPLEMENTATION_PLAN.md).

These files are evaluator-only source material for a future supervised fine-tuning dataset. They must never be loaded by CF1 extraction, prompt generation, or production inference.

There is one editable JSON form for each existing fixture:

- `CF1-F01.annotation.json` through `CF1-F09.annotation.json`

The forms contain the existing evaluation rubric as a checklist, but the actual argument annotations are intentionally blank.

There is also one chat-ready first-draft prompt per fixture under `../annotation-prompts/`. Those prompts contain the numbered article units and the neutral annotation contract, but **not** the evaluation key. Paste a prompt into a chat model, save its JSON response, and then check and transfer the reviewed annotations into the corresponding form.

## Recommended annotation order

1. Read the complete fixture article without looking at model output.
2. Record passage coverage, including both assertion-bearing and non-assertion passages.
3. Record the article orientation: theme, thesis, and thesis hinge.
4. Add every material atomic argument unit.
5. Ground every unit in exact source-unit IDs and a short verbatim excerpt.
6. Identify the assertion supplier independently of article stance.
7. Record how the article deploys the proposition.
8. Link rebuttals, qualifications, support, and internal contradictions.
9. State the proposition that external evidence would test.
10. Map the completed annotations to the prefilled rubric checklist.
11. Mark disagreements with the old key as `key_needs_revision`; do not force an annotation to satisfy a questionable key.

## Passage-coverage object

Cover the complete article with consecutive unit groups. Use narrow groups around material assertions and larger groups for context-only material.

```json
{
  "coverageId": "COV001",
  "sourceUnitIds": ["U0001", "U0002"],
  "classification": "material_assertion_present",
  "argumentUnitIds": ["AU001"],
  "basis": ""
}
```

Allowed classifications:

- `material_assertion_present`
- `no_material_assertion`
- `mixed`
- `duplicate_expression`
- `uncertain`

## Argument-unit object

Copy this object into the form's `argumentUnits` array for each material proposition:

```json
{
  "argumentUnitId": "AU001",
  "grounding": {
    "sourceUnitIds": ["U0001"],
    "verbatimExcerpt": ""
  },
  "canonicalAtomicProposition": "",
  "scopeQualifiers": [],
  "assertionSource": {
    "kind": "unknown",
    "name": "unknown",
    "sourceUnitIds": [],
    "basis": ""
  },
  "articleTreatment": {
    "contentStance": "unclear",
    "deployment": "unclear",
    "role": "unclear",
    "basis": ""
  },
  "evidenceTarget": {
    "disputedProposition": "",
    "verificationQuestion": "",
    "supportWouldRequire": [],
    "refuteWouldRequire": [],
    "qualifyWouldRequire": [],
    "warrant": ""
  },
  "portfolio": {
    "include": null,
    "basis": ""
  },
  "notes": ""
}
```

Allowed `assertionSource.kind` values:

- `article_voice`
- `person`
- `institution`
- `document`
- `study`
- `legal_party`
- `unknown`

Allowed `contentStance` values:

- `supports_thesis`
- `contradicts_thesis`
- `neutral`
- `unclear`

Allowed `deployment` values:

- `endorsed`
- `opponent_to_rebut`
- `rebutted`
- `qualified`
- `reported_neutral`
- `unclear`

Allowed `role` values:

- `pillar`
- `pillar_support`
- `opponent_claim`
- `rebuttal`
- `qualification`
- `context`
- `unclear`

## Relation object

Copy this object into `relations`:

```json
{
  "relationId": "REL001",
  "fromArgumentUnitId": "AU002",
  "type": "rebuts",
  "toArgumentUnitId": "AU001",
  "sourceUnitIds": ["U0002"],
  "basis": ""
}
```

Allowed relation types:

- `supports`
- `rebuts`
- `qualifies`
- `contradicts`
- `elaborates`
- `provides_evidence_for`
- `attributed_to`

## Adjudication discipline

- Do not merge propositions merely because they concern the same topic.
- Every source unit must appear in at least one passage-coverage entry.
- Every `material_assertion_present` passage must map to at least one argument unit.
- Retain negative passage examples; they teach assertion mining when not to emit anything.
- Preserve reporting frames in grounding, but remove them from the canonical proposition unless authorship is the proposition being tested.
- Attribution and stance are separate decisions.
- An opponent proposition remains in its original polarity. Do not rewrite it into the article's preferred conclusion.
- Use `unknown` only when the supplied article genuinely does not resolve the source.
- Training examples will be compiled only from forms whose `adjudication.status` is `approved`.

## Regenerating forms

Run from the repository root:

```bash
node ml/cf1-argument-model/tools/generate-annotation-forms.mjs
```

The generator refuses to overwrite an existing form unless passed `--force`.
