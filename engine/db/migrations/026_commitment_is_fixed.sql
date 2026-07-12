-- Marks a commitment as fixed/external (an appointment you attend, not a
-- task you do) -- same concept identity_checkins.is_fixed already captures
-- for point-samples, now on the commitment itself. An event has no "first
-- physical step" to define and doesn't go stale the way a neglected task
-- does, so R4_ambiguous_action and R8_stale_commitment both skip anything
-- marked is_fixed (see rules.js).
ALTER TABLE commitments ADD COLUMN is_fixed boolean NOT NULL DEFAULT false;
