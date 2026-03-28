// backend/src/core/sourceQualityScorer.js
// Quantitative source quality assessment (0-100 scoring)

/**
 * SourceQualityScorer
 *
 * Evaluates source quality across multiple dimensions using quantitative 0-10 scores.
 * Uses the same scoring scale as GameSpace (max 10 points).
 * Distinguishes quality signals from risk signals.
 *
 * Quality dimensions (higher = better, 0-10 scale):
 * - author_transparency: Named author, credentials, traceable identity
 * - publisher_transparency: About page, editorial standards, ownership
 * - evidence_density: Citations, documents, data, primary source quotations
 * - claim_specificity: Concrete testable claims vs vague rhetoric
 * - correction_behavior: Corrections policy, updates, retractions
 * - domain_reputation: Historical reliability vs better-grounded sources
 * - original_reporting: Firsthand reporting higher, copied opinion chains lower
 *
 * Risk dimensions (higher = riskier, 0-10 scale):
 * - sensationalism_score: Emotional framing, certainty inflation, outrage bait
 * - monetization_pressure: Popups, affiliate stuffing, clickbait structure
 */
export class SourceQualityScorer {
  constructor(llm = null, query = null, promptManager = null) {
    this.llm = llm;
    this.query = query; // Database query function
    this.promptManager = promptManager; // Prompt manager for DB prompts
  }

  /**
   * Score a source across all quality dimensions
   * Returns scores 0-100 for each dimension
   */
  async scoreSource({
    content_id,
    content_text,
    metadata = {},
    url = '',
    domain = '',
  }) {
    // Try AI-based scoring first if available
    if (this.llm && content_text) {
      try {
        return await this.scoreSourceWithAI({
          content_text,
          metadata,
          url,
          domain,
        });
      } catch (err) {
        console.warn('[SourceQuality] AI scoring failed, falling back to heuristics:', err.message);
      }
    }

    // Fallback to heuristic scoring
    return this.scoreSourceHeuristic({
      content_text,
      metadata,
      url,
      domain,
    });
  }

