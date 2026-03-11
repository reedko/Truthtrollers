// /backend/src/services/external/credibility.service.js
import gdiService from './gdi.service.js';
import opensanctionsService from './opensanctions.service.js';

/**
 * Combined Credibility Service
 * Orchestrates credibility checks across multiple external services
 */
class CredibilityService {
  /**
   * Check credibility for an author
   * Runs OpenSanctions screening
   * @param {Object} author - Author object with name and metadata
   * @param {number} authorId - Database author ID
   * @returns {Promise<Object>} Combined credibility results
   */
  async checkAuthor(author, authorId) {
    const results = {
      author_id: authorId,
      checked_at: new Date().toISOString(),
      services: {}
    };

    // Check OpenSanctions for author
    if (opensanctionsService.isConfigured()) {
      try {
        const osResult = await opensanctionsService.checkAuthor(author);
        results.services.opensanctions = osResult;
      } catch (error) {
        console.error('OpenSanctions check failed for author:', error.message);
        results.services.opensanctions = {
          error: 'check_failed',
          message: error.message
        };
      }
    } else {
      results.services.opensanctions = {
        error: 'not_configured',
        message: 'OpenSanctions API not configured'
      };
    }

    // Calculate overall risk level
    results.overall_risk = this.calculateOverallRisk([
      results.services.opensanctions
    ]);

    return results;
  }

  /**
   * Check credibility for a publisher
   * Runs GDI and OpenSanctions checks
   * @param {Object} publisher - Publisher object with name, domain, and metadata
   * @param {number} publisherId - Database publisher ID
   * @returns {Promise<Object>} Combined credibility results
   */
  async checkPublisher(publisher, publisherId) {
    const results = {
      publisher_id: publisherId,
      checked_at: new Date().toISOString(),
      services: {}
    };

    // Check GDI for publisher domain
    if (gdiService.isConfigured() && publisher.domain) {
      try {
        const gdiResult = await gdiService.checkPublisher(publisher.domain);
        results.services.gdi = gdiResult;
      } catch (error) {
        console.error('GDI check failed for publisher:', error.message);
        results.services.gdi = {
          error: 'check_failed',
          message: error.message
        };
      }
    } else if (!publisher.domain) {
      results.services.gdi = {
        error: 'missing_domain',
        message: 'Publisher domain not available'
      };
    } else {
      results.services.gdi = {
        error: 'not_configured',
        message: 'GDI API not configured'
      };
    }

    // Check OpenSanctions for publisher organization
    if (opensanctionsService.isConfigured()) {
      try {
        const osResult = await opensanctionsService.checkPublisher(publisher);
        results.services.opensanctions = osResult;
      } catch (error) {
        console.error('OpenSanctions check failed for publisher:', error.message);
        results.services.opensanctions = {
          error: 'check_failed',
          message: error.message
        };
      }
    } else {
      results.services.opensanctions = {
        error: 'not_configured',
        message: 'OpenSanctions API not configured'
      };
    }

    // Calculate overall risk level
    results.overall_risk = this.calculateOverallRisk([
      results.services.gdi,
      results.services.opensanctions
    ]);

    return results;
  }

  /**
   * Check credibility for a content URL
   * Runs GDI URL check
   * @param {string} url - Content URL
   * @param {number} contentId - Database content ID
   * @returns {Promise<Object>} Credibility results
   */
  async checkContent(url, contentId) {
    const results = {
      content_id: contentId,
      url: url,
      checked_at: new Date().toISOString(),
      services: {}
    };

    // Check GDI for URL
    if (gdiService.isConfigured()) {
      try {
        const gdiResult = await gdiService.checkUrl(url);
        results.services.gdi = gdiResult;
      } catch (error) {
        console.error('GDI check failed for content:', error.message);
        results.services.gdi = {
          error: 'check_failed',
          message: error.message
        };
      }
    } else {
      results.services.gdi = {
        error: 'not_configured',
        message: 'GDI API not configured'
      };
    }

    // Calculate overall risk level
    results.overall_risk = this.calculateOverallRisk([
      results.services.gdi
    ]);

    return results;
  }

  /**
   * Batch check multiple authors
   * @param {Array<Object>} authors - Array of author objects with author_id
   * @returns {Promise<Array<Object>>} Array of credibility results
   */
  async batchCheckAuthors(authors) {
    const results = [];

    for (const author of authors) {
      try {
        const result = await this.checkAuthor(author, author.author_id);
        results.push(result);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.push({
          author_id: author.author_id,
          error: 'check_failed',
          message: error.message
        });
      }
    }

    return results;
  }

  /**
   * Batch check multiple publishers
   * @param {Array<Object>} publishers - Array of publisher objects with publisher_id
   * @returns {Promise<Array<Object>>} Array of credibility results
   */
  async batchCheckPublishers(publishers) {
    const results = [];

    for (const publisher of publishers) {
      try {
        const result = await this.checkPublisher(publisher, publisher.publisher_id);
        results.push(result);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.push({
          publisher_id: publisher.publisher_id,
          error: 'check_failed',
          message: error.message
        });
      }
    }

    return results;
  }

  /**
   * Calculate overall risk level from multiple service results
   * @private
   */
  calculateOverallRisk(serviceResults) {
    const riskLevels = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      none: 0,
      unknown: 0
    };

    let maxRiskLevel = 'none';
    let maxRiskScore = 0;
    const flags = [];
    const reasons = [];

    for (const result of serviceResults) {
      if (result && !result.error) {
        const risk = result.risk_level || 'unknown';
        const score = riskLevels[risk] || 0;

        if (score > maxRiskScore) {
          maxRiskScore = score;
          maxRiskLevel = risk;
        }

        // Collect flags and reasons
        if (result.flags) {
          flags.push(...result.flags);
        }
        if (result.risk_reasons) {
          reasons.push(...result.risk_reasons);
        }

        // Special case for OpenSanctions matches
        if (result.source === 'opensanctions' && result.has_matches) {
          reasons.push(`${result.match_count} OpenSanctions match(es)`);
        }

        // Special case for GDI scores
        if (result.source === 'gdi' && result.score !== null) {
          reasons.push(`GDI score: ${result.score}`);
        }
      }
    }

    return {
      level: maxRiskLevel,
      score: maxRiskScore,
      flags: [...new Set(flags)], // Remove duplicates
      reasons: [...new Set(reasons)]
    };
  }

  /**
   * Get service status
   * @returns {Object} Status of all configured services
   */
  getServiceStatus() {
    return {
      gdi: {
        configured: gdiService.isConfigured(),
        name: 'Global Disinformation Index'
      },
      opensanctions: {
        configured: opensanctionsService.isConfigured(),
        name: 'OpenSanctions'
      }
    };
  }
}

// Export singleton instance
export default new CredibilityService();
