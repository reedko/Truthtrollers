-- Clear all simulated/placeholder publisher_ratings rows.
-- Real data will repopulate via the enrichment pipeline on next scrape.
-- Also clear profiles and run-log so enrichment reruns cleanly.
DELETE FROM publisher_ratings;
DELETE FROM publisher_profiles;
DELETE FROM publisher_enrichment_runs;
