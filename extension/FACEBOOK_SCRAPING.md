# Facebook Post Scraping with Extension

The extension now automatically detects and scrapes Facebook posts using the already-loaded page content.

## How It Works

1. **Navigate to a Facebook post** in your browser
2. **Click the post** to ensure it's fully loaded
3. **Click your extension icon** to scrape the post
4. The extension extracts:
   - Post text
   - Author name
   - Images
   - Engagement metrics (reactions, comments, shares)
5. Content is sent to backend and saved as a task

## Advantages Over Puppeteer

- ✅ **Faster** - No browser launch needed
- ✅ **More Reliable** - Uses already-loaded content
- ✅ **No Detection** - Uses real browser session (not headless)
- ✅ **Authenticated** - Works with your logged-in session
- ✅ **Better Extraction** - Can access fully rendered content

## Testing

### 1. Find a Public Facebook Post

Go to any Facebook post URL like:
```
https://www.facebook.com/username/posts/123456789
```

### 2. Click the Extension Icon

The extension will automatically:
- Detect it's a Facebook post
- Extract the content from the page
- Send it to the backend
- Create a task entry

### 3. View in Dashboard

The post will appear in your dashboard as a new task with:
- Post text as content
- Author information
- Facebook as the media source

## Technical Details

### Extension Flow

```
Facebook Page (loaded)
    ↓
Extension detects Facebook URL
    ↓
scrapeFacebookPost.ts extracts DOM content
    ↓
Sends to background.js
    ↓
background.js sends to backend /api/scrape-facebook-post
    ↓
Backend creates content entry
    ↓
Returns content_id to extension
```

### Files Modified

- `extension/src/services/scrapeFacebookPost.ts` - New Facebook scraper
- `extension/src/services/scrapeContent.ts` - Auto-detects Facebook posts
- `extension/src/background.js` - Added Facebook scraper handler
- `backend/src/routes/social/facebook.routes.js` - Handles extension data

### DOM Selectors Used

The extension looks for:
- Post text: `[data-ad-preview="message"]`, `[data-testid="post_message"]`
- Author: `h2 a[role="link"]`, `a[aria-label*="profile"]`
- Images: `img[data-visualcompletion="media-vc-image"]`
- Engagement: `[aria-label*="reaction"]`, `[aria-label*="comment"]`

## Limitations

1. **Private Posts**: Only works for posts you can see (logged in)
2. **Comments**: Not extracted (only post content)
3. **Videos**: URL extracted, not downloaded
4. **DOM Changes**: Facebook updates may break selectors

## Troubleshooting

### "Could not extract post content"

1. Scroll down to ensure post is visible
2. Click "See more" if text is truncated
3. Wait for images to load
4. Try refreshing the page

### "Not a Facebook post URL"

Extension only works on:
- `/posts/`
- `/permalink/`
- `/photo/`
- `/videos/`

Regular Facebook pages or profiles won't work.

## Future Enhancements

- [ ] Extract comments
- [ ] Extract video URLs
- [ ] Extract poll data
- [ ] Extract event details
- [ ] Support Facebook Stories
