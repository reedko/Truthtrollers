# Credibility Checking Modules

This document describes the credibility checking modules for authors, publishers, and content using external APIs.

## Overview

The credibility system integrates with two external services:
- **Global Disinformation Index (GDI)**: Provides credibility scores for publishers and URLs
- **OpenSanctions**: Screens authors and publishers against sanctions lists, PEPs, and watchlists

## Configuration

Add the following environment variables to your `.env` file:

```bash
# Global Disinformation Index
GDI_API_URL=https://api.disinformationindex.org/v1
GDI_API_KEY=your_gdi_api_key_here

# OpenSanctions
OPENSANCTIONS_API_URL=https://api.opensanctions.org/match/default
OPENSANCTIONS_API_KEY=your_opensanctions_api_key_here
```

### Getting API Keys

**GDI API Key:**
- Visit: https://disinformationindex.org/
- Contact them for API access
- The API provides credibility scores for news domains and URLs

**OpenSanctions API Key:**
- Visit: https://www.opensanctions.org/
- Sign up for API access at: https://www.opensanctions.org/api/
- Free tier available for limited queries

## Database Setup

### 1. Run the main migration

```bash
node backend/migrations/add-credibility-checks.js
```

This creates:
- Adds `domain` column to `publishers` table (required for GDI checks)
- `author_credibility_checks` - Stores OpenSanctions checks for authors
- `publisher_credibility_checks` - Stores GDI and OpenSanctions checks for publishers
- `content_credibility_checks` - Stores GDI checks for content URLs
- Views for easy summary access

### 2. (Optional) Populate publisher domains

```bash
node backend/migrations/populate-publisher-domains.js
```

This helper script:
- Extracts domains from publisher names (e.g., "nytimes.com" from "The New York Times (nytimes.com)")
- Populates the `domain` column for publishers
- **Note**: Publishers without domains can still be checked via OpenSanctions (by name) but won't be checked via GDI (which requires domains)

## Service Modules

### GDI Service (`gdi.service.js`)

Provides credibility scoring for publishers and URLs.

**Methods:**
- `checkPublisher(domain)` - Check a publisher domain
- `checkUrl(url)` - Check a specific URL
- `batchCheckPublishers(domains)` - Batch check multiple publishers

**Response format:**
```javascript
{
  source: 'gdi',
  domain: 'example.com',
  score: 75.5,
  risk_level: 'medium', // 'low', 'medium', 'high', 'critical', 'unknown'
  categories: ['news', 'politics'],
  flags: ['bias_concern'],
  last_updated: '2026-03-09T...'
}
```

### OpenSanctions Service (`opensanctions.service.js`)

Screens entities against sanctions lists, PEPs, and watchlists.

**Methods:**
- `searchPerson(name, options)` - Search for a person
- `searchOrganization(name, options)` - Search for an organization
- `checkAuthor(author)` - Check an author object
- `checkPublisher(publisher)` - Check a publisher object
- `getEntityDetails(entityId)` - Get detailed entity information

**Response format:**
```javascript
{
  source: 'opensanctions',
  entity_type: 'person',
  search_term: 'John Doe',
  has_matches: true,
  match_count: 2,
  highest_score: 0.95,
  risk_level: 'critical', // 'none', 'medium', 'high', 'critical'
  risk_reasons: ['sanctions_match', 'pep_match'],
  matches: [
    {
      entity_id: 'Q123456',
      name: 'John Doe',
      score: 0.95,
      datasets: ['us_ofac_sdn'],
      countries: ['US'],
      topics: ['sanction']
    }
  ]
}
```

### Credibility Service (`credibility.service.js`)

Orchestrates checks across multiple services.

**Methods:**
- `checkAuthor(author, authorId)` - Check author (uses OpenSanctions)
- `checkPublisher(publisher, publisherId)` - Check publisher (uses GDI + OpenSanctions)
- `checkContent(url, contentId)` - Check content URL (uses GDI)
- `batchCheckAuthors(authors)` - Batch check multiple authors
- `batchCheckPublishers(publishers)` - Batch check multiple publishers
- `getServiceStatus()` - Get status of configured services

## API Endpoints

