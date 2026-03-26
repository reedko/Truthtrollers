// backend/src/core/claimTriageEngine.js
// Two-stage claim handling: extraction → triage/evaluation-worthiness

/**
 * ClaimTriageEngine
 *
 * Determines which extracted claims are worth sending to full evaluation.
 *
 * Decision factors:
 * - Evidence availability (retrieval count, distinct sources)
 * - Evidence quality (source quality scores, relevance scores)
 * - Claim properties (centrality, specificity, consequence, contestability)
 * - Novelty/importance (may be important despite sparse retrieval)
 */
export class ClaimTriageEngine {
  constructor(llm = null) {
    this.llm = llm; // Optional: for AI-based triage decisions
  }

  /**
   * Triage a single claim based on retrieval evidence and claim properties
   *
   * @param {Object} claim - The claim to triage
   * @param {Object} retrievalEvidence - Evidence from retrieval
   * @param {Object} claimProperties - Claim-level properties
   * @returns {Object} Triage decision
   */
  async triageClaim({
    claim,
    retrievalEvidence = {},
    claimProperties = {},
  }) {
    const {
      retrieval_count = 0,
      distinct_source_count = 0,
      max_relevance = 0,
      avg_top3_relevance = 0,
      stance_distribution = {}, // { support: 2, refute: 1, nuance: 0 }
      quality_weighted_evidence_mass = 0, // sum of (relevance * quality) scores
    } = retrievalEvidence;

    const {
      claim_centrality = 0.5,      // How central to source document
      claim_specificity = 0.5,     // Specific vs vague
      claim_consequence = 0.5,     // Real-world importance
      claim_contestability = 0.5,  // Could reasonable people dispute?
      claim_novelty = 0.5,         // Novel/obscure assertion
    } = claimProperties;

    // ========================================
    // RULE-BASED TRIAGE DECISION
    // ========================================

    // HIGH PRIORITY: Route to active evaluation
    if (
      retrieval_count >= 2 &&
      avg_top3_relevance >= 0.6 &&
      distinct_source_count >= 2
    ) {
      return {
        triage_status: 'active_evaluation',
        triaged_by: 'rule',
        triage_reasoning: `Strong evidence base: ${retrieval_count} sources, avg relevance ${avg_top3_relevance.toFixed(2)}`,
        confidence: 0.95,
      };
    }

    // NOVEL BUT IMPORTANT: Keep despite sparse retrieval
    if (
      retrieval_count === 0 &&
      (claim_centrality >= 0.75 || claim_consequence >= 0.75)
    ) {
      return {
        triage_status: 'novel_but_important',
        triaged_by: 'rule',
        triage_reasoning: `No retrieval but high centrality (${claim_centrality.toFixed(2)}) or consequence (${claim_consequence.toFixed(2)})`,
        confidence: 0.80,
      };
    }

    // LOW SALIENCE: Suppress from main flow
    if (
      retrieval_count === 0 &&
      claim_centrality < 0.3 &&
      claim_consequence < 0.3 &&
      claim_contestability < 0.3
    ) {
      return {
        triage_status: 'background_claim',
        triaged_by: 'rule',
        triage_reasoning: `Low salience: centrality=${claim_centrality.toFixed(2)}, consequence=${claim_consequence.toFixed(2)}, contestability=${claim_contestability.toFixed(2)}`,
        confidence: 0.90,
      };
    }

    // INSUFFICIENT RELEVANT SOURCES
    if (retrieval_count === 0 && claim_centrality >= 0.3) {
      // Not background noise, but no retrieval - could be retrieval failure
      return {
        triage_status: 'insufficient_relevant_sources',
        triaged_by: 'rule',
        triage_reasoning: `No retrieval despite moderate centrality (${claim_centrality.toFixed(2)}) - possible retrieval failure`,
        confidence: 0.75,
      };
    }

    // LOW PRIORITY: Some evidence but weak
    if (
      retrieval_count === 1 ||
      (retrieval_count >= 2 && avg_top3_relevance < 0.5)
    ) {
      return {
        triage_status: 'low_priority',
        triaged_by: 'rule',
        triage_reasoning: `Weak evidence: ${retrieval_count} sources, avg relevance ${avg_top3_relevance.toFixed(2)}`,
        confidence: 0.80,
      };
    }

    // NEEDS REWRITE: Poor relevance scores suggest phrasing issue
    if (
      retrieval_count >= 2 &&
      avg_top3_relevance < 0.4 &&
      claim_specificity < 0.4
    ) {
      return {
        triage_status: 'needs_rewrite_for_retrieval',
        triaged_by: 'rule',
        triage_reasoning: `Low relevance (${avg_top3_relevance.toFixed(2)}) + low specificity (${claim_specificity.toFixed(2)}) suggests rephrasing needed`,
        confidence: 0.70,
      };
    }

    // DEFAULT: Route to active evaluation (cautious approach)
    return {
      triage_status: 'active_evaluation',
      triaged_by: 'rule',
      triage_reasoning: `Default routing: ${retrieval_count} sources, specificity ${claim_specificity.toFixed(2)}`,
      confidence: 0.60,
    };
  }

