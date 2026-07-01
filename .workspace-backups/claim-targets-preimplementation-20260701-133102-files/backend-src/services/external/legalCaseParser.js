// /backend/src/services/external/legalCaseParser.js
// Parses CourtListener pages to extract readable case information
// Handles different page types: opinions, dockets, filings, judgments

import logger from '../../utils/logger.js';

/**
 * Legal Case Parser
 * Extracts human-readable information from CourtListener URLs
 */
export class LegalCaseParser {
  /**
   * Determine the type of CourtListener page from URL
   * @param {string} url - CourtListener URL
   * @returns {Object} Page type and metadata
   */
  static identifyPageType(url) {
    if (!url) return { type: 'unknown' };

    // Opinion pages: /opinion/123456/case-name/
    if (url.includes('/opinion/')) {
      return {
        type: 'opinion',
        level: 'appellate',
        description: 'Court opinion/decision document'
      };
    }

    // Docket pages: /docket/12345678/case-name/
    if (url.includes('/docket/')) {
      return {
        type: 'docket',
        level: 'trial',
        description: 'Case docket with all filings'
      };
    }

    // RECAP documents: /recap/gov.uscourts.xxxxx.123.456.0.pdf
    if (url.includes('/recap/')) {
      return {
        type: 'filing',
        level: 'trial',
        description: 'Individual court filing document'
      };
    }

    // Person/party pages: /person/123/name/
    if (url.includes('/person/')) {
      return {
        type: 'party',
        level: 'metadata',
        description: 'Party/attorney information'
      };
    }

    return { type: 'unknown' };
  }

  /**
   * Fetch and parse a CourtListener opinion page
   * @param {string} opinionId - Opinion ID from URL
   * @param {string} apiToken - CourtListener API token
   * @returns {Promise<Object>} Parsed opinion data
   */
  static async parseOpinion(opinionId, apiToken) {
    try {
      const url = `https://www.courtlistener.com/api/rest/v4/opinions/${opinionId}/`;

      logger.log(`🌐 [LegalParser] Fetching opinion: ${url}`);
      logger.log(`🔑 [LegalParser] Token present: ${!!apiToken}, Length: ${apiToken?.length || 0}, First 10 chars: ${apiToken?.slice(0, 10) || 'NONE'}`);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      logger.log(`📡 [LegalParser] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Could not read body');
        logger.error(`❌ [LegalParser] Error body: ${errorBody.slice(0, 500)}`);
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        case_level: 'opinion',
        case_type: this.inferCaseType(data),
        case_name: data.case_name,
        court: data.court,
        date_filed: data.date_filed,

        // What the case is about
        procedural_history: data.procedural_history || null,
        syllabus: data.syllabus || null, // Case summary

        // The decision
        disposition: data.disposition || null, // "Affirmed", "Reversed", etc.
        opinion_text: data.plain_text || data.html || null,

        // Who decided
        author: data.author_str || null,
        judges: data.panel || [],

        // Case metadata
        citations: data.citations || [],
        precedential_status: data.precedential_status,

        disposition_source: 'opinion_text',
        url: `https://www.courtlistener.com${data.absolute_url}`,

        // Extract readable summary
        readable_summary: this.extractOpinionSummary(data)
      };
    } catch (error) {
      logger.error('❌ [LegalParser] Opinion parse failed:', error.message);
      throw error;
    }
  }

