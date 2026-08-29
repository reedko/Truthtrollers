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

export const PROMPT_TEMPLATE = `You are given case assertions and an evidence document.

CASE ASSERTIONS

{{caseAssertions}}

EVIDENCE DOCUMENT

{{evidenceText}}

Return the evidence assertions in the document that materially bear on the case assertions.
Each evidence assertion is a concise factual abstraction at the level needed to establish its bearing.
State each evidence assertion neutrally and concisely; do not reproduce emotionally charged phrasing from the source verbatim.
For each material bearing, identify the case assertion and return:

stance:
support
refute
nuance

strength:
a number from 0 to 1 representing how strongly the evidence assertion bears on that specific case assertion in the stated stance.

support means the evidence assertion makes the case assertion more likely true.
refute means the evidence assertion makes the case assertion less likely true.
nuance means the evidence assertion materially qualifies or complicates the case assertion without clearly supporting or refuting it.

strength is evidentiary force, not source quality or model confidence.

A material bearing provides information that would change how the specific case assertion should be evaluated.
Shared subject matter alone does not constitute material bearing.
A material bearing must address the same specific proposition and its material scope.
Match the relevant population, intervention or exposure, outcome, event, actor and action, quantity, time period, or causal relationship required by the case assertion.
A difference in one of those elements may qualify the case assertion only when that difference itself changes how the case assertion should be evaluated.
Link to the narrowest case assertion whose specific proposition is affected.
A broader thesis receives a link only when the evidence directly bears on that broader proposition.
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
          "stance": "support",
          "strength": 0.75
        }
      ]
    }
  ]
}

The assertions array may be empty when no evidence assertion materially bears on any supplied case assertion.`; // Human-readable schema for this JSON-object experiment and local validation.
export const resultSchema = {
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
            items: {
              type: "object",
              additionalProperties: false,
              required: ["taskClaimId", "stance", "strength"],
              properties: {
                taskClaimId: {
                  type: "integer",
                },
                stance: {
                  type: "string",
                  enum: ["support", "refute", "nuance"],
                },
                strength: {
                  type: "number",
                  minimum: 0,
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

export function buildUserPrompt(fullText, taskClaims) {
  const claimTargets = taskClaims.map((claim) => ({
    taskClaimId: claim.claim_id,
    assertion: claim.claim_text,
  }));

  return PROMPT_TEMPLATE.replace(
    "{{caseAssertions}}",
    JSON.stringify(claimTargets, null, 2),
  ).replace("{{evidenceText}}", fullText);
}

export function parseModelResult(rawModelResult) {
  return JSON.parse(rawModelResult);
}

export function validateModelResult(parsed, fullText, taskClaims) {
  const validationErrors = [];
  if (!parsed || !Array.isArray(parsed.assertions)) {
    return ["Model result must contain an assertions array"];
  }

  const suppliedClaimIds = new Set(
    taskClaims.map((claim) => Number(claim.claim_id)),
  );

  parsed.assertions.forEach((assertion, assertionIndex) => {
    const path = `assertions[${assertionIndex}]`;

    if (
      typeof assertion.evidenceAssertion !== "string" ||
      !assertion.evidenceAssertion.trim()
    ) {
      validationErrors.push(
        `${path}.evidenceAssertion must be a non-empty string`,
      );
    }
    if (Object.hasOwn(assertion, "exactExcerpt")) {
      if (
        typeof assertion.exactExcerpt !== "string" ||
        !assertion.exactExcerpt
      ) {
        validationErrors.push(
          `${path}.exactExcerpt must be a non-empty string`,
        );
      } else if (!fullText.includes(assertion.exactExcerpt)) {
        validationErrors.push(
          `${path}.exactExcerpt is not verbatim in the evidence text`,
        );
      }
    }
    if (!Array.isArray(assertion.bearsOn) || assertion.bearsOn.length === 0) {
      validationErrors.push(
        `${path}.bearsOn must contain at least one bearing`,
      );
      return;
    }

    assertion.bearsOn.forEach((bearing, bearingIndex) => {
      const bearingPath = `${path}.bearsOn[${bearingIndex}]`;
      const taskClaimId = Number(bearing.taskClaimId);
      if (
        !Number.isInteger(taskClaimId) ||
        !suppliedClaimIds.has(taskClaimId)
      ) {
        validationErrors.push(
          `${bearingPath}.taskClaimId ${bearing.taskClaimId} was not supplied`,
        );
      }
      if (!ALLOWED_RELATIONS.has(bearing.relation)) {
        validationErrors.push(
          `${bearingPath}.relation ${bearing.relation} is not allowed`,
        );
      }
      if (!ALLOWED_STANCES.has(bearing.stance)) {
        validationErrors.push(
          `${bearingPath}.stance ${bearing.stance} is not allowed`,
        );
      }

      if (
        typeof bearing.strength !== "number" ||
        !Number.isFinite(bearing.strength) ||
        bearing.strength < 0 ||
        bearing.strength > 1
      ) {
        validationErrors.push(
          `${bearingPath}.strength ${bearing.strength} must be a finite number from 0 to 1`,
        );
      }
    });
  });

  return validationErrors;
}
