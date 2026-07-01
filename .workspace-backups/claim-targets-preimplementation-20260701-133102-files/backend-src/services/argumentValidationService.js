/**
 * Argument Validation Service
 *
 * Handles validation pipeline for staged arguments:
 * - Civility filtering
 * - Logical fallacy detection
 * - Citation relevance scoring
 * - AI quality assessment
 */

import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.REACT_APP_OPENAI_API_KEY,
});

// =====================================================
// Civility Filter
// =====================================================

/**
 * Detect abusive language, insults, and uncivil terms
 * @param {string} text - The text to check
 * @returns {Promise<{passed: boolean, flaggedTerms: string[]}>}
 */
export async function checkCivility(text) {
  // Basic pattern matching for common uncivil terms
  const uncivilPatterns = [
    /\b(idiot|moron|stupid|dumb|pathetic)\b/gi,
    /\b(shut\s+up|stfu)\b/gi,
    /\b(liar|lying|lies)\b/gi,
    /\b(trash|garbage|worthless)\b/gi,
    /\b(hate\s+you|screw\s+you)\b/gi,
    /\b(suck|sucks|you\s+suck|libs\s+suck)\b/gi,
    /\b(loser|losers)\b/gi,
  ];

  const flaggedTerms = [];

  for (const pattern of uncivilPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      flaggedTerms.push(...matches.map(m => m.toLowerCase()));
    }
  }

  // Use AI for more nuanced detection
  if (flaggedTerms.length === 0) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a civility checker. Analyze the following text for:
- Personal attacks or ad hominem
- Abusive language
- Trolling or bad faith arguments
- Derogatory terms

Respond with JSON: {"is_civil": true/false, "flagged_phrases": ["phrase1", "phrase2"]}`
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(response.choices[0].message.content);

      if (!result.is_civil && result.flagged_phrases) {
        flaggedTerms.push(...result.flagged_phrases);
      }
    } catch (error) {
      console.error('AI civility check failed:', error);
      // Fall back to pattern matching only
    }
  }

  return {
    passed: flaggedTerms.length === 0,
    flaggedTerms: [...new Set(flaggedTerms)] // Remove duplicates
  };
}

// =====================================================
// Logical Fallacy Detection
// =====================================================

/**
 * Detect logical fallacies in reasoning
 * @param {string} claim - The main claim
 * @param {string} reasoning - The reasoning text
 * @returns {Promise<{passed: boolean, fallacies: Array}>}
 */
export async function detectFallacies(claim, reasoning) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a logical fallacy detector. Analyze arguments for common fallacies:

1. Ad Hominem - Attacking the person instead of the argument
2. Strawman - Misrepresenting opponent's position
3. False Dichotomy - Presenting only two options when more exist
4. Appeal to Emotion - Using emotions instead of logic
5. Appeal to Authority - Citing authority without evidence
6. Hasty Generalization - Drawing conclusions from insufficient data
7. Slippery Slope - Claiming one thing leads to extreme consequences without justification
8. Circular Reasoning - Conclusion assumes the premise
9. Red Herring - Introducing irrelevant information
10. Unsupported Claim - Making claims without evidence

Return JSON:
{
  "has_fallacies": true/false,
  "fallacies": [
    {
      "type": "strawman",
      "name": "Strawman Fallacy",
      "description": "Explanation of why this is a fallacy",
      "excerpt": "The specific text demonstrating the fallacy",
      "confidence": 85
    }
  ]
}`
        },
        {
          role: 'user',
          content: `Claim: ${claim}\n\nReasoning: ${reasoning}`
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);

    return {
      passed: !result.has_fallacies || result.fallacies.length === 0,
      fallacies: result.fallacies || []
    };
  } catch (error) {
    console.error('Fallacy detection failed:', error);
    // On error, assume no fallacies (fail open)
    return {
      passed: true,
      fallacies: []
    };
  }
}

