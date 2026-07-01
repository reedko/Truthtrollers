/**
 * Discussion Units Generator Service
 *
 * Generates structured discussion units from analyzed content.
 * Converts claims and evidence into tweet-friendly formats.
 */

import { openAiLLM } from '../core/openAiLLM.js';

/**
 * Generate discussion units from content
 *
 * @param {Object} params
 * @param {number} params.contentId
 * @param {Array} params.claims - Claims with evidence
 * @param {Object} params.content - Content metadata
 * @param {string} params.tone - 'neutral' | 'assertive' | 'question'
 * @returns {Promise<Array>} Array of discussion units
 */
export async function generateDiscussionUnits({
  contentId,
  claims,
  content,
  tone = 'neutral'
}) {
  const units = [];
  let unitOrder = 0;

  // 1. Generate claim units
  for (const claim of claims) {
    const claimUnit = {
      unit_type: 'claim',
      unit_text: await optimizeForTwitter(claim.claim_text, tone),
      original_text: claim.claim_text,
      unit_order: unitOrder++,
      claim_id: claim.claim_id,
      confidence: claim.confidence_level,
      sources: [],
      is_selected_for_posting: true
    };

    units.push(claimUnit);

    // 2. Generate evidence units for this claim
    if (claim.references && claim.references.length > 0) {
      const supportEvidence = claim.references.filter(ref => ref.support_level > 0.3);
      const counterEvidence = claim.references.filter(ref => ref.support_level < -0.3);

      // Add support evidence
      for (const evidence of supportEvidence.slice(0, 2)) { // Max 2 per claim
        const supportUnit = {
          unit_type: 'support',
          unit_text: await formatEvidence(evidence, 'support', tone),
          original_text: evidence.quote || evidence.rationale,
          unit_order: unitOrder++,
          claim_id: claim.claim_id,
          reference_content_id: evidence.reference_content_id,
          confidence: evidence.confidence,
          support_level: evidence.support_level,
          stance: evidence.stance,
          sources: [{
            title: evidence.content_name,
            url: evidence.url,
            quality: evidence.score / 100
          }],
          is_selected_for_posting: true
        };
        units.push(supportUnit);
      }

      // Add counter evidence
      for (const evidence of counterEvidence.slice(0, 2)) { // Max 2 per claim
        const counterUnit = {
          unit_type: 'counter',
          unit_text: await formatEvidence(evidence, 'counter', tone),
          original_text: evidence.quote || evidence.rationale,
          unit_order: unitOrder++,
          claim_id: claim.claim_id,
          reference_content_id: evidence.reference_content_id,
          confidence: evidence.confidence,
          support_level: evidence.support_level,
          stance: evidence.stance,
          sources: [{
            title: evidence.content_name,
            url: evidence.url,
            quality: evidence.score / 100
          }],
          is_selected_for_posting: true
        };
        units.push(counterUnit);
      }
    }
  }

  // 3. Generate summary unit
  const summaryUnit = {
    unit_type: 'summary',
    unit_text: await generateSummary(claims, content, tone),
    original_text: null,
    unit_order: unitOrder++,
    confidence: null,
    sources: [],
    is_selected_for_posting: true
  };
  units.push(summaryUnit);

  return units;
}

/**
 * Optimize text for Twitter (280 char limit)
 */
async function optimizeForTwitter(text, tone) {
  if (text.length <= 270) {
    return applyTone(text, tone);
  }

  const system = 'You are a concise editor for social media. Return only the edited text, no explanations.';
  const user = `Condense this claim to under 270 characters while preserving meaning:

"${text}"

Return ONLY the condensed text, nothing else.`;

  try {
    const response = await openAiLLM.generate({
      system,
      user,
      schemaHint: '{"condensed_text": "string"}',
      temperature: 0.3,
      maxRetries: 2,
      timeout: 15000
    });

    // Response is JSON object with condensed_text
    const condensed = response.condensed_text || text.substring(0, 267) + '...';
    return applyTone(condensed, tone);
  } catch (error) {
    console.error('Failed to optimize for Twitter:', error.message);
    // Fallback: truncate
    return applyTone(text.substring(0, 267) + '...', tone);
  }
}

/**
 * Format evidence with citation
 */
