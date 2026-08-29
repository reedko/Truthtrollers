import { createHash } from "crypto";

export const SYSTEM_PROMPT = `You judge how supplied evidence bears on supplied assertions.
Use only the supplied evidence.
Return strict JSON matching the supplied schema.`;

export const ALLOWED_RELATIONS = new Set([
  "supports",
  "challenges",
  "qualifies",
  "mixed",
]);

export const ALLOWED_STANCES = new Set(["support", "refute", "nuance"]);

// Edit this template to change the experiment prompt.
export const PROMPT_TEMPLATE1 = `You are given case assertions and an evidence document.

CASE ASSERTIONS

{{caseAssertions}}

EVIDENCE DOCUMENT

{{evidenceText}}

Return the evidence assertions in the document that materially bear on the case assertions.

Each evidence assertion is a concise factual assertion grounded in the evidence document.

For each material bearing, identify the case assertion and classify the relation as:

supports
challenges
qualifies
mixed

A material bearing provides information useful for evaluating the truth, scope, or significance of the case assertion.

Preserve the scope and meaning of both the evidence assertion and the case assertion.

Return an empty assertions array when the evidence document contains no material bearing.

Return only the requested JSON.

CASE ASSERTIONS:
{{caseAssertions}}

EVIDENCE DOCUMENT:
{{evidenceText}}

Return JSON only:

{
  "assertions": [
    {
      "evidenceAssertion": "...",
      "bearsOn": [
        {
          "taskClaimId": 123,
          "relation": "supports"
        }
      ]
    }
  ]
}

If no explicit assertion in the evidence document materially bears on any supplied case assertion, return:

{"assertions":[]}`;
export const PROMPT_TEMPLATE2 = `You are given case assertions and one evidence document.

CASE ASSERTIONS

{{caseAssertions}}

EVIDENCE DOCUMENT

{{evidenceText}}

Return the evidence assertions in the document that directly and materially bear on the case assertions.

An evidence assertion has material bearing when its truth would change how the specific case assertion should be evaluated.

Each evidence assertion must preserve the scope of the evidence document.

Each bearing must preserve the scope of the case assertion.

A supporting bearing increases confidence in the specific case assertion.

A challenging bearing decreases confidence in the specific case assertion.

A qualifying bearing materially limits, narrows, conditions, or contextualizes the specific case assertion.

A mixed bearing both increases and decreases confidence in material parts of the same case assertion.

Shared subject matter alone has no material bearing.

Return an empty assertions array when the document contains no evidence assertion with material bearing.

Return only JSON in exactly this structure:

{
  "assertions": [
    {
      "evidenceAssertion": "string",
      "bearsOn": [
        {
          "taskClaimId": 123,
          "relation": "supports|challenges|qualifies|mixed"
        }
      ]
    }
  ]
}`;
export const PROMPT_TEMPLATE3 = `You are given case assertions and an evidence document.

CASE ASSERTIONS

{{caseAssertions}}

EVIDENCE DOCUMENT

{{evidenceText}}

Return the evidence assertions in the document that materially bear on the case assertions.
Each evidence assertion is a concise factual abstraction at the level needed to establish its bearing.
State each evidence assertion neutrally and concisely; do not reproduce emotionally charged phrasing from the source verbatim.
For each material bearing, identify the case assertion and classify the relation as:

supports

challenges

qualifies

mixed

A material bearing provides information that would change how the specific case assertion should be evaluated.
Shared subject matter alone does not constitute material bearing.
Preserve the scope and meaning of both the evidence assertion and the case assertion.
Return an empty assertions array when the evidence document contains no material bearing.

Return JSON only:

{
  "assertions": [
    {
      "evidenceAssertion": "...",
      "bearsOn": [
        {
          "taskClaimId": 123,
          "relation": "supports"
        }
      ]
    }
  ]
}

The assertions array may be empty when no evidence assertion materially bears on any supplied case assertion.`;

