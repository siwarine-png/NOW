-- Adaptive Allocation Engine (engine-specs/adaptive-allocation-engine-v1.1.md,
-- currently v1.3) is still spec-only -- no desired_hours_per_week storage
-- exists anywhere yet. This is the first real piece of it: a lightweight,
-- tap-only onboarding capture (1-5 relative priority per want axis, no
-- typing, no precise hour input) that the eventual Allocation Engine can
-- translate into an initial desired_hours_per_week per axis, refinable later
-- in the Identity tab. Foundation is deliberately absent -- its desired
-- value is prescribed (BLOCK_GUIDELINES' healthy-range max), not user-set.
alter table users add column if not exists identity_priorities jsonb;

comment on column users.identity_priorities is
  'Relative priority (1-5) per want axis from onboarding: relationships, achievement, finance, contribution, recreation. Not desired_hours_per_week itself -- a proxy for it until the Allocation Engine exists to translate it.';
