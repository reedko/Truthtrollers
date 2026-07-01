export function normalizeEvidenceClaimText(claimText = "") {
  const text = String(claimText || "").trim().replace(/\s+/g, " ");
  if (!text) return text;

  const attributionPatterns = [
    /\b(?:revealed|reveals|claimed|claims|alleged|alleges|said|says|stated|states|reported|reports|asserted|asserts|argued|argues|testified|testifies|wrote|writes|published|publishes)\s+that\s+(.+)$/i,
    /\b(?:according to|per)\s+[^,]+,\s*(.+)$/i,
  ];

  for (const pattern of attributionPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/\.$/, "") + ".";
    }
  }

  return text;
}

export function classifyAttributionClaim(claimText = "") {
  const originalText = String(claimText || "").trim().replace(/\s+/g, " ");
  if (!originalText) {
    return {
      isAttribution: false,
      objectText: "",
      attributionText: "",
      endorsementPolarity: "unclear",
      accountabilityEligible: false,
    };
  }

  const patterns = [
    /^(?<subject>.+?)\s+(?<verb>revealed|reveals|claimed|claims|alleged|alleges|said|says|stated|states|reported|reports|asserted|asserts|argued|argues|testified|testifies|wrote|writes|published|publishes)\s+that\s+(?<object>.+)$/i,
    /^(?<subject>according to|per)\s+(?<speaker>[^,]+),\s*(?<object>.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = originalText.match(pattern);
    const objectText = match?.groups?.object?.trim();
    if (!objectText) continue;

    const verb = String(match.groups?.verb || match.groups?.subject || "").toLowerCase();
    const subject = String(match.groups?.subject || match.groups?.speaker || "").trim();
    const normalizedObject = objectText.replace(/\.$/, "") + ".";
    const endorsementPolarity = /reported|reports|according to|per/i.test(verb)
      ? "reports"
      : /published|publishes|argued|argues|asserted|asserts|claimed|claims|stated|states|said|says|alleged|alleges|revealed|reveals/i.test(verb)
        ? "endorses"
        : "unclear";

    return {
      isAttribution: true,
      objectText: normalizedObject,
      attributionText: originalText,
      speakerEntity: subject,
      attributionVerb: verb,
      endorsementPolarity,
      accountabilityEligible: endorsementPolarity === "endorses",
    };
  }

  const coreText = normalizeEvidenceClaimText(originalText);
  const changed = coreText !== originalText;
  return {
    isAttribution: changed,
    objectText: changed ? coreText : originalText,
    attributionText: originalText,
    endorsementPolarity: changed ? "unclear" : null,
    accountabilityEligible: false,
  };
}

export function buildEvidenceClaimContext(claimText = "") {
  const originalText = String(claimText || "").trim().replace(/\s+/g, " ");
  const coreText = normalizeEvidenceClaimText(originalText);
  const changed = coreText && coreText !== originalText;

  return {
    originalText,
    coreText,
    changed,
    promptText: changed
      ? `Original claim: ${originalText}\nCore factual assertion to evaluate: ${coreText}`
      : originalText,
  };
}
