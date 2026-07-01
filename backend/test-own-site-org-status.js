import assert from "node:assert/strict";
import {
  assemblePublisherStatusFromSignals,
  classifyOrganizationStatusFromPages,
  deriveSourceAlignment,
  discoverOrgStatusLinksFromHtml,
  providerResultsFromOrgStatus,
} from "./src/services/ownSiteOrgStatusService.js";
import { mapProviderSignalToAdmiralty } from "./services/providerSignalMapper.js";
import { evaluateAdmiraltyCode } from "./services/admiraltyEvaluator.js";

function page(url, pageType, text) {
  return { url, pageType, text };
}

async function testFiveGAmericasClassification() {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "5G Americas",
    sourceUrl: "https://www.5gamericas.org/5g-and-health/",
    pages: [
      page(
        "https://www.5gamericas.org/membership/",
        "own_site_membership_page",
        "The 5G Americas Board of Governors is a diverse stakeholder mix of leading wireless carriers, network equipment providers, device manufacturers and other key providers for the 5G wireless ecosystem."
      ),
      page(
        "https://www.5gamericas.org/policy/",
        "own_site_policy_page",
        "5G Americas develops policy recommendations for policymakers and regulators to advance the industry and promote adoption of wireless technology."
      ),
    ],
  });

  assert.equal(result.normalized.publisher_name, "5G Americas");
  assert.equal(result.normalized.publisher_type, "industry_trade_association");
  assert.equal(result.normalized.sector, "telecommunications / wireless");
  assert.equal(result.normalized.ultimate_publisher_or_interest_group, "wireless telecommunications industry consortium");
  assert.equal(result.normalized.stakeholder_alignment, "telecom / wireless industry advocacy");
  assert.equal(result.normalized.advocacy_role, true);
  assert.equal(result.normalized.membership_disclosed, true);
  assert.equal(result.normalized.board_members_disclosed, true);
  assert.equal(result.normalized.default_reliability_letter, "C");
  assert.equal(result.normalized.default_admiralty_code, "CØ");
  assert.ok(result.normalized.risk_flags.includes("material_industry_interest"));
  assert.ok(result.normalized.risk_flags.includes("health_claims_require_independent_corroboration"));
  assert.ok(result.normalized.evidence.some((item) => item.source_page_type === "own_site_membership_page"));
}

async function testAdmiraltyUsesOrgStatusForHealthPage() {
  const orgResult = classifyOrganizationStatusFromPages({
    publisherName: "5G Americas",
    sourceUrl: "https://www.5gamericas.org/5g-and-health/",
    pages: [
      page(
        "https://www.5gamericas.org/membership/",
        "own_site_membership_page",
        "The 5G Americas Board of Governors is a diverse stakeholder mix of leading wireless carriers, network equipment providers, device manufacturers and other key providers for the 5G wireless ecosystem."
      ),
    ],
  });
  const providerResult = providerResultsFromOrgStatus(orgResult)[0];
  const signal = mapProviderSignalToAdmiralty("own_site_org_status", providerResult);
  const evaluation = await evaluateAdmiraltyCode({
    sourceUrl: "https://www.5gamericas.org/5g-and-health/",
    publisherName: "5G Americas",
    sourceIdentity: { sourceType: "unknown", resolutionLevel: 3 },
    existingSourceRatings: [],
    providerResults: [],
    providerSignals: [signal],
  }, { runClaimLookup: false });

  assert.equal(evaluation.admiraltyCode, "CØ");
  assert.equal(evaluation.sourceReliabilityLetter, "C");
  assert.equal(evaluation.claimCredibilityNumber, "Ø");
  assert.equal(evaluation.sourceAlignment.marker, "IND");
  assert.equal(evaluation.sourceAlignment.riskScore, 80);
  assert.ok(evaluation.warnings.some((warning) => /industry trade association/.test(warning)));
}

function testProvenanceEvidence() {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "Example Host",
    sourceUrl: "https://example.org/article",
    pages: [
      page(
        "https://example.org/article",
        "own_site_status_page",
        "This article was originally published by Example Research Institute and reprinted from its newsletter. Sponsored by Example Foundation."
      ),
    ],
  });

  assert.ok(result.normalized.evidence.some((item) => item.field === "provenance"));
  assert.equal(result.normalized.publisher_type, null);
}