export const PROMPT_TEMPLATE4 = `You are given case assertions and an evidence document.

CASE ASSERTIONS

{{caseAssertions}}

EVIDENCE DOCUMENT

{{evidenceText}}

Return only evidence assertions in the document that directly and materially bear on a supplied case assertion.

Each evidence assertion must be a concise factual abstraction grounded in the evidence document.

A material bearing must address the same specific proposition and its material scope.

Match the relevant population, intervention or exposure, outcome, event, actor and action, quantity, time period, or causal relationship required by the case assertion.

Shared subject matter, thematic relevance, background information, or discussion of the same general controversy does not constitute material bearing.

A difference in one of those elements may qualify a case assertion only when that difference itself changes how the case assertion should be evaluated.

For each evidence assertion, link to the narrowest case assertion whose specific proposition is materially affected.

Do not also link to a broader case assertion merely because it encompasses the same subject. A broader assertion receives a link only when the evidence assertion directly bears on that broader proposition itself.

Classify each admitted relationship as:

supports
challenges
qualifies
mixed

supports means the evidence assertion increases support for the specific proposition.
challenges means it decreases support for the specific proposition.
qualifies means it materially limits, narrows, conditions, or contextualizes the specific proposition.
mixed means it materially supports and challenges different parts of the same proposition.

Preserve the scope and meaning of both assertions.

If an evidence assertion does not materially bear on any supplied case assertion, do not return it.

If the document contains no such evidence assertions, return an empty assertions array.

Return JSON only:

{
  "assertions": [
    {
      "evidenceAssertion": "...",
      "bearsOn": [
        {
          "taskClaimId": 123,
          "relation": "supports"
        }
      ]
    }
  ]
}`;

export const USER_PROMPT_TEMPLATE = `You are given case assertions and an evidence document.

CASE ASSERTIONS

{{caseAssertions}}

EVIDENCE DOCUMENT

{{evidenceText}}

Return the evidence assertions in the document that materially bear on the case assertions.

Each evidence assertion is a concise factual abstraction at the level needed to establish its bearing.

State each evidence assertion neutrally and concisely; do not reproduce emotionally charged phrasing from the source verbatim.

For each material bearing, identify the case assertion and a bearingScore from -1 to 1.

-1 means the evidence assertion strongly makes the case assertion less likely to be true.

0 means the evidence assertion materially bears on the case assertion but has no net directional effect.

1 means the evidence assertion strongly makes the case assertion more likely to be true.

The magnitude of bearingScore represents the strength of the evidentiary bearing.

bearingScore represents evidentiary bearing only, not source quality or model confidence.

A material bearing provides information that would change how the specific case assertion should be evaluated.

Shared subject matter alone does not constitute material bearing.

A material bearing must address the same specific proposition and its material scope.

Match the relevant population, intervention or exposure, outcome, event, actor and action, quantity, time period, attribution, or causal relationship required by the case assertion.

Preserve attribution. When a case assertion states that a person or organization said, revealed, reported, alleged, ordered, or decided something, evidence about the embedded subject matter alone does not bear on that attributed assertion.

Preserve material relationships. Evidence about one endpoint of a comparison, change, trend, causal relationship, or other relationship does not by itself bear on the relationship unless it changes how that relationship should be evaluated.

Do not treat failure by a document to mention, discuss, or report an assertion as evidence for or against that assertion.

If the evidence does not materially affect a case assertion, do not return a bearing for that case assertion.

One evidence assertion may bear on more than one case assertion. Identify each material bearing separately.

Return an empty assertions array when the evidence document contains no material bearing.

Return:

{
  "assertions": [
    {
      "evidenceAssertion": "...",
      "bearsOn": [
        {
          "taskClaimId": 123,
          "bearingScore": 0.75
        }
      ]
    }
  ]
}`;
// Human-readable schema:
// {
//   "assertions": [
//     {
//       "evidenceAssertion": "string",
//       "bearsOn": [
//         {
//           "taskClaimId": 123,
//           "targetAssertion": "string",
//           "bearingScore": -1.0 to 1.0
//         }
//       ]
//     }
//   ]
// }

export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assertions"],
  properties: {
    assertions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceAssertion", "bearsOn"],
        properties: {
          evidenceAssertion: {
            type: "string",
            minLength: 1,
          },
          bearsOn: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["taskClaimId", "bearingScore"],
              properties: {
                taskClaimId: {
                  type: "integer",
                },
                bearingScore: {
                  type: "number",
                  minimum: -1,
                  maximum: 1,
                },
              },
            },
          },
        },
      },
    },
  },
};

export function bearingScoreToStance(score) {
  if (score < -0.1) return "refute";
  if (score > 0.1) return "support";
  return "neutral";
}

export function buildUserPrompt(fullText, taskClaims) {
  const claimTargets = taskClaims.map((claim) => ({
    taskClaimId: claim.claim_id,
    assertion: claim.claim_text,
  }));

  return USER_PROMPT_TEMPLATE.replace(
    "{{caseAssertions}}",
    JSON.stringify(claimTargets, null, 2),
  ).replace("{{evidenceText}}", fullText);
}

export function parseModelResult(rawModelResult) {
  return JSON.parse(rawModelResult);
}

