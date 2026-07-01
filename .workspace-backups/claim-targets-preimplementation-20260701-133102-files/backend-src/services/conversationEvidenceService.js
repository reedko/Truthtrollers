/**
 * Conversation Evidence Service
 *
 * Integrates TruthTrollers evidence engine with conversation arguments
 * Extracts claims, runs evidence search, stores results
 */

import { v4 as uuidv4 } from 'uuid';
// Note: We'll use direct OpenAI calls instead of the complex evidenceEngine class
// to keep this lightweight for conversation mode

/**
 * Search for evidence using Tavily API
 */
async function searchEvidenceForClaims(claims) {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey || claims.length === 0) {
    return [];
  }

  const references = [];

  for (const claimText of claims.slice(0, 3)) { // Limit to 3 claims to avoid API overuse
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: claimText,
          search_depth: 'basic',
          max_results: 3,
        }),
      });

      const data = await response.json();
      const results = data.results || [];

      for (const result of results) {
        references.push({
          url: result.url,
          title: result.title,
          snippet: result.content || result.snippet,
          relevance_score: result.score || 0.7,
        });
      }
    } catch (error) {
      console.error(`Failed to search evidence for claim: ${claimText.substring(0, 50)}...`, error);
    }
  }

  return references;
}

/**
 * Extract claims from argument text using OpenAI
 */
