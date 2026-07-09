-- ENGINE schema — Execution Engine API
-- Run once against your Supabase project

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_key_hash text NOT NULL,          -- SHA-256 of the raw sk_live_ key
  webhook_url text,
  webhook_secret text,                 -- HMAC signing secret
  created_at timestamptz DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES apps(id) ON DELETE CASCADE,
  external_ref text NOT NULL,          -- client's own user id; no PII stored here
  timezone text NOT NULL DEFAULT 'UTC',
  wake_time time DEFAULT '07:00',
  sleep_time time DEFAULT '23:00',
  quiet_start time DEFAULT '22:00',
  quiet_end time DEFAULT '07:00',
  created_at timestamptz DEFAULT now(),
  UNIQUE (app_id, external_ref)
);

CREATE TABLE commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  next_action text,                    -- physical first step (≤80 chars recommended)
  why text,
  identity_tag text,                   -- "writer", "runner" etc.
  cadence text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('once','daily','weekly')),
  window_start time,
  window_end time,
  deadline timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned','paused')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid REFERENCES commitments(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('done','partial','skipped')),
  energy smallint CHECK (energy BETWEEN 1 AND 5),
  context jsonb,
  evidence_url text,
  occurred_at timestamptz DEFAULT now()
);

CREATE TABLE interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid REFERENCES commitments(id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  payload jsonb NOT NULL,
  issued_at timestamptz DEFAULT now(),
  outcome text CHECK (outcome IN ('acted','ignored','unknown')),
  outcome_at timestamptz
);

-- Append-only event log — never delete rows
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  app_id uuid REFERENCES apps(id),
  user_id uuid REFERENCES users(id),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Indexes for hot query paths
CREATE INDEX idx_commitments_user_status ON commitments(user_id, status);
CREATE INDEX idx_checkins_commitment_date ON checkins(commitment_id, occurred_at DESC);
CREATE INDEX idx_interventions_commitment ON interventions(commitment_id, issued_at DESC);
CREATE INDEX idx_interventions_open ON interventions(commitment_id) WHERE outcome IS NULL;
CREATE INDEX idx_events_user ON events(user_id, created_at DESC);
CREATE INDEX idx_events_app ON events(app_id, created_at DESC);

-- Helper: compute streak for a commitment (days consecutive done/partial ending today)
CREATE OR REPLACE FUNCTION commitment_streak(p_commitment_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  WITH daily AS (
    SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS d,
           bool_or(result IN ('done','partial')) AS completed
    FROM checkins
    WHERE commitment_id = p_commitment_id
    GROUP BY 1
  ),
  numbered AS (
    SELECT d, d - (row_number() OVER (ORDER BY d))::int AS grp
    FROM daily WHERE completed
  ),
  grp_stats AS (
    SELECT grp, max(d) AS max_d, count(*) AS cnt
    FROM numbered
    GROUP BY grp
  )
  SELECT COALESCE(
    (SELECT cnt FROM grp_stats
     WHERE grp = (SELECT max(grp) FROM grp_stats)
       AND max_d >= current_date - 1),  -- streak must include yesterday or today
    0)::int
$$;

-- Helper: 14-day completion rate
CREATE OR REPLACE FUNCTION completion_rate_14d(p_commitment_id uuid)
RETURNS float LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*) = 0 THEN 0
    ELSE count(*) FILTER (WHERE result IN ('done','partial'))::float / count(*)
  END
  FROM checkins
  WHERE commitment_id = p_commitment_id
    AND occurred_at >= now() - interval '14 days'
$$;
