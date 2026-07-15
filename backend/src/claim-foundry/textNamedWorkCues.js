const RULES = [
  { pattern: /\b([A-Z][A-Za-z'’.-]+ et al\.?)\s*(\d+(?:\s*[–—-]\s*\d+)?)\b/g,
    workType: "study_or_case_series", confidence: "medium", calloutGroup: 2 },
  { pattern: /\b([A-Z][A-Za-z]+(?:\s+(?:of|the|and|for|with|[A-Z][A-Za-z]+)){1,7}\s+\([A-Z]{2,}\))\s*(\d+(?:\s*[–—-]\s*\d+)?)\b/g,
    workType: "review_report", confidence: "high", calloutGroup: 2 },
  { pattern: /\b((?:(?:several|previous|other|recent|large)\s+){0,3}epidemiologic studies)[^.]{0,220}\.\s*(\d+(?:\s*[–—-]\s*\d+)?)\b/gi,
    workType: "study_group", confidence: "medium", calloutGroup: 2 },
  { pattern: /\b((?:(?:previous|other|recent|large|retrospective|prospective|population-based)\s+){0,4}(?:epidemiologic studies|cohort study|case-control study|case series|review report))\s*(\d+(?:\s*[–—-]\s*\d+)?)?/gi,
    workType: "study_group", confidence: "medium", calloutGroup: 2 },
  { pattern: /\b((?:[Aa]n?\s+)?[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){1,6}\s+(?:Committee|Board)(?:\s+of\s+(?:the\s+)?[A-Z]{2,})?)\s*(\d+(?:\s*[–—-]\s*\d+)?)?/g,
    workType: "review_report", confidence: "medium", calloutGroup: 2 },
  { pattern: /\b([A-Z]{2,}(?:-[IVX]+|\s+[IVX]{1,5}))\b/g,
    workType: "standard_or_manual", confidence: "high" },
  { pattern: /\b([A-Z][a-z][A-Za-z’'-]*(?:\s+(?:of|the|and|for|with|[A-Z][A-Za-z’'-]*)){1,10}\s+(?:Act|Code|Regulation|Treaty))\s*(\d+(?:\s*[–—-]\s*\d+)?)?/g,
    workType: "law_or_policy", confidence: "high", calloutGroup: 2 },
];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
const callout = (value) => value ? value.replace(/\s+/g, "").replace(/[—–]/g, "-") : null;

export function detectTextNamedWorkCues(sourceUnits) {
  const results = [];
  for (const unit of sourceUnits) {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of unit.text.matchAll(rule.pattern)) {
        const mentionText = clean(match[1]);
        if (!mentionText) continue;
        results.push({ mentionText, workType: rule.workType,
          citationCallout: callout(match[rule.calloutGroup]), source: "text_mention",
          confidence: rule.confidence, sourceUnitIds: [unit.unitId], linkResolved: false,
          year: null, peopleOrOrganizations: [], identifiers: [] });
      }
    }
  }
  const identity = (work) => work.mentionText.toLowerCase().replace(/^(?:a|an|the)\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
  const deduped = [];
  for (const work of results) {
    const existing = deduped.find((item) => identity(item) === identity(work)
      || (work.workType === "study_group" && item.workType === "study_group"
        && work.citationCallout && item.citationCallout === work.citationCallout));
    if (!existing) deduped.push(work);
    else {
      existing.sourceUnitIds = [...new Set([...existing.sourceUnitIds, ...work.sourceUnitIds])];
      existing.citationCallout ??= work.citationCallout;
    }
  }
  return deduped.filter((work) => !(work.workType === "study_group" && !work.citationCallout
    && !/^(?:several|previous|other|recent)\b/i.test(work.mentionText)))
    .filter((work) => !(/^(?:cohort study|case-control study|case series|review report)$/i
    .test(work.mentionText) && !work.citationCallout && deduped.some((other) =>
      other !== work && other.sourceUnitIds[0] === work.sourceUnitIds[0]
        && /\bet al\.?$/i.test(other.mentionText))));
}
