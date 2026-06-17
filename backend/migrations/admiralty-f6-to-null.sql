-- Migrate Admiralty F/6 → Ø/NULL
-- F (cannot assess source) → Ø in source_reliability_letter and admiralty_code
-- 6 (cannot assess claim)  → NULL in claim_credibility_number, Ø in admiralty_code

UPDATE admiralty_evaluations
SET
  source_reliability_letter = 'Ø',
  admiralty_code            = REPLACE(admiralty_code, 'F', 'Ø')
WHERE source_reliability_letter = 'F';

UPDATE admiralty_evaluations
SET
  claim_credibility_number = NULL,
  admiralty_code           = REPLACE(admiralty_code, '6', 'Ø')
WHERE claim_credibility_number = 6;