export function validateModelResult(parsed, taskClaims) {
  if (!parsed || !Array.isArray(parsed.assertions)) {
    return {
      acceptedRows: [],
      rejectedRows: [],
      deduplicatedRows: [],
      fatalErrors: ["Model result must contain an assertions array"],
    };
  }

  const suppliedClaimIds = new Set(
    taskClaims.map((claim) => Number(claim.claim_id)),
  );
  const candidateRows = [];
  const rejectedRows = [];

  parsed.assertions.forEach((assertion, assertionIndex) => {
    const path = `assertions[${assertionIndex}]`;
    const validEvidenceAssertion =
      typeof assertion.evidenceAssertion !== "string" ||
      !assertion.evidenceAssertion.trim()
        ? false
        : true;
    if (!Array.isArray(assertion.bearsOn) || assertion.bearsOn.length === 0) {
      rejectedRows.push({
        path,
        evidenceAssertion: assertion.evidenceAssertion ?? null,
        bearing: null,
        errors: [
          ...(validEvidenceAssertion
            ? []
            : [`${path}.evidenceAssertion must be a non-empty string`]),
          `${path}.bearsOn must contain at least one bearing`,
        ],
      });
      return;
    }

    assertion.bearsOn.forEach((bearing, bearingIndex) => {
      const bearingPath = `${path}.bearsOn[${bearingIndex}]`;
      const errors = [];
      const taskClaimId = Number(bearing.taskClaimId);
      const bearingScore = bearing.bearingScore;
      if (
        typeof bearingScore !== "number" ||
        !Number.isFinite(bearingScore) ||
        bearingScore < -1 ||
        bearingScore > 1
      ) {
        errors.push(
          `${bearingPath}.bearingScore ${bearingScore} must be a finite number from -1 to 1`,
        );
      }
      if (!validEvidenceAssertion) {
        errors.push(`${path}.evidenceAssertion must be a non-empty string`);
      }
      if (
        !Number.isInteger(taskClaimId) ||
        !suppliedClaimIds.has(taskClaimId)
      ) {
        errors.push(
          `${bearingPath}.taskClaimId ${bearing.taskClaimId} was not supplied`,
        );
      }

      if (errors.length > 0) {
        rejectedRows.push({
          path: bearingPath,
          evidenceAssertion: assertion.evidenceAssertion ?? null,
          bearing,
          errors,
        });
        return;
      }

      const evidenceAssertion = assertion.evidenceAssertion.trim();
      candidateRows.push({
        evidenceAssertion,
        taskClaimId,
        bearingScore,
        stance: bearingScoreToStance(bearingScore),
        strength: Math.abs(bearingScore),
      });
    });
  });

  const acceptedRows = [];
  const deduplicatedRows = [];
  const seen = new Set();
  for (const row of candidateRows) {
    const key = JSON.stringify([
      row.evidenceAssertion,
      row.taskClaimId,
      row.stance,
      row.strength,
    ]);
    if (seen.has(key)) {
      deduplicatedRows.push(row);
      continue;
    }
    seen.add(key);
    acceptedRows.push(row);
  }

  return {
    acceptedRows,
    rejectedRows,
    deduplicatedRows,
    fatalErrors: [],
  };
}

export function diagnosticPairFingerprint(
  referenceContentId,
  evidenceAssertion,
  taskClaimId,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        Number(referenceContentId),
        String(evidenceAssertion),
        Number(taskClaimId),
      ]),
      "utf8",
    )
    .digest("hex");
}

export const ASSERTION_CENTRIC_EXTRACTION_PROMPT = `You are given one case assertion and a set of evidence documents.

Return every factual assertion in the supplied evidence documents that is relevant to evaluating the case assertion.

Evaluate relevance to the case assertion as stated. Shared subject matter alone is not sufficient.

For every supplied document, return all relevant factual assertions from that document even when another supplied document contains the same, similar, stronger, or more detailed evidence.

Do not omit a relevant assertion because substantially similar information was returned from another document.

Do not evaluate whether an evidence assertion supports or refutes the case assertion.
Do not assign a score, stance, relationship, or bearing direction.
Do not use outside knowledge.
Do not return general document summaries or assertions that are merely topically related.

Each evidence assertion must faithfully preserve the factual meaning and material scope of its source document.

Each evidence assertion is a concise factual abstraction.

State each evidence assertion neutrally and concisely; do not reproduce emotionally charged phrasing from the source verbatim.

Preserve the referenceContentId of the document from which each evidence assertion was extracted.
An assertion about a different person, event, study, time period, or object is not relevant to the case assertion unless it directly bears on the specific event described by the case assertion.
Return no assertion for a document when that document contains nothing relevant to evaluating the case assertion.

CASE ASSERTION

{{caseAssertion}}

EVIDENCE DOCUMENTS

{{evidenceDocuments}}

Return JSON only:

{
  "assertions": [
    {
      "referenceContentId": 123,
      "evidenceAssertion": "..."
    }
  ]
}

Return an empty assertions array when none of the supplied evidence documents contains a factual assertion relevant to evaluating the case assertion.`;

