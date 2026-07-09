-- Back-office analytics: read-only aggregate functions backing /admin/analytics/*.
-- All scoped by an optional p_app_id (NULL = across every app).

-- MVP2 gate metrics, per the release strategy: user count with 2+ weeks of
-- data, week-2 retention, and the snooze-to-done ratio trend (recent vs prior
-- 7-day window). No hardcoded retention "pass" threshold — the spec itself
-- says that gets defined after the first real cohort, so this surfaces the
-- raw numbers for a human to judge, not a fake verdict.
CREATE OR REPLACE FUNCTION admin_gate_metrics(p_app_id uuid DEFAULT NULL)
RETURNS TABLE(
  total_users int,
  users_2wk_plus int,
  week2_retention float,
  snooze_ratio_recent float,
  snooze_ratio_prior float
) LANGUAGE sql STABLE AS $$
  WITH scoped_users AS (
    SELECT id, created_at FROM users WHERE p_app_id IS NULL OR app_id = p_app_id
  ),
  eligible AS (
    SELECT id, created_at FROM scoped_users WHERE created_at <= now() - interval '14 days'
  ),
  week2_retained AS (
    SELECT e.id FROM eligible e
    WHERE EXISTS (
      SELECT 1 FROM checkins ch JOIN commitments c ON c.id = ch.commitment_id
      WHERE c.user_id = e.id
        AND ch.result IN ('done','partial')
        AND ch.occurred_at >= e.created_at + interval '7 days'
        AND ch.occurred_at < e.created_at + interval '14 days'
    )
  ),
  recent AS (
    SELECT ch.result FROM checkins ch
    JOIN commitments c ON c.id = ch.commitment_id
    JOIN scoped_users u ON u.id = c.user_id
    WHERE ch.occurred_at >= now() - interval '7 days'
  ),
  prior AS (
    SELECT ch.result FROM checkins ch
    JOIN commitments c ON c.id = ch.commitment_id
    JOIN scoped_users u ON u.id = c.user_id
    WHERE ch.occurred_at >= now() - interval '14 days' AND ch.occurred_at < now() - interval '7 days'
  )
  SELECT
    (SELECT count(*)::int FROM scoped_users),
    (SELECT count(*)::int FROM eligible),
    (SELECT CASE WHEN count(*) = 0 THEN NULL
       ELSE (SELECT count(*)::float FROM week2_retained) / count(*) END FROM eligible),
    (SELECT CASE WHEN count(*) FILTER (WHERE result IN ('done','partial')) = 0 THEN NULL
       ELSE count(*) FILTER (WHERE result = 'snoozed')::float / count(*) FILTER (WHERE result IN ('done','partial')) END FROM recent),
    (SELECT CASE WHEN count(*) FILTER (WHERE result IN ('done','partial')) = 0 THEN NULL
       ELSE count(*) FILTER (WHERE result = 'snoozed')::float / count(*) FILTER (WHERE result IN ('done','partial')) END FROM prior)
$$;

-- Per-rule performance: how often each of R1-R8 fires, and its closed-outcome
-- acted rate (acted / (acted+ignored)) — the "which interventions are actually
-- working" view, not just raw volume.
CREATE OR REPLACE FUNCTION admin_rule_performance(p_app_id uuid DEFAULT NULL)
RETURNS TABLE(rule_id text, total int, acted int, ignored int, acted_rate float)
LANGUAGE sql STABLE AS $$
  SELECT i.rule_id,
    count(*)::int AS total,
    count(*) FILTER (WHERE i.outcome = 'acted')::int AS acted,
    count(*) FILTER (WHERE i.outcome = 'ignored')::int AS ignored,
    CASE WHEN count(*) FILTER (WHERE i.outcome IS NOT NULL) = 0 THEN NULL
      ELSE count(*) FILTER (WHERE i.outcome = 'acted')::float / count(*) FILTER (WHERE i.outcome IS NOT NULL) END AS acted_rate
  FROM interventions i
  JOIN commitments c ON c.id = i.commitment_id
  JOIN users u ON u.id = c.user_id
  WHERE p_app_id IS NULL OR u.app_id = p_app_id
  GROUP BY i.rule_id
  ORDER BY total DESC
$$;

-- Per-user summary row for the raw browser view — avoids N+1 queries from the
-- route handler for commitment/checkin counts and last-activity timestamp.
CREATE OR REPLACE FUNCTION admin_user_summaries(p_app_id uuid DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE(
  user_id uuid, external_ref text, timezone text, created_at timestamptz,
  commitment_count int, checkin_count int, last_checkin_at timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT u.id, u.external_ref, u.timezone, u.created_at,
    (SELECT count(*)::int FROM commitments c WHERE c.user_id = u.id),
    (SELECT count(*)::int FROM checkins ch JOIN commitments c ON c.id = ch.commitment_id WHERE c.user_id = u.id),
    (SELECT max(ch.occurred_at) FROM checkins ch JOIN commitments c ON c.id = ch.commitment_id WHERE c.user_id = u.id)
  FROM users u
  WHERE p_app_id IS NULL OR u.app_id = p_app_id
  ORDER BY u.created_at DESC
  LIMIT p_limit OFFSET p_offset
$$;
