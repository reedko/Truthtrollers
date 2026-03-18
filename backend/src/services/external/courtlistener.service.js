// /backend/src/services/external/courtlistener.service.js
// CourtListener API Service - Free Law Project
// Searches federal and state court cases for legal history
// API Docs: https://www.courtlistener.com/api/rest-info/

import logger from '../../utils/logger.js';
import LegalCaseParser from './legalCaseParser.js';

/**
 * CourtListener Service
 * Searches legal cases involving authors, publishers, or organizations
 */
class CourtListenerService {
  constructor() {
    this.baseUrl = 'https://www.courtlistener.com/api/rest/v4';
    this.apiToken = process.env.COURTLISTENER_API_TOKEN;
  }

  /**
   * Check if service is configured
   */
  isConfigured() {
    return !!this.apiToken;
  }

  /**
   * Search for cases involving a person (author)
   * @param {Object} author - Author object with name
   * @returns {Promise<Object>} Search results with case information
   */
  async checkAuthor(author) {
    if (!this.isConfigured()) {
      return {
        source: 'courtlistener',
        error: 'not_configured',
        message: 'CourtListener API token not set'
      };
    }

    const fullName = this.buildFullName(author);

    try {
      logger.log(`🏛️ [CourtListener] Checking author: ${fullName}`);

      // ONLY search RECAP/PACER dockets (type=r) - this has complaints, judgments, verdicts
      // Skip opinions (type=o) - those are appellate decisions without trial court details
      const dockets = await this.searchDockets(fullName);

      const totalCases = dockets.count;

      // Use only RECAP results
      const allResults = dockets.results;

      logger.log(`🔍 [CourtListener] Processing ${allResults.length} RECAP docket results`);

      // Format ALL results (not just first occurrence of each case name)
      const allCases = allResults.map(r => this.formatCase(r));

      // FILTER: Remove cases where person is just a warden/official
      const relevantCases = allCases.filter(c => this.isRelevantCase(c, fullName));
      logger.log(`📊 [CourtListener] Filtered to ${relevantCases.length} relevant cases (removed ${allCases.length - relevantCases.length} where person is official/warden)`);

      // Process up to 10 unique cases (not just 2)
      const uniqueCaseNames = [...new Set(relevantCases.map(c => c.case_name))];
      logger.log(`📊 [CourtListener] Found ${uniqueCaseNames.length} unique case names in ${relevantCases.length} total results`);

      const caseNamesToProcess = uniqueCaseNames.slice(0, 10);
      logger.log(`📋 [CourtListener] Processing first 10 case names`);

      // Filter to only include results for these case names
      const casesToProcess = relevantCases.filter(c => caseNamesToProcess.includes(c.case_name));
      logger.log(`   📋 This includes ${casesToProcess.length} total dockets across these cases`);

      // Now enhance these cases - will consolidate by case name and skip empty ones
      const enhancedCases = await this.enhanceCases(casesToProcess);

      logger.log(`✅ [CourtListener] Final return: ${enhancedCases.length} enhanced cases`);

      return {
        source: 'courtlistener',
        entity_type: 'person',
        entity_name: fullName,
        has_cases: enhancedCases.length > 0, // Use actual filtered count, not raw API total
        case_count: enhancedCases.length, // Use actual filtered count
        total_api_results: totalCases, // Keep original for reference
        cases: enhancedCases,
        risk_level: this.assessPersonRisk(totalCases, enhancedCases),
        risk_reasons: this.buildRiskReasons(totalCases, enhancedCases, 'person'),
        checked_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CourtListener] Author check failed:', error.message);
      return {
        source: 'courtlistener',
        error: 'check_failed',
        message: error.message
      };
    }
  }

