# Public argument-mining data mapping specification

Status: input contract for general argument-mining pretraining
Target renderer: `training/cf1_sft.py`
Important: examples in this document are illustrative and are not training rows.

## 1. Purpose

Public argument-mining corpora may be used to initialize compatible general skills
before CF1 specialization. Public rows remain separate from CF1 adjudicated gold.

Recommended sequence:

1. train compatible tasks on mapped public data;
2. continue training on CF1 gold at a lower learning rate;
3. evaluate on documents unseen in either stage.

Do not mix all public and CF1 rows into one unweighted stream. A large public corpus
would overwhelm the specialized CF1 meanings of attribution, deployment, opponent
polarity, and portfolio selection.

## 2. Canonical intermediate row

Store one JSON object per line:

```json
{
  "schemaVersion": "cf1.publicMappedTaskRow.v1",
  "rowId": "pub:corpus-name:document-17:extract:003",
  "fixtureId": "pub:corpus-name:document-17",
  "task": "extract_assertions",
  "corpus": {
    "id": "corpus-name",
    "version": "1.0",
    "license": "CC-BY-4.0",
    "url": "https://example.org/corpus"
  },
  "provenance": {
    "sourceDocumentId": "document-17",
    "sourceSplit": "train",
    "annotationOrigin": "human",
    "sourceLabel": "claim",
    "mappingRule": "claim-span-to-atomic-assertion-v1",
    "mapperVersion": "1.0"
  },
  "input": {},
  "output": {}
}
```

Required invariants:

- `rowId` is globally unique.
- `fixtureId` identifies the source **document**, not the row. Every row derived from
  the same public document must have the same `fixtureId`.
- Splits are performed by `fixtureId`; passages from one document must never occur
  in both training and evaluation.
- Source-unit IDs are unique and stable within a document.
- `input` contains only information available at runtime.
- `output` contains only labels genuinely present in the public annotation.
- Evaluation keys, evidence targets, warrants, adjudication rationales, and CF1
  fixture language are not added.
- Preserve original assertion polarity. Do not rewrite an attacked proposition into
  the annotator's preferred proposition.

The `corpus` and `provenance` objects are retained for lineage but are not shown to
the model by the current CF1 renderer.

## 3. Compatible tasks

### 3.1 Assertion-bearing passage detection

```json
{
  "schemaVersion": "cf1.publicMappedTaskRow.v1",
  "rowId": "pub:demo:doc-1:detect:001",
  "fixtureId": "pub:demo:doc-1",
  "task": "detect_assertions",
  "corpus": {
    "id": "demo",
    "version": "1",
    "license": "illustrative-only",
    "url": "https://example.invalid"
  },
  "provenance": {
    "sourceDocumentId": "doc-1",
    "sourceSplit": "train",
    "annotationOrigin": "illustrative",
    "sourceLabel": "claim",
    "mappingRule": "component-presence-v1",
    "mapperVersion": "1"
  },
  "input": {
    "sourceUnits": [
      {
        "unitId": "S001",
        "text": "The trial reduced hospital admissions by 18 percent."
      }
    ]
  },
  "output": {
    "classification": "material_assertion_present"
  }
}
```

Current labels:

- `material_assertion_present`
- `no_material_assertion`

Public corpora containing only positive argument components are insufficient for
this task unless trustworthy non-argument passages from the same documents can be
added as negative examples.

### 3.2 Atomic assertion extraction

```json
{
  "schemaVersion": "cf1.publicMappedTaskRow.v1",
  "rowId": "pub:demo:doc-1:extract:001",
  "fixtureId": "pub:demo:doc-1",
  "task": "extract_assertions",
  "corpus": {
    "id": "demo",
    "version": "1",
    "license": "illustrative-only",
    "url": "https://example.invalid"
  },
  "provenance": {
    "sourceDocumentId": "doc-1",
    "sourceSplit": "train",
    "annotationOrigin": "illustrative",
    "sourceLabel": "claim",
    "mappingRule": "component-to-atomic-propositions-v1",
    "mapperVersion": "1"
  },
  "input": {
    "sourceUnits": [
      {
        "unitId": "S001",
        "text": "The trial reduced hospital admissions by 18 percent, but mortality was unchanged."
      }
    ]
  },
  "output": {
    "assertions": [
      {
        "proposition": "The trial reduced hospital admissions by 18 percent.",
        "groundingUnitIds": ["S001"],
        "scopeQualifiers": []
      },
      {
        "proposition": "The trial did not change mortality.",
        "groundingUnitIds": ["S001"],
        "scopeQualifiers": []
      }
    ]
  }
}
```

Rules:

- emit every independently testable proposition separately;
- preserve negation and modality;
- do not include annotation IDs in the output;
- do not convert a premise into a conclusion or vice versa;
- do not infer propositions absent from the annotated span.

### 3.3 Assertion attribution

Use only corpora that explicitly annotate speakers, authors, quoted sources, or
document sources.

Input:

```json
{
  "candidateId": "C001",
  "proposition": "The trial reduced hospital admissions by 18 percent.",
  "localContext": [
    {
      "unitId": "S001",
      "text": "The trial investigators reported an 18 percent reduction in admissions."
    }
  ]
}
```

Output:

```json
{
  "kind": "study",
  "name": "the trial investigators",
  "sourceUnitIds": ["S001"]
}
```

Current `kind` labels:

- `article_voice`
- `document`
- `institution`
- `legal_party`
- `person`
- `study`
- `unknown`

