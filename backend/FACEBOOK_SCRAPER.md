# Facebook Post Scraper

Module for scraping Facebook posts using Puppeteer. Extracts post text, author, images, and engagement metrics.

## Features

- **Post Content**: Extracts post text, handling "See more" expansions
- **Author Info**: Captures author name from post
- **Timestamps**: Extracts relative timestamps (e.g., "2h ago")
- **Images**: Downloads URLs for all post images
- **Engagement Metrics**: Reactions, comments, and shares counts
- **Authentication**: Supports cookie-based authentication for private/protected content

## API Endpoints

### POST `/api/scrape-facebook-post`

Scrape a Facebook post and optionally create a content entry in the database.

**Request Body:**
```json
{
  "url": "https://www.facebook.com/username/posts/123456789",
  "createContent": false,
  "taskContentId": null,
  "screenshot": false
}
```

**Parameters:**
- `url` (required): Full URL to the Facebook post
- `createContent` (optional): If true, creates a content entry in database
- `taskContentId` (optional): If provided, links scraped content to this task
- `screenshot` (optional): If true, saves a screenshot for debugging

**Response:**
```json
{
  "success": true,
  "contentId": 12345,
  "post": {
    "text": "This is the post content...",
    "author": "Author Name",
    "timestamp": "2h ago",
    "images": ["https://fbcdn.net/image1.jpg"],
    "reactions": 42,
    "comments": 15,
    "shares": 3,
    "scrapedAt": "2026-02-14T10:30:00.000Z"
  }
}
```

### GET `/api/facebook/test`

Test endpoint to verify Facebook scraper is working.

## Usage Examples

### Basic Scraping (No Authentication)

```bash
curl -X POST https://localhost:5001/api/scrape-facebook-post \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.facebook.com/username/posts/123456789"
  }'
```

### Scraping with Content Creation

```bash
curl -X POST https://localhost:5001/api/scrape-facebook-post \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.facebook.com/username/posts/123456789",
    "createContent": true,
    "taskContentId": 100
  }'
```

### From Dashboard (React/TypeScript)

```typescript
import axios from "axios";

const scrapeFacebookPost = async (postUrl: string) => {
  const response = await axios.post(
    `${API_BASE_URL}/api/scrape-facebook-post`,
    {
      url: postUrl,
      createContent: true,
    }
  );
  return response.data;
};
```

## Authentication (For Private Posts)

Facebook requires authentication to view most content. To enable authenticated scraping:

### 1. Save Cookies (One-Time Setup)

Run this command to manually login and save cookies:

```bash
cd backend
node -e "import('./src/scrapers/facebookScraper.js').then(m => m.saveFacebookCookies('./config/facebook-cookies.json'))"
```

This will:
1. Open a browser window
2. Navigate to Facebook login
3. Wait for you to login manually
4. Save cookies to `config/facebook-cookies.json`
5. Close the browser

### 2. Use Saved Cookies

The scraper automatically loads cookies from `config/facebook-cookies.json` if it exists. No code changes needed.

**Important:** Keep `facebook-cookies.json` secure and add it to `.gitignore`.

## Limitations & Notes

1. **Facebook's Anti-Scraping**: Facebook actively blocks scrapers. This module:
   - Uses realistic user-agents
   - Adds random delays
   - Mimics human behavior
   - May still get blocked if used too frequently

2. **Dynamic Content**: Facebook uses heavy JavaScript. The scraper:
   - Uses Puppeteer for full page rendering
   - Waits for content to load
   - May take 5-15 seconds per post

3. **Rate Limiting**: Avoid scraping too many posts rapidly
   - Recommended: 1 post every 5-10 seconds
   - Use cookie authentication to reduce blocking
   - Monitor for CAPTCHA challenges

4. **Content Accuracy**: Facebook's DOM structure changes frequently
   - Selectors may need updating
   - Test with recent posts
   - Report issues if extraction fails

## File Structure

```
backend/
├── src/
│   ├── scrapers/
│   │   └── facebookScraper.js       # Core scraping logic
│   └── routes/
│       └── social/
│           └── facebook.routes.js   # API endpoints
├── config/
│   └── facebook-cookies.json        # Saved authentication (gitignored)
└── logs/
    └── fb-post-*.png                # Debug screenshots (if enabled)
```

## Troubleshooting

### "Failed to scrape Facebook post"

1. Check if URL is valid Facebook post URL
2. Try with `screenshot: true` to see what the scraper sees
3. Check logs for specific error messages
4. Verify cookies are valid (re-save if expired)

### "No post text extracted"

1. Facebook may have changed their DOM structure
2. Post may be deleted or private
3. Try with authenticated cookies
4. Check screenshot to see if content loaded

### "Request timed out"

1. Increase timeout in `scrapeFacebookPost` function
2. Check internet connection
3. Post may have heavy media that takes time to load

## Development

To modify selectors or add new fields:

1. Edit `src/scrapers/facebookScraper.js`
2. Update the `page.evaluate()` section
3. Test with `screenshot: true` to debug
4. Check browser console for errors

## Security Notes

- **Never commit** `facebook-cookies.json` to version control
- Cookies expire - re-save them periodically
- Only use for authorized/legal scraping purposes
- Respect Facebook's Terms of Service
- Consider using Facebook's official Graph API for production use

## Future Enhancements

- [ ] Support for comment extraction
- [ ] Video URL extraction
- [ ] Shared post content
- [ ] Multiple post batch scraping
- [ ] Automatic cookie refresh
- [ ] CAPTCHA detection and handling
