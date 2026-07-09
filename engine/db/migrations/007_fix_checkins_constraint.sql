-- checkins_exactly_one_target (005) required exactly one of commitment_id/
-- equivalent_id set, but deleting an outcome_equivalent triggers ON DELETE
-- SET NULL on any checkin that referenced it -- orphaning it to neither,
-- which the strict XOR then blocked. Historical checkins should survive a
-- domain cleanup; relax to "never both" instead of "always exactly one".
ALTER TABLE checkins DROP CONSTRAINT IF EXISTS checkins_exactly_one_target;
ALTER TABLE checkins ADD CONSTRAINT checkins_not_both_targets
  CHECK (NOT (commitment_id IS NOT NULL AND equivalent_id IS NOT NULL));
