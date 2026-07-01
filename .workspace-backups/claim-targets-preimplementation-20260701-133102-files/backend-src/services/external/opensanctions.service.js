// /backend/src/services/external/opensanctions.service.js
import axios from 'axios';

/**
 * OpenSanctions API Service
 * Screens authors, publishers, and organizations against sanctions lists,
 * politically exposed persons (PEPs), and other watchlists
 */
class OpenSanctionsService {
  constructor() {
    this.baseUrl = process.env.OPENSANCTIONS_API_URL || 'https://api.opensanctions.org/match/default';
    this.apiKey = process.env.OPENSANCTIONS_API_KEY;
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Check if OpenSanctions service is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Search for a person by name
   * @param {string} name - Full name of the person
   * @param {Object} options - Additional search parameters
   * @returns {Promise<Object>} OpenSanctions match data
   */
  async searchPerson(name, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('OpenSanctions API key not configured');
    }

    try {
      const query = {
        schema: 'Person',
        properties: {
          name: [name]
        }
      };

      // Add optional parameters
      if (options.birthDate) {
        query.properties.birthDate = [options.birthDate];
      }
      if (options.nationality) {
        query.properties.nationality = [options.nationality];
      }
      if (options.country) {
        query.properties.country = [options.country];
      }

      const params = {
        queries: {
          query: query
        }
      };

      const response = await axios.post(this.baseUrl, params, {
        headers: {
          'Authorization': `ApiKey ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      return this.normalizeResponse(response.data, 'person', name);
    } catch (error) {
      return this.handleError(error, 'person', name);
    }
  }

  /**
   * Search for an organization by name
   * @param {string} name - Organization name
   * @param {Object} options - Additional search parameters
   * @returns {Promise<Object>} OpenSanctions match data
   */
  async searchOrganization(name, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('OpenSanctions API key not configured');
    }

    try {
      const query = {
        schema: 'Organization',
        properties: {
          name: [name]
        }
      };

      // Add optional parameters
      if (options.country) {
        query.properties.country = [options.country];
      }
      if (options.jurisdiction) {
        query.properties.jurisdiction = [options.jurisdiction];
      }

      const params = {
        queries: {
          query: query
        }
      };

      const response = await axios.post(this.baseUrl, params, {
        headers: {
          'Authorization': `ApiKey ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      });

      return this.normalizeResponse(response.data, 'organization', name);
    } catch (error) {
      return this.handleError(error, 'organization', name);
    }
  }

  /**
   * Check an author against OpenSanctions
   * @param {Object} author - Author object with name and optional metadata
   * @returns {Promise<Object>} OpenSanctions match data
   */
  async checkAuthor(author) {
    const fullName = `${author.author_first_name || ''} ${author.author_middle_name || ''} ${author.author_last_name || ''}`.trim();

    return this.searchPerson(fullName, {
      country: author.country,
      nationality: author.nationality
    });
  }

  /**
   * Check a publisher/organization against OpenSanctions
   * @param {Object} publisher - Publisher object with name and optional metadata
   * @returns {Promise<Object>} OpenSanctions match data
   */
  async checkPublisher(publisher) {
    const name = publisher.name || publisher.publisher_name;

    return this.searchOrganization(name, {
      country: publisher.country,
      jurisdiction: publisher.jurisdiction
    });
  }

  /**
   * Batch check multiple entities
   * @param {Array<Object>} entities - Array of entities to check
   * @param {string} entityType - Type: 'person' or 'organization'
   * @returns {Promise<Array<Object>>} Array of match results
   */
  async batchCheck(entities, entityType = 'person') {
    if (!this.isConfigured()) {
      throw new Error('OpenSanctions API key not configured');
    }

    const results = [];

    // OpenSanctions API may not support batch requests, so we'll do sequential checks
    // with a small delay to avoid rate limiting
    for (const entity of entities) {
      try {
        const result = entityType === 'person'
          ? await this.checkAuthor(entity)
          : await this.checkPublisher(entity);

        results.push(result);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        results.push({
          source: 'opensanctions',
          error: 'batch_item_failed',
          entity: entity,
          message: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get detailed information about a matched entity
   * @param {string} entityId - OpenSanctions entity ID
   * @returns {Promise<Object>} Detailed entity information
   */
  async getEntityDetails(entityId) {
    if (!this.isConfigured()) {
      throw new Error('OpenSanctions API key not configured');
    }

    try {
      const response = await axios.get(`https://api.opensanctions.org/entities/${entityId}`, {
        headers: {
          'Authorization': `ApiKey ${this.apiKey}`
        },
        timeout: this.timeout
      });

      return {
        source: 'opensanctions',
        entity_id: entityId,
        details: response.data,
        retrieved_at: new Date().toISOString()
      };
    } catch (error) {
      return this.handleError(error, 'entity_details', entityId);
    }
  }

  /**
   * Normalize API response to standard format
   * @private
   */
  normalizeResponse(data, entityType, searchTerm) {
    // Handle new API format with responses wrapper
    const queryResults = data.responses?.query || data;
    const results = queryResults.results || [];
    const hasMatches = results.length > 0;

    // Calculate highest match score
    const highestScore = hasMatches
      ? Math.max(...results.map(r => r.score || 0))
      : 0;

    // Determine risk level based on matches
    let riskLevel = 'none';
    let riskReasons = [];

    if (hasMatches) {
      const topMatch = results[0];

      // Check for sanctions
      if (topMatch.datasets?.some(ds => ds.includes('sanctions'))) {
        riskLevel = 'critical';
        riskReasons.push('sanctions_match');
      }
      // Check for PEPs
      else if (topMatch.datasets?.some(ds => ds.includes('pep'))) {
        riskLevel = 'high';
        riskReasons.push('pep_match');
      }
      // Check for crime/wanted lists
      else if (topMatch.datasets?.some(ds => ds.includes('crime') || ds.includes('wanted'))) {
        riskLevel = 'critical';
        riskReasons.push('crime_match');
      }
      // Any other match
      else if (highestScore > 0.7) {
        riskLevel = 'medium';
        riskReasons.push('potential_match');
      }
    }

    return {
      source: 'opensanctions',
      entity_type: entityType,
      search_term: searchTerm,
      has_matches: hasMatches,
      match_count: results.length,
      highest_score: highestScore,
      risk_level: riskLevel,
      risk_reasons: riskReasons,
      matches: results.map(match => ({
        entity_id: match.id,
        name: match.caption || match.properties?.name?.[0],
        score: match.score,
        datasets: match.datasets || [],
        schema: match.schema,
        properties: match.properties,
        first_seen: match.first_seen,
        last_seen: match.last_seen,
        countries: match.properties?.country || [],
        topics: match.topics || []
      })),
      checked_at: new Date().toISOString(),
      raw_data: data
    };
  }

  /**
   * Handle API errors
   * @private
   */
  handleError(error, checkType, identifier) {
    console.error(`OpenSanctions API Error (${checkType}):`, error.message);

    if (error.response) {
      const status = error.response.status;

      if (status === 404) {
        return {
          source: 'opensanctions',
          error: 'not_found',
          message: `${checkType} not found`,
          identifier: identifier
        };
      }

      if (status === 401 || status === 403) {
        return {
          source: 'opensanctions',
          error: 'authentication_failed',
          message: 'OpenSanctions API authentication failed',
          identifier: identifier
        };
      }

      if (status === 429) {
        return {
          source: 'opensanctions',
          error: 'rate_limit',
          message: 'OpenSanctions API rate limit exceeded',
          identifier: identifier
        };
      }

      return {
        source: 'opensanctions',
        error: 'api_error',
        message: error.response.data?.message || 'OpenSanctions API error',
        status: status,
        identifier: identifier
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        source: 'opensanctions',
        error: 'timeout',
        message: 'OpenSanctions API request timed out',
        identifier: identifier
      };
    }

    return {
      source: 'opensanctions',
      error: 'unknown',
      message: error.message,
      identifier: identifier
    };
  }
}

// Export singleton instance
export default new OpenSanctionsService();