  /**
   * Search for cases involving an organization (publisher)
   * @param {Object} publisher - Publisher object with name
   * @returns {Promise<Object>} Search results with case information
   */
  async checkPublisher(publisher) {
    if (!this.isConfigured()) {
      return {
        source: 'courtlistener',
        error: 'not_configured',
        message: 'CourtListener API token not set'
      };
    }

    const orgName = publisher.publisher_name || publisher.name;

    try {
      logger.log(`🏛️ [CourtListener] Checking publisher: ${orgName}`);

      // Search opinions
      const opinions = await this.searchOpinions(orgName);

      // Search dockets
      const dockets = await this.searchDockets(orgName);

      const totalCases = opinions.count + dockets.count;

      // Get unique case names same way as for authors
      const seenCaseNames = new Set();
      const uniqueCases = [];
      const allResults = [...dockets.results, ...opinions.results];

      for (const result of allResults) {
        const formatted = this.formatCase(result);
        const caseName = formatted.case_name;

        if (!seenCaseNames.has(caseName)) {
          seenCaseNames.add(caseName);
          uniqueCases.push(formatted);
          if (uniqueCases.length >= 10) break;
        }
      }

      logger.log(`📊 [CourtListener] Selected ${uniqueCases.length} publisher cases with distinct names`);

      const enhancedCases = await this.enhanceCases(uniqueCases);

      return {
        source: 'courtlistener',
        entity_type: 'organization',
        entity_name: orgName,
        has_cases: enhancedCases.length > 0, // Use actual filtered count, not raw API total
        case_count: enhancedCases.length, // Use actual filtered count
        total_api_results: totalCases, // Keep original for reference
        cases: enhancedCases,
        risk_level: this.assessOrganizationRisk(totalCases, enhancedCases),
        risk_reasons: this.buildRiskReasons(totalCases, enhancedCases, 'organization'),
        checked_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CourtListener] Publisher check failed:', error.message);
      return {
        source: 'courtlistener',
        error: 'check_failed',
        message: error.message
      };
    }
  }

  /**
   * Search for RECAP/PACER dockets (trial court filings)
   * This is where complaints, judgments, and verdicts live
   * @private
   */
  async searchDockets(query) {
    // Wrap in quotes for exact phrase matching to avoid partial name matches
    const exactQuery = `"${query}"`;

    // type=r searches RECAP documents (PACER filings, dockets, complaints, judgments)
    const url = `${this.baseUrl}/search/?q=${encodeURIComponent(exactQuery)}&type=r&order_by=score%20desc`;

    logger.log(`🌐 [CourtListener] RECAP Search CURL: curl -H "Authorization: Token ${this.apiToken}" "${url}"`);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Token ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    logger.log(`📡 [CourtListener] RECAP Search response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Could not read body');
      logger.error(`❌ [CourtListener] Search error body: ${errorBody.slice(0, 500)}`);
      throw new Error(`CourtListener API error: ${response.status}`);
    }

    const data = await response.json();

    logger.log(`🔍 [CourtListener] RECAP search found ${data.count} docket results`);

    // Log sample results to see structure
    if (data.results && data.results.length > 0) {
      const sample = data.results[0];
      logger.log(`📋 [CourtListener] Sample RECAP result:`, {
        caseName: sample.caseName,
        docket_id: sample.docket_id,
        docketNumber: sample.docketNumber,
        court: sample.court,
        dateFiled: sample.dateFiled,
        description: sample.description?.substring(0, 100)
      });
    }

    return data;
  }

  /**
   * Search for published opinions (appellate decisions)
   * This is where dispositions and appellate rulings live
   * @private
   */
  async searchOpinions(query) {
    // Wrap in quotes for exact phrase matching
    const exactQuery = `"${query}"`;

    // type=o searches opinion clusters (published appellate decisions)
    const url = `${this.baseUrl}/search/?q=${encodeURIComponent(exactQuery)}&type=o&order_by=score%20desc`;

    logger.log(`🌐 [CourtListener] Opinion Search CURL: curl -H "Authorization: Token ${this.apiToken}" "${url}"`);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Token ${this.apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    logger.log(`📡 [CourtListener] Opinion Search response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Could not read body');
      logger.error(`❌ [CourtListener] Search error body: ${errorBody.slice(0, 500)}`);
      throw new Error(`CourtListener API error: ${response.status}`);
    }

    const data = await response.json();

    logger.log(`🔍 [CourtListener] Opinion search found ${data.count} opinion results`);

    return data;
  }