All endpoints require authentication (`authenticateToken` middleware).

### Check Credibility

**POST** `/api/credibility/author/:authorId/check`
- Check an author against OpenSanctions
- Stores results in database
- Returns combined credibility data

**POST** `/api/credibility/publisher/:publisherId/check`
- Check a publisher against GDI and OpenSanctions
- Stores results in database
- Returns combined credibility data

**POST** `/api/credibility/content/:contentId/check`
- Check content URL against GDI
- Stores results in database
- Returns credibility data

### Get History

**GET** `/api/credibility/author/:authorId/history`
- Get all credibility check history for an author

**GET** `/api/credibility/publisher/:publisherId/history`
- Get all credibility check history for a publisher

**GET** `/api/credibility/content/:contentId/history`
- Get all credibility check history for content

### Summaries

**GET** `/api/credibility/summary/authors`
- Get all authors with medium+ risk level

**GET** `/api/credibility/summary/publishers`
- Get all publishers with medium+ risk level

### Batch Operations

**POST** `/api/credibility/batch/authors`
```json
{
  "authorIds": [1, 2, 3]
}
```

**POST** `/api/credibility/batch/publishers`
```json
{
  "publisherIds": [1, 2, 3]
}
```

### Service Status

**GET** `/api/credibility/service-status`
- Check which credibility services are configured and available

## Usage Examples

### Check a Publisher

```javascript
// Frontend code
const response = await fetch('/api/credibility/publisher/123/check', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const result = await response.json();
console.log('Overall risk:', result.overall_risk);
console.log('GDI score:', result.services.gdi.score);
console.log('OpenSanctions matches:', result.services.opensanctions.matches);
```

### Check an Author

```javascript
const response = await fetch('/api/credibility/author/456/check', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const result = await response.json();
if (result.services.opensanctions.has_matches) {
  console.log('Warning: Author matched in sanctions database!');
  console.log('Matches:', result.services.opensanctions.matches);
}
```

### Get Risk Summary

```javascript
// Get all high-risk publishers
const response = await fetch('/api/credibility/summary/publishers', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const publishers = await response.json();
publishers.forEach(pub => {
  console.log(`${pub.publisher_name}: Risk score ${pub.overall_risk_score}`);
});
```

## Risk Levels

The system uses standardized risk levels:

| Level | Score | Description |
|-------|-------|-------------|
| none | 0 | No risk detected |
| low | 1 | Low risk, minimal concerns |
| medium | 2 | Medium risk, some concerns |
| high | 3 | High risk, significant concerns |
| critical | 4 | Critical risk, severe concerns |
| unknown | 0 | Unable to determine risk |

### GDI Risk Calculation
- **low**: score >= 80
- **medium**: score >= 60
- **high**: score >= 40
- **critical**: score < 40

### OpenSanctions Risk Calculation
- **critical**: Sanctions match or crime/wanted list match
- **high**: PEP (Politically Exposed Person) match
- **medium**: Other match with score > 0.7

## Database Tables

### author_credibility_checks
Stores OpenSanctions checks for authors.

### publisher_credibility_checks
Stores GDI and OpenSanctions checks for publishers.

### content_credibility_checks
Stores GDI checks for content URLs.

### Views
- `author_credibility_summary` - Latest check results per author
- `publisher_credibility_summary` - Latest check results per publisher
- `content_credibility_summary` - Latest check results per content

## Error Handling

All services return error objects when checks fail:

```javascript
{
  source: 'gdi' | 'opensanctions',
  error: 'not_found' | 'authentication_failed' | 'rate_limit' | 'timeout' | 'api_error',
  message: 'Human-readable error message',
  identifier: 'entity that was checked'
}
```

## Rate Limiting

Both services have rate limits. The batch check functions include delays between requests:
- Author/Publisher batch checks: 500ms delay between items
- OpenSanctions batch: 200ms delay between items

## Future Enhancements

Potential improvements:
1. Caching of credibility checks (avoid re-checking same entity frequently)
2. Scheduled background checks for all publishers/authors
3. Webhooks to receive updates from OpenSanctions
4. Integration with additional credibility services
5. Risk score aggregation algorithms
6. Alert system for new high-risk matches