  /**
   * AI-based source quality scoring
   */
  async scoreSourceWithAI({
    content_text,
    metadata,
    url,
    domain,
  }) {
    // Fallback prompts (used if DB load fails)
    const fallbackSystem = "You are a source quality evaluator. Return only valid JSON with scores 0-10 (matching GameSpace scoring scale).";

    const citationInfo = metadata.citationCount !== undefined
      ? `- Citations Extracted: ${metadata.citationCount} citations/references found`
      : '';

    const citationNote = metadata.citationCount !== undefined
      ? `Note: ${metadata.citationCount} citations were extracted from this source.`
      : '';

    const fallbackUser = `
Evaluate this source across multiple quality dimensions. Score each 0-10 (same scale as GameSpace points).

SOURCE METADATA:
- URL: ${url || 'unknown'}
- Domain: ${domain || 'unknown'}
- Author: ${metadata.author || 'unknown'}
- Publisher: ${metadata.publisher || 'unknown'}
- Date: ${metadata.date || 'unknown'}
${citationInfo}

CONTENT PREVIEW (first 2000 chars):
${content_text.substring(0, 2000)}

SCORE EACH DIMENSION (0-10 scale):

TRANSPARENCY:
1. author_transparency: Named author with credentials and traceable identity?
   10 = Named expert with verifiable credentials
   5 = Named author, unclear credentials
   0 = Anonymous or pseudonymous

2. publisher_transparency: Clear about page, editorial standards, ownership?
   10 = Major publication with clear standards
   5 = Some transparency, unclear ownership
   0 = No transparency, hidden ownership

EVIDENCE QUALITY:
3. evidence_density: Citations, documents, data, primary source quotations?
   ${citationNote}
   10 = Extensive citations and primary sources (15+ citations)
   5 = Some evidence, limited citations (3-10 citations)
   0 = Opinion without evidence (0-2 citations)

4. claim_specificity: Concrete testable claims vs vague rhetoric?
   10 = Specific, falsifiable claims with details
   5 = Mix of specific and vague
   0 = All vague assertions

RELIABILITY:
5. correction_behavior: Corrections/updates visible in this content?
   10 = Clear corrections/updates visible
   5 = Some corrections visible
   0 = No corrections visible

ORIGINALITY:
6. original_reporting: Firsthand reporting vs recycled assertions?
   10 = Original investigative reporting
   5 = Mix of original and aggregated
   0 = All recycled content, no original work

RISK INDICATORS (higher = riskier):
7. sensationalism_score: Emotional framing, certainty inflation, outrage bait?
   10 = Extreme sensationalism, all-caps, outrage maximization
   5 = Some emotional language, moderate framing
   0 = Neutral, measured tone

8. monetization_pressure: Visible signs of aggressive monetization?
   10 = Heavy affiliate links, clickbait structure
   5 = Some promotional content
   0 = Minimal commercial pressure evident

Return JSON:
{
  "author_transparency": 0-10,
  "publisher_transparency": 0-10,
  "evidence_density": 0-10,
  "claim_specificity": 0-10,
  "correction_behavior": 0-10,
  "original_reporting": 0-10,
  "sensationalism_score": 0-10,
  "monetization_pressure": 0-10,
  "reasoning": "brief explanation"
}
`.trim();

    let system = fallbackSystem;
    let user = fallbackUser;

    // Try to load from database if promptManager is available
    if (this.promptManager) {
      try {
        const systemPrompt = await this.promptManager.getPrompt(
          'source_quality_evaluation_system',
          { system: fallbackSystem, user: '', parameters: {} }
        );

        const userPrompt = await this.promptManager.getPrompt(
          'source_quality_evaluation_user',
          { system: '', user: fallbackUser, parameters: {} }
        );

        system = systemPrompt.system;
        user = userPrompt.user
          .replace(/\{\{url\}\}/g, url || 'unknown')
          .replace(/\{\{domain\}\}/g, domain || 'unknown')
          .replace(/\{\{author\}\}/g, metadata.author || 'unknown')
          .replace(/\{\{publisher\}\}/g, metadata.publisher || 'unknown')
          .replace(/\{\{date\}\}/g, metadata.date || 'unknown')
          .replace(/\{\{citationInfo\}\}/g, citationInfo)
          .replace(/\{\{contentPreview\}\}/g, content_text.substring(0, 2000))
          .replace(/\{\{citationNote\}\}/g, citationNote);
      } catch (err) {
        console.warn('[SourceQuality] Error loading DB prompts, using fallback:', err.message);
      }
    }

    const schemaHint = `{
  "author_transparency": 5.0,
  "publisher_transparency": 5.0,
  "evidence_density": 5.0,
  "claim_specificity": 5.0,
  "correction_behavior": 5.0,
  "original_reporting": 5.0,
  "sensationalism_score": 5.0,
  "monetization_pressure": 5.0,
  "reasoning": ""
}`;

    const result = await this.llm.generate({
      system,
      user,
      schemaHint,
      temperature: 0.1,
    });

    // Calculate aggregate scores
    const quality_score = this.calculateQualityScore(result);
    const risk_score = this.calculateRiskScore(result);
    const quality_tier = this.classifyQualityTier(quality_score, risk_score);

    return {
      ...result,
      quality_score,
      risk_score,
      quality_tier,
    };
  }