  /**
   * Get detailed case information with readable summary
   * @param {string} caseUrl - CourtListener case URL
   * @returns {Promise<Object>} Detailed case information
   */
  async getCaseDetails(caseUrl) {
    if (!this.isConfigured()) {
      return {
        error: 'not_configured',
        message: 'CourtListener API token not set'
      };
    }

    try {
      // Identify page type
      const pageType = LegalCaseParser.identifyPageType(caseUrl);

      logger.log(`🏛️ [CourtListener] Fetching ${pageType.type} details from: ${caseUrl}`);

      let details;

      if (pageType.type === 'opinion') {
        // Extract opinion ID from URL: /opinion/123456/case-name/
        const opinionId = caseUrl.match(/\/opinion\/(\d+)/)?.[1];
        if (!opinionId) throw new Error('Could not extract opinion ID from URL');

        details = await LegalCaseParser.parseOpinion(opinionId, this.apiToken);
      }
      else if (pageType.type === 'docket') {
        // Extract docket ID from URL: /docket/12345678/case-name/
        const docketId = caseUrl.match(/\/docket\/(\d+)/)?.[1];
        if (!docketId) throw new Error('Could not extract docket ID from URL');

        details = await LegalCaseParser.parseDocket(docketId, this.apiToken);
      }
      else {
        throw new Error(`Unsupported page type: ${pageType.type}`);
      }

      return {
        success: true,
        page_type: pageType,
        ...details
      };

    } catch (error) {
      logger.error('❌ [CourtListener] Failed to get case details:', error.message);
      return {
        error: 'fetch_failed',
        message: error.message
      };
    }
  }

  /**
   * Format case data for consistent response
   * @private
   */
  formatCase(caseData) {
    // Build full URL - absolute_url is relative, so prepend domain
    let url = null;
    if (caseData.absolute_url) {
      url = caseData.absolute_url.startsWith('http')
        ? caseData.absolute_url
        : `https://www.courtlistener.com${caseData.absolute_url}`;
    }

    // Determine page type from URL
    const pageType = LegalCaseParser.identifyPageType(url);

    // Get IDs DIRECTLY from search results (cluster_id, docket_id fields)
    // This avoids needing to parse URLs or fetch intermediate docket objects
    const clusterId = caseData.cluster_id || null;
    const docketId = caseData.docket_id || null;

    // DEBUG: Log what IDs we got and from what case
    logger.log(`   🔍 formatCase: "${caseData.case_name || caseData.caseName}" -> cluster_id=${clusterId}, docket_id=${docketId}, url=${url}`);

    // Fallback: Extract IDs from URL if not in search results
    let opinionId = null;
    if (url && !docketId) {
      const docketMatch = url.match(/\/docket\/(\d+)/);
      const opinionMatch = url.match(/\/opinion\/(\d+)/);
      if (docketMatch) docketId = docketMatch[1];
      if (opinionMatch) opinionId = opinionMatch[1];
    }

    return {
      case_name: caseData.caseName || caseData.case_name,
      court: caseData.court || caseData.court_id,
      date_filed: caseData.dateFiled || caseData.date_filed,
      docket_number: caseData.docketNumber || caseData.docket_number,
      description: caseData.snippet || caseData.description,
      url: url,
      cluster_id: clusterId,  // Direct from search results
      docket_id: docketId,    // Direct from search results
      opinion_id: opinionId,
      case_type: caseData.type || 'unknown',
      page_type: pageType.type,
      page_description: pageType.description
    };
  }

  /**
   * Build full name from author object
   * @private
   */
  buildFullName(author) {
    const parts = [
      author.author_first_name,
      author.author_last_name
    ].filter(Boolean);

    return parts.join(' ') || author.name || 'Unknown';
  }

  /**
   * Assess risk level for a person based on case count and types
   * @private
   */
  assessPersonRisk(caseCount, cases) {
    if (caseCount === 0) return 'none';

    // High case count could indicate litigious person or legal issues
    if (caseCount > 50) return 'high';
    if (caseCount > 20) return 'medium';
    if (caseCount > 5) return 'low';

    return 'low';
  }

  /**
   * Assess risk level for an organization
   * @private
   */
  assessOrganizationRisk(caseCount, cases) {
    if (caseCount === 0) return 'none';

    // Organizations naturally have more cases
    if (caseCount > 100) return 'high';
    if (caseCount > 50) return 'medium';
    if (caseCount > 10) return 'low';

    return 'low';
  }

  /**
   * Build risk reasons array
   * @private
   */
  buildRiskReasons(caseCount, cases, entityType) {
    const reasons = [];

    if (caseCount > 0) {
      reasons.push(`${caseCount} court case(s) found`);
    }

    // Could enhance this by analyzing case types, outcomes, etc.
    // For now, just note if there are cases
    if (caseCount > 10 && entityType === 'person') {
      reasons.push('High litigation involvement for individual');
    }

    if (caseCount > 50 && entityType === 'organization') {
      reasons.push('Significant legal history');
    }

    return reasons;
  }

