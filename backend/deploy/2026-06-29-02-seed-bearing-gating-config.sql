-- Phase 4 only: seed conservative bearing-gating configuration.
-- This changes config data, not schema. Existing bearing_config values are
-- deliberately preserved on rerun.

INSERT INTO evidence_search_config (config_key, config_value, description)
VALUES (
  'bearing_config',
  '{"enableBearingGating":false,"minBearingToScrape":0.35,"forceSkipBelowBearing":0.15,"deterministicForceSkipBelow":0.10,"maxClaimsSearchedPerContent":8,"globalScrapeLimitPerContent":16,"deepenGlobalScrapeLimit":24,"maxSnippetCandidatesPerClaim":12,"maxOriginSlotsPerClaim":1,"maxSteelmanSlotsPerClaim":1,"perClaimLimits":{"thesis":4,"pillar":3,"pillar_support":3,"evidence":3,"attribution":2,"background":0,"default":3}}',
  'Bearing-aware candidate gating thresholds and per-case/per-claim scrape limits. Disabled by default.'
)
ON DUPLICATE KEY UPDATE config_key = config_key;

SELECT config_key, config_value, description
  FROM evidence_search_config
 WHERE config_key = 'bearing_config';