// =====================================================
// Citation Relevance Scoring
// =====================================================

/**
 * Score citation relevance to argument
 * @param {string} claim - The argument claim
 * @param {string} reasoning - The argument reasoning
 * @param {string} citationUrl - URL of the citation
 * @param {string} citationText - Quote or summary from citation
 * @returns {Promise<{relevanceScore: number, credibilityScore: number}>}
 */
export async function scoreCitationRelevance(claim, reasoning, citationUrl, citationText = '') {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a citation relevance scorer. Evaluate how relevant a citation is to an argument.

Consider:
1. Does the citation directly support the claim?
2. Is it from a credible source?
3. Is the quoted text actually relevant?
4. Does it provide evidence or just opinion?

Return JSON:
{
  "relevance_score": 0-100,
  "credibility_score": 0-100,
  "is_relevant": true/false,
  "rationale": "Brief explanation"
}`
        },
        {
          role: 'user',
          content: `Argument Claim: ${claim}

Reasoning: ${reasoning}

Citation URL: ${citationUrl}
${citationText ? `Citation Quote: ${citationText}` : ''}`
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);

    return {
      relevanceScore: result.relevance_score || 0,
      credibilityScore: result.credibility_score || 50,
      rationale: result.rationale || ''
    };
  } catch (error) {
    console.error('Citation scoring failed:', error);
    // Default to middle score
    return {
      relevanceScore: 50,
      credibilityScore: 50,
      rationale: 'Auto-scoring unavailable'
    };
  }
}

// =====================================================
// AI Quality Assessment
// =====================================================

/**
 * Generate AI quality scores for argument
 * @param {string} claim - The main claim
 * @param {string} reasoning - The reasoning text
 * @param {Array} citations - Array of citations
 * @returns {Promise<{clarityScore: number, logicalStrengthScore: number, evidenceSupportScore: number}>}
 */
export async function assessArgumentQuality(claim, reasoning, citations = []) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an argument quality assessor. Evaluate arguments on three dimensions:

1. CLARITY (0-100): Is the argument clear and well-structured?
   - Clear thesis
   - Logical flow
   - Precise language
   - Easy to understand

2. LOGICAL STRENGTH (0-100): Is the reasoning sound?
   - Valid logical connections
   - No obvious gaps
   - Premises support conclusion
   - Internally consistent

3. EVIDENCE SUPPORT (0-100): How well does evidence support the argument?
   - Quality of citations
   - Relevance of evidence
   - Sufficient support for claims
   - Primary vs secondary sources

Return JSON:
{
  "clarity_score": 0-100,
  "logical_strength_score": 0-100,
  "evidence_support_score": 0-100,
  "overall_score": 0-100,
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"]
}`
        },
        {
          role: 'user',
          content: `Claim: ${claim}

Reasoning: ${reasoning}

Citations (${citations.length}):
${citations.map((c, i) => `${i + 1}. ${c.url}${c.quote_text ? `\n   Quote: "${c.quote_text}"` : ''}`).join('\n')}`
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);

    return {
      clarityScore: result.clarity_score || 50,
      logicalStrengthScore: result.logical_strength_score || 50,
      evidenceSupportScore: result.evidence_support_score || 50,
      overallScore: result.overall_score || 50,
      strengths: result.strengths || [],
      weaknesses: result.weaknesses || []
    };
  } catch (error) {
    console.error('Quality assessment failed:', error);
    // Default to middle scores
    return {
      clarityScore: 50,
      logicalStrengthScore: 50,
      evidenceSupportScore: 50,
      overallScore: 50,
      strengths: [],
      weaknesses: ['Auto-assessment unavailable']
    };
  }
}

// =====================================================
// Complete Validation Pipeline
// =====================================================

/**
 * Run complete validation pipeline on argument
 * @param {object} argument - Argument object with claim, reasoning, citations
 * @returns {Promise<object>} Validation results
 */