async function formatEvidence(evidence, type, tone) {
  const quote = evidence.quote || evidence.rationale;
  const source = evidence.content_name;
  const url = evidence.url;

  let prefix = type === 'support' ? '✅ Supporting:' : '⚠️ Counter:';
  if (tone === 'neutral') {
    prefix = type === 'support' ? 'Evidence:' : 'However:';
  } else if (tone === 'question') {
    prefix = type === 'support' ? 'Does this support it?' : 'But what about:';
  }

  // Format: "Prefix Quote - Source"
  let formatted = `${prefix} ${quote}`;

  // Add source citation if room
  if (formatted.length + source.length + 5 < 270) {
    formatted += `\n— ${source}`;
  }

  // Truncate if too long
  if (formatted.length > 270) {
    formatted = formatted.substring(0, 267) + '...';
  }

  return formatted;
}

/**
 * Apply tone to text
 */
function applyTone(text, tone) {
  if (tone === 'question') {
    // Convert statement to question if possible
    if (!text.endsWith('?')) {
      return `Is it true that ${text.toLowerCase()}?`;
    }
  } else if (tone === 'assertive') {
    // Add emphasis
    return text.replace(/\.$/, '!');
  }
  return text;
}

/**
 * Generate summary from all claims
 */
async function generateSummary(claims, content, tone) {
  const claimsText = claims.map(c => c.claim_text).join('\n');

  const system = 'You are a concise fact-checker summarizer. Return JSON with a summary field.';
  const user = `Summarize these fact-checked claims in 1-2 sentences (under 270 chars):

${claimsText}

${tone === 'question' ? 'Frame it as a question.' : ''}
${tone === 'assertive' ? 'Use confident language.' : ''}
Return JSON: {"summary": "your summary here"}`;

  try {
    const response = await openAiLLM.generate({
      system,
      user,
      schemaHint: '{"summary": "string"}',
      temperature: 0.4,
      maxRetries: 2,
      timeout: 15000
    });

    return response.summary || `Analysis of "${content.content_name}" with ${claims.length} claims examined.`;
  } catch (error) {
    console.error('Failed to generate summary:', error.message);
    return `Analysis of "${content.content_name}" with ${claims.length} claims examined.`;
  }
}

/**
 * Validate discussion unit before posting
 */
export function validateUnit(unit) {
  const errors = [];

  if (!unit.unit_text || unit.unit_text.trim().length === 0) {
    errors.push('Unit text cannot be empty');
  }

  if (unit.unit_text.length > 280) {
    errors.push(`Unit text exceeds 280 characters (${unit.unit_text.length})`);
  }

  if (!['claim', 'support', 'counter', 'summary'].includes(unit.unit_type)) {
    errors.push('Invalid unit type');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate engagement potential score (0-100)
 * Based on:
 * - Evidence quality
 * - Source diversity
 * - Claim confidence
 */
export function calculateEngagementPotential(units) {
  if (units.length === 0) return 0;

  let totalScore = 0;
  let count = 0;

  for (const unit of units) {
    let score = 50; // Base score

    // Bonus for high confidence
    if (unit.confidence && unit.confidence > 0.8) {
      score += 15;
    }

    // Bonus for sources
    if (unit.sources && unit.sources.length > 0) {
      score += unit.sources.length * 10;

      // Bonus for high quality sources
      const avgQuality = unit.sources.reduce((sum, s) => sum + (s.quality || 0.5), 0) / unit.sources.length;
      score += avgQuality * 20;
    }

    // Bonus for counter evidence (shows balance)
    if (unit.unit_type === 'counter') {
      score += 10;
    }

    totalScore += Math.min(score, 100);
    count++;
  }

  return Math.round(totalScore / count);
}

/**
 * Extract tweet ID from X/Twitter URL
 */
export function extractTweetId(url) {
  if (!url) return null;

  // Patterns:
  // https://twitter.com/user/status/1234567890
  // https://x.com/user/status/1234567890
  // https://mobile.twitter.com/user/status/1234567890

  const patterns = [
    /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
    /(?:mobile\.twitter\.com)\/\w+\/status\/(\d+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Chunk units into thread-safe groups
 * Max 5 tweets per thread to avoid rate limits
 */
export function chunkUnitsForThread(units, maxPerThread = 5) {
  const selectedUnits = units.filter(u => u.is_selected_for_posting);
  const chunks = [];

  for (let i = 0; i < selectedUnits.length; i += maxPerThread) {
    chunks.push(selectedUnits.slice(i, i + maxPerThread));
  }

  return chunks;
}
