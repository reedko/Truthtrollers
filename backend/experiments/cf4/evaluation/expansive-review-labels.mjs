const configs = {
  F02: {
    suitable: "S0001 S0002 S0003 S0004 S0005 S0006 S0007 S0008 S0009 S0010",
    load: "S0001 S0002 S0003 S0004 S0005 S0006 S0008 S0009 S0010",
    nonAtomic: "S0001 S0002 S0004 S0005 S0006 S0009 S0010 S0011",
    recommendation: "S0011",
    implication: "S0001 S0010 S0011",
    background: "",
    peripheral: "S0007 S0011",
    overlap: "",
    notes: {
      S0005: "Evidence-ready but combines retraction, conflicts, and alleged ghostwriting.",
      S0011: "Mixed recommendation and implication; not a clean final evaluation claim.",
    },
  },
  F03: {
    suitable: "S0003 S0004 S0005 S0006 S0008",
    load: "S0003 S0004 S0005 S0006 S0008 S0009 S0010",
    nonAtomic: "S0003 S0004 S0005 S0006 S0008 S0009 S0010",
    recommendation: "",
    implication: "S0005 S0010",
    background: "S0001 S0002 S0007",
    peripheral: "S0002 S0007",
    overlap: "S0009 S0010",
    notes: {
      S0003: "Captures the Thompson/CDC crux family directly, though as a compound.",
      S0009: "Substantially overlaps S0003 and broadens it into a general concealment claim.",
      S0010: "Broad narrative claim; less independently testable than its supporting facts.",
    },
  },
  F06: {
    suitable: "S0008 S0009 S0010 S0011 S0012 S0013",
    load: "S0008 S0009 S0010 S0011 S0012 S0013",
    nonAtomic: "S0002 S0003 S0004 S0007 S0008 S0009 S0011 S0012 S0013",
    recommendation: "",
    implication: "S0013",
    background: "S0001 S0002 S0003 S0004 S0005 S0006 S0007",
    peripheral: "S0001 S0002 S0005 S0006",
    overlap: "",
    notes: {
      S0008: "Evidence-ready bleaching mechanism, but combines several linked effects.",
      S0011: "Preserves the attribution boundary around alleged government suppression.",
      S0013: "Load-bearing prognosis, but predictive and compound.",
    },
  },
};

const toSet = (text) => new Set(text.trim() ? text.trim().split(/\s+/) : []);

export function humanReview(fixture, stance) {
  const config = configs[fixture];
  if (!config) throw new Error(`Missing review configuration for ${fixture}`);
  const sets = Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, toSet(value)]),
  );
  const id = stance.stanceId;
  return {
    atomic: !sets.nonAtomic.has(id),
    articleTreatment: "article-adopted",
    evidenceSearchable: true,
    independentlyEvaluable: !(fixture === "F03" && id === "S0002"),
    loadBearing: sets.load.has(id),
    recommendation: sets.recommendation.has(id),
    implication: sets.implication.has(id),
    backgroundOrContext: sets.background.has(id),
    peripheral: sets.peripheral.has(id),
    duplicateOrSubstantiallyOverlapping: sets.overlap.has(id),
    suitableAsFinalSelectedEvaluationClaim: sets.suitable.has(id),
    reviewerNotes: config.notes[id] ?? "Direct human review; no production prompt or logic used.",
  };
}
