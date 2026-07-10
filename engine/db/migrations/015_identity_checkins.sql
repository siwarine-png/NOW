-- Experience-sampling data collection for the Adaptive Allocation Engine's
-- current_hours_per_week (engine-specs/adaptive-allocation-engine-v1.1.md
-- §2.3) -- rather than approximating "time spent per axis" from scheduled
-- commitment windows, this asks in the moment, a bounded number of times a
-- day, for one week only. Frequency and duration are not arbitrary: ESM
-- research (Hektner/Schmidt/Csikszentmihalyi 2003; Delespaul 1992) shows
-- response rates collapse above ~6-8 prompts/day and hold up fine at 4-6/day
-- -- this is deliberately tuned against that research, not guessed.

alter table users add column if not exists identity_checkin_started_at timestamptz;

create table if not exists identity_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  identity_axis text not null,
  created_at timestamptz not null default now()
);

create index if not exists identity_checkins_user_idx on identity_checkins(user_id, created_at desc);

comment on table identity_checkins is
  'Each row is one in-the-moment "what are you doing right now" response during a user''s 7-day sampling window. Aggregated into current_hours_per_week per axis once the Allocation Engine exists to consume it -- see identityCheckin.js.';
