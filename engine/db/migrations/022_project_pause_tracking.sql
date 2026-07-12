-- Periodic stale-project check (engine/src/engine/projects.js) needs to:
-- (1) not re-ask about the same quiet project every single day once the
--     user's already said "still going" -- last_stale_check_at dedupes that,
--     same shape commitments.last_notified_at already uses for push dedup;
-- (2) capture WHY a project was paused when the user picks that instead of
--     "still going" -- paused_at/paused_reason, a real audit trail instead
--     of a project just silently going quiet with no record of the decision.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS last_stale_check_at timestamptz;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS paused_reason text;
