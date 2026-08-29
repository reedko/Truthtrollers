import { openAiLLM } from "./openAiLLM.js";

const BEARING_RESPONSE_SCHEMA = {
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

function renderPrompt(template, caseAssertion, evidenceDocuments) {
  return template
    .replace("{{caseAssertion}}", caseAssertion.text)
    .replace(
      "{{evidenceDocuments}}",
      JSON.stringify(evidenceDocuments, null, 2),
    );
}

function validateResult(result, evidenceDocuments) {
  const suppliedReferenceIds = new Set(
    (Array.isArray(evidenceDocuments) ? evidenceDocuments : [])
      .map((document) => Number(document?.referenceContentId))
      .filter(Number.isInteger),
  );

  const assertions = Array.isArray(result?.assertions) ? result.assertions : [];

  const validAssertions = [];

  for (const assertion of assertions) {
    const referenceContentId = Number(assertion?.referenceContentId);

    if (
      !Number.isInteger(referenceContentId) ||
      !suppliedReferenceIds.has(referenceContentId) ||
      typeof assertion?.evidenceAssertion !== "string" ||
      !assertion.evidenceAssertion.trim()
    ) {
      continue;
    }

    validAssertions.push({
      referenceContentId,
      evidenceAssertion: assertion.evidenceAssertion.trim(),
    });
  }

  return {
    assertions: validAssertions,
  };
}

export async function extractEvidenceBearing({
  caseAssertion,
  evidenceDocuments,
  llm = openAiLLM,
  promptManager,
}) {
  if (!promptManager) {
    throw new Error("extractEvidenceBearing requires promptManager");
  }

  if (
    !caseAssertion ||
    !Number.isInteger(Number(caseAssertion.id)) ||
    typeof caseAssertion.text !== "string" ||
    !caseAssertion.text.trim()
  ) {
    throw new Error("extractEvidenceBearing requires one valid caseAssertion");
  }

  if (!Array.isArray(evidenceDocuments) || evidenceDocuments.length === 0) {
    throw new Error(
      "extractEvidenceBearing requires at least one evidence document",
    );
  }

  const prompt = await promptManager.getPrompt(
    "evidence_bearing_extraction_user",
  );

  if (!prompt?.user) {
    throw new Error(
      "evidence_bearing_extraction_user returned no user prompt text",
    );
  }

  const user = renderPrompt(prompt.user, caseAssertion, evidenceDocuments);

  const result = await llm.generate({
    user,
    schemaHint: BEARING_RESPONSE_SCHEMA,
    strictJsonSchema: true,
    model: "gpt-5.4-mini",
    reasoning: {
      effort: "low",
    },
    max_output_tokens: 12000,
    api: "responses",
    timeout: 180000,
  });

  return validateResult(result, evidenceDocuments);
}
