-- Snooze fix: snoozing was being recorded as checkins.result = 'partial', which
-- (a) inflated streak/completion-rate as if the commitment were actually done, and
-- (b) set checkedInToday = true, silencing every rule for the rest of the day —
-- so a 10-minute snooze behaved like snoozing until tomorrow.
--
-- Snooze is now its own result type, excluded from streak/completion math, and
-- commitments.snoozed_until suppresses re-triggering only until it expires.

ALTER TABLE commitments ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

ALTER TABLE checkins DROP CONSTRAINT IF EXISTS checkins_result_check;
ALTER TABLE checkins ADD CONSTRAINT checkins_result_check
  CHECK (result IN ('done','partial','skipped','snoozed'));