export async function extractClaimsFromArgument(argumentText) {
  const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

  const messages = [
    {
      role: "system",
      content: "You are a fact-checking assistant that extracts verifiable claims from text.",
    },
    {
      role: "user",
      content: `
Extract every distinct factual assertion or claim from this text.
Each claim must be independently verifiable and phrased as a full sentence.
Avoid generalizations. Extract specific claims with numbers, statistics, or timelines when present.

Return your answer in strict JSON:
{
  "claims": ["<claim1>", "<claim2>", ...]
}

Text:
${argumentText}
`,
    },
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  try {
    const result = JSON.parse(content);
    return result.claims || [];
  } catch (error) {
    console.error('Failed to parse claims JSON:', error);
    return [];
  }
}

/**
 * Process conversation argument with full evidence engine
 */
export async function processArgumentEvidence({ query }, conv_argument_id, argumentData) {
  const { claim, reasoning, author_user_id } = argumentData;

  // Combine claim + reasoning for analysis
  const fullText = `${claim}\n\n${reasoning}`;

  try {
    // Step 1: Extract claims
    console.log(`🔍 Extracting claims from argument ${conv_argument_id}...`);
    const extractedClaims = await extractClaimsFromArgument(fullText);

    if (extractedClaims.length === 0) {
      console.log('No claims extracted');
      return { content_id: null, claims: [], references: [] };
    }

    // Step 2: Create content record for this argument
    const content_id = uuidv4();
    await query(`
      INSERT INTO content (
        content_id,
        content_url,
        content_text,
        content_type,
        added_by_user_id,
        status
      ) VALUES (?, ?, ?, 'conversation_argument', ?, 'active')
    `, [
      content_id,
      `ttlive://conversation/argument/${conv_argument_id}`,
      fullText,
      author_user_id
    ]);

    // Step 3: Store extracted claims
    const claimIds = [];
    const claimConfidenceMap = {};

    for (const claimText of extractedClaims) {
      const claim_id = uuidv4();
      claimIds.push(claim_id);
      claimConfidenceMap[claim_id] = 0.9; // High confidence for explicitly stated claims

      await query(`
        INSERT INTO claims (claim_id, claim_text, claim_type, created_by_user_id)
        VALUES (?, ?, 'factual', ?)
      `, [claim_id, claimText, author_user_id]);

      await query(`
        INSERT INTO content_claims (content_id, claim_id, confidence_score)
        VALUES (?, ?, ?)
      `, [content_id, claim_id, 0.9]);
    }

    // Step 4: Run evidence search for AI-suggested references (using Tavily)
    console.log(`🔬 Searching for evidence for ${claimIds.length} claims...`);
    const aiReferences = await searchEvidenceForClaims(extractedClaims);

    // Step 5: Persist AI references
    if (aiReferences.length > 0) {
      await persistAIReferences(query, {
        contentId: content_id,
        evidenceRefs: aiReferences,
        claimIds,
        claimConfidenceMap,
        userId: author_user_id
      });
    }

    // Step 6: Link content to conversation argument
    await query(`
      UPDATE ttlive_conversation_arguments
      SET evidence_content_id = ?
      WHERE conv_argument_id = ?
    `, [content_id, conv_argument_id]);

    console.log(`✅ Evidence processing complete: ${extractedClaims.length} claims, ${aiReferences.length} references`);

    return {
      content_id,
      claims: extractedClaims,
      claim_ids: claimIds,
      references: aiReferences
    };

  } catch (error) {
    console.error('Error processing argument evidence:', error);
    throw error;
  }
}

/**
 * Persist AI-suggested references
 */
async function persistAIReferences(query, { contentId, evidenceRefs, claimIds, claimConfidenceMap, userId }) {
  for (const ref of evidenceRefs) {
    const refId = uuidv4();

    // Insert reference
    await query(`
      INSERT INTO references (
        reference_id,
        reference_url,
        reference_title,
        reference_author,
        reference_publisher,
        reference_publish_date,
        reference_type,
        snippet,
        created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'ai_suggested', ?, ?)
    `, [
      refId,
      ref.url,
      ref.title || null,
      ref.author || null,
      ref.publisher || null,
      ref.publish_date || null,
      ref.snippet || null,
      userId
    ]);

    // Link reference to content
    await query(`
      INSERT INTO content_references (content_id, reference_id, reference_type)
      VALUES (?, ?, 'evidence')
    `, [contentId, refId]);

    // Link reference to claims it supports
    if (ref.claim_ids && ref.claim_ids.length > 0) {
      for (const claimId of ref.claim_ids) {
        if (claimIds.includes(claimId)) {
          await query(`
            INSERT INTO claim_references (claim_id, reference_id, relevance_score, supports_claim)
            VALUES (?, ?, ?, TRUE)
          `, [claimId, refId, ref.relevance_score || 0.7]);
        }
      }
    }
  }
}

/**
 * Get evidence breakdown for conversation argument
 */
export async function getArgumentEvidence({ query }, conv_argument_id) {
  // Get content_id
  const [arg] = await query(`
    SELECT evidence_content_id FROM ttlive_conversation_arguments
    WHERE conv_argument_id = ?
  `, [conv_argument_id]);

  if (!arg || !arg.evidence_content_id) {
    return { claims: [], references: [] };
  }

  const contentId = arg.evidence_content_id;

  // Get claims
  const claims = await query(`
    SELECT
      c.claim_id,
      c.claim_text,
      c.claim_type,
      cc.confidence_score
    FROM claims c
    JOIN content_claims cc ON c.claim_id = cc.claim_id
    WHERE cc.content_id = ?
    ORDER BY cc.confidence_score DESC
  `, [contentId]);

  // Get references with claim links
  const references = await query(`
    SELECT
      r.reference_id,
      r.reference_url,
      r.reference_title,
      r.reference_author,
      r.reference_publisher,
      r.reference_publish_date,
      r.reference_type,
      r.snippet,
      GROUP_CONCAT(DISTINCT cr.claim_id) as supporting_claim_ids
    FROM references r
    JOIN content_references cref ON r.reference_id = cref.reference_id
    LEFT JOIN claim_references cr ON r.reference_id = cr.reference_id
    WHERE cref.content_id = ?
    GROUP BY r.reference_id
    ORDER BY r.created_at DESC
  `, [contentId]);

  return {
    claims: claims.map(c => ({
      claim_id: c.claim_id,
      claim_text: c.claim_text,
      claim_type: c.claim_type,
      confidence: c.confidence_score
    })),
    references: references.map(r => ({
      reference_id: r.reference_id,
      url: r.reference_url,
      title: r.reference_title,
      author: r.reference_author,
      publisher: r.reference_publisher,
      publish_date: r.reference_publish_date,
      type: r.reference_type,
      snippet: r.snippet,
      supporting_claim_ids: r.supporting_claim_ids ? r.supporting_claim_ids.split(',') : []
    }))
  };
}

export default {
  extractClaimsFromArgument,
  processArgumentEvidence,
  getArgumentEvidence
};
