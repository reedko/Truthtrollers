import assert from "node:assert/strict";
import { resolvePublisherChain } from "./src/core/scrapeReference.js";

const originalFetch = global.fetch;

try {
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    return new Response(`
      <html><head>
        <meta name="publisher" content="Children's Health Defense">
        <meta property="og:site_name" content="Children's Health Defense">
      </head><body><article>Example article</article></body></html>
    `, { status: 200, headers: { "content-type": "text/html" } });
  };

  const queryWithDomainPlaceholder = async () => [{
    content_id: 123,
    publisher_name: "childrenshealthdefense.org",
  }];

  const result = await resolvePublisherChain(
    "https://childrenshealthdefense.org/example-article/",
    0,
    queryWithDomainPlaceholder,
  );

  assert.equal(result?.name, "Children's Health Defense");
  assert.equal(fetchCount, 1, "bare domain placeholders must not stop recursive resolution");

  fetchCount = 0;
  const queryWithResolvedPublisher = async () => [{
    content_id: 124,
    publisher_name: "Children's Health Defense",
  }];
  const cached = await resolvePublisherChain(
    "https://childrenshealthdefense.org/already-known/",
    0,
    queryWithResolvedPublisher,
  );
  assert.equal(cached?.name, "Children's Health Defense");
  assert.equal(fetchCount, 0, "resolved publisher names should retain the DB short-circuit");

  console.log("publisher chain tests passed");
} finally {
  global.fetch = originalFetch;
}
