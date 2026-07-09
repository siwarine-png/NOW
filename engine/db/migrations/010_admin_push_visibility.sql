-- Surface push delivery state in the existing back-office user list, so a
-- silently-failing reminder (see sendExpoPush fix) is visible without a DB
-- console -- the whole point of tracking last_push_error is that a human
-- actually looks at it.
-- Adding output columns changes the function's row type, which CREATE OR
-- REPLACE refuses to do -- Postgres requires DROP FUNCTION first in that case.
DROP FUNCTION IF EXISTS admin_user_summaries(uuid, integer, integer);
CREATE OR REPLACE FUNCTION admin_user_summaries(p_app_id uuid DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE(
  user_id uuid, external_ref text, timezone text, created_at timestamptz,
  commitment_count int, checkin_count int, last_checkin_at timestamptz,
  push_enabled boolean, last_push_sent_at timestamptz, last_push_error text
) LANGUAGE sql STABLE AS $$
  SELECT u.id, u.external_ref, u.timezone, u.created_at,
    (SELECT count(*)::int FROM commitments c WHERE c.user_id = u.id),
    (SELECT count(*)::int FROM checkins ch JOIN commitments c ON c.id = ch.commitment_id WHERE c.user_id = u.id),
    (SELECT max(ch.occurred_at) FROM checkins ch JOIN commitments c ON c.id = ch.commitment_id WHERE c.user_id = u.id),
    u.push_token IS NOT NULL,
    u.last_push_sent_at,
    u.last_push_error
  FROM users u
  WHERE p_app_id IS NULL OR u.app_id = p_app_id
  ORDER BY u.created_at DESC
  LIMIT p_limit OFFSET p_offset
$$;
