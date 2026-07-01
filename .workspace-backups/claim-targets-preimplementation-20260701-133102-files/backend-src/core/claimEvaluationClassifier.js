// backend/src/core/claimEvaluationClassifier.js
// Integrated system for determining claim evaluation-worthiness

import { ClaimTriageEngine } from './claimTriageEngine.js';
import { SourceQualityScorer } from './sourceQualityScorer.js';

/**
 * ClaimEvaluationClassifier
 *
 * Orchestrates the full pipeline:
 * 1. Score source quality (0-100 quantitative)
 * 2. Retrieve evidence for each claim
 * 3. Calculate claim properties (centrality, specificity, etc.)
 * 4. Triage claims into evaluation-worthy vs suppressed
 * 5. Provide UI display recommendations
 */
export class ClaimEvaluationClassifier {
  constructor(llm = null, query = null, promptManager = null) {
    this.llm = llm;
    this.query = query;
    this.promptManager = promptManager;
    this.triageEngine = new ClaimTriageEngine(llm, promptManager);
    this.qualityScorer = new SourceQualityScorer(llm, query, promptManager);
  }

  /**
   * Calculate claim properties using LLM or heuristics
   */
  async calculateClaimProperties({
    claim_text,
    source_document_text = '',
    source_document_metadata = {},
  }) {
    if (this.llm) {
      try {
        return await this.calculateClaimPropertiesWithAI({
          claim_text,
          source_document_text,
          source_document_metadata,
        });
      } catch (err) {
        console.warn('[ClaimClassifier] AI property calculation failed:', err.message);
      }
    }

    // Fallback to heuristics
    return this.calculateClaimPropertiesHeuristic({
      claim_text,
      source_document_text,
    });
  }