  /**
   * AI-based triage using LLM classifier
   * More nuanced than rule-based, but slower
   */
  async triageClaimWithAI({
    claim,
    retrievalEvidence,
    claimProperties,
  }) {
    if (!this.llm) {
      console.warn('[ClaimTriage] No LLM available, falling back to rule-based');
      return this.triageClaim({ claim, retrievalEvidence, claimProperties });
    }

    const system = "You are a claim triage classifier. Return only valid JSON.";

    const user = `
Given this extracted claim and retrieval evidence, determine whether it should proceed to public evaluation.

CLAIM: "${claim}"

RETRIEVAL EVIDENCE:
- Retrieved source claims: ${retrievalEvidence.retrieval_count || 0}
- Distinct sources/domains: ${retrievalEvidence.distinct_source_count || 0}
- Max relevance: ${retrievalEvidence.max_relevance || 0}
- Avg top-3 relevance: ${retrievalEvidence.avg_top3_relevance || 0}
- Quality-weighted evidence: ${retrievalEvidence.quality_weighted_evidence_mass || 0}

CLAIM PROPERTIES:
- Centrality to source: ${claimProperties.claim_centrality || 0.5}
- Specificity: ${claimProperties.claim_specificity || 0.5}
- Consequence: ${claimProperties.claim_consequence || 0.5}
- Contestability: ${claimProperties.claim_contestability || 0.5}
- Novelty: ${claimProperties.claim_novelty || 0.5}

TRIAGE OPTIONS:
1. ACTIVE_EVALUATION - Has enough evidence, worth public evaluation
2. BACKGROUND_CLAIM - Low salience/consequence, uncontested
3. INSUFFICIENT_RELEVANT_SOURCES - Not enough retrieved source claims
4. NEEDS_REWRITE_FOR_RETRIEVAL - Poorly phrased for retrieval
5. NOVEL_BUT_IMPORTANT - Sparse evidence but high centrality/consequence
6. LOW_PRIORITY - Some evidence but weak

CONSIDER:
- Number of genuinely relevant retrieved source claims
- Diversity of sources (distinct domains/documents)
- Whether the claim is central to the source case
- Whether the claim is specific and contestable
- Whether it has real-world consequence
- Whether retrieval failure appears due to weak phrasing vs lack of interest

Return JSON: {
  "triage_status": "ACTIVE_EVALUATION|BACKGROUND_CLAIM|...",
  "reasoning": "brief explanation of decision",
  "confidence": 0.0-1.0
}
`.trim();

    const schemaHint = '{"triage_status":"ACTIVE_EVALUATION","reasoning":"","confidence":0.0}';

    try {
      const result = await this.llm.generate({
        system,
        user,
        schemaHint,
        temperature: 0.1,
      });

      return {
        triage_status: result.triage_status?.toLowerCase() || 'active_evaluation',
        triaged_by: 'ai',
        triage_reasoning: result.reasoning || '',
        confidence: result.confidence || 0.5,
      };
    } catch (err) {
      console.error('[ClaimTriage] AI triage failed, falling back to rules:', err.message);
      return this.triageClaim({ claim, retrievalEvidence, claimProperties });
    }
  }