export async function validateArgument(argument) {
  const { claim, reasoning, citations = [] } = argument;

  // Score citations if they don't have relevance scores yet
  const scoredCitations = await Promise.all(
    citations.map(async (citation) => {
      if (citation.relevance_score !== undefined) {
        // Already scored
        return citation;
      }

      // Score the citation
      const scores = await scoreCitationRelevance(
        claim,
        reasoning,
        citation.url,
        citation.title || ''
      );

      return {
        ...citation,
        relevance_score: scores.relevanceScore,
        credibility_score: scores.credibilityScore,
        rationale: scores.rationale
      };
    })
  );

  // Run all validations in parallel
  const [
    civilityResult,
    fallacyResult,
    qualityResult
  ] = await Promise.all([
    checkCivility(`${claim} ${reasoning}`),
    detectFallacies(claim, reasoning),
    assessArgumentQuality(claim, reasoning, scoredCitations)
  ]);

  // Check citation requirement
  const relevantCitations = scoredCitations.filter(c => c.relevance_score > 55);
  const minCitationsMet = relevantCitations.length >= 1;

  // Determine if argument can be approved
  const canApprove =
    civilityResult.passed &&
    fallacyResult.passed &&
    minCitationsMet;

  return {
    civility_passed: civilityResult.passed,
    flagged_terms: civilityResult.flaggedTerms,

    fallacy_check_passed: fallacyResult.passed,
    detected_fallacies: fallacyResult.fallacies,

    min_citations_met: minCitationsMet,
    citation_count: relevantCitations.length,

    clarity_score: qualityResult.clarityScore,
    logical_strength_score: qualityResult.logicalStrengthScore,
    evidence_support_score: qualityResult.evidenceSupportScore,
    overall_quality_score: qualityResult.overallScore,

    can_approve: canApprove,

    issues: [
      ...(!civilityResult.passed ? ['Civility check failed'] : []),
      ...(!fallacyResult.passed ? ['Logical fallacies detected'] : []),
      ...(!minCitationsMet ? ['Needs at least 1 citation with relevance > 55%'] : [])
    ],

    strengths: qualityResult.strengths,
    weaknesses: qualityResult.weaknesses
  };
}

// =====================================================
// Export format generator
// =====================================================

/**
 * Generate condensed export format for social media
 * @param {object} argument - Argument object
 * @param {string} platform - Target platform
 * @returns {Promise<string>} Formatted export text
 */
export async function generateExportFormat(argument, platform = 'x') {
  const { claim, reasoning, citations = [] } = argument;

  const characterLimits = {
    'x': 280,
    'twitter': 280,
    'instagram': 2200,
    'facebook': 63206,
    'reddit': 40000
  };

  const limit = characterLimits[platform] || 280;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a social media post formatter. Create a concise version of an argument for ${platform}.

Requirements:
- Maximum ${limit} characters
- Include main claim
- Include key reasoning point
- Include citation link
- End with: #TruthTrollers
- Make it engaging and clear

Return just the formatted text, no JSON.`
        },
        {
          role: 'user',
          content: `Claim: ${claim}

Reasoning: ${reasoning}

Citation: ${citations[0]?.url || 'https://truthtrollers.com'}`
        }
      ],
      temperature: 0.7,
      max_tokens: 200
    });

    let exportText = response.choices[0].message.content.trim();

    // Ensure hashtag is present
    if (!exportText.includes('#TruthTrollers')) {
      exportText += '\n\n#TruthTrollers';
    }

    return exportText;
  } catch (error) {
    console.error('Export format generation failed:', error);
    // Fallback to simple format
    const citationUrl = citations[0]?.url || '';
    return `${claim}\n\nSource: ${citationUrl}\n\n#TruthTrollers`;
  }
}

export default {
  checkCivility,
  detectFallacies,
  scoreCitationRelevance,
  assessArgumentQuality,
  validateArgument,
  generateExportFormat
};
