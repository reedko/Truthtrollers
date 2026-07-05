// Captured raw-provider-result fixture for claim 54064
// ("data linking the MMR vaccine to autism had been manipulated by the CDC.").
//
// This is a representative, STATIC set of raw provider results so the survival
// regression test never depends on live Tavily/Brave/PubMed/OpenAlex in CI.

export const claim54064 = {
  id: 54064,
  text: "data linking the MMR vaccine to autism had been manipulated by the CDC.",
};

export const evidenceNeed54064 = {
  effectiveClaimText: "data linking the MMR vaccine to autism had been manipulated by the CDC.",
  subjectTerms: ["CDC", "William Thompson"],
  relationTerms: ["manipulated", "omitted"],
  objectTerms: ["MMR", "autism", "data"],
  scopeTerms: ["2004"],
  mustIncludeTerms: ["MMR", "autism", "CDC"],
  evidenceTargets: [
    { id: "attribution", evidenceTargetType: "attribution" },
    { id: "substantive", evidenceTargetType: "substantive" },
    { id: "study", evidenceTargetType: "original_study" },
  ],
};

// URLs the regression test requires to survive pre-bearing (if found in raw).
export const MUST_SURVIVE_54064 = [
  "https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html",
  "https://pubmed.ncbi.nlm.nih.gov/14754936/",
  "https://example.org/thompson-statement",
  "https://doi.org/10.1016/j.taap.2013.12.017",
  "https://www.cdc.gov/media/releases/2014/response-mmr-autism.html",
  "https://openalex.org/W-mmr-autism-cohort-review",
];

export const rawProviderResults54064 = [
  {
    url: "https://archive.cdc.gov/www_cdc_gov/vaccinesafety/concerns/autism/cdc2004pediatrics.html",
    title: "CDC Statement: 2004 MMR and Autism Study | Vaccine Safety | CDC",
    snippet: "CDC statement regarding the 2004 DeStefano MMR and autism study and reanalysis.",
    score: 0.5,
    provider: "tavily",
    query: "CDC 2004 MMR autism study statement",
    purposeLane: "official_response",
    evidenceTargetId: "substantive",
    evidenceTargetType: "substantive",
  },
  {
    url: "https://pubmed.ncbi.nlm.nih.gov/14754936/",
    title: "Age at first measles-mumps-rubella vaccination in children with autism",
    snippet: "DeStefano 2004 Pediatrics.",
    bearingText: "Case-control study of age at first MMR vaccination among children with autism in metropolitan Atlanta; examined timing and data analysis.",
    bearingTextSource: "pubmed_abstract",
    academicApiContent: { apiBacked: true, identifiers: { pmid: "14754936" } },
    score: 0.3,
    provider: "pubmed",
    query: "DeStefano 2004 MMR autism age vaccination",
    purposeLane: "study_identity",
    evidenceTargetId: "study",
    evidenceTargetType: "original_study",
  },
  {
    url: "https://example.org/thompson-statement",
    title: "Statement of William W. Thompson, Ph.D., Regarding the 2004 Article",
    snippet: "William Thompson statement issued through his lawyer regarding the 2004 MMR autism study data.",
    score: 0.45,
    provider: "brave",
    query: "William Thompson statement 2004 MMR autism",
    purposeLane: "attribution_record",
    identityRole: "attribution_document",
    evidenceTargetId: "attribution",
    evidenceTargetType: "attribution",
  },
  {
    url: "https://doi.org/10.1016/j.taap.2013.12.017",
    title: "Hooker reanalysis of MMR vaccination and autism data",
    snippet: "Reanalysis / retraction discussion of the DeStefano cohort MMR autism data.",
    academicApiContent: { apiBacked: true, identifiers: { doi: "10.1016/j.taap.2013.12.017" } },
    score: 0.35,
    provider: "openalex",
    query: "Hooker reanalysis MMR autism DeStefano data",
    purposeLane: "independent_reanalysis",
    identityRole: "reanalysis",
    evidenceTargetId: "substantive",
    evidenceTargetType: "systematic_review",
  },
  {
    url: "https://www.cdc.gov/media/releases/2014/response-mmr-autism.html",
    title: "CDC / coauthor response on MMR autism data analysis",
    snippet: "Official response addressing allegations about the 2004 MMR autism analysis and data.",
    score: 0.4,
    provider: "tavily",
    query: "CDC coauthor response MMR autism 2004 analysis",
    purposeLane: "official_response",
    evidenceTargetId: "substantive",
    evidenceTargetType: "official_statement",
  },
  {
    url: "https://openalex.org/W-mmr-autism-cohort-review",
    title: "MMR vaccination and autism: a systematic review and meta-analysis of cohort studies",
    snippet: "Independent systematic review and cohort meta-analysis of MMR vaccination and autism risk.",
    bearingText: "Systematic review and meta-analysis of cohort and case-control studies of MMR vaccination and autism found no association.",
    bearingTextSource: "openalex_abstract",
    academicApiContent: { apiBacked: true, identifiers: { doi: "10.9999/mmr.autism.review" } },
    score: 0.38,
    provider: "openalex",
    query: "MMR autism systematic review meta-analysis cohort",
    purposeLane: "causal_background",
    evidenceTargetType: "systematic_review",
  },
  {
    url: "https://edition.cnn.com/2014/08/27/health/irpt-cdc-autism-vaccine-study",
    title: "Journal questions validity of autism and vaccine study | CNN",
    snippet: "News coverage of the CDC MMR autism reanalysis controversy.",
    score: 0.45,
    provider: "brave",
    query: "CDC autism vaccine study CNN",
    purposeLane: "source_context",
    evidenceTargetType: "other",
  },
  // The GlobeNewswire press release that previously poisoned resolution.
  {
    url: "https://www.globenewswire.com/news-release/2016/05/03/836249/0/en/CDC-Whistleblower-to-Extend-MMR-Vaccine-Fraud.html",
    title: "CDC Whistleblower to Extend MMR Vaccine Fraud",
    snippet: "The CDC manipulated data linking the MMR vaccine to autism, a whistleblower alleges in this press release about vaccine fraud.",
    score: 0.55,
    provider: "brave",
    query: "CDC whistleblower MMR vaccine fraud",
    purposeLane: "alleged_conduct",
    identityRole: "original_study", // deliberately mislabeled by discovery
    evidenceTargetType: "original_study",
  },
];
