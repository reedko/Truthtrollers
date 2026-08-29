/**
 * @typedef {{ id: number, text: string }} CaseAssertionInput
 * @typedef {{ childAssertion: string }} DecomposedChildAssertion
 * @typedef {{
 *   parentAssertionId: number,
 *   children: DecomposedChildAssertion[]
 * }} SparseCaseAssertionDecomposition
 * @typedef {{
 *   parentAssertionId: number,
 *   parentAssertion: string,
 *   requiresDecomposition: boolean,
 *   children: DecomposedChildAssertion[]
 * }} MaterializedCaseAssertionDecomposition
 */
export const CASE_ASSERTION_DECOMPOSITION_PROMPT = `You are given one case assertion.

Decompose it only when it contains multiple factual assertions that could receive different evidence judgments.

Each child must be a complete, independently judgeable factual assertion made by the parent.

Distinguish substantive factual assertions from context by their role in the parent's meaning. If removing information would only remove identifying, descriptive, qualifying, or background context while leaving the substantive factual assertion intact, do not return that information as a separate child. If removing it would discard a substantive factual proposition that the parent asks the reader to accept, and that proposition could receive a different evidence judgment, it must be represented as a separate child.

Preserve attribution. Who said, revealed, reported, alleged, ordered, or decided something, and what they are attributed as saying or doing, remain part of the same assertion unless the parent makes another independently judgeable factual assertion outside that attribution.

Preserve relationships. A comparison, change, trend, causal relationship, or other relationship must remain intact. Do not split it into endpoints or components that no longer express the relationship.

If the parent contains more than one independently judgeable relationship, each complete relationship may be a separate child.

The children must together preserve the parent's material factual meaning without adding, dropping, broadening, narrowing, or duplicating it.

If the parent can receive one meaningful evidence judgment, return no decomposition.

CASE ASSERTION

{{caseAssertions}}

Return:

{
  "decompositions": [
    {
      "parentAssertionId": 123,
      "children": [
        {
          "childAssertion": "..."
        }
      ]
    }
  ]
}

Return an empty decompositions array when no decomposition is required.`;
export const CASE_ASSERTION_DECOMPOSITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decompositions"],
  properties: {
    decompositions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["parentAssertionId", "children"],
        properties: {
          parentAssertionId: {
            type: "integer",
          },
          children: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["childAssertion"],
              properties: {
                childAssertion: {
                  type: "string",
                  minLength: 1,
                },
              },
            },
          },
        },
      },
    },
  },
};

function validateInputInventory(caseAssertions) {
  if (!Array.isArray(caseAssertions) || caseAssertions.length === 0) {
    throw new TypeError("caseAssertions must be a non-empty array");
  }
  const seen = new Set();
  for (const [index, assertion] of caseAssertions.entries()) {
    if (!Number.isInteger(assertion?.id)) {
      throw new TypeError(`caseAssertions[${index}].id must be an integer`);
    }
    if (seen.has(assertion.id)) {
      throw new TypeError(`Duplicate input assertion ID ${assertion.id}`);
    }
    seen.add(assertion.id);
    if (typeof assertion.text !== "string" || !assertion.text.trim()) {
      throw new TypeError(
        `caseAssertions[${index}].text must be a non-empty string`,
      );
    }
  }
}

function minimallyNormalizeWhitespace(value) {
  return value.trim().replace(/\s+/g, " ");
}

/** @param {CaseAssertionInput[]} caseAssertions */
export function buildCaseAssertionDecompositionPrompt(caseAssertions) {
  validateInputInventory(caseAssertions);
  const promptInventory = caseAssertions.map((assertion) => ({
    parentAssertionId: assertion.id,
    parentAssertion: assertion.text,
  }));
  return CASE_ASSERTION_DECOMPOSITION_PROMPT.replace(
    "{{caseAssertions}}",
    JSON.stringify(promptInventory, null, 2),
  );
}

/**
 * Omission is meaningful under the sparse contract: an omitted input parent is
 * unchanged. Returned decompositions are validated without semantic repair.
 *
 * @param {unknown} result
 * @param {CaseAssertionInput[]} caseAssertions
 */
