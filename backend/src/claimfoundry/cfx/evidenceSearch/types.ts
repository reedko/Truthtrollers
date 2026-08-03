export type CfxCitationLink = {
  linkId: string;
  url: string;
  anchorText?: string | null;
  unitId?: string | null;
  sourceUnitId?: string | null;
  classification?: string | null;
};

export type CfxCitationMarker = {
  markerId: string;
  displayText: string;
  sourceUnitId?: string | null;
  resolvedReferenceId?: string | null;
};

export type CfxArticleReference = {
  referenceId: string;
  label?: string | null;
  text: string;
  sourceUnitId?: string | null;
  linkIds?: string[];
  markerIds?: string[];
  title?: string | null;
  authors?: string[];
  organizations?: string[];
  journal?: string | null;
  publicationVenue?: string | null;
  publicationYear?: string | number | null;
  geography?: string[];
  identifiers?: {
    doi?: string[];
    pmid?: string[];
    urls?: string[];
  };
};

export type CfxCitationMetadata = {
  links: CfxCitationLink[];
  citationMarkers: CfxCitationMarker[];
  references: CfxArticleReference[];
};

export type CfxEvidenceSearchHandoff = {
  normalizedAssertion: string;
  groundingUnitIds: string[];
  groundingText: string;
  explicitStudyIdentityFound: boolean;
  literalIdentifiers: {
    people: string[];
    organizations: string[];
    laws: string[];
    studyTitles: string[];
    journals: string[];
    years: string[];
    dateRanges: string[];
    doi: string[];
    pmid: string[];
    urls: string[];
    citationNumbers: string[];
    acronyms: string[];
  };
  lookupHints: {
    populations: string[];
    exposures: string[];
    outcomes: string[];
    interventions: string[];
    geography: string[];
    documentTypes: string[];
    topics: string[];
  };
  queries: {
    literal: string[];
    sourceQualified: string[];
    studyLookup: string[];
  };
};

export type CfxEvidenceSearchHandoffInventory = {
  schemaVersion: "cfx.evidenceSearchHandoff.v2";
  sourceSubstantiveReviewHash: string;
  results: Array<{
    propositionId: string;
    substantiveAssertion: string;
    assertionSource: string;
    articleStance: "adopts" | "challenges" | "reports";
    evidenceSearchHandoff: CfxEvidenceSearchHandoff;
  }>;
};
