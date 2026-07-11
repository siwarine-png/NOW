-- Retires the old 5-domain starter library (move/fuel/reset/progress/connect)
-- in favor of the Adaptive Allocation Engine's 6-axis spectrum
-- (foundation/relationships/achievement/finance/contribution/recreation) --
-- the same vocabulary identity_checkins.identity_axis and
-- commitments.identity_axis already use, so "domain" here finally means the
-- same thing everywhere in the app instead of two parallel taxonomies.
--
-- Only removes system-seeded starter rows (created_by = 'system_suggested')
-- -- any self-authored custom equivalent a user added themselves is left
-- alone regardless of what domain name it happens to use. Checkins referencing
-- a deleted equivalent keep their row (equivalent_id ON DELETE SET NULL, per
-- the account-delete flow's existing comment in users.js), so no history is
-- lost, just unlinked from a domain that no longer exists.
delete from outcome_equivalents
  where created_by = 'system_suggested'
    and domain in ('move', 'fuel', 'reset', 'progress', 'connect');

delete from domain_metrics
  where created_by = 'system_suggested'
    and domain in ('move', 'fuel', 'reset', 'progress', 'connect');

-- Lets a starter equivalent carry an optional fixed duration (seconds) --
-- e.g. "close your eyes and breathe slowly for 1 minute" -- so the client
-- can render an actual countdown timer with a completion alert instead of
-- just a Done button. null (the common case) means no timer, same as today.
alter table outcome_equivalents add column if not exists timer_seconds integer;

comment on column outcome_equivalents.timer_seconds is
  'Optional fixed duration in seconds for actions that are literally a timed exercise (breathing, a short walk, a focused work block). null = no timer, just a Done button.';
