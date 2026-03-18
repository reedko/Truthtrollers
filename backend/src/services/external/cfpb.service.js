// /backend/src/services/external/cfpb.service.js
// Consumer Financial Protection Bureau (CFPB) API Service
// Searches consumer complaints about financial institutions
// API Docs: https://cfpb.github.io/api/ccdb/

import logger from '../../utils/logger.js';

/**
 * CFPB Consumer Complaints Service
 * Searches consumer complaints database for financial institutions
 */
class CFPBService {
  constructor() {
    this.baseUrl = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1';
    // CFPB API is public and doesn't require authentication
  }

  /**
   * Check if service is configured (always true for CFPB public API)
   */
  isConfigured() {
    return true;
  }

  /**
   * Check consumer complaints for a person (author)
   * Note: CFPB primarily tracks companies, so individual checks will rarely find data
   * @param {Object} author - Author object with name
   * @returns {Promise<Object>} Search results
   */
  async checkAuthor(author) {
    const fullName = this.buildFullName(author);

    try {
      logger.log(`💰 [CFPB] Checking author: ${fullName}`);

      // Search for company name matching author name (rare but possible)
      const results = await this.searchComplaints(fullName);

      return {
        source: 'cfpb',
        entity_type: 'person',
        entity_name: fullName,
        has_complaints: results.hits.total.value > 0,
        complaint_count: results.hits.total.value,
        complaints: results.hits.hits.slice(0, 10).map(h => this.formatComplaint(h._source)),
        risk_level: 'none', // Individuals typically won't have CFPB complaints
        risk_reasons: [],
        note: 'CFPB primarily tracks companies, not individuals',
        checked_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CFPB] Author check failed:', error.message);
      return {
        source: 'cfpb',
        error: 'check_failed',
        message: error.message
      };
    }
  }

  /**
   * Check consumer complaints for a publisher/organization
   * @param {Object} publisher - Publisher object with name
   * @returns {Promise<Object>} Search results with complaint data
   */
  async checkPublisher(publisher) {
    const orgName = publisher.publisher_name || publisher.name;

    try {
      logger.log(`💰 [CFPB] Checking publisher: ${orgName}`);

      // Search complaints by company name
      const results = await this.searchComplaints(orgName);

      const complaintCount = results.hits.total.value;
      const complaints = results.hits.hits.map(h => h._source);

      // Get aggregations (complaint types, products, etc.)
      const stats = this.analyzeComplaints(complaints);

      return {
        source: 'cfpb',
        entity_type: 'organization',
        entity_name: orgName,
        has_complaints: complaintCount > 0,
        complaint_count: complaintCount,
        complaints: complaints.slice(0, 10).map(c => this.formatComplaint(c)),
        statistics: stats,
        risk_level: this.assessRisk(complaintCount, stats),
        risk_reasons: this.buildRiskReasons(complaintCount, stats),
        checked_at: new Date().toISOString()
      };
    } catch (error) {
      logger.error('❌ [CFPB] Publisher check failed:', error.message);
      return {
        source: 'cfpb',
        error: 'check_failed',
        message: error.message
      };
    }
  }

  /**
   * Search complaints by company name
   * @private
   */
  async searchComplaints(companyName) {
    const url = `${this.baseUrl}/?company=${encodeURIComponent(companyName)}&size=100&sort=created_date_desc`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`CFPB API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Get complaint statistics by product, issue, etc.
   * @param {string} companyName - Company name to query
   * @returns {Promise<Object>} Aggregated statistics
   */
  async getComplaintStats(companyName) {
    const url = `${this.baseUrl}/?company=${encodeURIComponent(companyName)}&size=0&agg=product,issue,company_response`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`CFPB API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Format complaint data for consistent response
   * @private
   */
  formatComplaint(complaint) {
    return {
      complaint_id: complaint.complaint_id,
      date_received: complaint.date_received,
      product: complaint.product,
      sub_product: complaint.sub_product,
      issue: complaint.issue,
      sub_issue: complaint.sub_issue,
      company_response: complaint.company_response_to_consumer,
      consumer_disputed: complaint.consumer_disputed,
      timely_response: complaint.timely_response === 'Yes',
      state: complaint.state,
      zip_code: complaint.zip_code,
      submitted_via: complaint.submitted_via
    };
  }

  /**
   * Analyze complaints to extract statistics
   * @private
   */
  analyzeComplaints(complaints) {
    const products = {};
    const issues = {};
    const responses = {};
    let disputedCount = 0;
    let untimelyCount = 0;

    complaints.forEach(c => {
      // Count by product
      products[c.product] = (products[c.product] || 0) + 1;

      // Count by issue
      issues[c.issue] = (issues[c.issue] || 0) + 1;

      // Count by company response
      responses[c.company_response_to_consumer] = (responses[c.company_response_to_consumer] || 0) + 1;

      // Count disputed
      if (c.consumer_disputed === 'Yes') disputedCount++;

      // Count untimely responses
      if (c.timely_response === 'No') untimelyCount++;
    });

    return {
      top_products: Object.entries(products)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([product, count]) => ({ product, count })),
      top_issues: Object.entries(issues)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([issue, count]) => ({ issue, count })),
      company_responses: responses,
      disputed_percentage: complaints.length > 0
        ? Math.round((disputedCount / complaints.length) * 100)
        : 0,
      untimely_percentage: complaints.length > 0
        ? Math.round((untimelyCount / complaints.length) * 100)
        : 0
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
   * Assess risk level based on complaint count and statistics
   * @private
   */
  assessRisk(complaintCount, stats) {
    if (complaintCount === 0) return 'none';

    // High complaint count
    if (complaintCount > 1000) return 'high';
    if (complaintCount > 500) return 'medium';

    // Check for high dispute or untimely response rates
    if (stats.disputed_percentage > 50 || stats.untimely_percentage > 30) {
      return 'high';
    }

    if (stats.disputed_percentage > 30 || stats.untimely_percentage > 20) {
      return 'medium';
    }

    if (complaintCount > 100) return 'medium';
    if (complaintCount > 10) return 'low';

    return 'low';
  }

  /**
   * Build risk reasons array
   * @private
   */
  buildRiskReasons(complaintCount, stats) {
    const reasons = [];

    if (complaintCount > 0) {
      reasons.push(`${complaintCount} consumer complaint(s) filed`);
    }

    if (complaintCount > 500) {
      reasons.push('High volume of consumer complaints');
    }

    if (stats.disputed_percentage > 30) {
      reasons.push(`${stats.disputed_percentage}% of complaints disputed by consumers`);
    }

    if (stats.untimely_percentage > 20) {
      reasons.push(`${stats.untimely_percentage}% untimely responses to complaints`);
    }

    if (stats.top_issues && stats.top_issues.length > 0) {
      const topIssue = stats.top_issues[0];
      reasons.push(`Most common issue: ${topIssue.issue} (${topIssue.count} complaints)`);
    }

    return reasons;
  }

  /**
   * Get trends over time for a company
   * @param {string} companyName - Company name
   * @param {string} dateMin - Start date (YYYY-MM-DD)
   * @param {string} dateMax - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} Trend data
   */
  async getComplaintTrends(companyName, dateMin = null, dateMax = null) {
    let url = `${this.baseUrl}/?company=${encodeURIComponent(companyName)}&date_interval=month`;

    if (dateMin) url += `&date_received_min=${dateMin}`;
    if (dateMax) url += `&date_received_max=${dateMax}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`CFPB API error: ${response.status}`);
    }

    return await response.json();
  }
}

// Export singleton instance
export default new CFPBService();
