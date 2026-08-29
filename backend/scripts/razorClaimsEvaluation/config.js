// Add another object to run the exact-excerpt diagnostic over another complete case corpus.
// diagnosticClaimIds affect watched-assertion reporting only; every case claim is sent on every model call.
export const TEST_CASE_CONFIGURATIONS = [
  {
    taskContentId: 21382,
    diagnosticClaimIds: [59476, 59480, 59481],
  },
];

export const MIN_REFERENCE_TEXT_CHARACTERS = 500;
export const MAX_PARALLEL_MODEL_CALLS = 15;
export const MAX_OUTPUT_TOKENS = 3000;
export const DIAGNOSTIC_PASS_COUNT = 3;
