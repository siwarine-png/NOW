-- Onboarding suggestion ranking: once an app has enough recorded commitments,
-- surface the most commonly chosen titles (with their most common next_action)
-- so new users see real popular intentions instead of only the static examples.
-- Below p_min_total, returns zero rows — the client falls back to statics.

CREATE OR REPLACE FUNCTION top_commitment_titles(p_app_id uuid, p_limit int DEFAULT 6, p_min_total int DEFAULT 3)
RETURNS TABLE(title text, next_action text, uses int) LANGUAGE sql STABLE AS $$
  WITH app_commitments AS (
    SELECT c.title, c.next_action
    FROM commitments c
    JOIN users u ON u.id = c.user_id
    WHERE u.app_id = p_app_id
  ),
  counted AS (
    SELECT title,
           mode() WITHIN GROUP (ORDER BY next_action) AS next_action,
           count(*)::int AS uses
    FROM app_commitments
    GROUP BY title
  )
  SELECT title, next_action, uses
  FROM counted
  WHERE (SELECT count(*) FROM app_commitments) >= p_min_total
  ORDER BY uses DESC
  LIMIT p_limit
$$;
