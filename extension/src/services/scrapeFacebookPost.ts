// extension/src/services/scrapeFacebookPost.ts
// ---------------------------------------------------------
// Facebook Post Scraper - extracts content from loaded page
// Uses the already-loaded DOM (no Puppeteer needed!)
// ---------------------------------------------------------

import browser from "webextension-polyfill";

interface FacebookPostData {
  url: string;
  postText: string | null;
  authorName: string | null;
  timestamp: string | null;
  images: string[];
  reactionsCount: number;
  commentsCount: number;
  sharesCount: number;
}

/**
 * Check if current page is Facebook (feed or post)
 */
export function isFacebookPost(url: string): boolean {
  return url.includes("facebook.com") || url.includes("fb.com");
}

/**
 * Get the Facebook post URL for the current page
 * If on feed, finds post in viewport. If on post page, returns current URL.
 * Returns null if not on Facebook or no post found.
 */
export async function getFacebookPostUrl(): Promise<string | null> {
  const pageUrl = window.location.href;

  if (!isFacebookPost(pageUrl)) {
    return null;
  }

  console.log("🔵 [Facebook] Detecting post URL...");

  // If we're already on a post page, just return the URL
  if (pageUrl.includes("/posts/") || pageUrl.includes("/permalink") ||
      pageUrl.includes("/photo") || pageUrl.includes("/videos/")) {
    console.log(`✅ [Facebook] Already on post page: ${pageUrl}`);
    return pageUrl;
  }

  // Try to find post in viewport (for feed scraping)
  const postInViewport = await findPostInViewport();

  if (postInViewport) {
    console.log(`✅ [Facebook] Found post URL in viewport: ${postInViewport.url}`);
    return postInViewport.url;
  }

  console.log("⚠️ [Facebook] No post found");
  return null;
}

/**
 * Extract post URL from embed dialog (programmatically)
 * Clicks the "..." menu, then "Embed", then extracts the embed code
 */
