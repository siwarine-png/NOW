-- Adaptive Nudge Engine (MVP1 per spec): seeded candidate anchors, a
-- time-boxed test that picks a winner, a reusable profile, and revalidated
-- reuse on a second behavior (medication). See engine/src/engine/nudgeEngine.js
-- for the state machine this schema backs.

-- The reusable, established cue -- one row per user, filled in once a test
-- locks in (or the user overrides). confidence_score/decay_after_days exist
-- specifically so a *second* behavior reusing this profile has a way to know
-- the profile itself might be stale, independent of whether that second
-- behavior succeeds.
CREATE TABLE nudge_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  primary_anchor text,
  primary_anchor_time time,
  backup_anchor text,
  backup_anchor_time time,
  timing_window_minutes int NOT NULL DEFAULT 30,
  notification_style text NOT NULL DEFAULT 'friendly' CHECK (notification_style IN ('direct','friendly')),
  delivery_method text NOT NULL DEFAULT 'push' CHECK (delivery_method IN ('push','widget','both')),
  reward_style text NOT NULL DEFAULT 'streak_counter' CHECK (reward_style IN ('streak_counter','none','affirming_message')),
  confidence_score float,
  established_at date,
  last_validated_at date,
  decay_after_days int NOT NULL DEFAULT 30
);

-- One test run per behavior. app_open: 7-day A/B (days 1-3 = A, 4-7 = B).
-- medication: sequential 3-day validation, A first, falls back to B, then
-- escalates -- reuses the same table rather than a second schema because the
-- fire/evaluate/checkpoint shape is identical, only the day-boundary and
-- hit-signal rules differ per behavior (see nudgeEngine.js).
CREATE TABLE nudge_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  behavior text NOT NULL,
  -- Only set for behaviors whose "hit" signal is a checkin rather than an app
  -- open (medication needs pills physically present -- see spec's reasoning
  -- for why the profile is re-validated, not blindly trusted, on reuse).
  commitment_id uuid REFERENCES commitments(id) ON DELETE CASCADE,
  candidate_a text NOT NULL,
  candidate_a_time time NOT NULL,
  candidate_b text,
  candidate_b_time time,
  active_candidate text NOT NULL DEFAULT 'A' CHECK (active_candidate IN ('A','B')),
  test_length_days int NOT NULL DEFAULT 7,
  started_at date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked_in','awaiting_override','confirmed','escalated')),
  result_anchor text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_nudge_tests_active ON nudge_tests(user_id, status) WHERE status = 'active';

-- Each individual cue firing. hit stays NULL until its window has closed and
-- the evaluate pass checks for the real signal (session.opened event for
-- app_open, a checkin for medication).
CREATE TABLE nudge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid REFERENCES nudge_tests(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  behavior text NOT NULL,
  anchor text NOT NULL,
  tone_variant text NOT NULL CHECK (tone_variant IN ('direct','friendly')),
  fired_at timestamptz NOT NULL DEFAULT now(),
  window_minutes int NOT NULL,
  hit boolean,
  evaluated_at timestamptz
);
CREATE INDEX idx_nudge_events_pending ON nudge_events(test_id) WHERE hit IS NULL;
CREATE INDEX idx_nudge_events_test_fired ON nudge_events(test_id, fired_at DESC);
