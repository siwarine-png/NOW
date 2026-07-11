-- Raw signal for the Adaptive Execution Engine on what actually happens
-- during a NowScreen focus session (clients/now/src/components/FocusSession.js)
-- -- not a feature by itself yet, just the log a future rule/analysis needs
-- to answer "did they stay with it, and did they come back and finish."
-- One row per session, written once it ends (time-up or cancelled) -- there
-- is deliberately no separate "started" call, since a session that never
-- reaches a client-side end (app killed mid-session, browser closed) has no
-- reliable end state to log anyway.
create table if not exists focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Snapshot of what was being focused on, not just a foreign key -- both
  -- outcome_equivalents and commitments can be deleted or reseeded (see
  -- admin.js's reseed-domains) well after this row is written, and losing
  -- "what were they even trying to do" would make the log far less useful
  -- for later analysis than keeping a plain-text copy alongside the (nullable) ids.
  identity_axis text,
  action_text text,
  equivalent_id uuid references outcome_equivalents(id) on delete set null,
  commitment_id uuid references commitments(id) on delete set null,
  planned_seconds integer not null,
  actual_seconds integer not null,
  started_at timestamptz not null,
  ended_reason text not null check (ended_reason in ('completed', 'cancelled')),
  -- Number of times the app left the foreground during the session (see
  -- FocusSession.js) -- the "did I stay with it" signal. Not real-time
  -- location/away-duration tracking, just a count of app-state transitions.
  left_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists focus_sessions_user_idx on focus_sessions(user_id, created_at desc);

comment on table focus_sessions is
  'One row per completed or cancelled focus-session run. "Did they come back and finish" is deliberately not a column here -- derive it by joining checkins on user_id + equivalent_id/commitment_id + created_at after this row''s created_at.';