  /**
   * Fetch and parse a CourtListener docket page
   * @param {string} docketId - Docket ID from URL
   * @param {string} apiToken - CourtListener API token
   * @returns {Promise<Object>} Parsed docket data
   */
  static async parseDocket(docketId, apiToken) {
    try {
      const url = `https://www.courtlistener.com/api/rest/v4/dockets/${docketId}/`;

      logger.log(`🌐 [LegalParser] CURL: curl -H "Authorization: Token ${apiToken}" "${url}"`);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      logger.log(`📡 [LegalParser] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Could not read body');
        logger.error(`❌ [LegalParser] Error body: ${errorBody.slice(0, 500)}`);
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      logger.log(`📋 [LegalParser] Docket ${docketId}: ${data.case_name}`);
      logger.log(`   📅 Dates: filed=${data.date_filed}, created=${data.date_created}, argued=${data.date_argued}`);
      logger.log(`   🔗 Appeal info: appeal_from=${data.appeal_from}, parent_docket=${data.parent_docket}`);
      logger.log(`   📋 Docket has ${data.clusters?.length || 0} cluster URLs`);
      logger.log(`   📋 Case details: nature_of_suit="${data.nature_of_suit}", cause="${data.cause}", jurisdiction="${data.jurisdiction_type}"`);

      if (data.clusters && data.clusters.length > 0) {
        logger.log(`📋 [LegalParser] Cluster URLs:`, data.clusters.slice(0, 3));
      }

      // Get docket entries (filings)
      const entries = await this.getDocketEntries(docketId, apiToken);

      // Get opinion clusters (these contain the actual decisions/opinions)
      const clusters = await this.getClusters(data.clusters, apiToken);

      logger.log(`📋 [LegalParser] Parsed ${clusters.length} clusters from ${data.clusters?.length || 0} URLs`);

      // Extract complaint/verdict/judgment from both entries AND clusters
      const complaint = await this.findComplaint(entries, apiToken) || this.findComplaintFromClusters(clusters);
      const verdict = await this.findVerdict(entries, apiToken) || this.findVerdictFromClusters(clusters);
      const judgment = await this.findJudgment(entries, apiToken) || this.findJudgmentFromClusters(clusters);

      return {
        case_level: 'docket',
        case_type: this.inferDocketCaseType(data),
        case_name: data.case_name,
        court: data.court,
        date_filed: data.date_filed,
        docket_number: data.docket_number,

        // Parties involved
        parties: await this.getParties(docketId, apiToken),

        // Case status
        nature_of_suit: data.nature_of_suit,
        cause: data.cause, // Legal cause of action
        jurisdiction_type: data.jurisdiction_type,

        // Key filings from entries AND clusters
        complaint,
        judgment,
        verdict,

        // Opinion clusters (court decisions)
        clusters: clusters,

        // All docket entries
        docket_entries: entries.slice(0, 20), // First 20 entries
        total_entries: entries.length,

        disposition_source: clusters.length > 0 ? 'opinion' : 'docket_entry',
        url: `https://www.courtlistener.com${data.absolute_url}`,

        // Extract readable summary
        readable_summary: await this.extractDocketSummary(data, entries, clusters, apiToken),

        // RAW DATA FOR DEBUGGING - all fields we got from API
        raw_docket: data,
        raw_clusters: clusters,
        raw_entries: entries.slice(0, 5)  // First 5 entries for debugging
      };
    } catch (error) {
      logger.error('❌ [LegalParser] Docket parse failed:', error.message);
      throw error;
    }
  }