export const ASSERTION_CENTRIC_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assertions"],
  properties: {
    assertions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["referenceContentId", "evidenceAssertion"],
        properties: {
          referenceContentId: {
            type: "integer",
          },
          evidenceAssertion: {
            type: "string",
            minLength: 1,
          },
        },
      },
    },
  },
};

export function buildAssertionCentricExtractionPrompt(
  taskClaim,
  evidenceDocuments,
) {
  const caseAssertion = {
    taskClaimId: Number(taskClaim.claim_id),
    assertion: taskClaim.claim_text,
  };
  const documents = evidenceDocuments.map((document) => ({
    referenceContentId: Number(document.reference_content_id),
    title: document.content_name || null,
    url: document.url || null,
    evidenceText: document.content_text,
  }));
  return ASSERTION_CENTRIC_EXTRACTION_PROMPT.replace(
    "{{caseAssertion}}",
    JSON.stringify(caseAssertion, null, 2),
  ).replace("{{evidenceDocuments}}", JSON.stringify(documents, null, 2));
}

export function validateAssertionCentricExtraction(parsed, evidenceDocuments) {
  if (!parsed || !Array.isArray(parsed.assertions)) {
    return {
      acceptedAssertions: [],
      rejectedAssertions: [],
      deduplicatedAssertions: [],
      fatalErrors: ["Model result must contain an assertions array"],
    };
  }
  const selectedDocumentIds = new Set(
    evidenceDocuments.map((document) => Number(document.reference_content_id)),
  );
  const acceptedAssertions = [];
  const rejectedAssertions = [];
  const deduplicatedAssertions = [];
  const seen = new Set();

  parsed.assertions.forEach((assertion, index) => {
    const errors = [];
    const referenceContentId = Number(assertion?.referenceContentId);
    if (
      !Number.isInteger(referenceContentId) ||
      !selectedDocumentIds.has(referenceContentId)
    ) {
      errors.push(
        `assertions[${index}].referenceContentId ${assertion?.referenceContentId} was not supplied`,
      );
    }
    if (
      typeof assertion?.evidenceAssertion !== "string" ||
      !assertion.evidenceAssertion.trim()
    ) {
      errors.push(
        `assertions[${index}].evidenceAssertion must be a non-empty string`,
      );
    }
    if (errors.length > 0) {
      rejectedAssertions.push({ index, assertion, errors });
      return;
    }
    const accepted = {
      referenceContentId,
      evidenceAssertion: assertion.evidenceAssertion.trim(),
    };
    const key = JSON.stringify([
      accepted.referenceContentId,
      accepted.evidenceAssertion,
    ]);
    if (seen.has(key)) {
      deduplicatedAssertions.push(accepted);
      return;
    }
    seen.add(key);
    acceptedAssertions.push(accepted);
  });

  return {
    acceptedAssertions,
    rejectedAssertions,
    deduplicatedAssertions,
    fatalErrors: [],
  };
}

export const BEARING_ADJUDICATION_PROMPT = `You are given one case assertion and a set of evidence assertions.

For each evidence assertion, determine its evidentiary bearing on the case assertion.

A material bearing exists when, assuming the evidence assertion is true, learning it would rationally change how likely the case assertion as stated is to be true.

Evidence may bear directly on the specific event asserted.

Evidence may also bear indirectly when it describes the same actor, organization, or relevant decision-making authority engaging in a structurally similar action, close enough in time, kind, and context that observing it would rationally update belief about a different, unconfirmed instance of that actor doing the same thing.

Mere similarity of subject matter, institution, vocabulary, or action is not sufficient. The evidence must provide a rational reason to update belief about the case assertion.

Indirect or pattern evidence should receive a score reflecting only the amount by which it changes the plausibility of the case assertion, not the strength with which it establishes the separate event it describes.

bearingScore is:

null when learning the evidence assertion would not materially change belief in the case assertion.

-1 when the evidence assertion strongly makes the case assertion less likely to be true.

0 when the evidence assertion materially qualifies the case assertion but does not make it more or less likely to be true overall.

1 when the evidence assertion strongly makes the case assertion more likely to be true.

Values between -1 and 1 represent direction and strength of bearing.

Evaluate the case assertion exactly as stated and preserve its meaning and scope.

bearingScore represents evidentiary bearing only. It does not represent source quality, model confidence, or retrieval relevance.

Use only the supplied assertions. Do not use outside knowledge.

CASE ASSERTION

{{caseAssertion}}

EVIDENCE ASSERTIONS

{{evidenceAssertions}}

INFORMAL OUTPUT CONTRACT

results[]
  evidenceAssertionId   string
  bearingScore          number [-1,1] | null

null means NO BEARING.`;