  /**
   * Heuristic-based source quality scoring
   * Fast fallback when AI is unavailable
   * Uses 0-10 scale to match GameSpace
   */
  scoreSourceHeuristic({
    content_text,
    metadata,
    url,
    domain,
  }) {
    const scores = {
      author_transparency: 5.0,
      publisher_transparency: 5.0,
      evidence_density: 5.0,
      claim_specificity: 5.0,
      correction_behavior: 5.0,
      original_reporting: 5.0,
      sensationalism_score: 5.0,
      monetization_pressure: 5.0,
      reasoning: 'Heuristic scoring (no AI available)',
    };

    // Author transparency (0-10 scale)
    if (metadata.author && metadata.author !== 'unknown') {
      scores.author_transparency = 6.0;
      if (metadata.author_credentials) {
        scores.author_transparency = 7.5;
      }
    } else {
      scores.author_transparency = 3.0;
    }

    // Evidence density - use actual extracted citations if available
    if (metadata.citationCount !== undefined) {
      // Use actual citation count from scraping (more accurate)
      // Scale: 0 citations = 0, 5 citations = 5, 15+ citations = 10
      scores.evidence_density = Math.min(10, (metadata.citationCount / 1.5));
    } else {
      // Fallback: count citation patterns in text
      const citationCount = (content_text.match(/\[\d+\]/g) || []).length;
      const numberCount = (content_text.match(/\d+%|\d+\.\d+/g) || []).length;
      const quoteCount = (content_text.match(/[""].*?[""]|".*?"/g) || []).length;
      const rawEvidence = citationCount * 10 + numberCount * 2 + quoteCount * 3;
      scores.evidence_density = Math.min(10, rawEvidence / 10);
    }

    // Sensationalism (detect all-caps, exclamation marks, extreme language) - scale to 0-10
    const allCapsWords = (content_text.match(/\b[A-Z]{4,}\b/g) || []).length;
    const exclamations = (content_text.match(/!/g) || []).length;
    const rawSensational = allCapsWords * 15 + exclamations * 5;
    scores.sensationalism_score = Math.min(10, rawSensational / 10); // Scale to 0-10

    // Domain reputation (simple whitelist/blacklist) - 0-10 scale
    const highQualityDomains = [
      'nytimes.com', 'washingtonpost.com', 'reuters.com', 'apnews.com',
      'nature.com', 'science.org', 'nih.gov', 'gov', 'edu',
    ];
    const lowQualityDomains = [
      'naturalnews.com', 'infowars.com', 'beforeitsnews.com',
    ];

    if (highQualityDomains.some(d => domain.includes(d))) {
      scores.domain_reputation = 8.5;
      scores.publisher_transparency = 8.0;
    } else if (lowQualityDomains.some(d => domain.includes(d))) {
      scores.domain_reputation = 2.0;
      scores.publisher_transparency = 3.0;
    }

    // Calculate aggregates
    const quality_score = this.calculateQualityScore(scores);
    const risk_score = this.calculateRiskScore(scores);
    const quality_tier = this.classifyQualityTier(quality_score, risk_score);

    return {
      ...scores,
      quality_score,
      risk_score,
      quality_tier,
    };
  }

  /**
   * Calculate aggregate quality score (weighted average)
   * Returns 0-10 scale to match GameSpace
   */
  calculateQualityScore(scores) {
    const weights = {
      author_transparency: 1.0,
      publisher_transparency: 1.2,
      evidence_density: 1.5,      // Emphasize evidence
      claim_specificity: 1.3,
      correction_behavior: 1.0,
      original_reporting: 1.1,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [dimension, weight] of Object.entries(weights)) {
      if (scores[dimension] !== undefined && scores[dimension] !== null) {
        weightedSum += scores[dimension] * weight;
        totalWeight += weight;
      }
    }

    // Return 0-10 scale, rounded to 1 decimal (matching GameSpace format)
    return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 5.0;
  }

  /**
   * Calculate aggregate risk score (weighted average)
   * Returns 0-10 scale to match GameSpace
   */
  calculateRiskScore(scores) {
    const weights = {
      sensationalism_score: 1.5,      // Emphasize sensationalism
      monetization_pressure: 1.0,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [dimension, weight] of Object.entries(weights)) {
      if (scores[dimension] !== undefined && scores[dimension] !== null) {
        weightedSum += scores[dimension] * weight;
        totalWeight += weight;
      }
    }

    // Return 0-10 scale, rounded to 1 decimal (matching GameSpace format)
    return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 5.0;
  }