function testNegativeOrdinaryArticleSite() {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "Daily Example",
    sourceUrl: "https://daily.example/news/story",
    pages: [
      page(
        "https://daily.example/about/",
        "own_site_about_page",
        "Daily Example publishes local news, interviews, reviews, and community reporting."
      ),
    ],
  });

  assert.equal(result.normalized.publisher_type, null);
  assert.ok(!result.normalized.risk_flags.includes("material_industry_interest"));
}

function testCorporateSiteNotTradeAssociation() {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "Example Wireless Inc.",
    sourceUrl: "https://example-wireless.test/products/routers",
    pages: [
      page(
        "https://example-wireless.test/about/",
        "own_site_about_page",
        "Our products include wireless routers, private 5G systems, and network equipment for enterprise customers."
      ),
    ],
  });

  assert.equal(result.normalized.publisher_type, null);
  assert.ok(!result.normalized.risk_flags.includes("material_industry_interest"));
}

function testDiscoveryReadsNavFooterLinks() {
  const links = discoverOrgStatusLinksFromHtml(
    `
      <html>
        <header><nav><a href="/membership/">Membership</a><a href="/board-of-governors/">Board of Governors</a></nav></header>
        <footer><a href="/policy/">Policy</a><a href="/contact-impressum/">Contact &amp; Impressum</a><a href="https://external.test/about">External About</a></footer>
      </html>
    `,
    "https://www.5gamericas.org/5g-and-health/",
    "5gamericas.org"
  );
  assert.deepEqual(links.map((link) => link.url).sort(), [
    "https://www.5gamericas.org/board-of-governors",
    "https://www.5gamericas.org/contact-impressum",
    "https://www.5gamericas.org/membership",
    "https://www.5gamericas.org/policy",
  ]);
}

async function testGovernmentPortalClassification() {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "Human Research Switzerland",
    sourceUrl: "https://www.humanforschung-schweiz.ch/en/trial-search/",
    pages: [
      page(
        "https://www.humanforschung-schweiz.ch/en/about-us/",
        "own_site_about_page",
        "The Federal Office of Public Health FOPH has a legal duty to inform the public about human research. For this purpose, it operates the HumRes website."
      ),
    ],
  });

  assert.equal(result.normalized.publisher_type, "government_organization");
  assert.equal(result.normalized.default_admiralty_code, "BØ");
  assert.equal(result.normalized.stakeholder_alignment, "government / public information");
  assert.equal(result.normalized.ultimate_publisher_or_interest_group, "Federal Office of Public Health (FOPH)");
  assert.ok(result.normalized.evidence.some((item) => item.value === "government_organization"));

  const evaluation = await evaluateAdmiraltyCode({
    sourceUrl: "https://www.humanforschung-schweiz.ch/en/trial-search/",
    publisherName: "Human Research Switzerland",
    sourceIdentity: { sourceType: "government", resolutionLevel: 3 },
    existingSourceRatings: [],
    providerResults: [],
  }, { runClaimLookup: false });
  assert.equal(evaluation.admiraltyCode, "BØ");
}

function testStatusAssemblyFromStoredSignals() {
  const result = classifyOrganizationStatusFromPages({
    publisherName: "5G Americas",
    sourceUrl: "https://www.5gamericas.org/5g-and-health/",
    pages: [
      page(
        "https://www.5gamericas.org/membership/",
        "own_site_membership_page",
        "The 5G Americas Board of Governors is a diverse stakeholder mix of leading wireless carriers, network equipment providers, device manufacturers and other key providers for the 5G wireless ecosystem."
      ),
    ],
  });
  const storedRows = providerResultsFromOrgStatus(result).map((providerResult) => ({
    provider: "own_site_org_status",
    raw_value: JSON.stringify({ normalized: providerResult.normalized }),
  }));
  const status = assemblePublisherStatusFromSignals(storedRows);
  assert.equal(status.publisher_type, "industry_trade_association");
  assert.ok(status.evidence.length > 0);
  const alignment = deriveSourceAlignment(status);
  assert.equal(alignment.marker, "IND");
  assert.equal(alignment.degree, "high");
}

await testFiveGAmericasClassification();
await testAdmiraltyUsesOrgStatusForHealthPage();
testProvenanceEvidence();
testNegativeOrdinaryArticleSite();
testCorporateSiteNotTradeAssociation();
testDiscoveryReadsNavFooterLinks();
await testGovernmentPortalClassification();
testStatusAssemblyFromStoredSignals();

console.log("own-site org status tests passed");