export function validateCaseAssertionDecomposition(result, caseAssertions) {
  validateInputInventory(caseAssertions);
  const suppliedIds = new Set(caseAssertions.map((assertion) => assertion.id));
  const errors = [];
  const acceptedDecompositions = [];
  const quarantinedDecompositions = [];

  if (!result || !Array.isArray(result.decompositions)) {
    return {
      valid: false,
      errors: ["Model result must contain a decompositions array"],
      acceptedDecompositions,
      quarantinedDecompositions,
    };
  }

  const occurrences = new Map();
  for (const decomposition of result.decompositions) {
    const id = decomposition?.parentAssertionId;
    if (Number.isInteger(id)) {
      occurrences.set(id, (occurrences.get(id) || 0) + 1);
    }
  }

  result.decompositions.forEach((decomposition, decompositionIndex) => {
    const path = `decompositions[${decompositionIndex}]`;
    const decompositionErrors = [];
    const parentAssertionId = decomposition?.parentAssertionId;

    if (
      !Number.isInteger(parentAssertionId) ||
      !suppliedIds.has(parentAssertionId)
    ) {
      decompositionErrors.push(
        `${path}.parentAssertionId ${parentAssertionId} was not supplied`,
      );
    } else if (occurrences.get(parentAssertionId) !== 1) {
      decompositionErrors.push(
        `${path}.parentAssertionId ${parentAssertionId} appears ${occurrences.get(parentAssertionId)} times`,
      );
    }

    const children = Array.isArray(decomposition?.children)
      ? decomposition.children
      : [];
    if (children.length < 2) {
      decompositionErrors.push(
        `${path}.children must contain at least two children`,
      );
    }

    const normalizedChildren = new Set();
    children.forEach((child, childIndex) => {
      const childPath = `${path}.children[${childIndex}].childAssertion`;
      if (
        typeof child?.childAssertion !== "string" ||
        !child.childAssertion.trim()
      ) {
        decompositionErrors.push(`${childPath} must be a non-empty string`);
        return;
      }
      const normalized = minimallyNormalizeWhitespace(child.childAssertion);
      if (normalizedChildren.has(normalized)) {
        decompositionErrors.push(`${childPath} duplicates another child`);
      }
      normalizedChildren.add(normalized);
    });

    if (decompositionErrors.length > 0) {
      errors.push(...decompositionErrors);
      quarantinedDecompositions.push({
        decompositionIndex,
        decomposition,
        errors: decompositionErrors,
      });
    } else {
      acceptedDecompositions.push(decomposition);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    acceptedDecompositions,
    quarantinedDecompositions,
  };
}

/**
 * Expands the sparse response into the complete adjudication inventory. An
 * omitted parent remains unchanged; a decomposed parent contributes only its
 * children. Invalid returned decompositions are quarantined rather than treated
 * as omitted/unchanged.
 *
 * @param {CaseAssertionInput[]} caseAssertions
 * @param {ReturnType<typeof validateCaseAssertionDecomposition>} validation
 * @returns {MaterializedCaseAssertionDecomposition[]}
 */
export function materializeCaseAssertionDecomposition(
  caseAssertions,
  validation,
) {
  validateInputInventory(caseAssertions);
  const decompositionsByParentId = new Map(
    validation.acceptedDecompositions.map((decomposition) => [
      decomposition.parentAssertionId,
      decomposition,
    ]),
  );
  const quarantinedParentIds = new Set(
    validation.quarantinedDecompositions
      .map((item) => item.decomposition?.parentAssertionId)
      .filter(Number.isInteger),
  );

  return caseAssertions.flatMap((parent) => {
    if (quarantinedParentIds.has(parent.id)) return [];
    const decomposition = decompositionsByParentId.get(parent.id);
    if (!decomposition) {
      return [
        {
          parentAssertionId: parent.id,
          parentAssertion: parent.text,
          requiresDecomposition: false,
          children: [{ childAssertion: parent.text }],
        },
      ];
    }
    return [
      {
        parentAssertionId: parent.id,
        parentAssertion: parent.text,
        requiresDecomposition: true,
        children: decomposition.children,
      },
    ];
  });
}

/**
 * @param {{
 *   caseAssertions: CaseAssertionInput[],
 *   invokeStructuredModel: (request: {
 *     userPrompt: string,
 *     schema: typeof CASE_ASSERTION_DECOMPOSITION_SCHEMA
 *   }) => Promise<{ rawModelResult: string, [key: string]: unknown }>
 * }} input
 */
export async function decomposeCaseAssertions({
  caseAssertions,
  invokeStructuredModel,
}) {
  if (typeof invokeStructuredModel !== "function") {
    throw new TypeError("invokeStructuredModel must be a function");
  }
  const userPrompt = buildCaseAssertionDecompositionPrompt(caseAssertions);
  const modelResult = await invokeStructuredModel({
    userPrompt,
    schema: CASE_ASSERTION_DECOMPOSITION_SCHEMA,
  });
  if (
    !modelResult ||
    typeof modelResult.rawModelResult !== "string" ||
    !modelResult.rawModelResult.trim()
  ) {
    throw new TypeError("Structured model returned no rawModelResult");
  }
  const parsedResult = JSON.parse(modelResult.rawModelResult);
  const validation = validateCaseAssertionDecomposition(
    parsedResult,
    caseAssertions,
  );
  const parents = materializeCaseAssertionDecomposition(
    caseAssertions,
    validation,
  );
  return {
    userPrompt,
    rawModelResult: modelResult.rawModelResult,
    parsedResult,
    validation,
    parents,
    modelResult,
  };
}
