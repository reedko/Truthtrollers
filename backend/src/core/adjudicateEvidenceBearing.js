import { openAiLLM } from "./openAiLLM.js";

const BEARING_ADJUDICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceAssertionId", "bearingScore", "rationale"],
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
          rationale: {
            anyOf: [
              {
                type: "string",
                minLength: 1,
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

function renderPrompt(template, caseAssertion, evidenceAssertions) {
  return template
    .replace("{{caseAssertion}}", caseAssertion.text)
    .replace(
      "{{evidenceAssertions}}",
      JSON.stringify(evidenceAssertions, null, 2),
    );
}

function validateResult(result, evidenceAssertions) {
  const suppliedIds = new Set(
    evidenceAssertions.map((assertion) =>
      String(assertion.evidenceAssertionId),
    ),
  );

  const results = Array.isArray(result?.results) ? result.results : [];

  const seenIds = new Set();
  const validated = [];

  for (const row of results) {
    const evidenceAssertionId = String(row?.evidenceAssertionId ?? "");

    if (
      !evidenceAssertionId ||
      !suppliedIds.has(evidenceAssertionId) ||
      seenIds.has(evidenceAssertionId)
    ) {
      throw new Error(
        `Invalid evidenceAssertionId returned by bearing adjudication: ${evidenceAssertionId}`,
      );
    }

    const bearingScore = row.bearingScore;

    if (
      bearingScore !== null &&
      (typeof bearingScore !== "number" ||
        !Number.isFinite(bearingScore) ||
        bearingScore < -1 ||
        bearingScore > 1)
    ) {
      throw new Error(
        `Invalid bearingScore for evidence assertion ${evidenceAssertionId}`,
      );
    }
    const rationale = row.rationale;

    if (bearingScore === null) {
      if (rationale !== null) {
        throw new Error(
          `Expected null rationale for non-bearing evidence assertion ${evidenceAssertionId}`,
        );
      }
    } else if (typeof rationale !== "string" || !rationale.trim()) {
      throw new Error(
        `Missing rationale for bearing evidence assertion ${evidenceAssertionId}`,
      );
    }

    seenIds.add(evidenceAssertionId);

    validated.push({
      evidenceAssertionId,
      bearingScore,
      rationale: bearingScore === null ? null : rationale.trim(),
    });
  }

  if (seenIds.size !== suppliedIds.size) {
    throw new Error(
      `Bearing adjudication returned ${seenIds.size}/${suppliedIds.size} evidence assertions`,
    );
  }

  return {
    results: validated,
  };
}

export async function adjudicateEvidenceBearing({
  caseAssertion,
  evidenceAssertions,
  llm = openAiLLM,
  promptManager,
}) {
  if (!promptManager) {
    throw new Error("adjudicateEvidenceBearing requires promptManager");
  }

  if (
    !caseAssertion ||
    !Number.isInteger(Number(caseAssertion.id)) ||
    typeof caseAssertion.text !== "string" ||
    !caseAssertion.text.trim()
  ) {
    throw new Error(
      "adjudicateEvidenceBearing requires one valid caseAssertion",
    );
  }

  if (!Array.isArray(evidenceAssertions) || evidenceAssertions.length === 0) {
    throw new Error("adjudicateEvidenceBearing requires evidence assertions");
  }

  const prompt = await promptManager.getPrompt(
    "evidence_assertion_bearing_user",
  );

  if (!prompt?.user) {
    throw new Error(
      "evidence_assertion_bearing_user returned no user prompt text",
    );
  }

  const user = renderPrompt(prompt.user, caseAssertion, evidenceAssertions);

  const result = await llm.generate({
    user,
    schemaHint: BEARING_ADJUDICATION_SCHEMA,
    strictJsonSchema: true,
    model: "gpt-5.4-mini",
    reasoning: {
      effort: "low",
    },
    max_output_tokens: 3000,
    api: "responses",
    timeout: 180000,
  });

  return validateResult(result, evidenceAssertions);
}