async function extractUrlFromEmbedDialog(postElement: Element): Promise<string | null> {
  console.log("🔵 [Facebook] Attempting to extract URL from embed dialog...");
  console.log(`🔵 [Facebook] Post element tagName: ${postElement.tagName}, role: ${postElement.getAttribute('role')}`);

  try {
    // Find the menu button (three dots "...")
    // Strategy: Search the ENTIRE DOCUMENT first, then find the one closest to our post
    const menuSelectors = [
      '[aria-label*="Actions for"]',   // "Actions for this post"
      '[aria-label*="ctions"]',         // Fallback for "actions"
      'div[role="button"][aria-haspopup="menu"]',  // Has popup menu
    ];

    let menuButton: HTMLElement | null = null;

    console.log("🔵 [Facebook] Strategy 1: Searching in postElement...");
    for (const selector of menuSelectors) {
      const button = postElement.querySelector(selector) as HTMLElement;
      if (button) {
        const label = button.getAttribute('aria-label') || '';
        console.log(`   ✅ Found menu button in post: "${label}" (selector: ${selector})`);
        menuButton = button;
        break;
      } else {
        console.log(`   ⚠️ No match in post for selector: ${selector}`);
      }
    }

    // Strategy 2: Search entire document, then find closest to post
    if (!menuButton) {
      console.log("🔵 [Facebook] Strategy 2: Searching entire document...");

      for (const selector of menuSelectors) {
        const allButtons = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
        console.log(`   Found ${allButtons.length} buttons matching "${selector}" in document`);

        if (allButtons.length > 0) {
          // Find the button closest to our post element
          const postRect = postElement.getBoundingClientRect();
          let closestButton: HTMLElement | null = null;
          let closestDistance = Infinity;

          for (const button of allButtons) {
            const buttonRect = button.getBoundingClientRect();
            const distance = Math.sqrt(
              Math.pow(buttonRect.top - postRect.top, 2) +
              Math.pow(buttonRect.left - postRect.left, 2)
            );

            const label = button.getAttribute('aria-label') || '';
            console.log(`   Button: "${label}" distance: ${distance.toFixed(2)}px`);

            if (distance < closestDistance && distance < 500) { // Within 500px
              closestDistance = distance;
              closestButton = button;
            }
          }

          if (closestButton) {
            const label = closestButton.getAttribute('aria-label') || '';
            console.log(`   ✅ Found closest menu button: "${label}" (distance: ${closestDistance.toFixed(2)}px)`);
            menuButton = closestButton;
            break;
          }
        }
      }
    }

    // Strategy 3: Search in parent elements
    if (!menuButton) {
      console.log("🔵 [Facebook] Strategy 3: Searching parent elements...");
      let currentElement: Element | null = postElement.parentElement;
      let depth = 0;

      while (currentElement && depth < 3) {
        console.log(`   Checking parent at depth ${depth}, tagName: ${currentElement.tagName}`);

        for (const selector of menuSelectors) {
          const button = currentElement.querySelector(selector) as HTMLElement;
          if (button) {
            const label = button.getAttribute('aria-label') || '';
            console.log(`   ✅ Found menu button in parent: "${label}"`);
            menuButton = button;
            break;
          }
        }

        if (menuButton) break;
        currentElement = currentElement.parentElement;
        depth++;
      }
    }

    // Strategy 4: SVG-based search in entire document
    if (!menuButton) {
      console.log("🔵 [Facebook] Strategy 4: SVG-based search...");
      const allDivs = Array.from(document.querySelectorAll('div[role="button"]')) as HTMLElement[];
      console.log(`   Found ${allDivs.length} total button divs in document`);

      const postRect = postElement.getBoundingClientRect();

      for (const div of allDivs) {
        const svg = div.querySelector('svg');
        if (svg) {
          const label = div.getAttribute('aria-label') || '';
          const divRect = div.getBoundingClientRect();
          const distance = Math.sqrt(
            Math.pow(divRect.top - postRect.top, 2) +
            Math.pow(divRect.left - postRect.left, 2)
          );

          if (label.toLowerCase().includes('action') || label.toLowerCase().includes('menu') || label.toLowerCase().includes('more')) {
            console.log(`   Checking SVG button: "${label}" distance: ${distance.toFixed(2)}px`);

            if (distance < 500) {
              console.log(`   ✅ Found menu button via SVG search!`);
              menuButton = div;
              break;
            }
          }
        }
      }

      if (!menuButton) {
        console.log("⚠️ [Facebook] Could not find menu button with any strategy");
        console.log(`   Post HTML (first 500 chars): ${postElement.innerHTML.substring(0, 500)}`);
        return null;
      }
    }

    // Click the menu button
    console.log("🔵 [Facebook] Clicking menu button...");
    menuButton.click();
    await new Promise(resolve => setTimeout(resolve, 800));

    // Find the "Embed" option in the menu
    // Use more specific selectors for post menu items
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
    console.log(`🔵 [Facebook] Found ${menuItems.length} menu items, looking for Embed...`);

    let embedButton: HTMLElement | null = null;

    // Log first 20 menu items to see what we got
    const itemTexts = menuItems.slice(0, 20).map(item => item.textContent?.trim() || '');
    console.log(`   First 20 menu items: ${JSON.stringify(itemTexts)}`);

    // Check if this is actually a post menu (should have post-specific items)
    const hasPostMenuItems = menuItems.some(item => {
      const text = item.textContent?.toLowerCase() || '';
      return text.includes('save') || text.includes('hide') || text.includes('embed') ||
             text.includes('copy link') || text.includes('report');
    });

    if (!hasPostMenuItems) {
      console.log("⚠️ [Facebook] Wrong menu opened (not a post menu). Closing and trying different approach...");
      // Close menu
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await new Promise(resolve => setTimeout(resolve, 300));

      // Try clicking directly on the post element's menu button
      // Look for the menu button that's a child or descendant of the post
      const postMenuButton = postElement.querySelector('[aria-label*="Actions for"]') as HTMLElement ||
                             postElement.querySelector('[aria-label*="ctions"]') as HTMLElement ||
                             postElement.querySelector('div[role="button"][aria-haspopup="menu"]') as HTMLElement;

      if (postMenuButton) {
        console.log("🔵 [Facebook] Found menu button inside post element, clicking it...");
        postMenuButton.click();
        await new Promise(resolve => setTimeout(resolve, 800));

        // Try again to find embed
        const newMenuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
        console.log(`🔵 [Facebook] Found ${newMenuItems.length} menu items after retry`);

        for (const item of newMenuItems) {
          const text = item.textContent?.toLowerCase() || '';
          if (text.includes('embed')) {
            embedButton = item as HTMLElement;
            console.log(`   ✅ Found Embed button!`);
            break;
          }
        }
      } else {
        console.log("⚠️ [Facebook] No menu button found inside post element");
      }

      if (!embedButton) {
        console.log("⚠️ [Facebook] Still could not find Embed option");
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return null;
      }
    } else {
      // This is the correct post menu, find Embed
      for (const item of menuItems) {
        const text = item.textContent?.toLowerCase() || '';
        if (text.includes('embed')) {
          embedButton = item as HTMLElement;
          console.log(`   ✅ Found Embed button!`);
          break;
        }
      }

      if (!embedButton) {
        console.log("⚠️ [Facebook] Could not find Embed option in post menu");
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return null;
      }
    }

    // Click the embed button
    console.log("🔵 [Facebook] Clicking Embed option...");
    embedButton.click();

    // Wait for embed dialog to appear
    await new Promise(resolve => setTimeout(resolve, 1000));

    // First, find the embed dialog/modal container
    // Facebook uses role="dialog" for modals
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    console.log(`🔵 [Facebook] Found ${dialogs.length} dialog(s) on page`);

    let embedDialog: Element | null = null;

    // Find the dialog that contains "Embed" text
    for (const dialog of dialogs) {
      const dialogText = dialog.textContent?.toLowerCase() || '';
      if (dialogText.includes('embed')) {
        embedDialog = dialog;
        console.log(`🔵 [Facebook] Found embed dialog`);
        break;
      }
    }

    // If no dialog found, fall back to searching entire document
    const searchScope = embedDialog || document;
    console.log(`🔵 [Facebook] Searching for URL in: ${embedDialog ? 'embed dialog' : 'entire document'}`);

    // Try multiple strategies to extract the URL:

    // Strategy 1: Look for anchor tag with relative post URL in embed dialog
    // Format: <a href="/username/posts/12345?ref=embed_post" target="_blank">
    console.log("🔵 [Facebook] Strategy 1: Looking for anchor tags with post URLs...");
    const anchors = Array.from(searchScope.querySelectorAll('a[href*="/posts/"][target="_blank"], a[href*="/permalink"]'));
    console.log(`   Found ${anchors.length} anchor tags with /posts/ or /permalink`);

    for (const anchor of anchors) {
      const href = (anchor as HTMLAnchorElement).href;
      console.log(`   Checking anchor: ${href}`);

      // Match relative URLs like /username/posts/12345 or absolute URLs
      if (href.includes('/posts/') || href.includes('/permalink')) {
        let fullUrl = href;

        // If it's a relative URL, convert to absolute
        if (href.startsWith('/')) {
          fullUrl = `https://www.facebook.com${href}`;
        }

        // Remove ref=embed_post parameter if present
        fullUrl = fullUrl.replace(/[?&]ref=embed_post/, '');

        console.log(`✅ [Facebook] Extracted post URL from anchor tag: ${fullUrl}`);

        // Close the dialog
        const closeButtons = document.querySelectorAll('[aria-label*="Close"], [aria-label*="close"]');
        if (closeButtons.length > 0) {
          (closeButtons[closeButtons.length - 1] as HTMLElement).click();
        }

        return fullUrl;
      }
    }

    // Strategy 2: Look for iframe in embed code
    console.log("🔵 [Facebook] Strategy 2: Looking for embed iframe...");
    const iframes = Array.from(searchScope.querySelectorAll('iframe[src*="facebook.com/plugins/post.php"]'));
    if (iframes.length > 0) {
      const iframe = iframes[0] as HTMLIFrameElement;
      const src = iframe.src;
      console.log(`🔵 [Facebook] Found embed iframe: ${src.substring(0, 100)}...`);

      const urlParams = new URLSearchParams(new URL(src).search);
      const postUrl = urlParams.get('href');

      if (postUrl) {
        // Close the dialog
        const closeButtons = document.querySelectorAll('[aria-label*="Close"], [aria-label*="close"]');
        if (closeButtons.length > 0) {
          (closeButtons[closeButtons.length - 1] as HTMLElement).click();
        }

        console.log(`✅ [Facebook] Extracted post URL from iframe: ${postUrl}`);
        return decodeURIComponent(postUrl);
      }
    }

    // Strategy 3: Look for the embed code in a textarea or code block
    console.log("🔵 [Facebook] Strategy 3: Looking for embed code in textarea...");
    const textareas = Array.from(searchScope.querySelectorAll('textarea, code, pre'));
    console.log(`   Found ${textareas.length} textarea/code/pre elements`);

    for (const textarea of textareas) {
      const content = (textarea as HTMLTextAreaElement).value || textarea.textContent || '';
      if (content.includes('facebook.com') && (content.includes('pfbid') || content.includes('/posts/'))) {
        console.log(`🔵 [Facebook] Found embed code: ${content.substring(0, 200)}...`);

        // Extract URL from iframe src or href attribute
        const match = content.match(/href=(?:&quot;|"|%22)?(https?[^"&\s]+(?:posts|permalink)[^"&\s]+(?:pfbid)?[^"&\s]+)/i);
        if (match) {
          let url = match[1];
          // Decode HTML entities
          url = url.replace(/&quot;/g, '"').replace(/%3A/g, ':').replace(/%2F/g, '/');

          console.log(`✅ [Facebook] Extracted post URL from embed code: ${url}`);

          // Close dialog
          const closeButtons = document.querySelectorAll('[aria-label*="Close"], [aria-label*="close"]');
          if (closeButtons.length > 0) {
            (closeButtons[closeButtons.length - 1] as HTMLElement).click();
          }

          return decodeURIComponent(url);
        }
      }
    }

    console.log("⚠️ [Facebook] Could not extract URL from embed dialog");

    // Close any dialogs
    const closeButtons = document.querySelectorAll('[aria-label*="Close"], [aria-label*="close"]');
    if (closeButtons.length > 0) {
      (closeButtons[closeButtons.length - 1] as HTMLElement).click();
    }

    return null;
  } catch (err) {
    console.error("❌ [Facebook] Error extracting URL from embed dialog:", err);
    // Try to close any open dialogs
    try {
      const closeButtons = document.querySelectorAll('[aria-label*="Close"], [aria-label*="close"]');
      if (closeButtons.length > 0) {
        (closeButtons[closeButtons.length - 1] as HTMLElement).click();
      }
    } catch {}
    return null;
  }
}