  /**
   * AI-based claim property calculation
   */
  async calculateClaimPropertiesWithAI({
    claim_text,
    source_document_text,
    source_document_metadata,
  }) {
    // Fallback prompts (used if DB load fails)
    const fallbackSystem = "You are a claim property evaluator. Return only valid JSON with scores 0.00-1.00.";

    const fallbackUser = `
Evaluate this claim across multiple dimensions. Score each 0.00-1.00.

CLAIM: "${claim_text}"

SOURCE DOCUMENT PREVIEW (first 1500 chars):
${source_document_text.substring(0, 1500)}

SCORE EACH DIMENSION (0.00-1.00):

1. claim_centrality: How central is this claim to the source document's argument?
   1.00 = Core thesis or primary claim
   0.50 = Important supporting claim
   0.00 = Tangential mention or background

2. claim_specificity: How specific and falsifiable is this claim?
   1.00 = Concrete, specific, includes numbers/dates/names
   0.50 = Somewhat specific but vague details
   0.00 = Vague, generic, subjective opinion

3. claim_consequence: What are the real-world stakes of this claim?
   1.00 = High consequence (public health, major policy, safety)
   0.50 = Moderate consequence (personal decisions, local impact)
   0.00 = Low consequence (trivial, low-stakes)

4. claim_contestability: Would reasonable people dispute this claim?
   1.00 = Highly contested, significant disagreement
   0.50 = Some debate, mixed evidence
   0.00 = Widely accepted fact or obvious statement

5. claim_novelty: Is this a novel/obscure/fringe assertion?
   1.00 = Novel, unusual, rarely discussed
   0.50 = Somewhat novel, emerging discussion
   0.00 = Well-known, commonly discussed

Return JSON:
{
  "claim_centrality": 0.00-1.00,
  "claim_specificity": 0.00-1.00,
  "claim_consequence": 0.00-1.00,
  "claim_contestability": 0.00-1.00,
  "claim_novelty": 0.00-1.00,
  "reasoning": "brief explanation"
}
`.trim();

    let system = fallbackSystem;
    let user = fallbackUser;

    // Try to load from database if promptManager is available
    if (this.promptManager) {
      try {
        const systemPrompt = await this.promptManager.getPrompt(
          'claim_properties_evaluation_system',
          { system: fallbackSystem, user: '', parameters: {} }
        );

        const userPrompt = await this.promptManager.getPrompt(
          'claim_properties_evaluation_user',
          { system: '', user: fallbackUser, parameters: {} }
        );

        system = systemPrompt.system;
        user = userPrompt.user
          .replace(/\{\{claim_text\}\}/g, claim_text)
          .replace(/\{\{source_document_preview\}\}/g, source_document_text.substring(0, 1500));
      } catch (err) {
        console.warn('[ClaimClassifier] Error loading DB prompts, using fallback:', err.message);
      }
    }

    const schemaHint = `{
  "claim_centrality": 0.50,
  "claim_specificity": 0.50,
  "claim_consequence": 0.50,
  "claim_contestability": 0.50,
  "claim_novelty": 0.50,
  "reasoning": ""
}`;

    const result = await this.llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.1,
    });

    return {
      claim_centrality: result.claim_centrality || 0.5,
      claim_specificity: result.claim_specificity || 0.5,
      claim_consequence: result.claim_consequence || 0.5,
      claim_contestability: result.claim_contestability || 0.5,
      claim_novelty: result.claim_novelty || 0.5,
      reasoning: result.reasoning || '',
    };
  }

  /**
   * Heuristic claim property calculation
   */
  calculateClaimPropertiesHeuristic({
    claim_text,
    source_document_text,
  }) {
    // Specificity: detect numbers, dates, names
    const hasNumbers = /\d+%|\d+\.\d+|\d+ (million|billion|thousand)/.test(claim_text);
    const hasDate = /\d{4}|january|february|march|april|may|june|july|august|september|october|november|december/i.test(claim_text);
    const hasProperNoun = /[A-Z][a-z]+\s[A-Z][a-z]+/.test(claim_text);
    const claim_specificity = (hasNumbers ? 0.4 : 0) + (hasDate ? 0.3 : 0) + (hasProperNoun ? 0.3 : 0);

    // Centrality: how many times claim appears in source
    const claimWords = claim_text.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    let centralityScore = 0;
    for (const word of claimWords) {
      const regex = new RegExp(word, 'gi');
      const matches = (source_document_text.match(regex) || []).length;
      centralityScore += Math.min(matches, 5); // Cap per word
    }
    const claim_centrality = Math.min(1.0, centralityScore / 20);

    // Consequence: keywords suggesting high stakes
    const highConsequenceKeywords = [
      'death', 'cancer', 'disease', 'poison', 'toxic', 'deadly',
      'billion', 'trillion', 'war', 'pandemic', 'crisis',
      'illegal', 'fraud', 'criminal', 'scandal',
    ];
    const hasHighConsequence = highConsequenceKeywords.some(kw =>
      claim_text.toLowerCase().includes(kw)
    );
    const claim_consequence = hasHighConsequence ? 0.8 : 0.4;

    // Contestability: presence of "disputed" language
    const contestableKeywords = [
      'claim', 'alleged', 'reportedly', 'disputed', 'controversial',
      'debate', 'question', 'uncertain',
    ];
    const hasContestable = contestableKeywords.some(kw =>
      source_document_text.toLowerCase().includes(kw)
    );
    const claim_contestability = hasContestable ? 0.7 : 0.5;

    // Novelty: hard to determine heuristically, default to medium
    const claim_novelty = 0.5;

    return {
      claim_centrality,
      claim_specificity,
      claim_consequence,
      claim_contestability,
      claim_novelty,
      reasoning: 'Heuristic calculation',
    };
  }

  /**
   * Full pipeline: classify claim evaluation-worthiness
   */
  async classifyClaim({
    claim_id,
    claim_text,
    source_content_id,
    source_content_text = '',
    source_content_metadata = {},
    retrieved_sources = [], // Array of { content_id, claim_text, relevance_score, stance }
  }) {
    console.log(`[ClaimClassifier] Classifying claim ${claim_id}...`);

    // Step 1: Calculate claim properties
    const claimProperties = await this.calculateClaimProperties({
      claim_text,
      source_document_text: source_content_text,
      source_document_metadata: source_content_metadata,
    });

    console.log(`[ClaimClassifier] Claim properties:`, claimProperties);

    // Step 2: Score quality of retrieved sources
    const sourcesWithQuality = [];
    for (const source of retrieved_sources) {
      // Check if we already have quality scores
      let qualityScores = null;
      if (this.query && source.content_id) {
        qualityScores = await this.qualityScorer.getScores(source.content_id);
      }

      // If not, calculate them
      if (!qualityScores && source.content_text) {
        qualityScores = await this.qualityScorer.scoreSource({
          content_id: source.content_id,
          content_text: source.content_text,
          metadata: source.metadata || {},
          url: source.url || '',
          domain: source.domain || '',
        });

        // Save to DB if available
        if (this.query && source.content_id) {
          await this.qualityScorer.saveScores(source.content_id, qualityScores);
        }
      }

      sourcesWithQuality.push({
        ...source,
        quality_score: qualityScores?.quality_score || 50,
        quality_tier: qualityScores?.quality_tier || 'mid',
      });
    }

    // Step 3: Calculate retrieval evidence metrics
    const retrieval_count = sourcesWithQuality.filter(s => s.relevance_score >= 0.5).length;
    const distinct_source_count = new Set(sourcesWithQuality.map(s => s.content_id)).size;
    const max_relevance = Math.max(...sourcesWithQuality.map(s => s.relevance_score || 0), 0);

    const top3 = sourcesWithQuality
      .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
      .slice(0, 3);
    const avg_top3_relevance = top3.length > 0
      ? top3.reduce((sum, s) => sum + (s.relevance_score || 0), 0) / top3.length
      : 0;

    const quality_weighted_evidence_mass = this.triageEngine.calculateEvidenceMass(
      sourcesWithQuality
    );

    const stance_distribution = this.triageEngine.analyzeStanceDistribution(
      sourcesWithQuality
    );

    const retrievalEvidence = {
      retrieval_count,
      distinct_source_count,
      max_relevance,
      avg_top3_relevance,
      quality_weighted_evidence_mass,
      stance_distribution,
    };

    console.log(`[ClaimClassifier] Retrieval evidence:`, retrievalEvidence);

    // Step 4: Triage the claim
    const triageResult = await this.triageEngine.triageClaim({
      claim: claim_text,
      retrievalEvidence,
      claimProperties,
    });

    console.log(`[ClaimClassifier] Triage result:`, triageResult);

    // Step 5: Get display strategy
    const displayStrategy = this.triageEngine.getDisplayStrategy(
      triageResult.triage_status
    );

    return {
      claim_id,
      claim_text,
      triage_status: triageResult.triage_status,
      triaged_by: triageResult.triaged_by,
      triage_reasoning: triageResult.triage_reasoning,
      confidence: triageResult.confidence,
      claim_properties: claimProperties,
      retrieval_evidence: retrievalEvidence,
      display_strategy: displayStrategy,
      retrieved_sources_with_quality: sourcesWithQuality,
    };
  }

  /**
   * Batch classify multiple claims
   */
  async classifyClaimsBatch({
    claims, // Array of { claim_id, claim_text, source_content_id }
    source_content_map = {}, // { content_id: { text, metadata } }
    retrieved_sources_map = {}, // { claim_id: [ { content_id, claim_text, relevance_score, stance } ] }
  }) {
    const results = [];

    for (const claim of claims) {
      const sourceContent = source_content_map[claim.source_content_id] || {};
      const retrievedSources = retrieved_sources_map[claim.claim_id] || [];

      const result = await this.classifyClaim({
        claim_id: claim.claim_id,
        claim_text: claim.claim_text,
        source_content_id: claim.source_content_id,
        source_content_text: sourceContent.text || '',
        source_content_metadata: sourceContent.metadata || {},
        retrieved_sources: retrievedSources,
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Save triage results to database
   */
  async saveTriageResults(claim_id, triageResult) {
    if (!this.query) {
      console.warn('[ClaimClassifier] No database query function available');
      return;
    }

    const sql = `
      UPDATE claims
      SET
        triage_status = ?,
        claim_centrality = ?,
        claim_specificity = ?,
        claim_consequence = ?,
        claim_contestability = ?,
        claim_novelty = ?,
        retrieval_count = ?,
        distinct_source_count = ?,
        max_relevance = ?,
        avg_top3_relevance = ?,
        triaged_at = CURRENT_TIMESTAMP,
        triaged_by = ?,
        triage_reasoning = ?
      WHERE claim_id = ?
    `;

    const params = [
      triageResult.triage_status,
      triageResult.claim_properties.claim_centrality,
      triageResult.claim_properties.claim_specificity,
      triageResult.claim_properties.claim_consequence,
      triageResult.claim_properties.claim_contestability,
      triageResult.claim_properties.claim_novelty,
      triageResult.retrieval_evidence.retrieval_count,
      triageResult.retrieval_evidence.distinct_source_count,
      triageResult.retrieval_evidence.max_relevance,
      triageResult.retrieval_evidence.avg_top3_relevance,
      triageResult.triaged_by,
      triageResult.triage_reasoning,
      claim_id,
    ];

    try {
      await this.query(sql, params);
      console.log(`[ClaimClassifier] Saved triage results for claim_id=${claim_id}`);
    } catch (err) {
      console.error('[ClaimClassifier] Failed to save triage results:', err.message);
    }
  }

  /**
   * Save retrieval evidence to database
   */
  async saveRetrievalEvidence(case_claim_id, retrieved_sources) {
    if (!this.query) {
      return;
    }

    const sql = `
      INSERT INTO claim_retrieval_evidence (
        case_claim_id,
        source_claim_id,
        relevance_score,
        stance,
        source_quality_score,
        source_quality_tier,
        retrieval_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        relevance_score = VALUES(relevance_score),
        stance = VALUES(stance),
        source_quality_score = VALUES(source_quality_score),
        source_quality_tier = VALUES(source_quality_tier)
    `;

    for (const source of retrieved_sources) {
      const params = [
        case_claim_id,
        source.claim_id || source.source_claim_id,
        source.relevance_score || null,
        source.stance || null,
        source.quality_score || null,
        source.quality_tier || null,
        source.retrieval_method || 'embedding',
      ];

      try {
        await this.query(sql, params);
      } catch (err) {
        console.error('[ClaimClassifier] Failed to save retrieval evidence:', err.message);
      }
    }
  }
}
