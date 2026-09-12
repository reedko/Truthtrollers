import test from "node:test";
import assert from "node:assert/strict";

import {
  resolvePublisherChain,
  resolvePublisherFromScrapedHtml,
} from "../src/core/scrapeReference.js";
import {
  classifyOrganizationStatusFromPages,
  deriveSourceAlignment,
} from "../src/services/ownSiteOrgStatusService.js";

test("recursive publisher provenance follows ordinary article attribution across multiple hops", async () => {
  const originalFetch = globalThis.fetch;
  const pages = new Map([
    ["https://middle.example/story", `
      <html><body><article>
        <p>Originally published at
          <a href="https://final.example/scientific-american-blog-entry">the original blog</a>.
        </p>
      </article></body></html>
    `],
    ["https://final.example/scientific-american-blog-entry", `
      <html><head>
        <meta property="og:site_name" content="Scientific American Blogs">
      </head><body><article><h1>A blog entry</h1></article></body></html>
    `],
  ]);

  globalThis.fetch = async (url) => {
    const html = pages.get(String(url));
    return new Response(html || "not found", {
      status: html ? 200 : 404,
      headers: { "content-type": "text/html" },
    });
  };

  try {
    const wrapperHtml = `
      <html><head><meta property="og:site_name" content="Example News Blog"></head>
      <body><article>
        <p>As seen in
          <a href="https://middle.example/story">Scientific American</a>.
        </p>
      </article></body></html>
    `;
    const result = await resolvePublisherChain(
      "https://wrapper.example/repost",
      0,
      null,
      wrapperHtml,
    );

    assert.equal(result?.name, "Scientific American Blogs");
    assert.equal(result?.resolvedUrl, "https://final.example/scientific-american-blog-entry");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PBS wrapper resolves an 'originally appeared on PolitiFact' link", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://www.politifact.com/article/example");
    return new Response(`
      <html><head>
        <script type="application/ld+json">
          {"@type":"NewsArticle","publisher":{"@type":"Organization","name":"PolitiFact"}}
        </script>
      </head><body><article><h1>Original fact check</h1></article></body></html>
    `, { status: 200, headers: { "content-type": "text/html" } });
  };

  try {
    const result = await resolvePublisherChain(
      "https://www.pbs.org/newshour/politics/example",
      0,
      null,
      `<html><head><meta property="og:site_name" content="PBS News"></head><body><article>
        <p>This article originally appeared on
          <a href="https://www.politifact.com/article/example">PolitiFact</a>.
        </p>
      </article></body></html>`,
    );
    assert.equal(result?.name, "PolitiFact");
    assert.equal(result?.resolvedUrl, "https://www.politifact.com/article/example");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Scientific American reprint prefers the linked original article and The Conversation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(
      String(url),
      "https://theconversation.com/nhs-ransomware-cyber-attack-was-preventable-77674",
    );
    return new Response(`
      <html><head>
        <meta property="og:site_name" content="The Conversation">
      </head><body><main>
        <article><h1>NHS ransomware cyber-attack was preventable</h1></article>
        <footer>Copyright © 2010–2026</footer>
      </main></body></html>
    `, { status: 200, headers: { "content-type": "text/html" } });
  };

  try {
    const result = await resolvePublisherChain(
      "https://www.scientificamerican.com/article/nhs-ransomware-cyber-attack-was-preventable/",
      0,
      null,
      `<html><head><meta property="og:site_name" content="Scientific American"></head><body><main>
        <p>The following essay is reprinted with permission from
          <a href="http://theconversation.com/">The Conversation</a>.
        </p>
        <p>This article was originally published on
          <a href="http://theconversation.com/">The Conversation</a>.
          Read the <a href="https://theconversation.com/nhs-ransomware-cyber-attack-was-preventable-77674">original article</a>.
        </p>
      </main></body></html>`,
    );

    assert.equal(result?.name, "The Conversation");
    assert.equal(
      result?.resolvedUrl,
      "https://theconversation.com/nhs-ransomware-cyber-attack-was-preventable-77674",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("compact extension text falls back to the full page for publisher provenance", async () => {
  const originalFetch = globalThis.fetch;
  const wrapperUrl = "https://www.scientificamerican.com/article/nhs-ransomware-cyber-attack-was-preventable/";
  const originalUrl = "https://theconversation.com/nhs-ransomware-cyber-attack-was-preventable-77674";
  const pages = new Map([
    [wrapperUrl, `<html><head><meta property="og:site_name" content="Scientific American"></head><body><main>
      <p>This article was originally published on <a href="http://theconversation.com/">The Conversation</a>.
        Read the <a href="${originalUrl}">original article</a>.</p>
    </main></body></html>`],
    [originalUrl, `<html><head><meta property="og:site_name" content="The Conversation"></head><body><main>
      <h1>NHS ransomware cyber-attack was preventable</h1><footer>Copyright © 2010–2026</footer>
    </main></body></html>`],
  ]);
  globalThis.fetch = async (url) => {
    const html = pages.get(String(url));
    return new Response(html || "not found", {
      status: html ? 200 : 404,
      headers: { "content-type": "text/html" },
    });
  };

  try {
    const result = await resolvePublisherFromScrapedHtml(
      wrapperUrl,
      `<article><h1>NHS Ransomware Cyber-Attack Was Preventable</h1><pre>
        This article was originally published on The Conversation. Read the original article.
      </pre></article>`,
      async () => [{ content_id: 23659, publisher_name: "Scientific American" }],
    );
    assert.equal(result?.name, "The Conversation");
    assert.equal(result?.resolvedUrl, originalUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PBS-style nonprofit membership language is not classified as industry", () => {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "PBS News",
    sourceUrl: "https://www.pbs.org/newshour/about",
    pages: [{
      url: "https://www.pbs.org/newshour/about",
      pageType: "own_site_about_page",
      text: [
        "PBS News is the primary daily news producer for PBS.",
        "News Hour Productions LLC is a wholly owned nonprofit subsidiary of WETA.",
        "PBS is a membership organization.",
        "Its board of directors provides governance.",
      ].join(" "),
    }],
  });

  assert.equal(result.normalized.publisher_type, "nonprofit_organization");
  assert.equal(result.normalized.risk_flags.includes("material_industry_interest"), false);
  assert.equal(
    result.normalized.evidence.some((item) => item.value === "industry_trade_association"),
    false,
  );
  assert.equal(deriveSourceAlignment(result.normalized)?.marker, "NPO");
});

test("an explicit nonprofit trade association remains industry-aligned", () => {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "Example Manufacturers Association",
    sourceUrl: "https://association.example/about",
    pages: [{
      url: "https://association.example/about",
      pageType: "own_site_about_page",
      text: "We are a nonprofit trade association representing member companies. Our board of directors advances the industry.",
    }],
  });

  assert.equal(result.normalized.publisher_type, "industry_trade_association");
  assert.equal(deriveSourceAlignment(result.normalized)?.marker, "IND");
});