/**
 * Find the post in the viewport (middle of screen)
 * Returns the post element and its URL
 */
export async function findPostInViewport(): Promise<{ element: Element; url: string } | null> {
  console.log("🔵 [Facebook] Finding post in viewport...");

  // Get all post containers - Facebook uses various article/div structures
  const posts = Array.from(
    document.querySelectorAll(
      'div[role="article"], div[data-pagelet*="FeedUnit"], div[data-ad-preview="message"]'
    )
  );

  if (posts.length === 0) {
    console.log("⚠️ [Facebook] No posts found in DOM");
    return null;
  }

  console.log(`🔵 [Facebook] Found ${posts.length} posts, finding one in viewport...`);

  // Get viewport center
  const viewportHeight = window.innerHeight;
  const viewportCenter = viewportHeight / 2;

  // Find post closest to center of viewport
  let closestPost: Element | null = null;
  let closestDistance = Infinity;

  for (const post of posts) {
    const rect = post.getBoundingClientRect();
    const postCenter = rect.top + rect.height / 2;
    const distance = Math.abs(postCenter - viewportCenter);

    if (distance < closestDistance && rect.top < viewportHeight && rect.bottom > 0) {
      closestDistance = distance;
      closestPost = post;
    }
  }

  if (!closestPost) {
    console.log("⚠️ [Facebook] No post in viewport");
    return null;
  }

  // IMPORTANT: The menu button might not be inside the article div
  // It could be in a parent container or sibling element
  // Let's find the actual post container that includes the menu button
  let postContainer = closestPost;

  // Try to find parent that contains both the post content AND the menu button
  let currentElement: Element | null = closestPost;
  let depth = 0;

  while (currentElement && depth < 5) {
    const hasMenuButton = currentElement.querySelector('[aria-label*="Actions for"]') !== null;
    if (hasMenuButton) {
      console.log(`🔵 [Facebook] Found container with menu button at depth ${depth}`);
      postContainer = currentElement;
      break;
    }
    currentElement = currentElement.parentElement;
    depth++;
  }

  console.log(`🔵 [Facebook] Using post container: ${postContainer.tagName}, has menu: ${postContainer.querySelector('[aria-label*="Actions for"]') !== null}`);

  // Extract post URL by programmatically accessing the Embed dialog
  // This is the most reliable way since Facebook removed URLs from the feed DOM
  const postUrl = await extractUrlFromEmbedDialog(postContainer);

  if (!postUrl) {
    console.log("⚠️ [Facebook] Could not extract post URL from embed dialog");
    return null;
  }

  console.log(`✅ [Facebook] Found post in viewport: ${postUrl}`);
  return { element: postContainer, url: postUrl };
}