  /**
   * Check if a case is relevant (filter out irrelevant cases)
   * @private
   */
  isRelevantCase(caseData, searchName) {
    const caseName = (caseData.case_name || '').toLowerCase();
    const description = (caseData.description || '').toLowerCase();
    const searchLower = searchName.toLowerCase();

    // Extract first and last name components for better matching
    const nameParts = searchLower.split(' ').filter(p => p.length > 0);

    // Filter out cases where person appears ONLY as a warden/officer/official
    // Common patterns: "John Smith, Warden" or "v. John Smith, Acting Warden"
    const officialTitles = [
      'warden', 'acting warden', 'secretary', 'director of', 'administrator',
      'commissioner', 'superintendent', 'officer', 'sheriff', 'chief',
      'attorney general', 'deputy', 'assistant'
    ];

    // Check if name appears with an official title
    for (const title of officialTitles) {
      // Pattern: "Name, Title" or "Name Title" or "v. Name, Title"
      const patterns = [
        `${searchLower},\\s*${title}`,
        `${searchLower}\\s+${title}`,
        `v\\.\\s*${searchLower},\\s*${title}`
      ];

      for (const pattern of patterns) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(caseName)) {
          logger.log(`⚠️  [CourtListener] Filtering out case where "${searchName}" appears as "${title}": ${caseData.case_name}`);
          return false;
        }
      }
    }

    // Also filter habeas corpus cases where the person is clearly the respondent official
    if (caseName.includes('habeas') || description.includes('habeas')) {
      // Pattern: "Petitioner v. Official Name"
      // In habeas cases, the respondent is usually the warden/official
      const vsPosition = caseName.indexOf(' v. ') || caseName.indexOf(' v ');
      if (vsPosition > 0) {
        const afterVs = caseName.substring(vsPosition);
        // If the name appears after "v." in a habeas case, likely the official
        if (nameParts.some(part => afterVs.includes(part))) {
          logger.log(`⚠️  [CourtListener] Filtering out habeas case where "${searchName}" is respondent: ${caseData.case_name}`);
          return false;
        }
      }
    }

    // Prioritize cases where person is plaintiff or defendant (not just mentioned)
    const nameMatch = caseName.includes(searchLower);

    // Keep cases with strong name matches (that passed the filters above)
    return nameMatch;
  }

  /**
   * Enhance cases with detailed information
   * Simplified: Just grab ONE docket per case, skip if no useful info
   * @private
   */
  async enhanceCases(cases) {
    // Group cases by case name
    const caseGroups = new Map();

    for (const caseData of cases) {
      const caseName = caseData.case_name;
      if (!caseGroups.has(caseName)) {
        caseGroups.set(caseName, caseData); // Just keep first one
      }
    }

    const enhanced = [];

    // For each unique case, fetch just ONE docket
    for (const [caseName, caseData] of caseGroups) {
      try {
        logger.log(`🔍 [CourtListener] Processing: ${caseName}`);

        // Only fetch if we have a docket_id
        if (!caseData.docket_id) {
          logger.log(`   ⏭️  No docket_id - using basic case info`);
          // Still add the case with basic info
          const basicCase = {
            ...caseData,
            readable_summary: this.buildCaseSummary(caseData, null, null, null, null, [], null)
          };
          enhanced.push(basicCase);
          continue;
        }

        // Fetch ONE docket
        let docketDetails;
        try {
          docketDetails = await LegalCaseParser.parseDocket(caseData.docket_id, this.apiToken);
        } catch (error) {
          logger.log(`   ⚠️  Couldn't fetch docket: ${error.message} - using basic info`);
          // Still add the case with basic info
          const basicCase = {
            ...caseData,
            readable_summary: this.buildCaseSummary(caseData, null, null, null, null, [], null)
          };
          enhanced.push(basicCase);
          continue;
        }

        if (!docketDetails) {
          logger.log(`   ⏭️  No docket details - using basic case info`);
          // Still add the case with basic info
          const basicCase = {
            ...caseData,
            readable_summary: this.buildCaseSummary(caseData, null, null, null, null, [], null)
          };
          enhanced.push(basicCase);
          continue;
        }

        // Don't skip - even minimal case info is useful
        // We'll still show the case even without nature_of_suit/cause
        // The case name, court, and date are valuable on their own

        // Build case with docket metadata
        const enhancedCase = {
          ...caseData,
          url: docketDetails.url || `https://www.courtlistener.com/docket/${caseData.docket_id}/`,
          nature_of_suit: docketDetails.nature_of_suit,
          cause: docketDetails.cause,
          jurisdiction_type: docketDetails.jurisdiction_type,
          date_filed: docketDetails.date_filed,
          docket_number: docketDetails.docket_number,
          court: docketDetails.court,
          parties: docketDetails.parties,
          readable_summary: this.buildCaseSummary(caseData, null, null, null, docketDetails.nature_of_suit, [], docketDetails)
        };

        enhanced.push(enhancedCase);
        logger.log(`✅ [CourtListener] Added case: ${caseName}`);
        logger.log(`   📊 Has: nature_of_suit=${!!docketDetails.nature_of_suit}, cause=${!!docketDetails.cause}, jurisdiction=${!!docketDetails.jurisdiction_type}`);
      } catch (error) {
        logger.error(`⏭️  Skipping ${caseName}: ${error.message}`);
      }
    }

    logger.log(`📊 [CourtListener] Enhanced ${enhanced.length} cases with useful metadata`);
    return enhanced;
  }

  /**
   * Build readable summary from consolidated case data
   * @private
   */
  buildCaseSummary(caseData, complaint, verdict, judgment, nature_of_suit, clusters = [], docketData = null) {
    const parts = [`**${caseData.case_name}**`];

    logger.log(`📝 [CourtListener] Building summary: complaint=${!!complaint}, verdict=${!!verdict}, judgment=${!!judgment}, clusters=${clusters?.length || 0}, docketData=${!!docketData}`);

    // Use docket metadata if we have it (we CAN access this even without docket entries)
    if (docketData) {
      if (docketData.nature_of_suit) {
        parts.push(`\n**Type:** ${docketData.nature_of_suit}`);
      }
      if (docketData.cause) {
        parts.push(`\n**Cause:** ${docketData.cause}`);
      }
      if (docketData.jurisdiction_type) {
        parts.push(`\n**Jurisdiction:** ${docketData.jurisdiction_type}`);
      }
      if (docketData.date_filed) {
        parts.push(`\n**Filed:** ${docketData.date_filed}`);
      }
      if (docketData.docket_number) {
        parts.push(`\n**Docket #:** ${docketData.docket_number}`);
      }
    } else if (nature_of_suit) {
      // Fallback to passed nature_of_suit
      parts.push(`\n**Nature of Suit:** ${nature_of_suit}`);
    }

    if (complaint) {
      parts.push(`\n**Complaint Filed:** ${complaint.date} - ${complaint.description}`);
    }

    if (verdict) {
      parts.push(`\n**Verdict:** ${verdict.date} - ${verdict.description}`);
    }

    if (judgment) {
      logger.log(`   Adding judgment: ${judgment.description || judgment.details || 'NO DESCRIPTION'}`);
      const judgmentText = judgment.description || judgment.details || 'Judgment entered';
      parts.push(`\n**Judgment:** ${judgment.date || 'Date unknown'} - ${judgmentText}`);
    }

    // Add cluster/opinion info if available
    if (clusters && clusters.length > 0) {
      logger.log(`   Processing ${clusters.length} clusters...`);
      clusters.forEach((cluster, idx) => {
        logger.log(`   Cluster ${idx}: disposition=${cluster?.disposition}, syllabus=${cluster?.syllabus?.slice(0, 50)}`);
        if (cluster && cluster.disposition) {
          parts.push(`\n**Court Decision:** ${cluster.disposition}`);
        }
        if (cluster && cluster.syllabus) {
          parts.push(`\n**Summary:** ${cluster.syllabus.slice(0, 200)}...`);
        }
      });
    }

    // If minimal data, still useful to show we found a case
    if (parts.length === 1) {
      // Add any available basic info
      if (caseData.court) {
        parts.push(`\n**Court:** ${caseData.court}`);
      }
      if (caseData.date_filed) {
        parts.push(`\n**Filed:** ${caseData.date_filed}`);
      }
      if (caseData.docket_number) {
        parts.push(`\n**Docket #:** ${caseData.docket_number}`);
      }
      if (caseData.description) {
        // Truncate long descriptions
        const desc = caseData.description.length > 200
          ? caseData.description.slice(0, 200) + '...'
          : caseData.description;
        parts.push(`\n\n${desc}`);
      }

      // Still add something even if we have no details
      if (parts.length === 1) {
        parts.push(`\nCase information available on CourtListener.`);
      }
    }

    const summary = parts.join('');
    logger.log(`   Final summary length: ${summary.length} chars`);

    return summary;
  }
}

// Export singleton instance
export default new CourtListenerService();