Do not derive attribution from a claim/premise label. If the public corpus does not
annotate the assertion supplier, it contributes no `attribute` rows.

### 3.4 Article deployment and role

This task requires document-level orientation and explicit annotation of how the
author treats a proposition. Ordinary pro/con stance labels are not automatically
compatible.

Input:

```json
{
  "candidateId": "C001",
  "proposition": "The policy reduced emissions.",
  "localContext": [
    {"unitId": "S004", "text": "Critics claim the policy reduced emissions, but the reported measurements were unchanged."}
  ],
  "orientation": {
    "theme": "Whether the policy reduced emissions.",
    "thesis": "The article argues that the policy did not reduce emissions.",
    "thesisStatus": "clear",
    "thesisHinge": {
      "proposition": "Measured emissions were unchanged after the policy.",
      "ifSupportedEffectOnThesis": "strengthens",
      "ifRefutedEffectOnThesis": "weakens"
    },
    "basisSourceUnitIds": ["S004"]
  }
}
```

Output:

```json
{
  "contentStance": "contradicts_thesis",
  "deployment": "rebutted",
  "role": "opponent_claim"
}
```

Current labels:

- `contentStance`: `supports_thesis`, `contradicts_thesis`, `neutral`
- `deployment`: `endorsed`, `opponent_to_rebut`, `qualified`, `rebutted`, `reported_neutral`
- `role`: `pillar`, `pillar_support`, `opponent_claim`, `rebuttal`, `qualification`, `context`

Only map a public stance taxonomy when these three distinctions can genuinely be
reconstructed from its annotations and document context.

### 3.5 Directed assertion relations

```json
{
  "schemaVersion": "cf1.publicMappedTaskRow.v1",
  "rowId": "pub:demo:doc-1:relate:001",
  "fixtureId": "pub:demo:doc-1",
  "task": "relate",
  "corpus": {
    "id": "demo",
    "version": "1",
    "license": "illustrative-only",
    "url": "https://example.invalid"
  },
  "provenance": {
    "sourceDocumentId": "doc-1",
    "sourceSplit": "train",
    "annotationOrigin": "illustrative",
    "sourceLabel": "support",
    "mappingRule": "explicit-support-to-supports-v1",
    "mapperVersion": "1"
  },
  "input": {
    "from": {
      "candidateId": "C001",
      "proposition": "Measured particulate pollution fell after the policy.",
      "localContext": [{"unitId": "S010", "text": "Measured particulate pollution fell after the policy."}]
    },
    "to": {
      "candidateId": "C002",
      "proposition": "The policy improved air quality.",
      "localContext": [{"unitId": "S011", "text": "The policy improved air quality."}]
    }
  },
  "output": {
    "relationType": "provides_evidence_for"
  }
}
```

Current relation labels:

- `supports`
- `provides_evidence_for`
- `rebuts`
- `contradicts`
- `qualifies`
- `elaborates`

Do not automatically map a generic public `attack` edge to `rebuts` or
`contradicts`; those labels are not equivalent. Queue ambiguous mappings or retain
the original corpus task separately.

### 3.6 Portfolio selection

Output is only:

```json
{"include": true}
```

Most public argument-mining corpora do not annotate compact document-level
portfolio inclusion. Do not manufacture this label from `claim`, `major claim`, or
`premise` unless the corpus definition has been reviewed and explicitly mapped.

### 3.7 Document orientation

Output shape:

```json
{
  "theme": "The central disputed question.",
  "thesis": "The position advanced by the document.",
  "thesisStatus": "clear",
  "thesisHinge": {
    "proposition": "The decisive proposition on which the thesis depends.",
    "ifSupportedEffectOnThesis": "strengthens",
    "ifRefutedEffectOnThesis": "weakens"
  },
  "basisSourceUnitIds": ["S001", "S010"]
}
```

Current `thesisStatus` labels: `clear`, `weak`, `absent`.

The effect fields are `strengthens`, `weakens`, or `neutral`. Public major-claim
annotations may help draft orientation rows, but only when the full document and
grounding units are available.

## 4. Final rendered SFT shape

The renderer converts the intermediate row to the TRL conversational
prompt/completion form:

```json
{
  "rowId": "pub:demo:doc-1:detect:001",
  "fixtureId": "pub:demo:doc-1",
  "task": "detect_assertions",
  "prompt": [
    {
      "role": "system",
      "content": "You are a grounded argument-analysis component..."
    },
    {
      "role": "user",
      "content": "{\"task\":\"detect_assertions\",\"instruction\":\"...\",\"input\":{...}}"
    }
  ],
  "completion": [
    {
      "role": "assistant",
      "content": "{\"classification\":\"material_assertion_present\"}"
    }
  ]
}
```

Do not hand-build this final shape. Convert the public corpus to the canonical
intermediate rows and run the shared renderer, ensuring public and CF1 examples use
byte-identical task instructions.

## 5. Dataset acceptance report

Every public-corpus converter must report:

- corpus name, version, URL, license, and citation;
- number of source documents;
- rows by task and source split;
- positive and negative label counts;
- rows rejected as ambiguous or incompatible;
- exact source-label-to-CF1-label mapping rules;
- duplicate-document detection results;
- proof that document IDs do not cross train/evaluation splits;
- converter version and hashes of source and converted artifacts.

Public rows are `public_mapped`, not CF1 adjudicated gold. Keep that distinction in
all manifests and experiment reports.
