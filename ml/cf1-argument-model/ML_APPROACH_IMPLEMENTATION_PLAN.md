# CF1 Task-Specific ML Approach

Status: implementation plan
Created: 2026-07-22
Scope: assertion mining, attribution, article deployment, argument relations, portfolio selection, evaluation, and demo serving

## 1. Objective

Build a task-specific semantic engine that can process an arbitrary article or transcript and return a grounded representation of its factual argument:

```text
source content
    -> material atomic assertions
    -> assertion sources
    -> article deployment and role
    -> support, rebuttal, qualification, and contradiction relations
    -> selected argument portfolio
```

This project is a replacement candidate for the prompt-driven CF1 semantic path. It must be evaluated independently before any production integration.

The system must learn assertion mining. It must not assume that a reliable proposition inventory already exists.

## 2. Governing principles

1. Training annotations are evaluator-owned gold data, not raw model output.
2. Chat models may draft annotations, but a human must adjudicate every training example.
3. Existing evaluation-key language must not be included in first-draft annotation prompts.
4. Split datasets by article, never by candidate row.
5. Preserve opponent propositions in their original polarity.
6. Decide assertion source independently of article stance.
7. Prefer narrow supervised tasks and deterministic assembly over one overloaded generation request.
8. Score missing assertions separately from incorrect labels.
9. New held-out fixtures remain untouched until the final evaluation configuration is frozen.
10. No production integration occurs unless the new engine clearly beats the strongest prompted baseline.

## 3. Dataset roles

### Development and training corpus

Use CF1-F01 through CF1-F09 for annotation, development, leave-one-article-out evaluation, and eventual final training.

These fixtures cease to be authoritative evidence of generalization once used for training. Preserve all pre-training benchmark results for historical comparison.

### Final held-out corpus

Acquire eight new fixtures, provisionally CF1-F10 through CF1-F17.

The held-out set should include varied structures:

- straightforward factual argument;
- rebuttal article;
- long advocacy article;
- quotation- or attribution-heavy article;
- multiple named studies or reports;
- internal contradiction or material tension;
- weak or absent thesis;
- short report, interview, podcast, or YouTube transcript.

At least two held-out fixtures should be transcripts containing realistic punctuation, speaker, or ASR noise.

Do not use F10-F17 for prompt design, threshold selection, model selection, label revision, or hyperparameter tuning.

## 4. Step 1: Create gold annotations

Current status: forms and chat-ready prompts exist for F01-F09.

Locations:

```text
ml/cf1-argument-model/data/annotation-prompts/
ml/cf1-argument-model/data/annotation-forms/
```

For each fixture:

1. Paste its complete `CF1-FXX.chat-prompt.md` into a capable chat model.
2. Save the returned JSON as an unapproved draft.
3. Review the complete article and every source-unit range.
4. Correct missing, compound, invented, or polarity-reversed assertions.
5. Correct assertion source independently of stance.
6. Correct article deployment and argument role.
7. Add or correct proposition relations.
8. Preserve positive and negative passage-coverage examples.
9. Compare the corrected annotation with the old evaluation key only after the independent annotation exists.
10. Mark questionable old requirements as `key_needs_revision` rather than forcing the annotation to match.
11. Obtain an independent review.
12. Change `adjudication.status` to `approved` only after discrepancies are resolved.

### Required annotation content

Each approved fixture must contain:

- article theme, thesis, and thesis hinge;
- full passage coverage;
- assertion-bearing passages;
- passages containing no material assertion;
- duplicate expressions;
- uncertain passages;
- atomic canonical propositions;
- exact grounding units and excerpts;
- assertion-source kind and name;
- source-supporting units;
- content stance;
- article deployment;
- article role;
- evidence target and warrant;
- proposition relations;
- internal consistency findings;
- portfolio inclusion decision;
- rubric coverage and key disagreements.

### Annotation acceptance checks

An approved fixture must satisfy all of the following:

- every source unit is covered;
- every material passage maps to at least one argument unit;
- every argument unit has valid grounding;
- every canonical proposition is atomic;
- no proposition depends on absent images or outside knowledge;
- assertion source is supported or explicitly unknown;
- opponent polarity is preserved;
- all relation endpoints exist;
- duplicate propositions are marked or merged intentionally;
- evaluation-key disagreements are documented.

## 5. Step 2: Freeze annotation versions and provenance

For every approved annotation, record:

- fixture content hash;
- annotation hash;
- annotation schema version;
- primary annotator;
- independent reviewer;
- approval timestamp;
- originating draft model, if any;
- draft prompt hash;
- all later amendments.

Raw chat drafts must be retained separately from approved annotations. The dataset compiler must read only approved annotations.

## 6. Step 3: Compile supervised task rows

Compile each approved article graph into multiple narrowly scoped datasets.

### Task A: assertion-bearing passage detection

Input:

- local passage or transcript window;
- optional structural metadata.

Output:

- `material_assertion_present`;
- `no_material_assertion`;
- `mixed`;
- `duplicate_expression`;
- `uncertain`.

This task teaches recall and restraint.

### Task B: atomic assertion extraction