  /**
   * Classify quality tier based on quality and risk scores (0-10 scale)
   */
  classifyQualityTier(quality_score, risk_score) {
    // High quality: quality > 7.0 and risk < 3.0
    if (quality_score > 7.0 && risk_score < 3.0) {
      return 'high';
    }

    // Unreliable: quality < 4.0 or risk > 7.0
    if (quality_score < 4.0 || risk_score > 7.0) {
      return 'unreliable';
    }

    // Low quality: quality < 5.0
    if (quality_score < 5.0) {
      return 'low';
    }

    // Mid quality: everything else
    return 'mid';
  }

  /**
   * Save source quality scores to database
   */
  async saveScores(content_id, scores) {
    if (!this.query) {
      console.warn('[SourceQuality] No database query function available');
      return;
    }

    const sql = `
      INSERT INTO source_quality_scores (
        content_id,
        author_transparency,
        publisher_transparency,
        evidence_density,
        claim_specificity,
        correction_behavior,
        domain_reputation,
        original_reporting,
        sensationalism_score,
        monetization_pressure,
        quality_score,
        risk_score,
        quality_tier,
        scored_by,
        scoring_model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        author_transparency = VALUES(author_transparency),
        publisher_transparency = VALUES(publisher_transparency),
        evidence_density = VALUES(evidence_density),
        claim_specificity = VALUES(claim_specificity),
        correction_behavior = VALUES(correction_behavior),
        domain_reputation = VALUES(domain_reputation),
        original_reporting = VALUES(original_reporting),
        sensationalism_score = VALUES(sensationalism_score),
        monetization_pressure = VALUES(monetization_pressure),
        quality_score = VALUES(quality_score),
        risk_score = VALUES(risk_score),
        quality_tier = VALUES(quality_tier),
        scored_at = CURRENT_TIMESTAMP
    `;

    const params = [
      content_id,
      scores.author_transparency,
      scores.publisher_transparency,
      scores.evidence_density,
      scores.claim_specificity,
      scores.correction_behavior,
      scores.domain_reputation || 5.0, // Default to 5.0 (not scored by LLM anymore)
      scores.original_reporting,
      scores.sensationalism_score,
      scores.monetization_pressure,
      scores.quality_score,
      scores.risk_score,
      scores.quality_tier,
      this.llm ? 'ai' : 'auto',
      this.llm ? 'gpt-4' : 'heuristic',
    ];

    try {
      await this.query(sql, params);
      console.log(`[SourceQuality] Saved scores for content_id=${content_id}, tier=${scores.quality_tier}`);
    } catch (err) {
      console.error('[SourceQuality] Failed to save scores:', err.message);
    }
  }

  /**
   * Retrieve quality scores for a content item
   */
  async getScores(content_id) {
    if (!this.query) {
      return null;
    }

    const sql = `
      SELECT * FROM source_quality_scores
      WHERE content_id = ?
    `;

    try {
      const [rows] = await this.query(sql, [content_id]);
      return rows.length > 0 ? rows[0] : null;
    } catch (err) {
      console.error('[SourceQuality] Failed to retrieve scores:', err.message);
      return null;
    }
  }

  /**
   * Batch score multiple sources
   */
  async scoreSourcesBatch(sources) {
    const results = [];

    for (const source of sources) {
      const scores = await this.scoreSource({
        content_id: source.content_id,
        content_text: source.content_text || source.text,
        metadata: source.metadata || {},
        url: source.url || '',
        domain: source.domain || '',
      });

      results.push({
        content_id: source.content_id,
        ...scores,
      });

      // Save to database if available
      if (this.query && source.content_id) {
        await this.saveScores(source.content_id, scores);
      }
    }

    return results;
  }
}