  /**
   * Get docket entries (all filings in the case)
   * @private
   */
  static async getDocketEntries(docketId, apiToken) {
    try {
      // Use v4 API
      const url = `https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=${docketId}&order_by=entry_number`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Could not read error');
        logger.error(`❌ [LegalParser] Docket entries API error: ${response.status} for docket ${docketId}`);
        logger.error(`   URL attempted: ${url}`);
        logger.error(`   Error response: ${errorText.slice(0, 200)}`);

        // Return empty array - docket entries might be restricted/sealed
        return [];
      }

      const data = await response.json();
      const entries = data.results || [];

      logger.log(`📋 [LegalParser] Got ${entries.length} docket entries for docket ${docketId}`);

      // Log first few entries to see structure
      if (entries.length > 0) {
        logger.log(`📋 [LegalParser] Sample entry:`, {
          entry_number: entries[0].entry_number,
          date: entries[0].date_filed,
          description: entries[0].description?.slice(0, 100)
        });
      }

      return entries;
    } catch (error) {
      logger.error('❌ [LegalParser] Failed to get docket entries:', error.message);
      return [];
    }
  }

  /**
   * Get parties involved in the case
   * @private
   */
  static async getParties(docketId, apiToken) {
    try {
      const url = `https://www.courtlistener.com/api/rest/v4/parties/?docket=${docketId}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) return [];

      const data = await response.json();

      return (data.results || []).map(party => ({
        name: party.name,
        type: party.party_type_name, // "Plaintiff", "Defendant", etc.
        attorneys: party.attorneys || []
      }));
    } catch (error) {
      logger.error('❌ [LegalParser] Failed to get parties:', error.message);
      return [];
    }
  }

  /**
   * Fetch opinion clusters from URLs
   * @private
   */
  static async getClusters(clusterUrls, apiToken) {
    if (!clusterUrls || clusterUrls.length === 0) {
      logger.log('📋 [LegalParser] No clusters to fetch');
      return [];
    }

    logger.log(`📋 [LegalParser] Fetching ${clusterUrls.length} clusters...`);

    const clusters = [];

    for (const clusterUrl of clusterUrls) {
      try {
        const response = await fetch(clusterUrl, {
          headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          logger.error(`❌ [LegalParser] Cluster fetch failed: ${response.status}`);
          continue;
        }

        const cluster = await response.json();

        logger.log(`📋 [LegalParser] Cluster: ${cluster.case_name}, sub_opinions: ${cluster.sub_opinions?.length || 0}`);
        logger.log(`   📋 Cluster API fields:`, Object.keys(cluster).join(', '));
        logger.log(`   📋 Cluster fields: disposition="${cluster.disposition || ''}", syllabus="${cluster.syllabus?.slice(0, 50) || ''}", summary="${cluster.summary?.slice(0, 50) || ''}"`);
        logger.log(`   📋 Other fields: posture="${cluster.posture?.slice(0, 50) || ''}", procedural_history="${cluster.procedural_history?.slice(0, 50) || ''}", headmatter="${cluster.headmatter?.slice(0, 50) || ''}"`);

        // Fetch opinions within this cluster
        const opinions = await this.getOpinions(cluster.sub_opinions, apiToken);

        clusters.push({
          id: cluster.id,
          case_name: cluster.case_name,
          date_filed: cluster.date_filed,
          judges: cluster.judges,
          nature_of_suit: cluster.nature_of_suit,
          syllabus: cluster.syllabus, // Case summary
          headnotes: cluster.headnotes,
          summary: cluster.summary,
          disposition: cluster.disposition, // "Affirmed", "Reversed", etc.
          posture: cluster.posture, // Procedural posture
          procedural_history: cluster.procedural_history, // Case history
          headmatter: cluster.headmatter, // Beginning matter
          opinions: opinions
        });

        logger.log(`✅ [LegalParser] Got cluster with ${opinions.length} opinions`);
        if (opinions.length > 0) {
          logger.log(`   📄 First opinion: type="${opinions[0].type || ''}", author="${opinions[0].author_str || ''}", text_length=${opinions[0].plain_text?.length || opinions[0].html?.length || 0}`);
        }
      } catch (error) {
        logger.error(`❌ [LegalParser] Failed to fetch cluster: ${error.message}`);
      }
    }

    return clusters;
  }

  /**
   * Fetch opinions from cluster
   * @private
   */
  static async getOpinions(opinionUrls, apiToken) {
    if (!opinionUrls || opinionUrls.length === 0) return [];

    const opinions = [];

    for (const opinionUrl of opinionUrls) {
      try {
        const response = await fetch(opinionUrl, {
          headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) continue;

        const opinion = await response.json();

        // Log ALL available fields to see what the API actually returns
        logger.log(`   📄 Opinion API fields:`, Object.keys(opinion).join(', '));
        logger.log(`   📄 Opinion has: plain_text=${!!opinion.plain_text}, html=${!!opinion.html}, download_url=${!!opinion.download_url}`);

        opinions.push({
          type: opinion.type, // "Lead Opinion", "Concurrence", "Dissent"
          author: opinion.author_str,
          text: opinion.plain_text || opinion.html || null,
          excerpt: opinion.plain_text ? opinion.plain_text.slice(0, 500) : null,
          download_url: opinion.download_url || null  // Add download URL if available
        });
      } catch (error) {
        logger.error(`❌ [LegalParser] Failed to fetch opinion: ${error.message}`);
      }
    }

    return opinions;
  }

  /**
   * Find the complaint filing in docket entries
   * @private
   */
  static async findComplaint(entries, apiToken) {
    if (!entries || entries.length === 0) return null;

    logger.log(`🔍 [LegalParser] Searching ${entries.length} docket entries for complaint...`);

    // Look for actual complaint filings (usually entry #1 or has "complaint" in description)
    const complaintEntry = entries.find(entry =>
      entry.description && (
        entry.description.toLowerCase().includes('complaint') ||
        entry.description.toLowerCase().includes('petition') ||
        entry.description.toLowerCase().includes('summons') ||
        entry.entry_number === 1
      )
    );

    if (!complaintEntry) {
      logger.log(`⚠️  [LegalParser] No complaint found in ${entries.length} entries`);
      // Log a few descriptions to see what we're getting
      if (entries.length > 0) {
        logger.log(`📋 [LegalParser] Sample entry descriptions:`, entries.slice(0, 10).map((e, i) => `#${e.entry_number}: ${e.description}`));
      }
      return null;
    }

    logger.log(`✅ [LegalParser] Found complaint: Entry #${complaintEntry.entry_number}: "${complaintEntry.description}"`);

    // Get the full text of the complaint if available
    let fullDescription = complaintEntry.description;

    // Check if there are recap documents (PDFs) attached
    if (complaintEntry.recap_documents && complaintEntry.recap_documents.length > 0) {
      const doc = complaintEntry.recap_documents[0];
      logger.log(`   📄 Complaint has ${complaintEntry.recap_documents.length} attached document(s)`);

      // Try to fetch the actual document text from CourtListener
      if (doc.id) {
        try {
          const docText = await this.fetchRecapDocumentText(doc.id, apiToken);
          if (docText) {
            // Extract first few paragraphs
            const preview = docText.substring(0, 800);
            fullDescription = `${complaintEntry.description}\n\n${preview}${docText.length > 800 ? '...' : ''}`;
            logger.log(`   📄 Fetched complaint document text (${docText.length} chars)`);
          }
        } catch (err) {
          logger.error(`   ❌ Failed to fetch complaint document text: ${err.message}`);
        }
      } else if (doc.plain_text) {
        // Fallback: use embedded plain_text if available
        const preview = doc.plain_text.substring(0, 600);
        fullDescription = `${complaintEntry.description}\n\nDocument preview: ${preview}...`;
        logger.log(`   📄 Found complaint document text (${doc.plain_text.length} chars)`);
      }
    }

    return {
      entry_number: complaintEntry.entry_number,
      date: complaintEntry.date_filed,
      description: fullDescription,
      document_url: this.getDocumentUrl(complaintEntry)
    };
  }

  /**
   * Find complaint info from opinion clusters
   * @private
   */
  static findComplaintFromClusters(clusters) {
    if (!clusters || clusters.length === 0) return null;

    logger.log(`🔍 [LegalParser] Searching ${clusters.length} clusters for complaint info...`);

    // Look through all opinions for complaint text
    for (const cluster of clusters) {
      if (cluster.opinions && cluster.opinions.length > 0) {
        for (const opinion of cluster.opinions) {
          if (!opinion.text) continue;

          // Extract complaint from the beginning of the opinion text
          const complaintText = this.extractComplaintFromText(opinion.text);
          if (complaintText) {
            logger.log(`✅ [LegalParser] Found complaint in opinion text (${complaintText.length} chars)`);
            return {
              date: cluster.date_filed,
              description: complaintText,
              source: 'opinion_text'
            };
          }
        }
      }

      // Fallback: Check syllabus/summary fields
      if (cluster.syllabus || cluster.summary) {
        const text = (cluster.syllabus || cluster.summary || '').toLowerCase();
        if (text.includes('complaint') || text.includes('plaintiff') || text.includes('sued')) {
          logger.log(`✅ [LegalParser] Found complaint info in cluster syllabus`);
          return {
            date: cluster.date_filed,
            description: `Complaint: ${cluster.syllabus || cluster.summary}`.slice(0, 300),
            source: 'opinion_cluster'
          };
        }
      }
    }

    logger.log(`⚠️  [LegalParser] No complaint info in clusters`);
    return null;
  }

  /**
   * Extract complaint text from opinion text
   * Looks for the initial case description/background section
   * @private
   */
  static extractComplaintFromText(text) {
    if (!text) return null;

    // Common patterns that indicate the start of case background/facts
    const complaintPatterns = [
      /(?:Background|Facts|Procedural History|Case History)[\s\S]{0,100}?([A-Z][^.!?]{20,500}[.!?])/i,
      /(?:plaintiff|petitioner|appellant)\s+(?:filed|brought|alleges|claims)[\s\S]{0,500}?[.!?]/i,
      /(?:This case|The case|This appeal)\s+(?:arises from|involves|concerns)[\s\S]{0,500}?[.!?]/i,
      /(?:Plaintiff|Petitioner|Appellant)\s+[A-Z][a-z]+\s+(?:sued|alleges|claims)[\s\S]{0,500}?[.!?]/i
    ];

    for (const pattern of complaintPatterns) {
      const match = text.match(pattern);
      if (match) {
        // Get the matched text, clean it up
        let extracted = match[0].trim();

        // Limit to reasonable length
        if (extracted.length > 600) {
          extracted = extracted.substring(0, 600) + '...';
        }

        return extracted;
      }
    }

    // Fallback: Get first substantial paragraph after case header
    const lines = text.split('\n');
    let foundHeader = false;
    let paragraphLines = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and page numbers
      if (!trimmed || /^f?\d+$/.test(trimmed) || trimmed.length < 20) {
        if (paragraphLines.length > 0) break; // End of paragraph
        continue;
      }

      // Skip header material (all caps, short lines)
      if (trimmed === trimmed.toUpperCase() && trimmed.length < 80) {
        foundHeader = true;
        continue;
      }

      // After header, collect paragraph text
      if (foundHeader) {
        paragraphLines.push(trimmed);

        // Stop after we have enough text
        if (paragraphLines.join(' ').length > 400) break;
      }
    }

    if (paragraphLines.length > 0) {
      let paragraph = paragraphLines.join(' ').trim();

      // Clean up and limit length
      if (paragraph.length > 600) {
        paragraph = paragraph.substring(0, 600) + '...';
      }

      return paragraph;
    }

    return null;
  }

  /**
   * Find the judgment in docket entries
   * @private
   */
  static async findJudgment(entries, apiToken) {
    if (!entries || entries.length === 0) return null;

    logger.log(`🔍 [LegalParser] Searching ${entries.length} docket entries for judgment...`);

    // Look for final judgments, orders, dispositions
    const judgment = entries.find(entry =>
      entry.description && (
        entry.description.toLowerCase().includes('final judgment') ||
        entry.description.toLowerCase().includes('judgment') ||
        entry.description.toLowerCase().includes('order granting') ||
        entry.description.toLowerCase().includes('order denying') ||
        entry.description.toLowerCase().includes('dismissed') ||
        entry.description.toLowerCase().includes('settled') ||
        entry.description.toLowerCase().includes('summary judgment')
      )
    );

    if (!judgment) {
      logger.log(`⚠️  [LegalParser] No judgment found in ${entries.length} entries`);
      return null;
    }

    logger.log(`✅ [LegalParser] Found judgment: Entry #${judgment.entry_number}: "${judgment.description}"`);

    // Get full text if available
    let fullDescription = judgment.description;
    if (judgment.recap_documents && judgment.recap_documents.length > 0) {
      const doc = judgment.recap_documents[0];

      // Try to fetch the actual document text
      if (doc.id && apiToken) {
        try {
          const docText = await this.fetchRecapDocumentText(doc.id, apiToken);
          if (docText) {
            const preview = docText.substring(0, 800);
            fullDescription = `${judgment.description}\n\n${preview}${docText.length > 800 ? '...' : ''}`;
            logger.log(`   📄 Fetched judgment document text (${docText.length} chars)`);
          }
        } catch (err) {
          logger.error(`   ❌ Failed to fetch judgment document text: ${err.message}`);
        }
      } else if (doc.plain_text) {
        const preview = doc.plain_text.substring(0, 600);
        fullDescription = `${judgment.description}\n\nDocument preview: ${preview}...`;
        logger.log(`   📄 Found judgment document text (${doc.plain_text.length} chars)`);
      }
    }

    return {
      entry_number: judgment.entry_number,
      date: judgment.date_filed,
      description: fullDescription,
      document_url: this.getDocumentUrl(judgment)
    };
  }

  /**
   * Find judgment/decision info from opinion clusters
   * @private
   */
  static findJudgmentFromClusters(clusters) {
    if (!clusters || clusters.length === 0) return null;

    logger.log(`🔍 [LegalParser] Searching ${clusters.length} clusters for judgment...`);

    // Look through all opinions for judgment text
    for (const cluster of clusters) {
      if (cluster.opinions && cluster.opinions.length > 0) {
        for (const opinion of cluster.opinions) {
          if (!opinion.text) continue;

          // Extract judgment from the end of the opinion text
          const judgmentText = this.extractJudgmentFromText(opinion.text);
          if (judgmentText) {
            logger.log(`✅ [LegalParser] Found judgment in opinion text (${judgmentText.length} chars)`);
            return {
              date: cluster.date_filed,
              description: judgmentText,
              details: cluster.disposition || null,
              source: 'opinion_text'
            };
          }
        }
      }

      // Fallback: Check disposition field
      if (cluster.disposition) {
        logger.log(`✅ [LegalParser] Found judgment: ${cluster.disposition}`);
        return {
          date: cluster.date_filed,
          description: `Court Decision: ${cluster.disposition}`,
          details: cluster.syllabus || cluster.summary || null,
          source: 'opinion_cluster'
        };
      }
    }

    logger.log(`⚠️  [LegalParser] No judgment info in clusters`);
    return null;
  }

  /**
   * Extract judgment/verdict from opinion text
   * Looks at the conclusion/ending sections
   * @private
   */
  static extractJudgmentFromText(text) {
    if (!text) return null;

    // Common patterns for conclusions
    const conclusionPatterns = [
      /(?:CONCLUSION|JUDGMENT|DECISION|ORDER|We (?:AFFIRM|REVERSE|REMAND))[\s\S]{0,500}?[.!?]/i,
      /(?:For the foregoing reasons|Accordingly|Therefore|In conclusion)[\s\S]{0,300}?(?:AFFIRM|REVERSE|REMAND|DISMISS|GRANT|DENY)[\s\S]{0,200}?[.!?]/i
    ];

    for (const pattern of conclusionPatterns) {
      const match = text.match(pattern);
      if (match) {
        let extracted = match[0].trim();

        // Limit to reasonable length
        if (extracted.length > 600) {
          extracted = extracted.substring(0, 600) + '...';
        }

        return extracted;
      }
    }

    // Fallback: Look at the last substantial paragraphs
    const lines = text.split('\n').reverse(); // Start from end
    let conclusionLines = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines, page numbers, footnotes
      if (!trimmed || /^f?\d+$/.test(trimmed) || trimmed.length < 20) {
        if (conclusionLines.length > 0) break;
        continue;
      }

      // Look for conclusion keywords
      const lower = trimmed.toLowerCase();
      if (lower.includes('affirm') || lower.includes('reverse') ||
          lower.includes('remand') || lower.includes('judgment') ||
          lower.includes('decision') || lower.includes('granted') ||
          lower.includes('denied')) {

        conclusionLines.unshift(trimmed); // Add at beginning (we're going backwards)

        // Stop after we have enough
        if (conclusionLines.join(' ').length > 400) break;
      }
    }

    if (conclusionLines.length > 0) {
      let conclusion = conclusionLines.join(' ').trim();

      // Clean up and limit
      if (conclusion.length > 600) {
        conclusion = conclusion.substring(0, 600) + '...';
      }

      return conclusion;
    }

    return null;
  }

  /**
   * Find the verdict in docket entries
   * @private
   */
  static async findVerdict(entries, apiToken) {
    if (!entries || entries.length === 0) return null;

    logger.log(`🔍 [LegalParser] Searching ${entries.length} docket entries for verdict...`);

    const verdict = entries.find(entry =>
      entry.description && (
        entry.description.toLowerCase().includes('verdict') ||
        entry.description.toLowerCase().includes('jury verdict') ||
        entry.description.toLowerCase().includes('jury decision') ||
        entry.description.toLowerCase().includes('guilty') ||
        entry.description.toLowerCase().includes('not guilty') ||
        entry.description.toLowerCase().includes('liable') ||
        entry.description.toLowerCase().includes('jury finds')
      )
    );

    if (!verdict) {
      logger.log(`⚠️  [LegalParser] No verdict found in ${entries.length} entries`);
      return null;
    }

    logger.log(`✅ [LegalParser] Found verdict: Entry #${verdict.entry_number}: "${verdict.description}"`);

    // Get full text if available
    let fullDescription = verdict.description;
    if (verdict.recap_documents && verdict.recap_documents.length > 0) {
      const doc = verdict.recap_documents[0];

      // Try to fetch the actual document text
      if (doc.id && apiToken) {
        try {
          const docText = await this.fetchRecapDocumentText(doc.id, apiToken);
          if (docText) {
            const preview = docText.substring(0, 800);
            fullDescription = `${verdict.description}\n\n${preview}${docText.length > 800 ? '...' : ''}`;
            logger.log(`   📄 Fetched verdict document text (${docText.length} chars)`);
          }
        } catch (err) {
          logger.error(`   ❌ Failed to fetch verdict document text: ${err.message}`);
        }
      } else if (doc.plain_text) {
        const preview = doc.plain_text.substring(0, 600);
        fullDescription = `${verdict.description}\n\nDocument preview: ${preview}...`;
        logger.log(`   📄 Found verdict document text (${doc.plain_text.length} chars)`);
      }
    }

    return {
      entry_number: verdict.entry_number,
      date: verdict.date_filed,
      description: fullDescription,
      document_url: this.getDocumentUrl(verdict)
    };
  }

  /**
   * Find verdict info from opinion clusters
   * @private
   */
  static findVerdictFromClusters(clusters) {
    if (!clusters || clusters.length === 0) return null;

    logger.log(`🔍 [LegalParser] Searching ${clusters.length} clusters for verdict...`);

    // Verdicts are typically in trial court dockets, not appellate opinions
    // But we can look for references to jury verdicts in the opinion text
    for (const cluster of clusters) {
      if (cluster.opinions && cluster.opinions.length > 0) {
        const leadOpinion = cluster.opinions.find(o => o.type === 'Lead Opinion') || cluster.opinions[0];
        if (leadOpinion && leadOpinion.excerpt) {
          const text = leadOpinion.excerpt.toLowerCase();
          if (text.includes('verdict') || text.includes('jury found')) {
            logger.log(`✅ [LegalParser] Found verdict reference in opinion`);
            return {
              date: cluster.date_filed,
              description: leadOpinion.excerpt.slice(0, 300),
              source: 'opinion'
            };
          }
        }
      }

      // Check syllabus for verdict mentions
      if (cluster.syllabus) {
        const text = cluster.syllabus.toLowerCase();
        if (text.includes('verdict') || text.includes('jury')) {
          logger.log(`✅ [LegalParser] Found verdict in syllabus`);
          return {
            date: cluster.date_filed,
            description: cluster.syllabus.slice(0, 300),
            source: 'opinion_cluster'
          };
        }
      }
    }

    logger.log(`⚠️  [LegalParser] No verdict info in clusters`);
    return null;
  }

  /**
   * Fetch the actual text of a RECAP document
   * @private
   */
  static async fetchRecapDocumentText(recapDocId, apiToken) {
    try {
      const url = `https://www.courtlistener.com/api/rest/v4/recap-documents/${recapDocId}/`;

      logger.log(`🌐 [LegalParser] Fetching RECAP doc: ${url}`);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        logger.error(`❌ [LegalParser] RECAP doc fetch failed: ${response.status}`);
        return null;
      }

      const doc = await response.json();

      // Return plain text if available
      if (doc.plain_text) {
        logger.log(`✅ [LegalParser] Got RECAP doc text: ${doc.plain_text.length} chars`);
        return doc.plain_text;
      }

      logger.log(`⚠️  [LegalParser] RECAP doc has no plain_text field`);
      return null;
    } catch (error) {
      logger.error(`❌ [LegalParser] Failed to fetch RECAP doc: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract document URL from docket entry
   * @private
   */
  static getDocumentUrl(entry) {
    if (entry.recap_documents && entry.recap_documents.length > 0) {
      const doc = entry.recap_documents[0];
      if (doc.filepath_local) {
        return `https://www.courtlistener.com${doc.filepath_local}`;
      }
    }
    return null;
  }

  /**
   * Infer case type from opinion data
   * @private
   */
  static inferCaseType(opinionData) {
    const caseName = (opinionData.case_name || '').toLowerCase();

    if (caseName.includes('united states v.')) return 'criminal';
    if (caseName.includes('in re')) return 'bankruptcy';
    if (caseName.includes('habeas')) return 'habeas';
    if (opinionData.procedural_history?.toLowerCase().includes('criminal')) return 'criminal';

    return 'civil'; // Default
  }

  /**
   * Infer case type from docket data
   * @private
   */
  static inferDocketCaseType(docketData) {
    const nature = docketData.nature_of_suit || '';
    const jurisdiction = docketData.jurisdiction_type || '';

    if (jurisdiction.toLowerCase().includes('criminal')) return 'criminal';
    if (nature.toLowerCase().includes('bankruptcy')) return 'bankruptcy';
    if (nature.toLowerCase().includes('habeas')) return 'habeas';
    if (docketData.case_name?.toLowerCase().includes('united states v.')) return 'criminal';

    return 'civil';
  }

  /**
   * Extract readable summary from opinion
   * @private
   */
  static extractOpinionSummary(data) {
    const parts = [];

    // Case name
    parts.push(`**${data.case_name}**`);

    // What happened
    if (data.syllabus) {
      parts.push(`\n**Summary:** ${data.syllabus.substring(0, 500)}...`);
    }

    // Decision
    if (data.disposition) {
      parts.push(`\n**Decision:** ${data.disposition}`);
    }

    // Who decided
    if (data.author_str) {
      parts.push(`\n**Author:** ${data.author_str}`);
    }

    return parts.join('\n');
  }

  /**
   * Extract readable summary from docket
   * @private
   */
  static async extractDocketSummary(data, entries, clusters = [], apiToken) {
    const parts = [];

    // Case name
    parts.push(`**${data.case_name}**`);

    // Nature of the suit (what it's about)
    if (data.nature_of_suit) {
      parts.push(`\n**Nature of Suit:** ${data.nature_of_suit}`);
    }

    // Cause (legal reason)
    if (data.cause) {
      parts.push(`\n**Cause:** ${data.cause}`);
    }

    // Complaint (from entries or clusters)
    const complaint = await this.findComplaint(entries, apiToken) || this.findComplaintFromClusters(clusters);
    if (complaint) {
      parts.push(`\n**Complaint Filed:** ${complaint.date} - ${complaint.description}`);
    }

    // Judgment (from entries or clusters)
    const judgment = await this.findJudgment(entries, apiToken) || this.findJudgmentFromClusters(clusters);
    if (judgment) {
      parts.push(`\n**Judgment:** ${judgment.date} - ${judgment.description}`);
    }

    // Verdict (from entries or clusters)
    const verdict = await this.findVerdict(entries, apiToken) || this.findVerdictFromClusters(clusters);
    if (verdict) {
      parts.push(`\n**Verdict:** ${verdict.date} - ${verdict.description}`);
    }

    return parts.join('\n');
  }
}

export default LegalCaseParser;