/**
 * Extract Facebook post content from a specific post element
 * @param postElement - The post container element (or null to search whole document)
 * @param postUrl - The URL of the post
 */
export function extractFacebookPostFromDOM(
  postElement?: Element | null,
  postUrl?: string
): FacebookPostData | null {
  console.log("🔵 [Facebook] Extracting post from DOM...");

  const container = postElement || document;

  // Helper to safely get text content
  const getText = (selector: string): string | null => {
    const el = container.querySelector(selector);
    return el ? el.textContent?.trim() || null : null;
  };

  // Helper to get all matching text content
  const getAllText = (selector: string): string[] => {
    const elements = Array.from(container.querySelectorAll(selector));
    return elements.map((el) => el.textContent?.trim() || "").filter(Boolean);
  };

  // Extract post text - Facebook uses various selectors
  const postTextSelectors = [
    '[data-ad-preview="message"]',
    '[data-ad-comet-preview="message"]',
    '[data-testid="post_message"]',
    'div[dir="auto"]',
  ];

  let postText: string | null = null;
  for (const selector of postTextSelectors) {
    const el = container.querySelector(selector);
    if (el && el.textContent && el.textContent.length > 20) {
      postText = el.textContent.trim();
      break;
    }
  }

  // If still no text, try getting the largest text block
  if (!postText) {
    const divs = Array.from(container.querySelectorAll("div[dir='auto']"));
    const sorted = divs.sort(
      (a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0)
    );
    if (sorted.length > 0 && (sorted[0].textContent?.length || 0) > 20) {
      postText = sorted[0].textContent?.trim() || null;
    }
  }

  // Extract author name
  const authorSelectors = [
    'h2 a[role="link"]',
    'a[aria-label*="profile"]',
    'strong a[role="link"]',
  ];

  let authorName: string | null = null;
  for (const selector of authorSelectors) {
    const el = container.querySelector(selector);
    if (el && el.textContent && el.textContent.length > 0) {
      authorName = el.textContent.trim();
      break;
    }
  }

  // Extract timestamp
  const timestampSelectors = [
    'a[aria-label*="ago"]',
    "abbr",
    'a[role="link"] span',
  ];

  let timestamp: string | null = null;
  for (const selector of timestampSelectors) {
    const el = container.querySelector(selector);
    if (
      el &&
      el.textContent &&
      /\d+\s*(h|hr|hour|min|day|week)/i.test(el.textContent)
    ) {
      timestamp = el.textContent.trim();
      break;
    }
  }

  // Extract images - try multiple strategies
  // Strategy 1: data-visualcompletion attribute
  let imageElements = Array.from(
    container.querySelectorAll('img[data-visualcompletion="media-vc-image"]')
  ) as HTMLImageElement[];

  console.log(`🔵 [Facebook] Strategy 1: Found ${imageElements.length} images with data-visualcompletion="media-vc-image"`);

  // Strategy 2: Look for all images with fbcdn in src
  if (imageElements.length === 0) {
    imageElements = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
    console.log(`🔵 [Facebook] Strategy 2: Found ${imageElements.length} total img tags, filtering...`);
  }

  const images = imageElements
    .map((img) => {
      const src = img.src;
      return src;
    })
    .filter((src) => {
      // Filter for Facebook CDN images, but exclude tiny profile icons and emojis
      const isFbCdn = src.includes("fbcdn.net") || src.includes("fbsbx.com");
      const isNotTiny = !src.includes("p50x50") && !src.includes("p48x48") && !src.includes("emoji");
      const isNotIcon = !src.includes("/rsrc.php/") && !src.includes("/static.xx.fbcdn.net/rsrc.php");
      return isFbCdn && isNotTiny && isNotIcon;
    })
    // Remove duplicates
    .filter((src, index, self) => self.indexOf(src) === index);

  console.log(`🔵 [Facebook] After filtering for fbcdn (non-profile, non-emoji): ${images.length} images`);
  if (images.length > 0) {
    console.log(`   First image: ${images[0].substring(0, 100)}...`);
  }

  // Extract reactions count
  const reactionsText = getText('[aria-label*="reaction"]');
  let reactionsCount = 0;
  if (reactionsText) {
    const match = reactionsText.match(/(\d+(?:,\d+)*)/);
    if (match) {
      reactionsCount = parseInt(match[1].replace(/,/g, ""), 10);
    }
  }

  // Extract comments count
  const commentsText = getText('[aria-label*="comment"]');
  let commentsCount = 0;
  if (commentsText) {
    const match = commentsText.match(/(\d+(?:,\d+)*)/);
    if (match) {
      commentsCount = parseInt(match[1].replace(/,/g, ""), 10);
    }
  }

  // Extract shares count
  const sharesText = getText('[aria-label*="share"]');
  let sharesCount = 0;
  if (sharesText) {
    const match = sharesText.match(/(\d+(?:,\d+)*)/);
    if (match) {
      sharesCount = parseInt(match[1].replace(/,/g, ""), 10);
    }
  }

  console.log("🔵 [Facebook] Extraction complete:", {
    hasText: !!postText,
    postTextLength: postText?.length || 0,
    hasAuthor: !!authorName,
    authorName: authorName || 'NONE',
    imageCount: images.length,
    timestamp: timestamp || 'NONE',
    reactions: reactionsCount,
    comments: commentsCount,
    shares: sharesCount,
  });

  return {
    url: postUrl || window.location.href,
    postText,
    authorName,
    timestamp,
    images,
    reactionsCount,
    commentsCount,
    sharesCount,
  };
}