  /**
   * Batch triage multiple claims
   */
  async triageClaimsBatch({
    claims,
    retrievalEvidenceMap = {}, // { claim_id: retrievalEvidence }
    claimPropertiesMap = {},    // { claim_id: claimProperties }
    useAI = false,
  }) {
    const results = [];

    for (const claim of claims) {
      const claimId = claim.claim_id || claim.id;
      const retrievalEvidence = retrievalEvidenceMap[claimId] || {};
      const claimProperties = claimPropertiesMap[claimId] || {};

      const triageResult = useAI
        ? await this.triageClaimWithAI({
            claim: claim.claim_text || claim.text || claim,
            retrievalEvidence,
            claimProperties,
          })
        : await this.triageClaim({
            claim: claim.claim_text || claim.text || claim,
            retrievalEvidence,
            claimProperties,
          });

      results.push({
        claim_id: claimId,
        claim_text: claim.claim_text || claim.text || claim,
        ...triageResult,
      });
    }

    return results;
  }

  /**
   * Calculate quality-weighted evidence mass
   * Combines relevance scores and source quality scores
   * Both use 0-10 scale (matching GameSpace), normalized to 0-1 for multiplication
   */
  calculateEvidenceMass(retrievedSources) {
    if (!Array.isArray(retrievedSources) || retrievedSources.length === 0) {
      return 0;
    }

    let totalMass = 0;
    for (const source of retrievedSources) {
      const relevance = source.relevance_score || 0; // Already 0-1 scale
      const quality = (source.source_quality_score || 5.0) / 10; // Normalize 0-10 to 0-1
      totalMass += relevance * quality;
    }

    return totalMass;
  }

  /**
   * Analyze stance distribution from retrieved sources
   */
  analyzeStanceDistribution(retrievedSources) {
    const distribution = {
      support: 0,
      refute: 0,
      nuance: 0,
      neutral: 0,
      unclear: 0,
    };

    for (const source of retrievedSources || []) {
      const stance = source.stance || 'unclear';
      if (distribution.hasOwnProperty(stance)) {
        distribution[stance]++;
      }
    }

    return distribution;
  }

  /**
   * Get recommended UI display strategy based on triage status
   */
  getDisplayStrategy(triageStatus) {
    const strategies = {
      'active_evaluation': {
        display: 'prominent',
        priority: 1,
        showInMainFlow: true,
        badgeText: null,
        badgeColor: null,
      },
      'novel_but_important': {
        display: 'prominent',
        priority: 2,
        showInMainFlow: true,
        badgeText: 'Novel claim - limited sources',
        badgeColor: 'amber',
      },
      'low_priority': {
        display: 'collapsed',
        priority: 3,
        showInMainFlow: true,
        badgeText: 'Low priority',
        badgeColor: 'gray',
      },
      'insufficient_relevant_sources': {
        display: 'hidden',
        priority: 4,
        showInMainFlow: false,
        badgeText: 'Insufficient evidence',
        badgeColor: 'gray',
      },
      'background_claim': {
        display: 'hidden',
        priority: 5,
        showInMainFlow: false,
        badgeText: 'Background claim',
        badgeColor: 'gray',
      },
      'needs_rewrite_for_retrieval': {
        display: 'hidden',
        priority: 6,
        showInMainFlow: false,
        badgeText: 'Needs rephrasing',
        badgeColor: 'yellow',
      },
    };

    return strategies[triageStatus] || strategies['active_evaluation'];
  }
}
