// /backend/src/services/external/gdi.service.js
import axios from 'axios';

/**
 * Global Disinformation Index API Service
 * Provides credibility scoring for publishers and URLs
 */
class GDIService {
  constructor() {
    this.baseUrl = process.env.GDI_API_URL || 'https://api.disinformationindex.org/v1';
    this.apiKey = process.env.GDI_API_KEY;
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Check if GDI service is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get credibility score for a publisher domain
   * @param {string} domain - Publisher domain (e.g., 'example.com')
   * @returns {Promise<Object>} GDI credibility data
   */
  async checkPublisher(domain) {
    if (!this.isConfigured()) {
      throw new Error('GDI API key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/publishers/${encodeURIComponent(domain)}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      return this.normalizePublisherResponse(response.data);
    } catch (error) {
      return this.handleError(error, 'publisher', domain);
    }
  }

  /**
   * Get credibility score for a specific URL
   * @param {string} url - Full URL to check
   * @returns {Promise<Object>} GDI credibility data
   */
  async checkUrl(url) {
    if (!this.isConfigured()) {
      throw new Error('GDI API key not configured');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/check`, {
        url: url
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      return this.normalizeUrlResponse(response.data);
    } catch (error) {
      return this.handleError(error, 'url', url);
    }
  }

  /**
   * Batch check multiple publishers
   * @param {Array<string>} domains - Array of publisher domains
   * @returns {Promise<Array<Object>>} Array of GDI credibility data
   */
  async batchCheckPublishers(domains) {
    if (!this.isConfigured()) {
      throw new Error('GDI API key not configured');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/publishers/batch`, {
        domains: domains
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout * 2 // Double timeout for batch
      });

      return response.data.map(item => this.normalizePublisherResponse(item));
    } catch (error) {
      return this.handleError(error, 'batch_publishers', domains.join(', '));
    }
  }

  /**
   * Normalize publisher response to standard format
   * @private
   */
  normalizePublisherResponse(data) {
    return {
      source: 'gdi',
      domain: data.domain,
      score: data.score || data.credibility_score || null,
      risk_level: data.risk_level || this.calculateRiskLevel(data.score),
      categories: data.categories || [],
      flags: data.flags || [],
      last_updated: data.last_updated || data.updated_at || new Date().toISOString(),
      raw_data: data
    };
  }

  /**
   * Normalize URL response to standard format
   * @private
   */
  normalizeUrlResponse(data) {
    return {
      source: 'gdi',
      url: data.url,
      domain: data.domain,
      score: data.score || data.credibility_score || null,
      risk_level: data.risk_level || this.calculateRiskLevel(data.score),
      categories: data.categories || [],
      flags: data.flags || [],
      content_type: data.content_type || null,
      last_updated: data.last_updated || data.updated_at || new Date().toISOString(),
      raw_data: data
    };
  }

  /**
   * Calculate risk level from score
   * @private
   */
  calculateRiskLevel(score) {
    if (score === null || score === undefined) return 'unknown';
    if (score >= 80) return 'low';
    if (score >= 60) return 'medium';
    if (score >= 40) return 'high';
    return 'critical';
  }

  /**
   * Handle API errors
   * @private
   */
  handleError(error, checkType, identifier) {
    console.error(`GDI API Error (${checkType}):`, error.message);

    if (error.response) {
      // API responded with error status
      const status = error.response.status;

      if (status === 404) {
        return {
          source: 'gdi',
          error: 'not_found',
          message: `${checkType} not found in GDI database: ${identifier}`,
          identifier: identifier
        };
      }

      if (status === 401 || status === 403) {
        return {
          source: 'gdi',
          error: 'authentication_failed',
          message: 'GDI API authentication failed',
          identifier: identifier
        };
      }

      if (status === 429) {
        return {
          source: 'gdi',
          error: 'rate_limit',
          message: 'GDI API rate limit exceeded',
          identifier: identifier
        };
      }

      return {
        source: 'gdi',
        error: 'api_error',
        message: error.response.data?.message || 'GDI API error',
        status: status,
        identifier: identifier
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        source: 'gdi',
        error: 'timeout',
        message: 'GDI API request timed out',
        identifier: identifier
      };
    }

    return {
      source: 'gdi',
      error: 'unknown',
      message: error.message,
      identifier: identifier
    };
  }
}

// Export singleton instance
export default new GDIService();