/**
 * Scrape Facebook post and send to backend
 * Uses the already-loaded page DOM (no Puppeteer needed!)
 */
export async function scrapeFacebookPost(
  createContent: boolean = true
): Promise<string | null> {
  const pageUrl = window.location.href;

  console.log(`🔵 [Facebook] Scraping Facebook content from: ${pageUrl}`);

  // Check if this is actually a Facebook page
  if (!isFacebookPost(pageUrl)) {
    console.error("❌ [Facebook] Not a Facebook URL");
    return null;
  }

  // Try to find post in viewport first (for feed scraping)
  const postInViewport = await findPostInViewport();

  let postData: FacebookPostData | null;

  if (postInViewport) {
    // Scraping from feed - extract from specific post element
    console.log(`🔵 [Facebook] Scraping post from feed: ${postInViewport.url}`);
    postData = extractFacebookPostFromDOM(postInViewport.element, postInViewport.url);
  } else {
    // Scraping from individual post page - extract from whole document
    console.log(`🔵 [Facebook] Scraping from post page: ${pageUrl}`);
    postData = extractFacebookPostFromDOM(null, pageUrl);
  }

  if (!postData || !postData.postText) {
    console.error("❌ [Facebook] Could not extract post content");
    return null;
  }

  // Get the HTML of the post container for backend processing
  const postElement = postInViewport ? postInViewport.element : document.body;
  const rawHtml = postElement.outerHTML;

  console.log(`🔵 [Facebook] Sending HTML (${rawHtml.length} chars) to backend for full scraping pipeline`);
  console.log(`🔵 [Facebook] Post data summary:`, {
    url: postData.url,
    postTextLength: postData.postText?.length || 0,
    authorName: postData.authorName,
    imagesCount: postData.images?.length || 0,
    firstImagePreview: postData.images?.[0]?.substring(0, 60) + '...' || 'NONE',
    timestamp: postData.timestamp,
  });

  // CRITICAL: Store the detected post URL so background.js can find it after scraping completes
  await browser.storage.local.set({ currentUrl: postData.url });
  console.log(`✅ [Facebook] Stored post URL in storage: ${postData.url}`);

  // Extract author info from Facebook-specific DOM (preprocessing)
  let authorData = null;
  if (postData.authorName) {
    // Try to find author profile image (the small avatar/icon next to author name)
    // Strategy 1: Find the author link, then find the image inside it
    let authorImage = null;

    // Look for author link by aria-label or text content
    const authorLinks = Array.from(postElement.querySelectorAll('a[role="link"]')) as HTMLAnchorElement[];

    for (const link of authorLinks) {
      const linkText = link.textContent?.trim() || '';
      const ariaLabel = link.getAttribute('aria-label') || '';

      if (linkText === postData.authorName || ariaLabel.includes(postData.authorName)) {
        // Found the author link! Look for an image inside or near it
        const img = link.querySelector('img') as HTMLImageElement;
        if (img && img.src && img.src.includes('fbcdn')) {
          authorImage = img.src;
          console.log(`✅ [Facebook] Found author profile image in author link: ${authorImage.substring(0, 60)}...`);
          break;
        }

        // Also check siblings (sometimes image is next to the link, not inside)
        const prevSibling = link.previousElementSibling?.querySelector('img') as HTMLImageElement;
        if (prevSibling && prevSibling.src && prevSibling.src.includes('fbcdn')) {
          authorImage = prevSibling.src;
          console.log(`✅ [Facebook] Found author profile image near author link: ${authorImage.substring(0, 60)}...`);
          break;
        }
      }
    }

    // Fallback: Look for any small circular profile images near the top
    if (!authorImage) {
      const allImages = Array.from(postElement.querySelectorAll('img')) as HTMLImageElement[];
      for (const img of allImages) {
        const alt = img.getAttribute('alt') || '';
        const src = img.src || '';

        // Profile pics are usually small, circular, and have author name in alt
        if (src.includes('fbcdn') && alt.includes(postData.authorName)) {
          authorImage = src;
          console.log(`✅ [Facebook] Found author profile image by alt text: ${authorImage.substring(0, 60)}...`);
          break;
        }
      }
    }

    authorData = {
      name: postData.authorName, // Full name
      firstName: postData.authorName.split(' ')[0] || '',
      lastName: postData.authorName.split(' ').slice(1).join(' ') || '',
      image: authorImage, // Author profile image URL
    };

    console.log(`✅ [Facebook] Extracted author:`, authorData);
  }

  // Send to backend via background script - use the regular scrape-task pipeline
  try {
    const response = await browser.runtime.sendMessage({
      action: "scrapeTaskOnServer",
      payload: {
        url: postData.url,
        raw_html: rawHtml,
        // Facebook-specific preprocessing data
        media_source: "Facebook",
        authors: authorData ? [authorData] : undefined,
        // Send the extracted post text to help backend use correct title/text
        content_name: postData.postText?.substring(0, 100) || "Facebook Post",
        raw_text: postData.postText, // This triggers TESTING MODE which uses our pre-extracted text
        topic: "social_media",
        subtopics: ["facebook"],
        thumbnail: postData.images?.[0] || null,
      },
    }) as { success: boolean; contentId?: string; error?: string };

    if (!response || !response.success) {
      console.error("❌ [Facebook] Backend scrape failed:", response?.error);
      return null;
    }

    const contentId = response.contentId;
    console.log(`✅ [Facebook] Post scraped: content_id=${contentId}`);

    return contentId || null;
  } catch (err) {
    console.error("❌ [Facebook] Error sending to backend:", err);
    return null;
  }
}
