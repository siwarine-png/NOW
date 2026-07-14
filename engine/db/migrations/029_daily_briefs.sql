-- One row per user per calendar day (in the user's own timezone, see
-- rules.js's todayKeyInTz), backing the Morning Brief / Evening Debrief
-- prompts. planned_focus is the user's OWN words for today's one thing --
-- deliberately separate from whatever the risk scorer's DO-THIS-NOW pick
-- is, since the Evening Debrief's whole point is comparing "what I said
-- I'd do" against "what I actually did" (checkins), not against the
-- algorithm's own suggestion. shipped_something/shipped_note mirror the
-- Ship-or-Kill checklist's own end-of-day question.
CREATE TABLE daily_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brief_date date NOT NULL,
  planned_focus text,
  morning_completed_at timestamptz,
  shipped_something boolean,
  shipped_note text,
  evening_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, brief_date)
);

CREATE INDEX daily_briefs_user_idx ON daily_briefs(user_id, brief_date DESC);