Input:

- an assertion-bearing passage;
- limited neighboring context.

Output:

- all atomic canonical propositions;
- grounding-unit IDs;
- scope qualifiers.

This task must preserve multiple independently testable propositions as separate rows.

### Task C: assertion-source selection

Input:

- proposition;
- local grounding context;
- deterministic candidate source names;
- explicit `article_voice` and `unknown` choices.

Output:

- selected source;
- source kind;
- supporting units;
- abstention when unresolved.

### Task D: article deployment and role

Input:

- proposition;
- local context;
- frozen article orientation.

Output:

- content stance;
- article deployment;
- article role.

### Task E: proposition relations

Input:

- two propositions;
- their local contexts;
- article orientation.

Output:

- supports;
- rebuts;
- qualifies;
- contradicts;
- elaborates;
- provides evidence for;
- unrelated.

Include hard negative pairs from the same article.

### Task F: portfolio selection

Input:

- complete extracted argument graph.

Output:

- include or exclude;
- deterministic selection features;
- documented exclusion reason.

Portfolio selection is trained and evaluated separately from assertion recall.

### Multi-task generative rows

If a 7B-14B LoRA model is pursued, compile the same gold graph into task-tagged conversational JSONL:

```text
TASK: ORIENT
TASK: DETECT_ASSERTIONS
TASK: EXTRACT_ASSERTIONS
TASK: ATTRIBUTE
TASK: RELATE
TASK: SELECT
```

One adapter may learn all tasks, but each training example should request one bounded operation.

## 7. Step 4: Validate dataset quality

Build automated validators that reject:

- malformed JSON;
- unapproved annotations;
- missing or invalid source units;
- duplicate IDs;
- dangling relations;
- unsupported enum values;
- non-atomic marked propositions;
- positive passages without propositions;
- uncovered source units;
- train/test article overlap;
- evaluation-key text copied into model inputs;
- identical or near-identical rows crossing article splits.

Generate a human-readable dataset report containing class counts, article counts, proposition counts, relation counts, negative-example counts, and class imbalance warnings.

## 8. Step 5: Establish frozen baselines

Before training, run and preserve:

1. majority-class baselines;
2. deterministic heuristics;
3. zero-shot NLI classification;
4. frozen embeddings plus logistic regression;
5. SetFit;
6. the strongest prompted 1B configuration;
7. the strongest existing assertion extractor.

Use leave-one-article-out evaluation across F01-F09:

```text
train on eight articles
evaluate on the ninth
repeat for all nine articles
```

No rows from one article may appear in both sides of a fold.

## 9. Step 6: Lightweight semantic-engine benchmark

Test three learned alternatives before managed LLM fine-tuning:

### Zero-training NLI

Use a suitable public NLI checkpoint to score deployment and proposition relations without training.

### Frozen embeddings plus logistic regression

Embed normalized task inputs once and train regularized classifiers per task.

### SetFit

Fine-tune a Sentence Transformer using contrastive few-shot learning and a logistic-regression classification head.

Run all lightweight models locally where practical. Record exact checkpoint revisions and hashes.

## 10. Step 7: Evaluate the lightweight benchmark

Report results per task, class, article, and model.

Required metrics:

- assertion-bearing passage macro F1;
- material-assertion recall;
- atomic assertion precision and recall;
- proposition exact and semantic match;
- source-selection accuracy and macro F1;
- `opponent_to_rebut` recall;
- deployment macro F1;
- relation macro F1;
- contradiction and qualification recall;
- portfolio coverage;
- prohibited-interpretation count;
- per-article worst-case score;
- repeated-run consistency;
- latency and memory use.

Do not rely on aggregate row accuracy because majority classes can conceal complete opponent or relation failure.

## 11. Step 8: Lightweight decision gate

Advance a lightweight model only if it:

- beats the prompted baseline on macro metrics;
- materially improves assertion recall or semantic labeling;
- does not collapse minority classes;
- generalizes across article-held-out folds;
- is deterministic under fixed inputs;
- has acceptable worst-article behavior.

If a lightweight combination works, package it as the first demo engine and defer LoRA.

If it improves labels but cannot extract assertions adequately, retain the useful classifiers and continue to managed LoRA for extraction.

If it fails broadly, preserve the report and advance to managed LoRA without further classifier tuning.

## 12. Step 9: Managed 7B-14B supervised LoRA

Screen several instruction-tuned open models that:

- permit commercial use;
- support the required context length;
- are available through a managed LoRA provider;
- allow adapter export or controlled hosting;
- can produce constrained JSON;
- fit the expected latency and cost envelope.

Do not select the base model by popularity alone. First run the frozen base models on a small validation slice.

Train task-tagged SFT adapters using the approved JSONL only.

Record:

- base-model repository and revision;
- tokenizer revision;
- provider;
- training-data hash;
- validation-data hash;
- epochs;
- learning rate;
- LoRA rank and alpha;
- target modules;
- maximum sequence length;
- random seed;
- checkpoint metrics;
- total tokens and cost.

Train several small controlled variants rather than one opaque large run.

## 13. Step 10: Development evaluation and model selection

