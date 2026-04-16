-- Add test data for rating evaluation system
-- This creates test users with various roles and test ratings to evaluate

-- First, let's ensure we have some test users with different roles
-- Note: Adjust these IDs based on your existing user_id values

-- Insert test ratings for existing users
-- These will have 'pending' approval status so they show up for evaluation

-- Example ratings from a hypothetical user_id 2 (adjust based on your actual user IDs)
INSERT INTO user_claim_ratings (
  user_id,
  reference_claim_id,
  task_claim_id,
  honesty_score,
  ai_stance,
  user_stance,
  reasoning,
  approval_status,
  created_at
) VALUES
-- Pending ratings that need evaluation
(2, 1, 2, 75, 'supports', 'supports', 'The evidence clearly supports this claim with multiple verified sources.', 'pending', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(2, 3, 4, 45, 'neutral', 'supports', 'Mixed evidence, but overall leans toward supporting the claim.', 'pending', DATE_SUB(NOW(), INTERVAL 1 DAY)),
(2, 5, 6, 92, 'supports', 'supports', 'Excellent source quality and comprehensive analysis.', 'pending', NOW()),

-- Some already approved ratings to show history
(2, 7, 8, 88, 'supports', 'supports', 'Well-researched with credible primary sources.', 'approved', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(2, 9, 10, 65, 'neutral', 'supports', 'Adequate sourcing but could be stronger.', 'approved', DATE_SUB(NOW(), INTERVAL 4 DAY)),

-- Some rejected ratings to show varied performance
(2, 11, 12, 35, 'opposes', 'supports', 'Sources are questionable and bias is evident.', 'rejected', DATE_SUB(NOW(), INTERVAL 3 DAY)),

-- Ratings from another test user (user_id 3)
(3, 13, 14, 55, 'supports', 'neutral', 'Reasonable analysis but lacks depth.', 'pending', DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(3, 15, 16, 80, 'supports', 'supports', 'Strong evidence base and logical reasoning.', 'pending', NOW()),
(3, 17, 18, 42, 'neutral', 'opposes', 'Weak sourcing and potential confirmation bias.', 'pending', DATE_SUB(NOW(), INTERVAL 3 HOUR)),

-- Ratings from user_id 4
(4, 19, 20, 68, 'supports', 'supports', 'Good effort with room for improvement in source quality.', 'pending', DATE_SUB(NOW(), INTERVAL 6 HOUR)),
(4, 21, 22, 90, 'supports', 'supports', 'Exceptional analysis with pristine sourcing.', 'pending', DATE_SUB(NOW(), INTERVAL 2 HOUR)),

-- Ratings from user_id 5
(5, 23, 24, 38, 'opposes', 'neutral', 'Analysis is superficial and sources are not credible.', 'pending', NOW()),
(5, 25, 26, 72, 'supports', 'supports', 'Solid work with good source diversity.', 'pending', DATE_SUB(NOW(), INTERVAL 30 MINUTE)),

-- Ratings from user_id 6
(6, 27, 28, 85, 'supports', 'supports', 'Comprehensive research with excellent citations.', 'pending', DATE_SUB(NOW(), INTERVAL 4 HOUR)),
(6, 29, 30, 58, 'neutral', 'supports', 'Decent analysis but could benefit from additional sources.', 'pending', DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(6, 31, 32, 95, 'supports', 'supports', 'Outstanding work - this sets the standard for quality.', 'pending', NOW());

-- Note: This assumes you have claim_ids 1-32 in your claims table
-- If you don't have enough claims, you may need to adjust the claim IDs above
-- or create test claims first

-- To verify the test data:
-- SELECT u.username, COUNT(*) as pending_ratings
-- FROM user_claim_ratings ucr
-- JOIN users u ON ucr.user_id = u.user_id
-- WHERE ucr.approval_status = 'pending'
-- GROUP BY u.user_id;
