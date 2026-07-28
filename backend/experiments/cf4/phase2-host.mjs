export function normalized(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function validateStanceAssertions(rawAssertions, validUnitIds) {
  const findings = [];
  const seen = new Set();
  const stanceAssertions = [];
  for (const [index, raw] of rawAssertions.entries()) {
    const assertionText = String(raw.assertionText ?? "").trim();
    const groundingUnitIds = [...new Set(raw.groundingUnitIds ?? [])];
    const invalidUnitIds = groundingUnitIds.filter((id) => !validUnitIds.has(id));
    if (!assertionText || !groundingUnitIds.length || invalidUnitIds.length) {
      findings.push({
        code: "CF4_INVALID_STANCE_ASSERTION",
        index,
        invalidUnitIds,
      });
      continue;
    }
    const key = normalized(assertionText);
    if (seen.has(key)) {
      findings.push({ code: "CF4_DUPLICATE_STANCE_ASSERTION", index });
      continue;
    }
    seen.add(key);
    stanceAssertions.push({
      stanceId: `S${String(stanceAssertions.length + 1).padStart(4, "0")}`,
      assertionText,
      groundingUnitIds,
    });
  }
  if (!stanceAssertions.length) {
    throw new Error("CF4 S5 produced no valid grounded stance assertions");
  }
  if (stanceAssertions.length === 15) {
    findings.push({
      code: "CF4_STANCE_ASSERTIONS_AT_CEILING",
      count: stanceAssertions.length,
    });
  }
  return { stanceAssertions, findings };
}

export function validateSelection(rawIds, inventoryIds) {
  const selectedAssertionIds = [];
  const findings = [];
  const seen = new Set();
  for (const assertionId of rawIds) {
    if (!inventoryIds.has(assertionId)) {
      findings.push({ code: "CF4_SELECTION_UNKNOWN_ID", assertionId });
    } else if (!seen.has(assertionId)) {
      seen.add(assertionId);
      selectedAssertionIds.push(assertionId);
    }
  }
  if (selectedAssertionIds.length < 5) {
    findings.push({
      code: "CF4_THIN_PORTFOLIO",
      count: selectedAssertionIds.length,
    });
  }
  return { selectedAssertionIds, findings };
}
