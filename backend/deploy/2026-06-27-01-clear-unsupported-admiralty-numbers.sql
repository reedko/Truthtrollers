-- Claim-credibility numbers require claim evidence. Older machine evaluations
-- could assign 3 from publisher identity/alignment alone; preserve the source
-- letter while returning the claim portion to unassessed.
UPDATE admiralty_evaluations
SET claim_credibility_number = NULL,
    admiralty_code = CONCAT(source_reliability_letter, 'Ø'),
    claim_credibility_rationale = 'Claim not yet assessed — insufficient evidence available',
    updated_at = NOW()
WHERE evaluation_status = 'machine_suggested'
  AND admiralty_code REGEXP '^[A-E][1-5]$'
  AND COALESCE(JSON_LENGTH(JSON_EXTRACT(claim_signals_json, '$.googleFactCheckMatches')), 0) = 0
  AND COALESCE(JSON_EXTRACT(claim_signals_json, '$.supportingEvidenceCount') + 0, 0) = 0
  AND COALESCE(JSON_EXTRACT(claim_signals_json, '$.refutingEvidenceCount') + 0, 0) = 0
  AND COALESCE(JSON_EXTRACT(claim_signals_json, '$.primarySourceCount') + 0, 0) = 0
  AND COALESCE(JSON_EXTRACT(claim_signals_json, '$.authoritativeSourceCount') + 0, 0) = 0
  AND COALESCE(JSON_EXTRACT(claim_signals_json, '$.scientificConsensusMatch') = TRUE, FALSE) = FALSE;