export const BEARING_ADJUDICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceAssertionId", "bearingScore"],
        properties: {
          evidenceAssertionId: {
            type: "string",
            minLength: 1,
          },
          bearingScore: {
            anyOf: [
              {
                type: "number",
                minimum: -1,
                maximum: 1,
              },
              {
                type: "null",
              },
            ],
          },
        },
      },
    },
  },
};

export function assignEvidenceAssertionIds(taskClaimId, assertions) {
  return assertions.map((assertion) => ({
    evidenceAssertionId: `ea_${createHash("sha256")
      .update(
        JSON.stringify([
          Number(taskClaimId),
          Number(assertion.referenceContentId),
          assertion.evidenceAssertion,
        ]),
        "utf8",
      )
      .digest("hex")}`,
    referenceContentId: Number(assertion.referenceContentId),
    evidenceAssertion: assertion.evidenceAssertion,
  }));
}

export function buildBearingAdjudicationPrompt(
  taskClaimId,
  caseAssertion,
  evidenceAssertions,
) {
  return BEARING_ADJUDICATION_PROMPT.replace(
    "{{caseAssertion}}",
    JSON.stringify(
      {
        taskClaimId: Number(taskClaimId),
        caseAssertion,
      },
      null,
      2,
    ),
  ).replace(
    "{{evidenceAssertions}}",
    JSON.stringify(evidenceAssertions, null, 2),
  );
}

export function validateBearingAdjudication(parsed, evidenceAssertions) {
  if (!parsed || !Array.isArray(parsed.results)) {
    return {
      acceptedResults: [],
      validatedResults: [],
      counts: { null: 0, negative: 0, zero: 0, positive: 0 },
      fatalErrors: ["Model result must contain a results array"],
    };
  }

  const suppliedIds = new Set(
    evidenceAssertions.map((assertion) => assertion.evidenceAssertionId),
  );
  const seenIds = new Set();
  const validatedResults = [];
  const fatalErrors = [];

  parsed.results.forEach((result, index) => {
    const path = `results[${index}]`;
    const evidenceAssertionId = result?.evidenceAssertionId;
    const bearingScore = result?.bearingScore;

    if (
      typeof evidenceAssertionId !== "string" ||
      !suppliedIds.has(evidenceAssertionId)
    ) {
      fatalErrors.push(
        `${path}.evidenceAssertionId ${evidenceAssertionId} was not supplied`,
      );
      return;
    }
    if (seenIds.has(evidenceAssertionId)) {
      fatalErrors.push(
        `${path}.evidenceAssertionId ${evidenceAssertionId} is duplicated`,
      );
      return;
    }
    seenIds.add(evidenceAssertionId);

    if (
      bearingScore !== null &&
      (typeof bearingScore !== "number" ||
        !Number.isFinite(bearingScore) ||
        bearingScore < -1 ||
        bearingScore > 1)
    ) {
      fatalErrors.push(
        `${path}.bearingScore must be null or a finite number from -1 to 1`,
      );
      return;
    }

    validatedResults.push({ evidenceAssertionId, bearingScore });
  });

  for (const evidenceAssertionId of suppliedIds) {
    if (!seenIds.has(evidenceAssertionId)) {
      fatalErrors.push(
        `Missing result for supplied evidenceAssertionId ${evidenceAssertionId}`,
      );
    }
  }

  const counts = validatedResults.reduce(
    (summary, result) => {
      if (result.bearingScore === null) summary.null += 1;
      else if (result.bearingScore < 0) summary.negative += 1;
      else if (result.bearingScore > 0) summary.positive += 1;
      else summary.zero += 1;
      return summary;
    },
    { null: 0, negative: 0, zero: 0, positive: 0 },
  );

  return {
    acceptedResults: fatalErrors.length === 0 ? validatedResults : [],
    validatedResults,
    counts,
    fatalErrors,
  };
}