Use article-level validation within F01-F09 for:

- base-model choice;
- training configuration;
- decoding parameters;
- thresholds;
- abstention policy;
- deterministic postprocessing.

Freeze the complete model, adapter, prompts, decoding, thresholds, and host behavior before opening F10-F17.

## 14. Step 11: Final held-out evaluation

Run the frozen engine once on F10-F17, followed by predefined repeated-run stability checks.

Compare against:

- best lightweight classifier engine;
- best prompted CF1 engine;
- sanitized legacy hybrid;
- majority and deterministic baselines.

The final report must expose:

- raw mined assertions;
- grounding;
- missed gold assertions;
- invented assertions;
- atomicity;
- sources;
- deployment and role;
- proposition relations;
- selected portfolio;
- per-task metrics;
- per-fixture metrics;
- cost and latency;
- repeated-run stability;
- all severe failures.

Do not revise the model or thresholds after viewing held-out results. Any revision creates a new development cycle and requires new held-out fixtures.

## 15. Step 12: Production-candidate gate

The new engine becomes a production candidate only if it clearly improves on the existing system and avoids severe semantic failures.

Minimum gate categories:

- material assertion recall;
- atomicity;
- grounding validity;
- attribution accuracy;
- opponent and rebuttal polarity;
- relation accuracy;
- internal contradiction handling;
- abstention behavior;
- worst-fixture performance;
- stability;
- latency;
- operating cost.

Exact numerical thresholds must be frozen before final held-out evaluation.

## 16. Step 13: Demo packaging

Build an isolated demo service with no production writes.

Supported input:

- pasted article text;
- fetched article body supplied by an existing ingestion adapter;
- pasted YouTube transcript;
- transcript with optional speaker and timestamp metadata.

Demo flow:

```text
content
    -> deterministic normalization and unit numbering
    -> assertion-bearing passage detection
    -> atomic assertion extraction
    -> attribution and deployment
    -> proposition-relation graph
    -> balanced portfolio
    -> HTML and JSON report
```

The report should show:

- full source text with unit IDs;
- every mined assertion;
- assertion source and supporting units;
- stance, deployment, and role;
- relation edges;
- inclusion or exclusion decision;
- confidence or abstention;
- model and dataset provenance;
- runtime and cost.

## 17. Step 14: Shadow evaluation

If the held-out gate passes:

1. deploy behind an internal API;
2. run in shadow mode on real content;
3. write only isolated diagnostic artifacts;
4. collect reviewer corrections;
5. add approved corrections to a new training-data version;
6. monitor class drift and source-domain drift;
7. compare with the incumbent without changing live user-visible output.

## 18. Step 15: Limited production and scale

Promote gradually:

1. internal users;
2. opt-in demo;
3. bounded production cohort;
4. general production after reliability review.

Production requirements:

- versioned adapter and base model;
- versioned dataset;
- reproducible deployment image;
- structured logging without hidden training leakage;
- health and latency monitoring;
- explicit abstention state;
- rollback to the prior engine;
- no silent adapter or model upgrades;
- periodic fresh held-out evaluation.

## 19. Cost-control gates

### Gate A: annotation quality

Do not spend on training until at least several fixtures pass annotation validation and independent review.

### Gate B: lightweight benchmark

Spend essentially no GPU money before NLI, embeddings, logistic regression, and SetFit results exist.

### Gate C: managed LoRA

Set a small initial training budget. Stop if article-held-out metrics do not improve over base and prompted models.

### Gate D: serving

Do not provision an always-on endpoint before the held-out gate passes. Prefer scale-to-zero during development and demo use.

## 20. Required project artifacts

```text
ml/cf1-argument-model/
  ML_APPROACH_IMPLEMENTATION_PLAN.md
  data/
    annotation-prompts/
    annotation-forms/
    raw-drafts/
    approved/
    compiled/
    splits/
  schemas/
  scripts/
    validate-annotations
    compile-datasets
    run-nli-baseline
    run-embedding-baseline
    run-setfit
    train-lora
    evaluate
    build-report
  configs/
  models/
    manifests/
  reports/
  serving/
  tests/
```

Generated model weights, caches, and large transient datasets should not be committed. Schemas, approved annotations, split manifests, model manifests, metrics, and compact evaluation reports should be tracked.

## 21. Immediate next actions

1. Generate and review the first chat draft, preferably F02 or F06 because each exercises a critical relation structure.
2. Amend the annotation contract based on actual reviewer friction before annotating all nine fixtures.
3. Add automated annotation validation.
4. Complete and independently review F01-F09.
5. Select and freeze F10-F17 without inspecting model performance on them.
6. Compile the lightweight benchmark datasets.
7. Run the leave-one-article-out baselines.
8. Decide whether lightweight models are sufficient or managed LoRA is required.

## 22. Definition of success

This project succeeds when an unseen article or transcript can be converted into a grounded argument graph whose important assertions, sources, opponent positions, rebuttals, qualifications, and contradictions are materially more accurate and stable than the best existing CF1 output.

The project does not succeed merely because training loss decreases, training fixtures are memorized, or a report looks plausible.
