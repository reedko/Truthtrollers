import assert from 'node:assert/strict';
import test from 'node:test';
import * as cheerio from 'cheerio';

import {
  getBestImage,
  getBestImageFromCandidates,
} from '../src/utils/getBestImage.js';

test('prefers secure Open Graph images and accepts extensionless CDN URLs', () => {
  const $ = cheerio.load(`
    <meta property="og:image" content="https://cdn.example.test/older.jpg">
    <meta property="og:image:secure_url" content="https://images.example.test/render/abc123">
  `);
  assert.equal(
    getBestImage($, 'https://example.test/article'),
    'https://images.example.test/render/abc123',
  );
});

test('rejects malformed metadata containing multiple URLs', () => {
  const $ = cheerio.load(`
    <meta property="og:image" content="https://example.test, https://example.test/good.jpg">
    <meta name="twitter:image" content="/fallback.jpg">
  `);
  assert.equal(
    getBestImage($, 'https://example.test/article'),
    'https://example.test/fallback.jpg',
  );
});

test('uses lazy-loaded and srcset image candidates', () => {
  const lazy = cheerio.load('<img data-src="/article-image.webp">');
  assert.equal(
    getBestImage(lazy, 'https://example.test/story'),
    'https://example.test/article-image.webp',
  );

  const srcset = cheerio.load(
    '<img srcset="/small.jpg 320w, /large.jpg 1200w">',
  );
  assert.equal(
    getBestImage(srcset, 'https://example.test/story'),
    'https://example.test/large.jpg',
  );
});

test('uses the first processable Tavily result image', () => {
  assert.equal(
    getBestImageFromCandidates(
      [
        'https://example.test/assets/us_flag_small.png',
        'https://example.test/assets/noscript.png',
        'https://example.test/static/img/action-bookmark-full.svg',
        'https://example.test/static/img/search.svg',
        'https://example.test/img/gbc-footer.png',
        'https://example.test/social/bluesky_40px_blue.png',
        { url: 'https://cdn.example.test/article-photo.webp' },
      ],
      'https://example.test/article',
    ),
    'https://cdn.example.test/article-photo.webp',
  );
});
