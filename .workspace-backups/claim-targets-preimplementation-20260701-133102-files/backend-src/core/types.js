// backend/src/core/types.js

/**
 * @typedef {"support" | "refute" | "nuance" | "insufficient"} Verdict
 */

/**
 * @typedef {"statistic" | "study_conclusion" | "general_assertion" | "synthesis"} ClaimType
 */

/**
 * @typedef {"internal_only" | "same_study_index" | "external_fact_check"} SourcingMode
 */

/**
 * @typedef {Object} Claim
 * @property {string} id
 * @property {string} text
 * @property {string} [language]
 * @property {string} [sourceContentId]
 */

/**
 * @typedef {Object} ClaimMeta
 * @property {string} claimId
 * @property {ClaimType} claimType
 * @property {SourcingMode} sourcingMode
 * @property {"document_specific" | "externally_verifiable"} verifiability
 * @property {Object} [provenance]
 * @property {string} [provenance.pdfUrl]
 * @property {number} [provenance.page]
 * @property {string} [provenance.section]
 * @property {string} [provenance.doi]
 * @property {string} [provenance.pmid]
 * @property {Object} [pitfalls]
 * @property {boolean} [pitfalls.numeric_only_overlap]
 * @property {boolean} [pitfalls.year_mismatch]
 * @property {boolean} [pitfalls.denominator_mismatch]
 */

/**
 * @typedef {Object} ClaimContext
 * @property {string} claimId
 * @property {string} [url]
 * @property {string} [topic]
 * @property {string[]} [entities]
 * @property {string[]} [nearbySentences]
 * @property {string} [date]
 */

/**
 * @typedef {Object} Query
 * @property {string} claimId
 * @property {string} query
 * @property {"support" | "refute" | "background" | "factbox"} intent
 */

/**
 * @typedef {Object} CandidateDoc
 * @property {string} id
 * @property {string} [url]
 * @property {string} [title]
 * @property {string} [domain]
 * @property {string} [publishedAt]
 * @property {string} [snippet]
 * @property {number} [score]
 * @property {"internal_db" | "web_search" | "upload" | "archive"} source
 */

/**
 * @typedef {Object} EvidenceLocation
 * @property {number} [page]
 * @property {string} [section]
 * @property {number} [startChar]
 * @property {number} [endChar]
 * @property {string} [t]
 */

/**
 * @typedef {Object} EvidenceItem
 * @property {string} id
 * @property {string} claimId
 * @property {string} candidateId
 * @property {string} [url]
 * @property {string} [title]
 * @property {EvidenceLocation} [location]
 * @property {string} quote
 * @property {string} summary
 * @property {Verdict} stance
 * @property {number} quality
 * @property {string} [publishedAt]
 */

/**
 * @typedef {Object} Adjudication
 * @property {string} claimId
 * @property {Verdict} finalVerdict
 * @property {number} confidence
 * @property {string} rationale
 * @property {string[]} evidenceIds
 * @property {string[]} [counters]
 */

/**
 * @typedef {Object} ClaimMappingResult
 * @property {Claim} claim
 * @property {ClaimMeta} [meta]
 * @property {ClaimContext} [context]
 * @property {Query[]} queries
 * @property {CandidateDoc[]} candidates
 * @property {EvidenceItem[]} evidence
 * @property {Adjudication} adjudication
 */

/**
 * @typedef {Object} MapClaimsOptions
 * @property {number} [topKQueries]
 * @property {number} [topKCandidates]
 * @property {number} [maxEvidencePerDoc]
 * @property {string[]} [preferDomains]
 * @property {string[]} [avoidDomains]
 * @property {number} [minSourceQuality]
 * @property {number} [temperature]
 * @property {boolean} [enableWeb]
 * @property {boolean} [enableInternal]
 */

// This file is intentionally types-only (JSDoc). No runtime exports are required.
